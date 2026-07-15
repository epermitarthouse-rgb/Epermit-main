import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { ConnectedLoadReviewPanel } from "@/components/uci/ConnectedLoadReviewPanel";
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
import { cn } from "@/lib/utils";
import {
  getLoadProfileDraftApplication,
  parseLoadProfileSummary,
  type UciLoadProfileSummary,
} from "@/lib/uciLoadProfile";
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
  getUtilityTypeContracts,
  groupSourceDocumentsByCategory,
  MANUAL_VERIFIABLE_FIELD_OPTIONS,
  persistWorkspaceSection,
  readStoredWorkspaceSection,
  validateManualVerifiedInput,
  type ManualVerifiedInputPayload,
  type WorkspaceSection,
} from "@/lib/uciLoadProfileWorkspace";
import type { CoordinationApplication } from "@/types/uci";

const SECTION_LABELS: Record<WorkspaceSection, string> = {
  overview: "Overview",
  source_documents: "Source documents",
  verified_inputs: "Verified inputs",
  load_schedule: "Load schedule",
  service_sizing: "Service sizing",
  review_queue: "Review queue",
  package_readiness: "Package readiness",
};

export function LoadProfileWorkspace({
  applications,
  utilityType,
  selectedPepcoApplicationId,
  selectedPepcoApplicationTitle,
  formatWhen,
  mutedClass,
  toolbarOutlineButtonClass,
  analyzeBusy,
  candidateBusy,
  candidateResolveBusy,
  manualVerifyBusy,
  importFindingsBusy,
  packageStatus,
  hasProjectAddress,
  packageDocumentsComplete,
  onAnalyze,
  onExtractCandidates,
  onImportDocumentFindings,
  onResolveCandidate,
  onManualVerify,
}: {
  applications: CoordinationApplication[];
  utilityType: string | null | undefined;
  selectedPepcoApplicationId: string | null;
  selectedPepcoApplicationTitle?: string | null;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  analyzeBusy: boolean;
  candidateBusy: boolean;
  candidateResolveBusy: string | null;
  manualVerifyBusy: boolean;
  importFindingsBusy: boolean;
  packageStatus?: string | null;
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
  onManualVerify: (payload: ManualVerifiedInputPayload & { review_note: string }) => void;
}) {
  const [section, setSection] = useState<WorkspaceSection>(
    () => readStoredWorkspaceSection() ?? DEFAULT_WORKSPACE_SECTION,
  );
  const [manualOpen, setManualOpen] = useState(false);
  const [manualField, setManualField] = useState(MANUAL_VERIFIABLE_FIELD_OPTIONS[0].field_key);
  const [manualValue, setManualValue] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [manualSource, setManualSource] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualConfirm, setManualConfirm] = useState(false);

  useEffect(() => {
    persistWorkspaceSection(section);
  }, [section]);

  const draftApp = getLoadProfileDraftApplication(applications);
  const summary = parseLoadProfileSummary(draftApp?.load_summary) as UciLoadProfileSummary | null;

  const overview = useMemo(
    () =>
      getLoadProfileOverview(summary, {
        externalApplicationId: selectedPepcoApplicationId,
        packageStatus,
        packageConnectedLoadSatisfied: undefined,
      }),
    [summary, selectedPepcoApplicationId, packageStatus],
  );

  const sourceRows = useMemo(
    () => buildSourceDocumentRows(summary, selectedPepcoApplicationId),
    [summary, selectedPepcoApplicationId],
  );
  const sourceGroups = useMemo(() => groupSourceDocumentsByCategory(sourceRows), [sourceRows]);
  const verifiedGroups = useMemo(() => buildVerifiedInputRows(summary), [summary]);
  const scheduleRows = useMemo(() => buildLoadScheduleRows(summary), [summary]);
  const scheduleTotals = useMemo(() => getLoadScheduleTotals(summary), [summary]);
  const serviceFields = useMemo(() => buildServiceSizingFields(summary), [summary]);
  const readiness = useMemo(
    () =>
      buildPackageReadinessChecklist(summary, {
        hasProjectAddress,
        packageDocumentsComplete,
        humanReviewComplete: false,
      }),
    [summary, hasProjectAddress, packageDocumentsComplete],
  );
  const utilityContract = getUtilityTypeContracts(utilityType ?? summary?.utility_type ?? "electric");
  const bridgeMeta = summary?.load_extraction?.document_findings_bridge;

  const manualOption =
    MANUAL_VERIFIABLE_FIELD_OPTIONS.find((o) => o.field_key === manualField) ??
    MANUAL_VERIFIABLE_FIELD_OPTIONS[0];

  const submitManual = () => {
    const payload: ManualVerifiedInputPayload & { review_note: string } = {
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

  return (
    <Card className="border-border/60">
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Agent 2 — Load profile workspace</CardTitle>
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
        ) : (
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
              <p className={cn("text-xs", mutedClass)}>
                Filename and ranking categories suggest document type only — they do not verify
                engineering content.
              </p>
              {(Object.entries(sourceGroups) as Array<[string, typeof sourceRows]>).map(
                ([cat, rows]) =>
                  rows.length === 0 ? null : (
                    <section key={cat}>
                      <p className={cn("text-xs font-medium uppercase tracking-wide", mutedClass)}>
                        {rows[0]?.categoryLabel} ({rows.length})
                      </p>
                      <SourceDocumentsTable rows={rows} mutedClass={mutedClass} />
                    </section>
                  ),
              )}
              {sourceRows.length === 0 ? (
                <EmptyState
                  title="No source documents"
                  description="Run extraction after utility documents are scraped."
                  mutedClass={mutedClass}
                />
              ) : null}
            </TabsContent>

            <TabsContent value="verified_inputs" className="mt-4 space-y-4">
              <VerifiedInputsGroups groups={verifiedGroups} mutedClass={mutedClass} />
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
                  title="Load schedule not supported"
                  description={`${utilityContract.utilityType} schedules are not implemented in this workspace yet.`}
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
              <ServiceSizingPanel fields={serviceFields} mutedClass={mutedClass} />
              <TemplateStatusPanel overview={overview} mutedClass={mutedClass} />
            </TabsContent>

            <TabsContent value="review_queue" className="mt-4">
              {summary ? (
                <ConnectedLoadReviewPanel
                  key={`${summary.load_extraction?.last_extracted_at ?? ""}-${summary.load_extraction?.document_findings_bridge?.last_imported_at ?? ""}-${summary.candidate_values?.length ?? 0}`}
                  summary={summary}
                  selectedPepcoApplicationId={selectedPepcoApplicationId}
                  connectedLoadReady={overview.connectedLoadSatisfied}
                  candidateBusy={candidateBusy}
                  candidateResolveBusy={candidateResolveBusy}
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
        )}
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
}: {
  rows: ReturnType<typeof buildSourceDocumentRows>;
  mutedClass: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Document</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Candidates</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.documentKey}>
            <TableCell>
              <p className="text-sm font-medium">{row.documentName}</p>
              {row.failureReason ? (
                <p className={cn("text-xs text-destructive", mutedClass)}>{row.failureReason}</p>
              ) : null}
            </TableCell>
            <TableCell className={cn("text-xs", mutedClass)}>{row.sourceLabel}</TableCell>
            <TableCell className={cn("text-xs", mutedClass)}>
              {row.processingStatus} · {row.textExtractionStatus}
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.candidateCount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function VerifiedInputsGroups({
  groups,
  mutedClass,
}: {
  groups: ReturnType<typeof buildVerifiedInputRows>;
  mutedClass: string;
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
                <li key={row.id} className="rounded border bg-muted/10 p-2 text-sm">
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
            <TableCell>{row.demandFactor ?? "Unresolved"}</TableCell>
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
  mutedClass,
}: {
  fields: ReturnType<typeof buildServiceSizingFields>;
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
        {overview.templateStatus === "none"
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
        <Label>Engineering note (required)</Label>
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
