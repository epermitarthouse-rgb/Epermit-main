import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import {
  buildCoordinationApplicationPackage,
  confirmApplicationPackageDocumentMapping,
  formatUciUserError,
  getCoordinationDetail,
  listApplicationPackageDocumentCandidates,
  listProjectCoordination,
  removeApplicationPackageDocumentMapping,
  reviewCoordinationApplication,
  submitCoordinationApplication,
} from "@/lib/uciApi";
import {
  getApplicationPackageDraftApplication,
  parseApplicationPackageMetadata,
  parsePackageDocuments,
  type UciPackageDocumentCandidatesResponse,
} from "@/lib/uciApplicationPrep";
import {
  getLoadProfileDraftApplication,
  parseLoadProfileSummary,
} from "@/lib/uciLoadProfile";
import {
  buildLoadProfileMetrics,
  canBuildApplicationPackage,
  computeBuilderCompletionPercent,
  evaluateUciBuilderSections,
  resolveServiceFieldValues,
} from "@/lib/uciBuilder/uciBuilderReadiness";
import type {
  CoordinationApplication,
  CoordinationRecord,
  UciApplicationSubmitResponse,
  UciRecordDetailResponse,
} from "@/types/uci";

export function useUciApplicationBuilder() {
  const { projectId } = useResolvedProjectId();
  const { projects } = useProjects();
  const project = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<CoordinationRecord[]>([]);
  const [coordinationId, setCoordinationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UciRecordDetailResponse | null>(null);
  const [externalApplicationId, setExternalApplicationId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<UciPackageDocumentCandidatesResponse | null>(null);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [buildBusy, setBuildBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [mappingBusySlot, setMappingBusySlot] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [lastSubmitResult, setLastSubmitResult] = useState<UciApplicationSubmitResponse | null>(
    null,
  );
  const [selectedCandidateBySlot, setSelectedCandidateBySlot] = useState<Record<string, string>>(
    {},
  );
  const [actionMessage, setActionMessage] = useState<{
    tone: "ok" | "warn" | "bad";
    text: string;
  } | null>(null);

  const record = useMemo(
    () => records.find((r) => r.id === coordinationId) ?? detail?.record ?? null,
    [records, coordinationId, detail],
  );

  const applications: CoordinationApplication[] = detail?.applications ?? [];
  const loadDraft = getLoadProfileDraftApplication(applications);
  const loadSummary = parseLoadProfileSummary(loadDraft?.load_summary);
  const packageApp = getApplicationPackageDraftApplication(applications);
  const packageMeta = parseApplicationPackageMetadata(packageApp);
  const packageDocs = parsePackageDocuments(packageApp?.package_documents);

  const portalApplications = useMemo(
    () =>
      applications.filter(
        (a) =>
          a.record_source === "portal_sync" &&
          a.external_application_id &&
          String(a.external_application_id).trim(),
      ),
    [applications],
  );

  const refreshDetail = useCallback(async (id: string) => {
    const d = await getCoordinationDetail(id);
    setDetail(d);
    return d;
  }, []);

  const load = useCallback(async () => {
    if (!projectId) {
      setRecords([]);
      setCoordinationId(null);
      setDetail(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setActionMessage(null);
    try {
      const { records: list } = await listProjectCoordination(projectId);
      setRecords(list);
      const preferred =
        list.find((r) => String(r.utility_type || "").toLowerCase() === "electric") ??
        list[0] ??
        null;
      const nextId = preferred?.id ?? null;
      setCoordinationId(nextId);
      if (nextId) {
        const d = await refreshDetail(nextId);
        const portal =
          d.applications.find(
            (a) => a.record_source === "portal_sync" && a.external_application_id,
          )?.external_application_id ?? null;
        setExternalApplicationId(portal);
      } else {
        setDetail(null);
        setExternalApplicationId(null);
      }
    } catch (e: unknown) {
      setError(formatUciUserError(e, "Failed to load UCI coordination"));
      setRecords([]);
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, refreshDetail]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSelectedCandidateBySlot({});
  }, [externalApplicationId, packageApp?.id]);

  const loadCandidates = useCallback(async () => {
    if (!coordinationId || !packageApp) {
      setCandidates(null);
      return;
    }
    if (!externalApplicationId) {
      setCandidates(null);
      setCandidatesError(
        "Select a portal application before mapping package documents (PEPCO scope required).",
      );
      return;
    }
    setCandidatesLoading(true);
    setCandidatesError(null);
    try {
      const payload = await listApplicationPackageDocumentCandidates(coordinationId, {
        external_application_id: externalApplicationId,
      });
      setCandidates(payload);
    } catch (e: unknown) {
      setCandidatesError(formatUciUserError(e, "Failed to load document candidates"));
      setCandidates(null);
    } finally {
      setCandidatesLoading(false);
    }
  }, [coordinationId, packageApp?.id, externalApplicationId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates, packageApp?.package_documents]);

  const selectCoordination = async (id: string) => {
    setCoordinationId(id);
    setLastSubmitResult(null);
    setActionMessage(null);
    try {
      const d = await refreshDetail(id);
      const portal =
        d.applications.find(
          (a) => a.record_source === "portal_sync" && a.external_application_id,
        )?.external_application_id ?? null;
      setExternalApplicationId(portal);
    } catch (e: unknown) {
      setError(formatUciUserError(e, "Failed to load coordination detail"));
    }
  };

  const buildEligibility = canBuildApplicationPackage({
    coordinationId,
    applications,
  });

  const saveDraft = async () => {
    if (!coordinationId || !buildEligibility.ok) {
      setActionMessage({
        tone: "warn",
        text: buildEligibility.reason || "Cannot save draft yet",
      });
      return;
    }
    setBuildBusy(true);
    setActionMessage(null);
    try {
      await buildCoordinationApplicationPackage(coordinationId, {
        external_application_id: externalApplicationId || undefined,
      });
      await refreshDetail(coordinationId);
      setActionMessage({
        tone: "ok",
        text: "Application package draft saved — review missing documents before submission",
      });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Application package build failed"),
      });
    } finally {
      setBuildBusy(false);
    }
  };

  const markReviewed = async (status: "reviewed" | "needs_changes") => {
    if (!packageApp || !coordinationId) return;
    setReviewBusy(true);
    setActionMessage(null);
    try {
      await reviewCoordinationApplication(packageApp.id, {
        status,
        notes: reviewNotes.trim() || undefined,
      });
      await refreshDetail(coordinationId);
      setActionMessage({
        tone: "ok",
        text: status === "reviewed" ? "Application marked reviewed" : "Changes requested",
      });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Application review failed"),
      });
    } finally {
      setReviewBusy(false);
    }
  };

  const submitPackage = async () => {
    if (!packageApp || !coordinationId) return;
    if (packageApp.draft_status !== "reviewed") {
      setActionMessage({
        tone: "warn",
        text: "Portal submission stays disabled until draft status is reviewed",
      });
      return;
    }
    setSubmitBusy(true);
    setActionMessage(null);
    setLastSubmitResult(null);
    try {
      // Never pass live_submission_confirmed — dry-run / gated path only.
      const result = await submitCoordinationApplication(packageApp.id);
      setLastSubmitResult(result);
      await refreshDetail(coordinationId);
      if (result.dry_run || result.status === "human_required") {
        setActionMessage({
          tone: "warn",
          text:
            result.message ||
            "Submission completed as validation dry-run / human-required — not a live portal filing",
        });
      } else if (result.status === "failed") {
        setActionMessage({
          tone: "bad",
          text: result.message || result.reason || "Submission failed",
        });
      } else {
        setActionMessage({
          tone: "ok",
          text: result.message || "Submission recorded — confirm utility acknowledgment separately",
        });
      }
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Application submission failed"),
      });
    } finally {
      setSubmitBusy(false);
    }
  };

  const confirmMapping = async (slotKey: string) => {
    if (!packageApp || !coordinationId) return;
    const candidateId = selectedCandidateBySlot[slotKey];
    if (!candidateId) {
      setActionMessage({ tone: "warn", text: "Select a document before confirming" });
      return;
    }
    setMappingBusySlot(slotKey);
    try {
      await confirmApplicationPackageDocumentMapping(packageApp.id, {
        slot_key: slotKey,
        candidate_id: candidateId,
        external_application_id: externalApplicationId || undefined,
      });
      setSelectedCandidateBySlot((prev) => {
        const next = { ...prev };
        delete next[slotKey];
        return next;
      });
      await refreshDetail(coordinationId);
      await loadCandidates();
      setActionMessage({
        tone: "ok",
        text: "Document mapping confirmed — slot marked attached after human review",
      });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Failed to confirm document mapping"),
      });
    } finally {
      setMappingBusySlot(null);
    }
  };

  const removeMapping = async (slotKey: string) => {
    if (!packageApp || !coordinationId) return;
    setMappingBusySlot(slotKey);
    try {
      await removeApplicationPackageDocumentMapping(packageApp.id, { slot_key: slotKey });
      await refreshDetail(coordinationId);
      await loadCandidates();
      setActionMessage({ tone: "ok", text: "Document mapping removed" });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Failed to remove document mapping"),
      });
    } finally {
      setMappingBusySlot(null);
    }
  };

  const projectAddress =
    packageMeta?.project_address?.formatted?.trim() ||
    (typeof project?.address === "string" ? project.address.trim() : "") ||
    null;

  const sections = evaluateUciBuilderSections({
    hasProject: Boolean(projectId),
    record,
    applications,
    projectAddress,
  });
  const completion = computeBuilderCompletionPercent(sections);
  const serviceFields = resolveServiceFieldValues({
    projectName: project?.name ?? null,
    projectType: project?.project_type ? String(project.project_type) : null,
    record,
    summary: loadSummary,
  });
  const loadMetrics = buildLoadProfileMetrics(loadSummary);

  return {
    projectId,
    project,
    loading,
    error,
    records,
    coordinationId,
    selectCoordination,
    record,
    applications,
    loadDraft,
    loadSummary,
    packageApp,
    packageMeta,
    packageDocs,
    portalApplications,
    externalApplicationId,
    setExternalApplicationId,
    candidates,
    candidatesError,
    candidatesLoading,
    loadCandidates,
    selectedCandidateBySlot,
    setSelectedCandidateBySlot,
    buildBusy,
    reviewBusy,
    submitBusy,
    mappingBusySlot,
    reviewNotes,
    setReviewNotes,
    lastSubmitResult,
    actionMessage,
    buildEligibility,
    saveDraft,
    markReviewed,
    submitPackage,
    confirmMapping,
    removeMapping,
    reload: load,
    sections,
    completion,
    serviceFields,
    loadMetrics,
    projectAddress,
  };
}
