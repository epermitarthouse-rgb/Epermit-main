import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileJson, FileText, GitBranch, Layers, ListChecks, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, Panel, StatCard } from "@/components/design/ProductPrimitives";
import { FindingsMatrix, SupabaseFindingCard, type FindingSeverityFilter } from "@/components/compliance/supabaseAnalyzerPresentation";
import { countSeverity, downloadSupabaseAnalyzerJson } from "@/lib/supabaseAnalyzer/exportDataset";
import { downloadArchitectReviewPdf } from "@/lib/supabaseAnalyzer/brandedReportDownload";
import type { AnalyzerRunDataset, SupabaseAnalyzerFinding } from "@/lib/supabaseAnalyzer/client";
import type { FindingReviewDecision, ReviewDecisionStatus } from "@/lib/supabaseAnalyzer/reviewDecisions";
import { cn } from "@/lib/utils";
import experiment from "../../out/qwen-spatial-audit/e2e/qwen-analysis.dataset.json";

type Audit = {
  claimId: string; status: string; statusLabel: string; internalConfidence: string; modelEvidenceStatus: string; findingType: string;
  relatedSheets: string[]; codeBasis: string;
  stability: Record<string, { runs: number; drafted: number; published: number }>;
  ocr: { anyUncertain: boolean; evidenceUnits: Array<{ id: string; region?: string; text?: string; uncertain?: boolean; inSummary?: boolean; tiles?: string[]; status?: string }> };
  provenance: { runFile: string; responseId: string; model: string; arm: string; rep: number };
  productionValidator: { outcome: string; rules?: string[]; publishedTitle?: string; publishedSeverity?: string };
  adjudication: { note: string; crops: string[]; by: string };
};

const dataset = experiment.dataset as unknown as AnalyzerRunDataset;
const audit = experiment.audit as unknown as Record<string, Audit>;
const projectName = experiment.projectName as string;
const STORAGE_KEY = `qsa-review:${dataset.run.id}`;

function loadReviews(): FindingReviewDecision[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function FilterRow<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ key: T; label: string; count?: number }>; onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={label}>
      <span className="pilot-kicker mr-1 w-28 shrink-0">{label}</span>
      {options.map((o) => (
        <Button key={o.key} type="button" size="sm" variant={value === o.key ? "tealData" : "outline"} aria-pressed={value === o.key} onClick={() => onChange(o.key)}>
          {o.label}
          {o.count !== undefined ? <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-[10px]">{o.count}</Badge> : null}
        </Button>
      ))}
    </div>
  );
}

function ReviewDetails({ a }: { a: Audit }) {
  const stability = Object.entries(a.stability).map(([arm, s]) => `${arm}: raised in ${s.drafted} of ${s.runs} runs, published in ${s.published}`).join(" · ");
  return (
    <div className="mt-2 space-y-3 rounded-lg border border-border/50 bg-muted/30 p-3 text-sm" data-testid="finding-review-details">
      <div className="grid gap-2 sm:grid-cols-2">
        <p><span className="font-medium text-foreground">Review status:</span> <span className="text-muted-foreground">{a.statusLabel}</span></p>
        <p><span className="font-medium text-foreground">Internal confidence:</span> <span className="text-muted-foreground">{a.internalConfidence} (model), {a.findingType.replace(/_/g, " ")}</span></p>
        <p className="sm:col-span-2"><span className="font-medium text-foreground">Code basis:</span> <span className="text-muted-foreground">{a.codeBasis}</span></p>
        <p className="sm:col-span-2"><span className="font-medium text-foreground">Stability:</span> <span className="text-muted-foreground">{stability}</span></p>
        {a.relatedSheets.length ? <p className="sm:col-span-2"><span className="font-medium text-foreground">Related sheets:</span> <span className="text-muted-foreground">{a.relatedSheets.join(", ")}</span></p> : null}
      </div>
      <div>
        <p className="font-medium text-foreground">Drawing readings used (Qwen2.5-VL-72B)</p>
        <ul className="mt-1 space-y-1">
          {a.ocr.evidenceUnits.map((u) => (
            <li key={u.id} className="text-muted-foreground">
              <span className="font-mono text-xs text-foreground">{u.id}</span>{" "}
              {u.status === "not_in_pack" ? "reference not found in evidence pack" : (
                <>
                  <span className="text-xs">[{u.region}]</span> {u.text}
                  {u.uncertain ? <span className="ml-1 text-xs italic">(reading not independently confirmed)</span> : null}
                  {u.tiles?.length ? <span className="ml-1 font-mono text-[10px]">tiles {u.tiles.join(", ")}</span> : null}
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-medium text-foreground">Evaluator check</p>
        <p className="text-muted-foreground">{a.adjudication.note} <span className="text-xs">({a.adjudication.by})</span></p>
        {a.adjudication.crops.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {a.adjudication.crops.map((c) => (
              <a key={c} href={`/${c}`} target="_blank" rel="noreferrer" className="block overflow-hidden rounded border border-border/60">
                <img src={`/${c}`} alt={`Drawing crop ${c}`} className="h-28 w-auto bg-white object-contain" />
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Source: {a.provenance.model}, arm {a.provenance.arm} run {a.provenance.rep}, response {a.provenance.responseId}. Production validator: {a.productionValidator.outcome}
        {a.productionValidator.rules?.length ? ` (${a.productionValidator.rules.join(", ")})` : ""}
        {a.productionValidator.publishedTitle && a.productionValidator.outcome === "adjusted" ? `; published as "${a.productionValidator.publishedTitle}"` : ""}.
      </p>
    </div>
  );
}

export function QwenReviewPage() {
  const [reviews, setReviews] = useState<FindingReviewDecision[]>(loadReviews);
  const [severity, setSeverity] = useState<FindingSeverityFilter>("all");
  const [drawing, setDrawing] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(() => new Set(dataset.jobs.map((j) => j.id)));
  const [expandedFindings, setExpandedFindings] = useState<Set<string>>(new Set());
  const [detailsOpen, setDetailsOpen] = useState<Set<string>>(new Set());
  const [modifying, setModifying] = useState<{ id: string; text: string } | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews)), [reviews]);
  const reviewed: AnalyzerRunDataset = useMemo(() => ({ ...dataset, reviews }), [reviews]);
  const reviewByFinding = useMemo(() => new Map(reviews.map((r) => [r.finding_id, r])), [reviews]);

  const categories = useMemo(() => [...new Set(dataset.findings.map((f) => f.category))].sort(), []);
  const visible = dataset.findings.filter((f) => (severity === "all" || f.severity === severity) && (drawing === "all" || f.sheet_job_id === drawing)
    && (category === "all" || f.category === category) && (status === "all" || f.verification_status === status));
  const reportIds = new Map(dataset.findings.map((f, i) => [f.id, `F-${String(i + 1).padStart(3, "0")}`]));

  const decide = (f: SupabaseAnalyzerFinding, decision: ReviewDecisionStatus, response: string | null = null) => {
    setReviews((prev) => [...prev.filter((r) => r.finding_id !== f.id), {
      id: `local-${f.id}`, project_id: dataset.run.project_id, run_id: dataset.run.id, sheet_job_id: f.sheet_job_id, finding_id: f.id,
      decision, modified_response: decision === "modified" ? response : null, decided_at: new Date().toISOString(), decided_by: "local-reviewer",
    }]);
  };
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  const pairs = experiment.crossSheet.pairs as Array<{ pairId: string; kind: string; source: string; sourceText: string; target: string; detail: string | null; status: string; lookalike: string[]; bubblePrinted: string | null }>;
  const resolvedRefs = pairs.filter((p) => !p.status.startsWith("not_")).length;
  const comparison = experiment.comparison as any;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <PageHeader
          eyebrow="PermitPilot Code Analyzer · Drawing review"
          title={projectName}
          body={`${dataset.run.code_context} · ${dataset.run.jurisdiction_label}. Five drawings reviewed with cross-sheet references checked against the 82-sheet set.`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="gold" className="gap-1.5" disabled={exporting}
                onClick={async () => { setExporting(true); try { await downloadArchitectReviewPdf(reviewed, projectName); } finally { setExporting(false); } }}>
                <FileText className="h-4 w-4" /> Download PDF
              </Button>
              <Button type="button" variant="outlineGold" className="gap-1.5" onClick={() => downloadSupabaseAnalyzerJson(reviewed, projectName)}>
                <FileJson className="h-4 w-4" /> Download JSON
              </Button>
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Drawings reviewed" value={dataset.jobs.length} icon={Layers} />
          <StatCard label="Observations" value={dataset.findings.length} icon={ListChecks} hint={`${new Set(dataset.findings.map((f) => f.sheet_job_id)).size} drawings with observations`} />
          <StatCard label="Cross-sheet references" value={resolvedRefs} icon={GitBranch} hint="resolved to a sheet or detail" />
          <StatCard label="Reviewed" value={`${reviews.length}/${dataset.findings.length}`} icon={Search} hint="accepted, modified or rejected" />
        </div>

        <FindingsMatrix counts={countSeverity(dataset.findings)} active={severity} processing={false} onSelect={setSeverity} />

        <Panel title="Filters">
          <div className="space-y-2">
            <FilterRow label="Drawing" value={drawing} onChange={setDrawing} options={[{ key: "all", label: "All", count: dataset.findings.length },
              ...dataset.jobs.map((j) => ({ key: j.id, label: j.detected_sheet_number || j.original_file_name, count: dataset.findings.filter((f) => f.sheet_job_id === j.id).length }))]} />
            <FilterRow label="Category" value={category} onChange={setCategory} options={[{ key: "all", label: "All" }, ...categories.map((c) => ({ key: c, label: c }))]} />
            <FilterRow label="Review status" value={status} onChange={setStatus} options={[{ key: "all", label: "All" },
              ...Object.entries(experiment.statusLabels as Record<string, string>).map(([k, l]) => ({ key: k, label: l, count: dataset.findings.filter((f) => f.verification_status === k).length }))]} />
          </div>
        </Panel>

        <div className="space-y-3" data-testid="qwen-drawing-list">
          {dataset.jobs.filter((j) => drawing === "all" || j.id === drawing).map((job) => {
            const all = dataset.findings.filter((f) => f.sheet_job_id === job.id);
            const shown = visible.filter((f) => f.sheet_job_id === job.id);
            const open = expandedJobs.has(job.id);
            return (
              <div key={job.id} className="rounded-lg border border-border/60 bg-card shadow-sm dark:border-[hsl(var(--border-obsidian-strong)/0.28)]">
                <button type="button" className="flex w-full items-start justify-between gap-3 p-4 text-left" aria-expanded={open} onClick={() => setExpandedJobs((s) => toggle(s, job.id))}>
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold text-foreground">{job.detected_sheet_number} <span className="font-normal text-muted-foreground">· {job.detected_sheet_title}</span></p>
                    <p className="mt-1 text-sm text-muted-foreground">{job.analysis_summary}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline">{job.discipline}</Badge>
                    <Badge variant="secondary">{shown.length === all.length ? all.length : `${shown.length} of ${all.length}`}</Badge>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                  </div>
                </button>
                {open ? (
                  <div className="space-y-2 border-t border-border/50 p-3">
                    {shown.length === 0 ? <p className="px-1 text-sm text-muted-foreground">{all.length ? "No observations match the current filters." : "No observations were raised for this drawing."}</p> : null}
                    {shown.map((f) => {
                      const a = audit[f.id];
                      return (
                        <div key={f.id}>
                          <SupabaseFindingCard finding={f} review={reviewByFinding.get(f.id) || null} reportId={reportIds.get(f.id)} expanded={expandedFindings.has(f.id)} saving={false}
                            onToggle={() => setExpandedFindings((s) => toggle(s, f.id))} onAccept={() => decide(f, "accepted")} onReject={() => decide(f, "rejected")}
                            onModify={() => setModifying({ id: f.id, text: reviewByFinding.get(f.id)?.modified_response || f.recommendation })} />
                          {modifying?.id === f.id ? (
                            <div className="mt-2 space-y-2 rounded-lg border border-border/50 p-3">
                              <Textarea value={modifying.text} onChange={(e) => setModifying({ id: f.id, text: e.target.value })} rows={4} aria-label="Reviewer response" />
                              <div className="flex gap-2">
                                <Button type="button" size="sm" variant="gold" disabled={!modifying.text.trim()} onClick={() => { decide(f, "modified", modifying.text.trim()); setModifying(null); }}>Save response</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => setModifying(null)}>Cancel</Button>
                              </div>
                            </div>
                          ) : null}
                          <div className="flex items-center justify-between px-1 pt-1">
                            <span className="text-xs text-muted-foreground">{a.statusLabel}{a.relatedSheets.length ? ` · related: ${a.relatedSheets.join(", ")}` : ""}</span>
                            {showAudit ? (
                              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setDetailsOpen((s) => toggle(s, f.id))}>
                                {detailsOpen.has(f.id) ? "Hide evidence and review details" : "Evidence and review details"}
                              </button>
                            ) : null}
                          </div>
                          {showAudit && detailsOpen.has(f.id) ? <ReviewDetails a={a} /> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <Panel title="Cross-sheet relationships" eyebrow={`${resolvedRefs} of ${pairs.length} references resolved through the project sheet index`}>
          <ul className="divide-y divide-border/50 text-sm">
            {pairs.map((p) => (
              <li key={p.pairId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="text-foreground">
                  <span className="font-mono text-xs text-muted-foreground">{p.source}</span> “{p.sourceText}” → {p.target.replace(/\.pdf$/, "")}
                  {p.detail ? <span className="text-muted-foreground"> · detail {p.detail}</span> : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {p.status.replace(/_/g, " ")}
                  {p.lookalike.length || p.bubblePrinted ? ` · printed ${[...p.lookalike, ...(p.bubblePrinted ? [`bubble "${p.bubblePrinted}"`] : [])].join(", ")}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <label htmlFor="audit-toggle">Show review details</label>
          <Switch id="audit-toggle" checked={showAudit} onCheckedChange={setShowAudit} />
        </div>

        {showAudit ? (
          <Panel title="Evaluation record" eyebrow="Internal: comparison with the existing analyzer on the same five drawings">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className="py-1 pr-3">Arm</th><th className="pr-3">Runs</th><th className="pr-3">Published</th><th className="pr-3">Correct</th><th className="pr-3">Uncertain</th><th className="pr-3">Unsupported</th><th className="pr-3">Errors</th><th className="pr-3">Cost</th></tr>
                </thead>
                <tbody>
                  {Object.entries(comparison.arms).map(([k, v]: [string, any]) => (
                    <tr key={k} className="border-t border-border/50">
                      <td className="py-1 pr-3" title={v.description}>{k}</td><td className="pr-3">{v.runs}</td><td className="pr-3">{v.published}</td><td className="pr-3">{v.OK + v.OKs}</td>
                      <td className="pr-3">{v.Q}</td><td className="pr-3">{v.U + (v.H || 0)}</td><td className="pr-3">{v.E}</td><td className="pr-3">${Number(v.costUsd).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end">
              <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => {
                const url = URL.createObjectURL(new Blob([JSON.stringify({ ...experiment, dataset: reviewed }, null, 2)], { type: "application/json" }));
                const a = document.createElement("a"); a.href = url; a.download = "qwen-luna-analysis.audit.json"; a.click(); URL.revokeObjectURL(url);
              }}><Download className="h-4 w-4" /> Audit JSON</Button>
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
