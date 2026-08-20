import { useCallback, useEffect, useMemo, useState } from "react";
import { useProjects } from "@/hooks/useProjects";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import {
  buildCoordinationApplicationPackage,
  approveSyntheticApplicationChecklist,
  confirmAllApplicationPackageVerifiedFields,
  confirmApplicationPackageDocumentMapping,
  formatUciUserError,
  getCoordinationDetail,
  listApplicationPackageDocumentCandidates,
  listProjectCoordination,
  openApplicationPackageDocument,
  removeApplicationPackageDocumentMapping,
  repairApplicationPackageDocuments,
  reviewCoordinationApplication,
  setSyntheticApplicationSignatureStatus,
  validateSubmissionPackage,
  updateApplicationPackageReviewItem,
} from "@/lib/uciApi";
import {
  isApplicationTemplateMissingError,
} from "@/components/uci/UciApplicationTemplatePanel";
import {
  getApplicationPackageDraftApplication,
  parseApplicationPackageMetadata,
  parsePackageDocuments,
  canRepairReviewedPackageDocuments,
  applicationReviewPersisted,
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
  UciSubmissionValidationAttemptResponse,
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
  const [repairBusy, setRepairBusy] = useState(false);
  const [applicationTemplateForceVisible, setApplicationTemplateForceVisible] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [mappingBusySlot, setMappingBusySlot] = useState<string | null>(null);
  const [documentOpenBusy, setDocumentOpenBusy] = useState<string | null>(null);
  const [signatureBusyAction, setSignatureBusyAction] = useState<string | null>(null);
  const [reviewItemBusy, setReviewItemBusy] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [signatureReviewNote, setSignatureReviewNote] = useState("");
  const [lastSubmitResult, setLastSubmitResult] = useState<
    UciApplicationSubmitResponse | UciSubmissionValidationAttemptResponse | null
  >(null);
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
  const embeddedProvider = record?.utility_providers
    ? Array.isArray(record.utility_providers)
      ? record.utility_providers[0]
      : record.utility_providers
    : null;
  const providerSlug = String(
    packageApp?.provider_slug || embeddedProvider?.slug || "",
  ).toLowerCase();
  const isPepco = providerSlug === "pepco";
  const isDominionSynthetic =
    providerSlug === "dominion" && packageMeta?.checklist_mode === "synthetic_test";

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

  const applyApplicationMutation = useCallback((application: CoordinationApplication) => {
    setDetail((current) =>
      current
        ? {
            ...current,
            applications: current.applications.map((item) =>
              item.id === application.id ? application : item,
            ),
          }
        : current,
    );
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
    if (isPepco && !externalApplicationId) {
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
  }, [coordinationId, packageApp?.id, externalApplicationId, isPepco]);

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
  const repairEligibility = canRepairReviewedPackageDocuments(packageApp, packageDocs);

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
      const result = await buildCoordinationApplicationPackage(coordinationId, {
        external_application_id: externalApplicationId || undefined,
        checklist_mode:
          packageMeta?.checklist_mode === "synthetic_test" ? "synthetic_test" : undefined,
      });
      applyApplicationMutation(result.application);
      setApplicationTemplateForceVisible(false);
      void refreshDetail(coordinationId).catch(() => {
        // The build response is authoritative; a read refresh can retry independently.
      });
      setActionMessage({
        tone: "ok",
        text: "Application package draft saved — review missing documents before submission",
      });
    } catch (e: unknown) {
      if (isApplicationTemplateMissingError(e)) {
        setApplicationTemplateForceVisible(true);
      }
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Application package build failed"),
      });
    } finally {
      setBuildBusy(false);
    }
  };

  const repairPackageDocuments = async () => {
    if (!packageApp || !coordinationId || !repairEligibility.ok) {
      setActionMessage({
        tone: "warn",
        text: repairEligibility.reason || "Package repair is not available",
      });
      return;
    }
    if (
      !window.confirm(
        "Repair unresolved document references on this reviewed package? Affected slots will need re-confirmation and the package must be marked reviewed again before Stage 4 validation.",
      )
    ) {
      return;
    }
    setRepairBusy(true);
    setActionMessage(null);
    try {
      const result = await repairApplicationPackageDocuments(packageApp.id);
      applyApplicationMutation(result.application);
      void refreshDetail(coordinationId).catch(() => {
        // Repair response is authoritative.
      });
      setActionMessage({
        tone: "ok",
        text:
          result.worksheet_project_document_id != null
            ? `Package repaired — worksheet document ${result.worksheet_project_document_id}. Re-confirm repaired slots and mark reviewed again.`
            : "Package repaired — re-confirm repaired slots and mark reviewed again.",
      });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Package repair failed"),
      });
    } finally {
      setRepairBusy(false);
    }
  };

  const approveSyntheticChecklist = async () => {
    if (!packageApp || !coordinationId || !isDominionSynthetic) return;
    setReviewBusy(true);
    setActionMessage(null);
    try {
      const result = await approveSyntheticApplicationChecklist(packageApp.id, {
        note: reviewNotes.trim() || "Approved for Highland Springs synthetic Stage 3 testing only",
      });
      applyApplicationMutation(result.application as CoordinationApplication);
      void refreshDetail(coordinationId).catch(() => {
        // The mutation response already contains the persisted checklist state.
      });
      setActionMessage({ tone: "ok", text: "Synthetic test checklist approved" });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Synthetic checklist approval failed"),
      });
    } finally {
      setReviewBusy(false);
    }
  };

  const setSignatureStatus = async (
    documentKey: string,
    status: "unknown" | "unsigned" | "signed_manual_verified",
  ) => {
    if (!packageApp || !coordinationId || !isDominionSynthetic) return;
    setSignatureBusyAction(`${documentKey}:${status}`);
    setActionMessage(null);
    try {
      const result = await setSyntheticApplicationSignatureStatus(packageApp.id, {
        document_key: documentKey,
        signature_status: status,
        review_note:
          status === "signed_manual_verified"
            ? signatureReviewNote.trim()
            : undefined,
      });
      applyApplicationMutation(result.application);
      setSignatureReviewNote("");
      setActionMessage({
        tone: "ok",
        text:
          status === "signed_manual_verified"
            ? "Signature marked signed"
            : `Synthetic signature status set to ${status}`,
      });
      void refreshDetail(coordinationId).catch((refreshError: unknown) => {
        setActionMessage({
          tone: "warn",
          text: `Signature saved, but the latest package refresh failed: ${formatUciUserError(
            refreshError,
            "Unable to refresh package details",
          )}`,
        });
      });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Synthetic signature update failed"),
      });
    } finally {
      setSignatureBusyAction(null);
    }
  };

  const markReviewed = async (status: "reviewed" | "needs_changes") => {
    if (!packageApp || !coordinationId) return;
    setReviewBusy(true);
    setActionMessage(null);
    try {
      const result = await reviewCoordinationApplication(packageApp.id, {
        status,
        notes: reviewNotes.trim() || undefined,
      });
      if (status === "reviewed" && !applicationReviewPersisted(result.application)) {
        throw new Error("Mark reviewed did not persist — refresh and try again");
      }
      applyApplicationMutation(result.application);
      void refreshDetail(coordinationId).catch(() => {
        // The mutation response already contains the canonical reviewed state.
      });
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

  const updateReviewItem = async (
    kind: "field" | "document",
    key: string,
    status: "confirmed" | "needs_correction",
    correctionReason?: string,
    issueArea?: "mapping" | "signature",
  ) => {
    if (!packageApp || !coordinationId) return;
    setReviewItemBusy(`${kind}:${key}`);
    setActionMessage(null);
    try {
      const result = await updateApplicationPackageReviewItem(packageApp.id, {
        kind,
        item_key: key,
        status,
        note:
          status === "needs_correction"
            ? correctionReason?.trim() || reviewNotes.trim() || undefined
            : undefined,
        issue_area: status === "needs_correction" ? issueArea ?? "mapping" : undefined,
      });
      applyApplicationMutation(result.application);
      setActionMessage({
        tone: status === "confirmed" ? "ok" : "warn",
        text:
          status === "confirmed"
            ? "Package item confirmed"
            : "Change requested",
      });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Package review item update failed"),
      });
    } finally {
      setReviewItemBusy(null);
    }
  };

  const confirmAllVerifiedFields = async () => {
    if (!packageApp || !coordinationId) return;
    if (
      !window.confirm(
        "Confirm that every eligible Load Profile Analyzer field is appropriate for this application package?",
      )
    ) {
      return;
    }
    setReviewItemBusy("all-fields");
    setActionMessage(null);
    try {
      const result = await confirmAllApplicationPackageVerifiedFields(packageApp.id);
      applyApplicationMutation(result.application);
      setActionMessage({
        tone: "ok",
        text: `${result.confirmed_count} verified package fields confirmed`,
      });
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Bulk field confirmation failed"),
      });
    } finally {
      setReviewItemBusy(null);
    }
  };

  const submitPackage = async () => {
    if (!packageApp || !coordinationId) return;
    if (packageApp.draft_status !== "reviewed") {
      setActionMessage({
        tone: "warn",
        text: "Validate submission package stays disabled until the package is Reviewed",
      });
      return;
    }
    if (submitBusy) return;
    setSubmitBusy(true);
    setActionMessage(null);
    setLastSubmitResult(null);
    try {
      // Stage 4 P0: dedicated validation_only endpoint — never live submit.
      const result = await validateSubmissionPackage(packageApp.id);
      setLastSubmitResult(result);
      applyApplicationMutation(result.application);
      void refreshDetail(coordinationId).catch(() => {
        // Validation persisted; a failed follow-up read must not turn it into a failed action.
      });
      if (result.result === "blocked" || result.status === "validation_blocked") {
        const blockerText = Array.isArray(result.blockers)
          ? result.blockers
              .map((b) =>
                typeof b === "object" && b && "message" in b
                  ? String((b as { message?: unknown }).message ?? "")
                  : "",
              )
              .filter(Boolean)
              .join("; ")
          : "";
        setActionMessage({
          tone: "warn",
          text:
            blockerText ||
            result.message ||
            "Validation blocked — package remains Not submitted",
        });
      } else if (result.result === "failed" || result.status === "validation_failed") {
        setActionMessage({
          tone: "bad",
          text: result.message || "Validation failed — package remains Not submitted",
        });
      } else {
        setActionMessage({
          tone: "ok",
          text:
            result.message ||
            "Validation passed — package remains Not submitted. Actual submission is not configured.",
        });
      }
    } catch (e: unknown) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(e, "Submission package validation failed"),
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
      const result = await confirmApplicationPackageDocumentMapping(packageApp.id, {
        slot_key: slotKey,
        candidate_id: candidateId,
        external_application_id: externalApplicationId || undefined,
      });
      if (result.no_change) {
        setActionMessage({ tone: "warn", text: "Already mapped — no change was saved" });
        return;
      }
      applyApplicationMutation(result.application as CoordinationApplication);
      setSelectedCandidateBySlot((prev) => {
        const next = { ...prev };
        delete next[slotKey];
        return next;
      });
      setActionMessage({
        tone: "ok",
        text: "Document changed — reconfirm this requirement for package review",
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
      const result = await removeApplicationPackageDocumentMapping(packageApp.id, {
        slot_key: slotKey,
      });
      applyApplicationMutation(result.application as CoordinationApplication);
      void refreshDetail(coordinationId).catch(() => {
        // Mapping response is authoritative.
      });
      void loadCandidates();
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

  const openDocument = async (documentKey: string) => {
    if (!packageApp) return;
    setDocumentOpenBusy(documentKey);
    setActionMessage(null);
    try {
      const result = await openApplicationPackageDocument(packageApp.id, documentKey);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      setActionMessage({
        tone: "bad",
        text: formatUciUserError(error, "Failed to open document"),
      });
    } finally {
      setDocumentOpenBusy(null);
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
    repairBusy,
    reviewBusy,
    submitBusy,
    mappingBusySlot,
    documentOpenBusy,
    signatureBusyAction,
    reviewItemBusy,
    reviewNotes,
    setReviewNotes,
    signatureReviewNote,
    setSignatureReviewNote,
    lastSubmitResult,
    actionMessage,
    buildEligibility,
    repairEligibility,
    saveDraft,
    repairPackageDocuments,
    approveSyntheticChecklist,
    setSignatureStatus,
    markReviewed,
    updateReviewItem,
    confirmAllVerifiedFields,
    submitPackage,
    confirmMapping,
    removeMapping,
    openDocument,
    reload: load,
    sections,
    completion,
    serviceFields,
    loadMetrics,
    projectAddress,
    providerSlug,
    isPepco,
    isDominionSynthetic,
    applicationTemplateForceVisible,
    saveDraftAfterTemplateSaved: saveDraft,
  };
}
