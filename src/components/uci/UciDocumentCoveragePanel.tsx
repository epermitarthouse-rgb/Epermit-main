import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  formatDocumentRole,
  formatExtractionMethodBadge,
  formatFindingCategory,
  formatFindingFieldLabel,
  formatPageCoverage,
  formatProcessingStatus,
  formatUciStage,
  groupFindingsByCategory,
  countFallbackPages,
  hasSensitiveStorageFields,
  processingStatusTone,
  runStatusTone,
  type UciDocumentManifestEntry,
  type UciDocumentProcessingManifestResponse,
} from "@/lib/uciDocumentProcessing";
import {
  downloadPepcoApplicationDocument,
  formatDocumentProcessingUserError,
  formatUciUserError,
  getCoordinationDocumentManifest,
  getCoordinationDocumentFallbackEstimate,
  logDocumentProcessingErrorDev,
  openPepcoApplicationDocumentView,
  runCoordinationDocumentProcessing,
  runCoordinationDocumentFallback,
} from "@/lib/uciApi";
import { toast } from "sonner";

export function UciDocumentCoveragePanel({
  coordinationId,
  externalApplicationId,
  externalApplicationTitle,
  mutedClass,
  toolbarOutlineButtonClass,
  resolvePortalDocumentIndex,
}: {
  coordinationId: string;
  externalApplicationId: string | null;
  externalApplicationTitle?: string | null;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  resolvePortalDocumentIndex?: (fileName: string) => number | null;
}) {
  const [manifest, setManifest] = useState<UciDocumentProcessingManifestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadBusy, setLoadBusy] = useState(false);
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [findingsDocId, setFindingsDocId] = useState<string | null>(null);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [pagesDoc, setPagesDoc] = useState<UciDocumentManifestEntry | null>(null);
  const [docActionBusy, setDocActionBusy] = useState<string | null>(null);
  const [fallbackBusy, setFallbackBusy] = useState<string | null>(null);
  const [fallbackEstimate, setFallbackEstimate] = useState<{
    total: number;
    vision: number;
    ocr: number;
  } | null>(null);

  const loadManifest = useCallback(
    async (includeFindings = false) => {
      if (!coordinationId || !externalApplicationId) return;
      setLoadBusy(true);
      try {
        const data = await getCoordinationDocumentManifest(coordinationId, {
          external_application_id: externalApplicationId,
          include_findings: includeFindings,
        });
        setManifest(data);
      } catch (e: unknown) {
        toast.error(formatUciUserError(e, "Failed to load document coverage"));
      } finally {
        setLoadBusy(false);
      }
    },
    [coordinationId, externalApplicationId],
  );

  useEffect(() => {
    void loadManifest(false);
  }, [loadManifest]);

  useEffect(() => {
    if (!coordinationId || !externalApplicationId || !manifest?.documents?.length) {
      setFallbackEstimate(null);
      return;
    }
    void (async () => {
      try {
        const est = await getCoordinationDocumentFallbackEstimate(coordinationId, {
          external_application_id: externalApplicationId,
          mode: "all",
        });
        setFallbackEstimate({ total: est.total, vision: est.vision, ocr: est.ocr });
      } catch {
        setFallbackEstimate(countFallbackPages(manifest.documents));
      }
    })();
  }, [coordinationId, externalApplicationId, manifest?.documents, manifest?.run_completed_at]);

  const handleRun = async (refresh = false) => {
    if (!coordinationId || !externalApplicationId) return;
    setBusy(true);
    try {
      const result = await runCoordinationDocumentProcessing(coordinationId, {
        external_application_id: externalApplicationId,
        refresh,
      });
      if (result.run_status === "complete") {
        toast.success("Document processing complete");
      } else if (result.run_status === "partial") {
        const failed = result.documents_failed ?? 0;
        const complete = result.documents_complete ?? 0;
        toast.warning(
          failed > 0
            ? `${complete} document(s) processed; ${failed} failed. Open coverage details.`
            : `Document processing ${result.run_status} — review coverage`,
        );
      } else {
        toast.error("Document processing failed — review coverage details.");
      }
      await loadManifest(false);
    } catch (e: unknown) {
      logDocumentProcessingErrorDev(e);
      toast.error(formatDocumentProcessingUserError(e, "Document processing failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleReprocess = () => void handleRun(true);

  const handleFallbackRun = async (mode: "all" | "vision" | "ocr") => {
    if (!coordinationId || !externalApplicationId) return;
    setFallbackBusy(mode);
    try {
      const est = await getCoordinationDocumentFallbackEstimate(coordinationId, {
        external_application_id: externalApplicationId,
        mode,
      });
      if (est.total === 0) {
        toast.info("No pages require this fallback method");
        return;
      }
      const result = await runCoordinationDocumentFallback(coordinationId, {
        external_application_id: externalApplicationId,
        mode,
      });
      if (result.status === "partial") {
        toast.warning(
          `Partial fallback — ${result.pages_processed} processed, ${result.pages_failed} failed`,
        );
      } else {
        toast.success(`Processed ${result.pages_processed} fallback page(s)`);
      }
      await loadManifest(false);
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Fallback processing failed"));
    } finally {
      setFallbackBusy(null);
    }
  };

  const openPageDetails = (doc: UciDocumentManifestEntry) => {
    setPagesDoc(doc);
    setPagesOpen(true);
  };

  const handleView = async (doc: UciDocumentManifestEntry) => {
    if (!coordinationId || !externalApplicationId) return;
    const idx = resolvePortalDocumentIndex?.(doc.original_filename);
    if (idx == null) {
      toast.info("View is available for portal documents after scrape indexing");
      return;
    }
    const key = `${doc.document_id}-view`;
    const previewWindow = window.open("about:blank", "_blank");
    setDocActionBusy(key);
    try {
      await openPepcoApplicationDocumentView(
        coordinationId,
        externalApplicationId,
        idx,
        previewWindow,
      );
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to open document"));
    } finally {
      setDocActionBusy(null);
    }
  };

  const handleDownload = async (doc: UciDocumentManifestEntry) => {
    if (!coordinationId || !externalApplicationId) return;
    const idx = resolvePortalDocumentIndex?.(doc.original_filename);
    if (idx == null) {
      toast.info("Download is available for portal documents after scrape indexing");
      return;
    }
    const key = `${doc.document_id}-download`;
    setDocActionBusy(key);
    try {
      await downloadPepcoApplicationDocument(
        coordinationId,
        externalApplicationId,
        idx,
        doc.original_filename,
      );
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to download document"));
    } finally {
      setDocActionBusy(null);
    }
  };

  const openFindings = async (docId: string) => {
    setFindingsDocId(docId);
    setFindingsOpen(true);
    if (!manifest?.findings) {
      await loadManifest(true);
    }
  };

  const coverage = manifest?.coverage;
  const documents = manifest?.documents ?? [];
  const fallbackCounts = fallbackEstimate ?? countFallbackPages(documents);
  const providerStatus = manifest?.fallback_provider_status;
  const selectedFindings = useMemo(() => {
    const all = manifest?.findings ?? [];
    if (!findingsDocId) return [];
    return all.filter((f) => f.document_id === findingsDocId);
  }, [manifest?.findings, findingsDocId]);
  const findingsGroups = useMemo(() => groupFindingsByCategory(selectedFindings), [selectedFindings]);

  const runTone = runStatusTone(manifest?.run_status);

  if (!externalApplicationId) {
    return (
      <Card className="border-border/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Document coverage</CardTitle>
          <CardDescription className={cn("text-[11px]", mutedClass)}>
            Select a utility application to process and review all downloaded documents.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card className="border-border/60">
        <CardHeader className="space-y-2 pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Document coverage</CardTitle>
              <CardDescription className={cn("text-[11px]", mutedClass)}>
                Every utility document is registered, parsed, and mapped to UCI stages.
                {externalApplicationTitle ? ` · ${externalApplicationTitle}` : ""}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={toolbarOutlineButtonClass}
                disabled={busy || loadBusy}
                onClick={() => void loadManifest(false)}
              >
                {loadBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Refresh
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={toolbarOutlineButtonClass}
                disabled={busy}
                onClick={() => void handleRun(false)}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Process documents
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={toolbarOutlineButtonClass}
                disabled={busy}
                onClick={() => void handleReprocess()}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reprocess all
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={toolbarOutlineButtonClass}
                disabled={!!fallbackBusy || fallbackCounts.vision === 0}
                onClick={() => void handleFallbackRun("vision")}
              >
                {fallbackBusy === "vision" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Vision ({fallbackCounts.vision})
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={toolbarOutlineButtonClass}
                disabled={!!fallbackBusy || fallbackCounts.ocr === 0}
                onClick={() => void handleFallbackRun("ocr")}
              >
                {fallbackBusy === "ocr" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                OCR ({fallbackCounts.ocr})
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={toolbarOutlineButtonClass}
                disabled={!!fallbackBusy || fallbackCounts.total === 0}
                onClick={() => void handleFallbackRun("all")}
              >
                {fallbackBusy === "all" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                All fallback ({fallbackCounts.total})
              </Button>
            </div>
          </div>
          {providerStatus && (!providerStatus.vision_available || !providerStatus.ocr_available) ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-100">
              {providerStatus.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          ) : null}
          {manifest?.fallback_processing?.last_run_at ? (
            <p className={cn("text-xs", mutedClass)}>
              Last fallback: {manifest.fallback_processing.last_run_at} ·{" "}
              {manifest.fallback_processing.pages_processed ?? 0} processed ·{" "}
              {manifest.fallback_processing.pages_failed ?? 0} failed ·{" "}
              {manifest.fallback_processing.findings_created ?? 0} findings
            </p>
          ) : null}
          {manifest ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  runTone === "success"
                    ? "default"
                    : runTone === "warning"
                      ? "destructive"
                      : runTone === "destructive"
                        ? "destructive"
                        : "secondary"
                }
              >
                Run: {manifest.run_status}
              </Badge>
              <Badge variant="outline">{documents.length} registered</Badge>
              {coverage ? (
                <>
                  <Badge variant="outline">{coverage.complete} complete</Badge>
                  {coverage.partial > 0 ? (
                    <Badge variant="secondary">{coverage.partial} partial</Badge>
                  ) : null}
                  {coverage.failed > 0 ? (
                    <Badge variant="destructive">{coverage.failed} failed</Badge>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {coverage ? (
            <CoverageSummaryGrid coverage={coverage} mutedClass={mutedClass} />
          ) : (
            <p className={cn("text-sm", mutedClass)}>
              No document processing run yet. Process documents to build a complete manifest.
            </p>
          )}

          {(manifest?.completion_blockers?.length ?? 0) > 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <p className="font-medium text-amber-900 dark:text-amber-100">Completion blockers</p>
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-800 dark:text-amber-200">
                {manifest?.completion_blockers?.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {documents.length === 0 ? (
            <EmptyCoverageState mutedClass={mutedClass} runStatus={manifest?.run_status} />
          ) : (
            <DocumentTable
              documents={documents}
              mutedClass={mutedClass}
              toolbarOutlineButtonClass={toolbarOutlineButtonClass}
              docActionBusy={docActionBusy}
              onView={(d) => void handleView(d)}
              onDownload={(d) => void handleDownload(d)}
              onFindings={(id) => void openFindings(id)}
              onPages={(d) => openPageDetails(d)}
            />
          )}

          {manifest?.findings_by_stage_counts ? (
            <FindingsStageCounts counts={manifest.findings_by_stage_counts} mutedClass={mutedClass} />
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={findingsOpen} onOpenChange={setFindingsOpen}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Document findings</DialogTitle>
            <DialogDescription>
              Broad structured inventory — filtered by UCI stage for agent consumption.
            </DialogDescription>
          </DialogHeader>
          {selectedFindings.length === 0 ? (
            <p className={cn("text-sm", mutedClass)}>No findings for this document.</p>
          ) : (
            <div className="space-y-4">
              {Object.entries(findingsGroups).map(([category, items]) => (
                <Collapsible key={category} defaultOpen>
                  <CollapsibleTrigger className="flex w-full items-center justify-between rounded border px-3 py-2 text-sm font-medium">
                    {formatFindingCategory(category)} ({items.length})
                    <ChevronDown className="h-4 w-4" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    {items.map((f) => (
                      <div key={f.finding_id} className="rounded border bg-muted/10 p-2 text-xs">
                        <p className="font-medium">
                          {formatFindingFieldLabel(f)}
                          {f.unit ? ` · ${f.unit}` : ""}
                          {f.page_number != null ? ` · p.${f.page_number}` : ""}
                        </p>
                        <p>
                          {String(f.normalized_value ?? f.raw_value)}
                          {f.entity_name ? ` · ${f.entity_name}` : ""}
                          {f.entity_type ? ` (${f.entity_type.replace(/_/g, " ")})` : ""}
                        </p>
                        <p className={cn("mt-1", mutedClass)}>{f.evidence_text.slice(0, 200)}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(f.uci_stages ?? []).map((stage) => (
                            <Badge key={stage} variant="outline" className="text-[10px]">
                              {formatUciStage(stage)}
                            </Badge>
                          ))}
                          <Badge variant="secondary" className="text-[10px]">
                            {formatExtractionMethodBadge(f.extraction_method)}
                          </Badge>
                          {f.confidence != null ? (
                            <Badge variant="outline" className="text-[10px]">
                              {Math.round(f.confidence * 100)}% conf.
                            </Badge>
                          ) : null}
                        </div>
                        {f.review_blocked_reason ? (
                          <p className={cn("mt-1 text-amber-700 dark:text-amber-400", mutedClass)}>
                            Review blocked: {f.review_blocked_reason}
                          </p>
                        ) : null}
                        <Badge variant="outline" className="mt-1">
                          {f.verification_status}
                        </Badge>
                      </div>
                    ))}
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pagesOpen} onOpenChange={setPagesOpen}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Page coverage — {pagesDoc?.original_filename ?? "Document"}</DialogTitle>
            <DialogDescription>
              Per-page classification, fallback status, and extraction methods. Human review is
              required for all engineering findings.
            </DialogDescription>
          </DialogHeader>
          {!pagesDoc?.page_records?.length ? (
            <p className={cn("text-sm", mutedClass)}>No per-page records for this document.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Page</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagesDoc.page_records.map((page) => (
                  <TableRow key={page.page_number}>
                    <TableCell>{page.page_number}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{page.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {(page.extraction_methods ?? []).map((m) => (
                          <Badge key={m} variant="secondary" className="text-[10px]">
                            {formatExtractionMethodBadge(m)}
                          </Badge>
                        ))}
                        {page.page_analysis?.recommended_method ? (
                          <Badge variant="outline" className="text-[10px]">
                            → {formatExtractionMethodBadge(page.page_analysis.recommended_method)}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className={cn("text-xs", mutedClass)}>
                      {page.page_analysis?.reason ?? page.failure_reason ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function CoverageSummaryGrid({
  coverage,
  mutedClass,
}: {
  coverage: NonNullable<UciDocumentProcessingManifestResponse["coverage"]>;
  mutedClass: string;
}) {
  const items = [
    { label: "Discovered", value: coverage.documents_discovered },
    { label: "Complete", value: coverage.complete },
    { label: "Partial", value: coverage.partial },
    { label: "Failed", value: coverage.failed },
    { label: "Duplicate", value: coverage.duplicate },
    { label: "Unsupported", value: coverage.unsupported },
    { label: "Total pages", value: coverage.total_pages },
    { label: "Processed pages", value: coverage.processed_pages },
    { label: "Findings", value: coverage.findings_extracted },
    { label: "Pending review", value: coverage.findings_pending_review },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border bg-muted/10 px-2 py-1.5">
          <p className={cn("text-[10px] uppercase tracking-wide", mutedClass)}>{item.label}</p>
          <p className="text-sm font-medium tabular-nums">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function DocumentTable({
  documents,
  mutedClass,
  toolbarOutlineButtonClass,
  docActionBusy,
  onView,
  onDownload,
  onFindings,
  onPages,
}: {
  documents: UciDocumentManifestEntry[];
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  docActionBusy: string | null;
  onView: (doc: UciDocumentManifestEntry) => void;
  onDownload: (doc: UciDocumentManifestEntry) => void;
  onFindings: (docId: string) => void;
  onPages: (doc: UciDocumentManifestEntry) => void;
  onRetryFallback?: (doc: UciDocumentManifestEntry, mode: "all" | "vision" | "ocr") => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Document</TableHead>
          <TableHead>Roles</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Pages</TableHead>
          <TableHead className="text-right">Findings</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => {
          const tone = processingStatusTone(doc.processing_status);
          const badgeVariant =
            tone === "success"
              ? "default"
              : tone === "warning"
                ? "secondary"
                : tone === "destructive"
                  ? "destructive"
                  : "outline";
          if (hasSensitiveStorageFields(doc as unknown as Record<string, unknown>)) {
            console.warn("Manifest entry exposed storage path — should be sanitized server-side");
          }
          return (
            <TableRow key={doc.document_id}>
              <TableCell>
                <p className="text-sm font-medium">{doc.original_filename}</p>
                {doc.failure_reason ? (
                  <p className={cn("text-xs text-destructive", mutedClass)}>{doc.failure_reason}</p>
                ) : null}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {doc.document_roles.slice(0, 3).map((role) => (
                    <Badge key={role} variant="outline" className="text-[10px]">
                      {formatDocumentRole(role)}
                    </Badge>
                  ))}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={badgeVariant}>{formatProcessingStatus(doc.processing_status)}</Badge>
              </TableCell>
              <TableCell className={cn("text-xs", mutedClass)}>
                {formatPageCoverage(doc.page_coverage)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{doc.findings_count}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={toolbarOutlineButtonClass}
                    disabled={docActionBusy != null}
                    onClick={() => onView(doc)}
                  >
                    {docActionBusy === `${doc.document_id}-view` ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={toolbarOutlineButtonClass}
                    disabled={docActionBusy != null}
                    onClick={() => onDownload(doc)}
                  >
                    Download
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={toolbarOutlineButtonClass}
                    onClick={() => onPages(doc)}
                  >
                    Pages
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={toolbarOutlineButtonClass}
                    onClick={() => onFindings(doc.document_id)}
                  >
                    Findings
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function FindingsStageCounts({
  counts,
  mutedClass,
}: {
  counts: NonNullable<UciDocumentProcessingManifestResponse["findings_by_stage_counts"]>;
  mutedClass: string;
}) {
  return (
    <div className={cn("text-xs", mutedClass)}>
      <p className="font-medium text-foreground">Findings by UCI stage</p>
      <p>
        {formatUciStage("agent_2_load_profile")}: {counts.agent_2_load_profile} ·{" "}
        {formatUciStage("agent_3_application_package")}: {counts.agent_3_application_package} ·{" "}
        {formatUciStage("agent_4_submission")}: {counts.agent_4_submission}
      </p>
    </div>
  );
}

function EmptyCoverageState({
  mutedClass,
  runStatus,
}: {
  mutedClass: string;
  runStatus?: string;
}) {
  if (runStatus === "failed") {
    return (
      <p className={cn("text-sm text-destructive", mutedClass)}>
        Document processing failed — review failure reasons above.
      </p>
    );
  }
  if (runStatus === "partial") {
    return (
      <p className={cn("text-sm text-amber-800 dark:text-amber-200", mutedClass)}>
        Partial run — some documents may still need processing or review.
      </p>
    );
  }
  return (
    <p className={cn("text-sm", mutedClass)}>
      No documents registered yet. Run processing after utility documents are downloaded.
    </p>
  );
}
