import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileUp, FolderOpen, Loader2, RotateCcw } from "lucide-react";
import { useLocation } from "react-router-dom";
import {
  ConnectedLoadReviewPanel,
  type CandidateResolutionState,
} from "@/components/uci/ConnectedLoadReviewPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  getLoadProfileDraftApplication,
  parseLoadProfileSummary,
  type UciLoadProfileSummary,
} from "@/lib/uciLoadProfile";
import {
  getCoordinationDocumentManifest,
  getCoordinationLoadProfileDocuments,
  linkCoordinationLoadProfileDocuments,
  unlinkCoordinationLoadProfileDocument,
  setCoordinationLoadProfileDocumentInclusion,
  runCoordinationDocumentProcessing,
  importCoordinationDocumentFindings,
  formatUciUserError,
} from "@/lib/uciApi";
import type {
  UciDocumentProcessingManifestResponse,
  UciDocumentReprocessResponse,
} from "@/lib/uciDocumentProcessing";
import {
  buildLoadScheduleRows,
  buildPackageReadinessChecklist,
  buildServiceSizingFields,
  buildSourceDocumentRows,
  buildVerifiedInputRows,
  DEFAULT_WORKSPACE_SECTION,
  getDataLevelLabel,
  getLoadProfileOverview,
  getLoadScheduleTotals,
  getServiceSizingRecommendation,
  getUtilityTypeContracts,
  groupSourceDocumentsByCategory,
  MANUAL_VERIFIABLE_FIELD_OPTIONS,
  persistWorkspaceSection,
  readStoredWorkspaceSection,
  validateManualVerifiedInput,
  formatSelectedForAnalysisLabel,
  type ManualVerifiedInputPayload,
  type WorkspaceSection,
} from "@/lib/uciLoadProfileWorkspace";
import type { CoordinationApplication, UciLoadProfileDocumentScope } from "@/types/uci";
import { toast } from "sonner";

const SECTION_LABELS: Record<WorkspaceSection, string> = {
  overview: "Overview",
  source_documents: "Source documents",
  verified_inputs: "Verified inputs",
  load_schedule: "Load schedule",
  service_sizing: "Service sizing",
  review_queue: "Review queue",
  package_readiness: "Package readiness",
};

export interface Agent2ManualUploadProgress {
  stage: "uploading" | "processing" | "importing";
  current: number;
  total: number;
  fileName?: string;
}

export function LoadProfileWorkspace({
  coordinationId,
  applications,
  utilityType,
  selectedPepcoApplicationId,
  selectedPepcoApplicationTitle,
  providerName,
  providerSlug,
  formatWhen,
  mutedClass,
  toolbarOutlineButtonClass,
  analyzeBusy,
  candidateBusy,
  candidateResolutionState,
  manualVerifyBusy,
  manualUploadBusy,
  manualUploadProgress,
  importFindingsBusy,
  packageStatus,
  stage2Completed,
  hasProjectAddress,
  packageDocumentsComplete,
  onAnalyze,
  onExtractCandidates,
  onImportDocumentFindings,
  onResolveCandidate,
  onManualVerify,
  onManualUpload,
  onReprocessDocuments,
}: {
  coordinationId: string;
  applications: CoordinationApplication[];
  utilityType: string | null | undefined;
  selectedPepcoApplicationId: string | null;
  selectedPepcoApplicationTitle?: string | null;
  providerName?: string | null;
  providerSlug?: string | null;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  analyzeBusy: boolean;
  candidateBusy: boolean;
  candidateResolutionState: CandidateResolutionState;
  manualVerifyBusy: boolean;
  manualUploadBusy: boolean;
  manualUploadProgress: Agent2ManualUploadProgress | null;
  importFindingsBusy: boolean;
  packageStatus?: string | null;
  stage2Completed?: boolean;
  hasProjectAddress?: boolean;
  packageDocumentsComplete?: boolean;
  onAnalyze: () => void;
  onExtractCandidates: (refresh?: boolean) => void;
  onImportDocumentFindings: (refresh?: boolean) => void;
  onResolveCandidate: (
    candidateId: string,
    action: "approve" | "edit_approve" | "reject" | "keep_unresolved",
    opts?: { edited_value?: string; edited_unit?: string; review_note?: string },
  ) => void;
  onManualVerify: (payload: ManualVerifiedInputPayload) => void;
  onManualUpload: (files: File[], externalApplicationId: string | null) => Promise<boolean>;
  onReprocessDocuments: (
    documentIds: string[],
    externalApplicationId: string | null,
    onProgress?: (completed: number) => void,
  ) => Promise<{
    results: UciDocumentReprocessResponse[];
    failures: Array<{ document_id: string; message: string }>;
  }>;
}) {
  const location = useLocation();
  const routeParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const focusedFieldKey = routeParams.get("field_key");
  const returnToPackage = routeParams.get("return_to");
  const [section, setSection] = useState<WorkspaceSection>(
    () => readStoredWorkspaceSection() ?? DEFAULT_WORKSPACE_SECTION,
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [manualField, setManualField] = useState<string>(
    MANUAL_VERIFIABLE_FIELD_OPTIONS[0].field_key,
  );
  const [manualValue, setManualValue] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [manualSource, setManualSource] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualConfirm, setManualConfirm] = useState(false);
  const [manualUploadFiles, setManualUploadFiles] = useState<File[]>([]);
  const [processingManifest, setProcessingManifest] =
    useState<UciDocumentProcessingManifestResponse | null>(null);
  const [documentScope, setDocumentScope] = useState<UciLoadProfileDocumentScope | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<string[]>([]);
  const [pickerUtilityFilter, setPickerUtilityFilter] = useState<string>("all");
  const [scopeBusy, setScopeBusy] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [reprocessBusy, setReprocessBusy] = useState<string[] | null>(null);
  const [reprocessProgress, setReprocessProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const reprocessInFlightRef = useRef(false);

  useEffect(() => {
    persistWorkspaceSection(section);
  }, [section]);

  useEffect(() => {
    if (routeParams.get("section") !== "verified_inputs" || !focusedFieldKey) return;
    setSection("verified_inputs");
    const timer = window.setTimeout(() => {
      document
        .getElementById(`verified-input-${focusedFieldKey}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusedFieldKey, routeParams]);

  useEffect(() => {
    let cancelled = false;
    setProcessingManifest(null);
    setManifestError(null);
    if (!coordinationId || manualUploadBusy) return;

    void getCoordinationDocumentManifest(coordinationId, {
      external_application_id: selectedPepcoApplicationId,
      include_findings: false,
    })
      .then((manifest) => {
        if (!cancelled) setProcessingManifest(manifest);
      })
      .catch(() => {
        if (!cancelled) {
          setManifestError(
            "Processing metadata could not be loaded; displayed statuses may be incomplete.",
          );
        }
      });

    void getCoordinationLoadProfileDocuments(coordinationId, {
      external_application_id: selectedPepcoApplicationId,
    })
      .then((scope) => {
        if (!cancelled) setDocumentScope(scope);
      })
      .catch(() => {
        if (!cancelled) setDocumentScope(null);
      });

    return () => {
      cancelled = true;
    };
  }, [coordinationId, selectedPepcoApplicationId, manualUploadBusy]);

  const draftApp = getLoadProfileDraftApplication(applications);
  const summary = parseLoadProfileSummary(draftApp?.load_summary) as UciLoadProfileSummary | null;

  const overview = useMemo(
    () =>
      getLoadProfileOverview(summary, {
        externalApplicationId: selectedPepcoApplicationId,
        packageStatus,
        packageConnectedLoadSatisfied: undefined,
        stage2Completed,
      }),
    [summary, selectedPepcoApplicationId, packageStatus, stage2Completed],
  );

  const sourceRows = useMemo(
    () =>
      buildSourceDocumentRows(
        summary,
        selectedPepcoApplicationId,
        processingManifest?.documents ?? [],
      ),
    [summary, selectedPepcoApplicationId, processingManifest?.documents],
  );
  const sourceGroups = useMemo(() => groupSourceDocumentsByCategory(sourceRows), [sourceRows]);
  const pendingReprocessIds = useMemo(
    () =>
      sourceRows
        .filter((row) => {
          if (row.status === "failed" || row.status === "pending") return true;
          if (row.status !== "needs_fallback") return false;
          const document = processingManifest?.documents.find(
            (item) => item.document_id === row.documentKey,
          );
          return !["unavailable", "manual_review_required"].includes(
            String(document?.fallback_status ?? ""),
          );
        })
        .map((row) => row.documentKey)
        .filter((id) => processingManifest?.documents.some((doc) => doc.document_id === id)),
    [processingManifest?.documents, sourceRows],
  );
  const verifiedGroups = useMemo(() => buildVerifiedInputRows(summary), [summary]);
  const scheduleRows = useMemo(() => buildLoadScheduleRows(summary), [summary]);
  const scheduleTotals = useMemo(() => getLoadScheduleTotals(summary), [summary]);
  const serviceFields = useMemo(() => buildServiceSizingFields(summary), [summary]);
  const serviceSizingRecommendation = useMemo(
    () => getServiceSizingRecommendation(summary),
    [summary],
  );
  const readiness = useMemo(
    () =>
      buildPackageReadinessChecklist(summary, {
        hasProjectAddress,
        packageDocumentsComplete,
        humanReviewComplete: stage2Completed,
      }),
    [summary, hasProjectAddress, packageDocumentsComplete, stage2Completed],
  );
  const utilityContract = getUtilityTypeContracts(utilityType ?? summary?.utility_type ?? "electric");
  const bridgeMeta = summary?.load_extraction?.document_findings_bridge;
  const uploadExternalApplicationId =
    selectedPepcoApplicationId ??
    summary?.load_extraction?.external_application_id ??
    applications.find((application) => application.external_application_id)
      ?.external_application_id ??
    null;

  const manualOption =
    MANUAL_VERIFIABLE_FIELD_OPTIONS.find((o) => o.field_key === manualField) ??
    MANUAL_VERIFIABLE_FIELD_OPTIONS[0];

  const submitManual = () => {
    const payload: ManualVerifiedInputPayload = {
      field_key: manualField,
      value: manualValue,
      unit: manualUnit || manualOption.unit || undefined,
      source_reference: manualSource || undefined,
      review_note: manualNote,
    };
    const err = validateManualVerifiedInput(payload);
    if (err || !manualConfirm) return;
    onManualVerify(payload);
    setManualOpen(false);
    setManualValue("");
    setManualNote("");
    setManualConfirm(false);
  };

  const reprocessDocuments = async (documentIds: string[]) => {
    if (reprocessInFlightRef.current || documentIds.length === 0) return;
    reprocessInFlightRef.current = true;
    setReprocessBusy(documentIds);
    setReprocessProgress({ completed: 0, total: documentIds.length });
    try {
      await onReprocessDocuments(
        documentIds,
        selectedPepcoApplicationId,
        (completed) => setReprocessProgress({ completed, total: documentIds.length }),
      );
      try {
        setProcessingManifest(
          await getCoordinationDocumentManifest(coordinationId, {
            external_application_id: selectedPepcoApplicationId,
            include_findings: false,
          }),
        );
        setManifestError(null);
      } catch {
        setManifestError("Reprocessing finished, but the updated document status could not be loaded.");
      }
    } finally {
      reprocessInFlightRef.current = false;
      setReprocessBusy(null);
      setReprocessProgress(null);
    }
  };

  const refreshDocumentScope = async () => {
    const scope = await getCoordinationLoadProfileDocuments(coordinationId, {
      external_application_id: selectedPepcoApplicationId,
    });
    setDocumentScope(scope);
    return scope;
  };

  const useProjectDocumentsForCoordination = async (projectDocumentIds: string[]) => {
    if (scopeBusy || projectDocumentIds.length === 0) return;
    setScopeBusy(true);
    try {
      const linked = await linkCoordinationLoadProfileDocuments(coordinationId, {
        project_document_ids: projectDocumentIds,
        included_in_analysis: true,
        external_application_id: selectedPepcoApplicationId,
      });
      setDocumentScope(linked);
      setPickerSelectedIds([]);
      setPickerOpen(false);
      try {
        await runCoordinationDocumentProcessing(coordinationId, {
          external_application_id: selectedPepcoApplicationId,
          document_ids: projectDocumentIds,
        });
        await importCoordinationDocumentFindings(coordinationId, {
          external_application_id: selectedPepcoApplicationId,
        });
      } catch {
        // Link succeeded; processing can be retried from Analyze / Import.
      }
      await refreshDocumentScope();
      toast.success("Documents linked for this coordination record");
    } catch (error) {
      toast.error(formatUciUserError(error, "Failed to use documents for this coordination record"));
    } finally {
      setScopeBusy(false);
    }
  };

  const unlinkUsedDocument = async (projectDocumentId: string, removeFromAnalysisOnly = false) => {
    if (scopeBusy || !projectDocumentId) return;
    setScopeBusy(true);
    try {
      const result = await unlinkCoordinationLoadProfileDocument(coordinationId, projectDocumentId, {
        remove_from_analysis_only: removeFromAnalysisOnly,
        external_application_id: selectedPepcoApplicationId,
      });
      setDocumentScope(result);
      toast.success(
        removeFromAnalysisOnly
          ? "Removed from this analysis. The project document was kept."
          : "Unlinked from this coordination. The project document was kept.",
      );
    } catch (error) {
      toast.error(formatUciUserError(error, "Failed to update document scope"));
    } finally {
      setScopeBusy(false);
    }
  };

  const toggleDocumentIncluded = async (projectDocumentId: string, included: boolean) => {
    if (scopeBusy || !projectDocumentId) return;
    setScopeBusy(true);
    try {
      const result = await setCoordinationLoadProfileDocumentInclusion(
        coordinationId,
        projectDocumentId,
        {
          included_in_analysis: included,
          external_application_id: selectedPepcoApplicationId,
        },
      );
      setDocumentScope(result);
    } catch (error) {
      toast.error(formatUciUserError(error, "Failed to update analysis inclusion"));
    } finally {
      setScopeBusy(false);
    }
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Load Profile Analyzer</CardTitle>
            <CardDescription className={cn("text-[11px]", mutedClass)}>
              Source evidence → verified inputs → load schedule → service sizing → package readiness.
              No engineering values are guessed.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarOutlineButtonClass}
              disabled={analyzeBusy}
              onClick={onAnalyze}
            >
              {analyzeBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {summary ? "Re-analyze" : "Analyze load profile"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarOutlineButtonClass}
              disabled={candidateBusy || !selectedPepcoApplicationId}
              onClick={() => onExtractCandidates(false)}
            >
              {candidateBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Extract candidates
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarOutlineButtonClass}
              disabled={importFindingsBusy || !selectedPepcoApplicationId}
              onClick={() => onImportDocumentFindings(false)}
            >
              {importFindingsBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Import document findings
            </Button>
          </div>
        </div>
        {bridgeMeta?.last_imported_at ? (
          <p className={cn("text-xs", mutedClass)}>
            Last document import: {formatWhen(bridgeMeta.last_imported_at)} ·{" "}
            {bridgeMeta.candidates_created ?? 0} created · {bridgeMeta.candidates_reused ?? 0} reused ·{" "}
            {bridgeMeta.findings_skipped ?? 0} skipped
            {(bridgeMeta.failed_findings?.length ?? 0) > 0
              ? ` · ${bridgeMeta.failed_findings?.length} failed`
              : ""}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{overview.workspaceStateLabel}</Badge>
          <Badge variant="outline" className="capitalize">
            {utilityType || summary?.utility_type || "utility"}
          </Badge>
          {selectedPepcoApplicationTitle ? (
            <Badge variant="outline">{selectedPepcoApplicationTitle}</Badge>
          ) : null}
          <Badge variant="outline">{overview.completionPercent}% complete</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!summary ? (
          <p className={cn("text-sm", mutedClass)}>
            Run load profile analysis to inventory inputs and enable document-scoped extraction.
          </p>
        ) : null}
        <Tabs value={section} onValueChange={(v) => setSection(v as WorkspaceSection)}>
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 lg:grid-cols-4 xl:grid-cols-7">
              {(Object.keys(SECTION_LABELS) as WorkspaceSection[]).map((key) => (
                <TabsTrigger key={key} value={key} className="text-xs">
                  {SECTION_LABELS[key]}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-3">
              <OverviewPanel overview={overview} formatWhen={formatWhen} mutedClass={mutedClass} />
              <DataLevelsHelp mutedClass={mutedClass} />
            </TabsContent>

            <TabsContent value="source_documents" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/10 p-3">
                <p className="text-sm font-medium">
                  {documentScope?.selected_for_analysis_label ||
                    formatSelectedForAnalysisLabel(
                      documentScope?.selected_for_analysis_count ?? 0,
                      utilityType ?? summary?.utility_type,
                    )}
                </p>
                <Badge variant="secondary">
                  {documentScope?.selected_for_analysis_count ?? 0} selected
                </Badge>
              </div>

              <section className="space-y-2">
                <p className="text-sm font-medium">Used for this coordination</p>
                <p className={cn("text-xs", mutedClass)}>
                  Analysis uses only these linked and included documents. Cross-utility files stay
                  labeled with their original source.
                </p>
                {(documentScope?.used.length ?? 0) === 0 ? (
                  <EmptyState
                    title="No documents selected for this coordination"
                    description="Upload files here or select existing project documents. Unrelated utility files are not analyzed automatically."
                    mutedClass={mutedClass}
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead>Source utility / type</TableHead>
                        <TableHead>Document type</TableHead>
                        <TableHead>Processing</TableHead>
                        <TableHead>Analysis</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documentScope?.used.map((row) => (
                        <TableRow key={row.project_document_id}>
                          <TableCell>
                            <p className="text-sm font-medium">{row.file_name}</p>
                          </TableCell>
                          <TableCell className={cn("text-xs", mutedClass)}>
                            {row.provenance_label}
                          </TableCell>
                          <TableCell className={cn("text-xs", mutedClass)}>
                            {row.classified_document_type.replace(/_/g, " ")}
                          </TableCell>
                          <TableCell className={cn("text-xs", mutedClass)}>
                            {row.processing_status_label}
                          </TableCell>
                          <TableCell>
                            <Badge variant={row.included_in_analysis ? "secondary" : "outline"}>
                              {row.included_in_analysis ? "Included" : "Excluded"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {row.portal_document ? null : (
                              <div className="flex justify-end gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={scopeBusy}
                                  onClick={() =>
                                    void toggleDocumentIncluded(
                                      row.project_document_id,
                                      !row.included_in_analysis,
                                    )
                                  }
                                >
                                  {row.included_in_analysis ? "Remove from this analysis" : "Include in analysis"}
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={scopeBusy}
                                  onClick={() => void unlinkUsedDocument(row.project_document_id)}
                                >
                                  Unlink from coordination
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </section>

              <div className="rounded-md border bg-muted/10 p-3">
                <p className="text-sm font-medium">Upload documents</p>
                <p className={cn("mt-1 text-xs", mutedClass)}>
                  Select multiple files in one upload. Files are stored with the project, linked to
                  this coordination record, and included in this analysis by default. No portal
                  application is required.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    className="max-w-md"
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf"
                    multiple
                    disabled={manualUploadBusy}
                    onChange={(event) => {
                      setManualUploadFiles(Array.from(event.target.files ?? []));
                      event.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={manualUploadBusy || manualUploadFiles.length === 0}
                    onClick={() => {
                      if (manualUploadFiles.length === 0) return;
                      void onManualUpload(
                        manualUploadFiles,
                        uploadExternalApplicationId,
                      ).then((completed) => {
                        if (completed) setManualUploadFiles([]);
                      });
                    }}
                  >
                    {manualUploadBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FileUp className="mr-2 h-4 w-4" />
                    )}
                    Upload and process
                  </Button>
                </div>
                {manualUploadFiles.length > 0 ? (
                  <p className={cn("mt-2 text-xs", mutedClass)}>
                    {manualUploadFiles.length} file{manualUploadFiles.length === 1 ? "" : "s"}{" "}
                    selected: {manualUploadFiles.map((file) => file.name).join(", ")}
                  </p>
                ) : null}
                {manualUploadBusy && manualUploadProgress ? (
                  <p className="mt-2 text-xs font-medium" aria-live="polite">
                    {manualUploadProgress.stage === "uploading"
                      ? `Uploading ${manualUploadProgress.current} of ${manualUploadProgress.total}: ${manualUploadProgress.fileName ?? "document"}`
                      : manualUploadProgress.stage === "processing"
                        ? `Processing ${manualUploadProgress.total} uploaded document${manualUploadProgress.total === 1 ? "" : "s"}`
                        : `Importing findings from ${manualUploadProgress.total} document${manualUploadProgress.total === 1 ? "" : "s"}`}
                  </p>
                ) : null}
              </div>

              <div className="rounded-md border bg-muted/10 p-3">
                <p className="text-sm font-medium">Select from project documents</p>
                <p className={cn("mt-1 text-xs", mutedClass)}>
                  Choose existing project files, including cross-utility documents, then use them
                  for this coordination record. They are not analyzed until you opt in.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={scopeBusy}
                  onClick={() => setPickerOpen(true)}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Select from project documents
                </Button>
              </div>

              <p className={cn("text-xs", mutedClass)}>
                Filename and ranking categories suggest document type only — they do not verify
                engineering content.
              </p>
              {pendingReprocessIds.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={reprocessBusy != null}
                  onClick={() => void reprocessDocuments(pendingReprocessIds)}
                >
                  {reprocessBusy ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-4 w-4" />
                  )}
                  {reprocessProgress && reprocessProgress.total > 1
                    ? `Reprocessing ${reprocessProgress.completed}/${reprocessProgress.total}`
                    : "Reprocess pending documents"}
                </Button>
              ) : null}
              {manifestError ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">{manifestError}</p>
              ) : null}

              {(documentScope?.other_project_documents.length ?? 0) > 0 ? (
                <Collapsible>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm">
                    Other project documents ({documentScope?.other_project_documents.length})
                    <ChevronDown className="h-4 w-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    {documentScope?.other_project_documents.map((row) => (
                      <div key={row.project_document_id} className="rounded-md border px-3 py-2 text-sm">
                        <p className="font-medium">{row.file_name}</p>
                        <p className={cn("text-xs", mutedClass)}>
                          {row.provenance_label} · {row.classified_document_type.replace(/_/g, " ")} · not linked
                        </p>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ) : null}

              <Sheet open={pickerOpen} onOpenChange={setPickerOpen}>
                <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
                  <SheetHeader>
                    <SheetTitle>Select from project documents</SheetTitle>
                    <SheetDescription>
                      Filter by utility type, then use selected files for this coordination record.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="mt-4 space-y-3 overflow-y-auto pr-1">
                    <Select value={pickerUtilityFilter} onValueChange={setPickerUtilityFilter}>
                      <SelectTrigger>
                        <SelectValue placeholder="All utility types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All utility types</SelectItem>
                        <SelectItem value="electric">Electric</SelectItem>
                        <SelectItem value="gas">Gas</SelectItem>
                        <SelectItem value="water">Water</SelectItem>
                        <SelectItem value="project_level">Project-level</SelectItem>
                        <SelectItem value="unknown">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                    {(documentScope?.other_project_documents ?? [])
                      .filter(
                        (row) =>
                          pickerUtilityFilter === "all" ||
                          row.source_utility_type === pickerUtilityFilter ||
                          row.relevance === pickerUtilityFilter,
                      )
                      .map((row) => {
                        const checked = pickerSelectedIds.includes(row.project_document_id);
                        return (
                          <label
                            key={row.project_document_id}
                            className="flex items-start gap-2 rounded-md border p-2 text-sm"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(value) => {
                                setPickerSelectedIds((current) =>
                                  value === true
                                    ? [...current, row.project_document_id]
                                    : current.filter((id) => id !== row.project_document_id),
                                );
                              }}
                            />
                            <span>
                              <span className="block font-medium">{row.file_name}</span>
                              <span className={cn("block text-xs", mutedClass)}>
                                {row.provenance_label} · {row.classified_document_type.replace(/_/g, " ")} ·{" "}
                                {row.linked ? "already linked" : "not linked"}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                  </div>
                  <SheetFooter className="mt-4">
                    <Button
                      type="button"
                      disabled={scopeBusy || pickerSelectedIds.length === 0}
                      onClick={() => void useProjectDocumentsForCoordination(pickerSelectedIds)}
                    >
                      {scopeBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Use for this coordination record
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </TabsContent>

            <TabsContent value="verified_inputs" className="mt-4 space-y-4">
              {returnToPackage ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">
                  <span>
                    Reviewing the exact verified load input used by the Application Builder.
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <a href={returnToPackage}>Return to package</a>
                  </Button>
                </div>
              ) : null}
              <VerifiedInputsGroups
                groups={verifiedGroups}
                mutedClass={mutedClass}
                focusedFieldKey={focusedFieldKey}
              />
              <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm">
                  Add manual verified input
                  <ChevronDown className={cn("h-4 w-4", manualOpen && "rotate-180")} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-3 rounded-md border p-3">
                  <ManualVerifiedForm
                    manualField={manualField}
                    manualValue={manualValue}
                    manualUnit={manualUnit}
                    manualSource={manualSource}
                    manualNote={manualNote}
                    manualConfirm={manualConfirm}
                    manualOption={manualOption}
                    manualVerifyBusy={manualVerifyBusy}
                    onFieldChange={setManualField}
                    onValueChange={setManualValue}
                    onUnitChange={setManualUnit}
                    onSourceChange={setManualSource}
                    onNoteChange={setManualNote}
                    onConfirmChange={setManualConfirm}
                    onSubmit={submitManual}
                  />
                </CollapsibleContent>
              </Collapsible>
            </TabsContent>

            <TabsContent value="load_schedule" className="mt-4 space-y-3">
              {!utilityContract.scheduleSupported ? (
                <EmptyState
                  title="Panel schedule not applicable"
                  description={`${utilityContract.utilityType} uses connected BTU/DFU aggregation in Service sizing rather than an electric panel schedule.`}
                  mutedClass={mutedClass}
                />
              ) : (
                <>
                  <LoadScheduleTable rows={scheduleRows} mutedClass={mutedClass} />
                  <ScheduleTotalsPanel totals={scheduleTotals} mutedClass={mutedClass} />
                </>
              )}
            </TabsContent>

            <TabsContent value="service_sizing" className="mt-4 space-y-3">
              <ServiceSizingPanel
                fields={serviceFields}
                recommendation={serviceSizingRecommendation}
                mutedClass={mutedClass}
              />
              <TemplateStatusPanel overview={overview} mutedClass={mutedClass} />
            </TabsContent>

            <TabsContent value="review_queue" className="mt-4">
              {summary ? (
                <ConnectedLoadReviewPanel
                  key={`${summary.load_extraction?.last_extracted_at ?? ""}-${summary.load_extraction?.document_findings_bridge?.last_imported_at ?? ""}-${summary.candidate_values?.length ?? 0}`}
                  summary={summary}
                  selectedPepcoApplicationId={selectedPepcoApplicationId}
                  providerName={providerName}
                  providerSlug={providerSlug}
                  connectedLoadReady={overview.connectedLoadSatisfied}
                  candidateBusy={candidateBusy}
                  candidateResolutionState={candidateResolutionState}
                  mutedClass={mutedClass}
                  toolbarOutlineButtonClass={toolbarOutlineButtonClass}
                  onExtractCandidates={onExtractCandidates}
                  onResolveCandidate={onResolveCandidate}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="package_readiness" className="mt-4 space-y-3">
              <PackageReadinessPanel items={readiness} mutedClass={mutedClass} />
            </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function OverviewPanel({
  overview,
  formatWhen,
  mutedClass,
}: {
  overview: ReturnType<typeof getLoadProfileOverview>;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="rounded-md border bg-muted/10 p-3 text-sm space-y-1">
        <p>
          <span className="font-medium">Status:</span> {overview.workspaceStateLabel}
        </p>
        <p>
          <span className="font-medium">Connected load:</span>{" "}
          {overview.connectedLoadSatisfied ? "Complete" : "Incomplete"}
        </p>
        <p>
          <span className="font-medium">Human review:</span>{" "}
          {overview.humanReviewRequired ? "Required" : "Not flagged"}
        </p>
        <p className={cn("text-xs", mutedClass)}>
          Last extraction: {overview.lastExtractedAt ? formatWhen(overview.lastExtractedAt) : "—"}
        </p>
        <p className={cn("text-xs", mutedClass)}>
          Last approval: {overview.lastApprovalAt ? formatWhen(overview.lastApprovalAt) : "—"}
        </p>
      </div>
      <div className="rounded-md border bg-muted/10 p-3 text-sm space-y-1">
        <p className="font-medium">Blocking issues</p>
        {overview.blockingIssues.length === 0 ? (
          <p className={cn("text-xs", mutedClass)}>None flagged</p>
        ) : (
          <ul className={cn("list-disc pl-4 text-xs", mutedClass)}>
            {overview.blockingIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
        {overview.hasOnlyPanelEvidence ? (
          <p className="text-xs text-amber-800 dark:text-amber-200">
            Panel evidence alone cannot complete the project-level connected-load requirement.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DataLevelsHelp({ mutedClass }: { mutedClass: string }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-xs font-medium text-foreground">
        Data levels (help)
      </CollapsibleTrigger>
      <CollapsibleContent className={cn("mt-2 space-y-1 text-xs", mutedClass)}>
        <p>{getDataLevelLabel(1)} — snippets, panel totals, spec references</p>
        <p>{getDataLevelLabel(2)} — extracted candidates awaiting review</p>
        <p>{getDataLevelLabel(3)} — human-approved source facts</p>
        <p>{getDataLevelLabel(4)} — calculated schedule values (template/formula required)</p>
        <p>{getDataLevelLabel(5)} — frozen application package snapshot</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SourceDocumentsTable({
  rows,
  mutedClass,
  knownDocumentIds,
  reprocessBusy,
  onReprocess,
}: {
  rows: ReturnType<typeof buildSourceDocumentRows>;
  mutedClass: string;
  knownDocumentIds: Set<string>;
  reprocessBusy: string[] | null;
  onReprocess: (documentId: string) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Document</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Findings</TableHead>
          <TableHead className="text-right">Candidates</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.documentKey}>
            <TableCell>
              <p className="text-sm font-medium">{row.documentName}</p>
            </TableCell>
            <TableCell className={cn("text-xs", mutedClass)}>{row.sourceLabel}</TableCell>
            <TableCell className={cn("text-xs", mutedClass)}>
              <p className="font-medium text-foreground">{row.statusLabel}</p>
              {row.statusReason ? <p>{row.statusReason}</p> : null}
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.findingsCount}</TableCell>
            <TableCell className="text-right tabular-nums">{row.candidateCount}</TableCell>
            <TableCell className="text-right">
              {knownDocumentIds.has(row.documentKey) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={reprocessBusy != null}
                  onClick={() => onReprocess(row.documentKey)}
                >
                  {reprocessBusy?.includes(row.documentKey) ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                  )}
                  Reprocess
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function VerifiedInputsGroups({
  groups,
  mutedClass,
  focusedFieldKey,
}: {
  groups: ReturnType<typeof buildVerifiedInputRows>;
  mutedClass: string;
  focusedFieldKey?: string | null;
}) {
  const labels: Record<keyof typeof groups, string> = {
    project_service: "Project / service",
    equipment: "Equipment",
    panels: "Panels (supporting)",
    supporting: "Other supporting evidence",
  };
  const hasAny = Object.values(groups).some((g) => g.length > 0);
  if (!hasAny) {
    return (
      <EmptyState
        title="No verified inputs"
        description="Approve candidates or add a manual verified entry."
        mutedClass={mutedClass}
      />
    );
  }
  return (
    <div className="space-y-4">
      {(Object.keys(labels) as Array<keyof typeof groups>).map((key) =>
        groups[key].length === 0 ? null : (
          <section key={key}>
            <p className={cn("text-xs font-medium uppercase tracking-wide", mutedClass)}>
              {labels[key]} ({groups[key].length})
            </p>
            <ul className="mt-2 space-y-2">
              {groups[key].map((row) => (
                <li
                  key={row.id}
                  id={`verified-input-${row.id}`}
                  className={cn(
                    "rounded border bg-muted/10 p-2 text-sm",
                    focusedFieldKey === row.id && "border-primary bg-primary/10 ring-2 ring-primary/20",
                  )}
                >
                  <div className="flex flex-wrap gap-2">
                    <span className="font-medium">{row.label}</span>
                    <Badge variant="outline">{getDataLevelLabel(row.dataLevel)}</Badge>
                    {row.satisfiesPackage ? (
                      <Badge variant="secondary">Package-eligible</Badge>
                    ) : null}
                  </div>
                  <p>
                    {row.value}
                    {row.unit ? ` ${row.unit}` : ""}
                  </p>
                  <p className={cn("text-xs", mutedClass)}>
                    {row.sourceDocument}
                    {row.page != null ? ` · p.${row.page}` : ""} · {row.approvedBy} ·{" "}
                    {row.approvedAt}
                  </p>
                  {row.evidence ? (
                    <p className={cn("text-xs italic", mutedClass)}>&ldquo;{row.evidence}&rdquo;</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

function LoadScheduleTable({
  rows,
  mutedClass,
}: {
  rows: ReturnType<typeof buildLoadScheduleRows>;
  mutedClass: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No verified schedule rows"
        description="Approve equipment or project-level load inputs first. Panel totals are excluded."
        mutedClass={mutedClass}
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead>Qty</TableHead>
          <TableHead>Connected</TableHead>
          <TableHead>Demand adj.</TableHead>
          <TableHead>Factor</TableHead>
          <TableHead>Unit</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.category}</TableCell>
            <TableCell>{row.quantity ?? "—"}</TableCell>
            <TableCell>{row.connectedLoad ?? "—"}</TableCell>
            <TableCell>{row.demandAdjustedLoad ?? "—"}</TableCell>
            <TableCell>{row.demandFactor ?? row.demandFactorDisplay}</TableCell>
            <TableCell>{row.unit ?? "—"}</TableCell>
            <TableCell>{row.verificationStatus}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ScheduleTotalsPanel({
  totals,
  mutedClass,
}: {
  totals: ReturnType<typeof getLoadScheduleTotals>;
  mutedClass: string;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-3 text-sm space-y-1">
      <p className="font-medium">Totals (verified only, kW/kVA separate)</p>
      <p className={cn("text-xs tabular-nums", mutedClass)}>
        Connected kW: {totals.connectedKw ?? "—"} · Connected kVA: {totals.connectedKva ?? "—"} ·
        Demand kW: {totals.demandKw ?? "—"} · Demand kVA: {totals.demandKva ?? "—"}
      </p>
      <p className={cn("text-xs", mutedClass)}>{totals.finalizeMessage}</p>
    </div>
  );
}

function ServiceSizingPanel({
  fields,
  recommendation,
  mutedClass,
}: {
  fields: ReturnType<typeof buildServiceSizingFields>;
  recommendation: ReturnType<typeof getServiceSizingRecommendation>;
  mutedClass: string;
}) {
  if (fields.length === 0) {
    return (
      <EmptyState
        title="No verified service sizing inputs"
        description="Service size is not calculated without verified demand values and documented formulas."
        mutedClass={mutedClass}
      />
    );
  }
  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/10 p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">Service-size recommendation</p>
          <Badge variant={recommendation.status === "approved" ? "secondary" : "outline"}>
            {recommendation.status.replace(/_/g, " ")}
          </Badge>
        </div>
        <p className={cn("mt-1 text-xs", mutedClass)}>{recommendation.message}</p>
      </div>
      <ul className="space-y-2">
        {fields.map((f) => (
          <li key={f.key} className="rounded border bg-muted/10 p-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <span className="font-medium">{f.label}</span>
              <Badge variant="outline">{f.origin}</Badge>
            </div>
            <p>
              {f.value}
              {f.unit ? ` ${f.unit}` : ""}
            </p>
            <p className={cn("text-xs", mutedClass)}>Source: {f.source}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TemplateStatusPanel({
  overview,
  mutedClass,
}: {
  overview: ReturnType<typeof getLoadProfileOverview>;
  mutedClass: string;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-3 text-sm">
      <p className="font-medium">Template status</p>
      <p className={cn("text-xs capitalize", mutedClass)}>
        {overview.verifiedProjectDemandSatisfied
          ? "Not required for demand — verified project demand provided"
          : overview.templateStatus === "none"
          ? "No approved template — engineering factors cannot be applied automatically"
          : `${overview.templateStatus} template: ${overview.templateName ?? "—"} (${overview.templateVersion ?? "—"})`}
      </p>
    </div>
  );
}

function PackageReadinessPanel({
  items,
  mutedClass,
}: {
  items: ReturnType<typeof buildPackageReadinessChecklist>;
  mutedClass: string;
}) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key} className="flex flex-wrap items-start justify-between gap-2 rounded border p-2 text-sm">
          <div>
            <p className="font-medium">{item.label}</p>
            <p className={cn("text-xs", mutedClass)}>{item.detail}</p>
          </div>
          <Badge
            variant={
              item.status === "complete"
                ? "secondary"
                : item.status === "missing"
                  ? "destructive"
                  : "outline"
            }
          >
            {item.status.replace(/_/g, " ")}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function ManualVerifiedForm({
  manualField,
  manualValue,
  manualUnit,
  manualSource,
  manualNote,
  manualConfirm,
  manualOption,
  manualVerifyBusy,
  onFieldChange,
  onValueChange,
  onUnitChange,
  onSourceChange,
  onNoteChange,
  onConfirmChange,
  onSubmit,
}: {
  manualField: string;
  manualValue: string;
  manualUnit: string;
  manualSource: string;
  manualNote: string;
  manualConfirm: boolean;
  manualOption: (typeof MANUAL_VERIFIABLE_FIELD_OPTIONS)[number];
  manualVerifyBusy: boolean;
  onFieldChange: (v: string) => void;
  onValueChange: (v: string) => void;
  onUnitChange: (v: string) => void;
  onSourceChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onConfirmChange: (v: boolean) => void;
  onSubmit: () => void;
}) {
  const validation = validateManualVerifiedInput({
    field_key: manualField,
    value: manualValue,
    unit: manualUnit || manualOption.unit || undefined,
    source_reference: manualSource || undefined,
    review_note: manualNote,
  });
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-2">
        <Label>Field type</Label>
        <Select value={manualField} onValueChange={onFieldChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MANUAL_VERIFIABLE_FIELD_OPTIONS.map((o) => (
              <SelectItem key={o.field_key} value={o.field_key}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Value</Label>
        <Input value={manualValue} onChange={(e) => onValueChange(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Unit</Label>
        <Input
          value={manualUnit}
          placeholder={manualOption.unit || "optional"}
          onChange={(e) => onUnitChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label>Source / reference</Label>
        <Input value={manualSource} onChange={(e) => onSourceChange(e.target.value)} />
      </div>
      <div className="md:col-span-2 space-y-2">
        <Label>Note (optional)</Label>
        <Textarea value={manualNote} onChange={(e) => onNoteChange(e.target.value)} rows={3} />
      </div>
      <div className="md:col-span-2 flex items-center gap-2">
        <Checkbox
          id="manual-confirm"
          checked={manualConfirm}
          onCheckedChange={(v) => onConfirmChange(v === true)}
        />
        <Label htmlFor="manual-confirm">I confirm this value is engineering-verified</Label>
      </div>
      {validation ? <p className="md:col-span-2 text-xs text-destructive">{validation}</p> : null}
      <Button
        type="button"
        className="md:col-span-2 w-fit"
        disabled={manualVerifyBusy || Boolean(validation) || !manualConfirm}
        onClick={onSubmit}
      >
        {manualVerifyBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save verified input
      </Button>
    </div>
  );
}

function EmptyState({
  title,
  description,
  mutedClass,
}: {
  title: string;
  description: string;
  mutedClass: string;
}) {
  return (
    <div className="rounded-md border border-dashed px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className={cn("mt-1 text-xs", mutedClass)}>{description}</p>
    </div>
  );
}
