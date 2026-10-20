import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AnalyzerDisclosure } from "@/components/compliance/AnalyzerDisclosure";
import { toast } from "sonner";
import {
  CATEGORIES,
  activeLearningVersion,
  decideLearningFeedback,
  draftFromIssue,
  effectKindForCategory,
  evaluationForFeedback,
  listLearningFeedback,
  promoteLearning,
  rollbackLearning,
  submitLearningFeedback,
  validateProposed,
  type LearningFeedbackRow,
  type LearningVersionRow,
} from "@/lib/codeAnalyzer/learningClient";

export interface LearningDraftContext {
  fileName?: string | null;
  documentId?: string | null;
  sheetId?: string | null;
  issue?: {
    id?: string;
    title?: string;
    description?: string;
    codeReference?: string;
    findingType?: string;
    severity?: string;
    location?: string;
  } | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  evidence_review: "Evidence reviewed",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
};

/**
 * Reviewer corrections for one project. Saving a correction does not change the
 * original finding. It becomes reusable only after evidence review, approval,
 * evaluation, and promotion.
 */
export function LearningFeedbackPanel({
  projectId,
  runId,
  codeYear,
  jurisdiction,
  draft,
  onDraftConsumed,
}: {
  projectId: string;
  runId?: string | null;
  codeYear?: string | null;
  jurisdiction?: string | null;
  draft?: LearningDraftContext | null;
  onDraftConsumed?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<LearningFeedbackRow[]>([]);
  const [version, setVersion] = useState<LearningVersionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState("false_positive");
  const [scope, setScope] = useState("sheet");
  const [labelPattern, setLabelPattern] = useState("");
  const [fromType, setFromType] = useState("");
  const [toType, setToType] = useState("");
  const [bindTo, setBindTo] = useState("element");
  const [sectionLocator, setSectionLocator] = useState("");
  const [wrongSection, setWrongSection] = useState("");
  const [issueSignature, setIssueSignature] = useState("");
  const [note, setNote] = useState("");
  const [fileName, setFileName] = useState("");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [originalOutput, setOriginalOutput] = useState<Record<string, unknown>>({});
  const [drawingEvidence, setDrawingEvidence] = useState<Record<string, unknown>>({});
  const [attestation, setAttestation] = useState<Record<string, boolean>>({});
  const [rejectReason, setRejectReason] = useState("");

  async function reload() {
    const [feedback, active] = await Promise.all([
      listLearningFeedback(projectId),
      activeLearningVersion(projectId),
    ]);
    setRows(feedback);
    setVersion(active);
  }

  useEffect(() => {
    let cancelled = false;
    reload().catch((error) => {
      if (!cancelled) toast.error(error instanceof Error ? error.message : "Could not load learning corrections");
    });
    return () => {
      cancelled = true;
    };
    // Reload when the project changes. Drafts are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!draft) return;
    const seeded = draftFromIssue(draft.issue || {}, {
      fileName: draft.fileName,
      documentId: draft.documentId,
      sheetId: draft.sheetId,
      codeYear,
      jurisdiction,
    });
    setExpanded(true);
    setCategory("false_positive");
    setScope(seeded.scope);
    setFileName(draft.fileName || "");
    setDocumentId(draft.documentId || null);
    setSheetId(draft.sheetId || null);
    setIssueSignature(seeded.effect.issue_signature || "");
    setSectionLocator(seeded.effect.section_locator || "");
    setNote("");
    setLabelPattern("");
    setOriginalOutput(seeded.original_output);
    setDrawingEvidence(seeded.drawing_evidence);
    onDraftConsumed?.();
  }, [draft, codeYear, jurisdiction, onDraftConsumed]);

  const kind = effectKindForCategory(category);
  const preview = useMemo(() => {
    const proposed = proposedCorrection();
    return validateProposed(projectId, proposed);
    // proposedCorrection closes over the form fields listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, category, scope, labelPattern, fromType, toType, bindTo, sectionLocator, wrongSection, issueSignature, note, fileName, sheetId, codeYear, jurisdiction]);

  function proposedCorrection() {
    const effectKind = effectKindForCategory(category);
    return {
      scope,
      conditions: {
        sheet_number: scope === "sheet" ? fileName || null : null,
        sheet_id: scope === "sheet" ? sheetId : null,
        discipline: null,
        element_type: fromType || null,
        label_pattern: labelPattern || null,
        code_edition: codeYear || null,
        jurisdiction: jurisdiction || null,
        section_locator: sectionLocator || null,
        fact_kind: null,
      },
      effect: {
        kind: effectKind === "bind_dimension" && bindTo === "unbind" ? "unbind_dimension" : effectKind,
        element_type: toType || null,
        bind_to: bindTo === "calculation" ? "calculation" : bindTo === "element" ? "element" : null,
        section_locator: sectionLocator || null,
        note: note || null,
        issue_signature: issueSignature || null,
      },
    };
  }

  function snapshotForSubmit() {
    if (originalOutput.source === "published_finding") return originalOutput;
    if (kind === "prefer_section") {
      return {
        source: "reviewer_labeled_retrieval",
        packages: [
          {
            questionId: "reviewer",
            code: [
              { section: wrongSection || "unspecified", quote: "retrieved locator", authoritative: true },
              { section: sectionLocator, quote: "retrieved locator", authoritative: true },
            ],
          },
        ],
      };
    }
    if (kind === "bind_dimension" || kind === "unbind_dimension") {
      return {
        source: "reviewer_described_extraction",
        elements: [
          {
            id: "reported-element",
            type: toType || fromType || "element",
            source_label: labelPattern,
          },
        ],
        dimensions: [
          {
            id: "reported-dimension",
            context_text: labelPattern,
            original_content: labelPattern,
            binding_status: bindTo === "unbind" ? "bound" : "unbound",
            association_status: bindTo === "unbind" ? "inferred" : "none",
            related_element_ids: bindTo === "unbind" ? ["reported-element"] : [],
            related_calculation_ids: [],
            value_numeric: null,
          },
        ],
        calculations: bindTo === "calculation" ? [{ id: "reported-calculation", text: labelPattern }] : [],
      };
    }
    if (kind === "relabel_element") {
      return {
        source: "reviewer_described_extraction",
        elements: [
          {
            id: "reported-element",
            type: fromType || "unknown",
            source_label: labelPattern,
          },
        ],
      };
    }
    if (kind === "flag_missed_evidence") {
      return { source: "reviewer_labeled_miss", issues: [], summary: { totalIssues: 0, overallScore: null } };
    }
    return {
      source: "reviewer_note",
      note: note || null,
    };
  }

  async function onSubmit() {
    const proposed = proposedCorrection();
    const check = validateProposed(projectId, proposed);
    if (!check.ok) {
      toast.error(check.errors[0] || "This correction is not specific enough.");
      return;
    }
    setBusy(true);
    try {
      await submitLearningFeedback({
        project_id: projectId,
        run_id: runId || null,
        sheet_id: sheetId,
        document_id: documentId,
        code_edition: codeYear || null,
        jurisdiction: jurisdiction || null,
        source_provision: sectionLocator || null,
        category,
        source_kind: "human_reviewer",
        original_output: snapshotForSubmit(),
        drawing_evidence: {
          ...drawingEvidence,
          file_name: fileName || null,
          document_id: documentId,
        },
        proposed_correction: proposed,
        reviewer_note: note || null,
      });
      toast.success("Correction saved. It stays pending until you review the evidence and approve it.");
      setNote("");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the correction");
    } finally {
      setBusy(false);
    }
  }

  async function runDecision(row: LearningFeedbackRow, action: "start_review" | "approve" | "reject") {
    setBusy(true);
    try {
      await decideLearningFeedback({
        feedbackId: row.id,
        action,
        attestation: action === "approve" ? attestation[row.id] === true : false,
        approvalBasis: action === "approve" ? "human_approval" : null,
        reason: action === "reject" ? rejectReason : null,
      });
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the correction");
    } finally {
      setBusy(false);
    }
  }

  async function onPromote() {
    setBusy(true);
    try {
      const fresh = await listLearningFeedback(projectId);
      const report = evaluationForFeedback(fresh);
      if (!report.decision.ok) {
        toast.error(report.errors[0] || report.decision.reason || "Nothing is ready to promote.");
        return;
      }
      await promoteLearning(projectId, fresh);
      toast.success("Learning promoted for this project. Future analyses can use it where the conditions match.");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not promote learning");
    } finally {
      setBusy(false);
    }
  }

  async function onRollback() {
    setBusy(true);
    try {
      await rollbackLearning(projectId, "Reviewer rolled back the active learning version.");
      toast.success("Active learning version rolled back.");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not roll back learning");
    } finally {
      setBusy(false);
    }
  }

  const evaluation = evaluationForFeedback(rows.filter((row) => row.status === "approved"));

  return (
    <AnalyzerDisclosure
      expanded={expanded}
      onExpandedChange={setExpanded}
      testId="learning-feedback-panel"
      header={
        <>
          <span className="font-medium text-foreground">Learning corrections</span>
          <span className="text-muted-foreground">
            {version ? `Version ${version.version_number} active` : "No active learning"}
            {rows.length ? ` · ${rows.filter((row) => row.status === "pending" || row.status === "evidence_review").length} awaiting review` : ""}
          </span>
        </>
      }
    >
      <div className="space-y-4 border border-t-0 border-border/70 bg-card px-3 py-3 text-sm">
        <p className="text-muted-foreground">
          A correction stays with its original finding. It is reused only after evidence review, human approval,
          a labeled evaluation, and promotion. It does not change adopted code text or mark a check verified.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What was wrong">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Where it applies">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sheet">This sheet only</SelectItem>
                <SelectItem value="project_pattern">This project, when the same label or section appears</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {scope === "sheet" ? (
            <Field label="Sheet file">
              <Input value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="Sheet file name" />
            </Field>
          ) : null}
          {kind === "relabel_element" || kind === "bind_dimension" ? (
            <Field label="Printed label">
              <Input value={labelPattern} onChange={(event) => setLabelPattern(event.target.value)} placeholder="Label as printed, at least 3 characters" />
            </Field>
          ) : null}
          {kind === "relabel_element" ? (
            <>
              <Field label="Analyzer called it">
                <Input value={fromType} onChange={(event) => setFromType(event.target.value)} placeholder="floor_drain" />
              </Field>
              <Field label="It should be">
                <Input value={toType} onChange={(event) => setToType(event.target.value)} placeholder="grease_interceptor" />
              </Field>
            </>
          ) : null}
          {kind === "bind_dimension" ? (
            <>
              <Field label="Bind to">
                <Select value={bindTo} onValueChange={setBindTo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="element">The element with this label</SelectItem>
                    <SelectItem value="calculation">The calculation that states it</SelectItem>
                    <SelectItem value="unbind">Leave it unbound</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {bindTo === "element" ? (
                <Field label="Element type">
                  <Input value={toType} onChange={(event) => setToType(event.target.value)} placeholder="grease_interceptor" />
                </Field>
              ) : null}
            </>
          ) : null}
          {kind === "prefer_section" ? (
            <>
              <Field label="Section that was retrieved">
                <Input value={wrongSection} onChange={(event) => setWrongSection(event.target.value)} placeholder="101.2" />
              </Field>
              <Field label="Section to prefer">
                <Input value={sectionLocator} onChange={(event) => setSectionLocator(event.target.value)} placeholder="403.2" />
              </Field>
            </>
          ) : null}
          {kind === "suppress_false_positive" ? (
            <Field label="Finding title">
              <Input value={issueSignature} onChange={(event) => setIssueSignature(event.target.value)} />
            </Field>
          ) : null}
        </div>
        <Field label="Correction">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What the drawing actually shows. Do not write a new code requirement."
            rows={3}
          />
        </Field>
        <Button type="button" size="sm" onClick={onSubmit} disabled={busy || !preview.ok}>
          Save correction
        </Button>

        <div className="space-y-2">
          {rows.length === 0 ? <p className="text-muted-foreground">No corrections yet.</p> : null}
          {rows.map((row) => (
            <div key={row.id} className="rounded-md border border-border/70 px-3 py-2" data-testid="learning-feedback-row">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{STATUS_LABEL[row.status] || row.status}</span>
                <span className="text-muted-foreground">{row.category.replace(/_/g, " ")}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{String((row.proposed_correction as { effect?: { note?: string } })?.effect?.note || row.reviewer_note || "No note")}</p>
              {row.status === "pending" ? (
                <Button type="button" size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => runDecision(row, "start_review")}>
                  I reviewed the original evidence
                </Button>
              ) : null}
              {row.status === "evidence_review" ? (
                <div className="mt-2 space-y-2">
                  <label className="flex items-start gap-2">
                    <Checkbox
                      checked={attestation[row.id] === true}
                      onCheckedChange={(checked) => setAttestation((current) => ({ ...current, [row.id]: checked === true }))}
                    />
                    <span>I reviewed the original drawing evidence. This correction does not change a code requirement.</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" disabled={busy || attestation[row.id] !== true} onClick={() => runDecision(row, "approve")}>
                      Approve
                    </Button>
                    <Input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Rejection reason" className="max-w-xs" />
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => runDecision(row, "reject")}>
                      Reject
                    </Button>
                  </div>
                </div>
              ) : null}
              {row.status === "rejected" && row.rejection_reason ? (
                <p className="mt-1 text-muted-foreground">Rejected: {row.rejection_reason}</p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <Button type="button" size="sm" variant="outline" disabled={busy || !evaluation.decision.ok} onClick={onPromote}>
            Evaluate and promote
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || !version} onClick={onRollback}>
            Roll back active version
          </Button>
          <span className="text-muted-foreground" data-testid="learning-evaluation-summary">
            {evaluation.evaluation.labeledCount
              ? `${evaluation.evaluation.improvements} labeled improvement(s), ${evaluation.evaluation.regressions} regression(s). This is not an accuracy percentage.`
              : "No approved examples to evaluate."}
          </span>
        </div>
      </div>
    </AnalyzerDisclosure>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
