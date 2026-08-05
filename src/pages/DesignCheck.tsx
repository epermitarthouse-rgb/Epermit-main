import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  ClipboardCheck,
  Construction,
  FileQuestion,
  Info,
  Loader2,
  MessageSquare,
  ShieldAlert,
  Timer,
  Users,
} from "lucide-react";
import {
  AlertBanner,
  PageHeader,
  Panel,
  ServicePill,
  StatCard,
  StatusPill,
} from "@/components/design/ProductPrimitives";
import { DataSourceBadge } from "@/components/operations/DataSourceBadge";
import { Button } from "@/components/ui/button";
import { useResolvedProjectId } from "@/hooks/useResolvedProjectId";
import { useDesignCheckSummary } from "@/hooks/useDesignCheckSummary";
import { useProjects } from "@/hooks/useProjects";
import type { DesignCheckFinding, DesignCheckSeverity } from "@/lib/designcheck/designCheckSummary";
import { cn } from "@/lib/utils";

function analyzerHref(projectId: string | null): string {
  return projectId ? `/code-compliance?projectId=${encodeURIComponent(projectId)}` : "/code-compliance";
}

function scoreTone(score: number): "good" | "warn" | "bad" {
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

function severityTone(severity: DesignCheckSeverity): "bad" | "warn" | "info" {
  if (severity === "critical") return "bad";
  if (severity === "warning") return "warn";
  return "info";
}

function ComingSoonPanel({
  id,
  title,
  eyebrow,
  body,
  softLink,
}: {
  id: string;
  title: string;
  eyebrow: string;
  body: string;
  softLink?: { href: string; label: string };
}) {
  return (
    <Panel
      id={id}
      eyebrow={eyebrow}
      title={title}
      className="border-dashed"
      action={<DataSourceBadge kind="upcoming" detail="Coming soon — not connected to a live DesignCheck backend." />}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <Construction className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <AlertBanner tone="warn" title="Coming soon" detail={body} />
          {softLink ? (
            <Link
              to={softLink.href}
              className="inline-flex text-sm font-semibold text-primary hover:underline"
            >
              {softLink.label}
            </Link>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function FindingsTable({ findings }: { findings: DesignCheckFinding[] }) {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Analysis metadata exists, but no individual findings were persisted for this project.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Severity</th>
            <th className="px-3 py-2 font-medium">Citation</th>
            <th className="px-3 py-2 font-medium">Finding</th>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="px-3 py-2 font-medium">Suggested fix</th>
            <th className="px-3 py-2 font-medium">Code</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => (
            <tr key={f.id} className="border-b border-border/70 last:border-0">
              <td className="px-3 py-2 align-top">
                <StatusPill tone={severityTone(f.severity)}>{f.severity}</StatusPill>
              </td>
              <td className="px-3 py-2 align-top font-mono text-xs">{f.codeReference || "—"}</td>
              <td className="px-3 py-2 align-top">
                <div className="font-tight font-semibold text-foreground">
                  {f.title || f.description || "Untitled finding"}
                </div>
                {f.title && f.description ? (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{f.description}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground">{f.documentName}</p>
              </td>
              <td className="px-3 py-2 align-top text-muted-foreground">{f.location || "—"}</td>
              <td className="px-3 py-2 align-top text-muted-foreground">
                <span className="line-clamp-3">{f.suggestedFix || "—"}</span>
              </td>
              <td className="px-3 py-2 align-top uppercase text-xs text-muted-foreground">
                {f.codeType || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DesignCheck() {
  const navigate = useNavigate();
  const { projectId } = useResolvedProjectId();
  const { projects } = useProjects();
  const { summary, loading, error } = useDesignCheckSummary(projectId);

  const projectName = useMemo(() => {
    if (!projectId) return null;
    return projects.find((p) => p.id === projectId)?.name ?? null;
  }, [projectId, projects]);

  const analyzerLink = analyzerHref(projectId);

  return (
    <>
      <Helmet>
        <title>DesignCheck | PermitPulse</title>
        <meta
          name="description"
          content="Pre-submittal readiness dashboard that summarizes Code Compliance Analyzer findings for the selected project."
        />
      </Helmet>

      <div className="space-y-6">
        <PageHeader
          eyebrow="DesignCheck"
          title="Pre-submittal readiness"
          body="Summarize real Code Compliance Analyzer findings for the selected project. Run analysis and export stay on the analyzer — DesignCheck does not re-run drawing review."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <ServicePill kind="permit">Readiness overview</ServicePill>
              <Button asChild>
                <Link to={analyzerLink}>
                  <ShieldAlert className="mr-1.5 h-4 w-4" />
                  Open Code Compliance Analyzer
                </Link>
              </Button>
            </div>
          }
        />

        {!projectId ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
              <FileQuestion className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium text-foreground">No project selected</p>
            <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
              Select a project from the header picker (or open DesignCheck with ?projectId=) to load
              readiness summary from persisted compliance findings.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/dashboard")}>
              Go to Dashboard
            </Button>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading DesignCheck summary…
          </div>
        ) : error ? (
          <AlertBanner
            tone="bad"
            title="Unable to load DesignCheck summary"
            detail={error}
          />
        ) : !summary ? (
          <Panel
            eyebrow="No analysis yet"
            title={projectName ? `${projectName} · empty package` : "No compliance analysis yet"}
            action={<DataSourceBadge kind="live" detail="Live empty state — no seed findings are shown." />}
          >
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  No compliance analysis for this project yet. Run the Code Compliance Analyzer to
                  upload drawings and persist findings — DesignCheck will summarize them here.
                </p>
                <AlertBanner
                  tone="info"
                  title="Analyzer is the source of truth"
                  detail="DesignCheck never invents scores or findings. Agent review, predictive delay, and internal prescreen remain Coming Soon."
                />
              </div>
              <Button asChild className="shrink-0">
                <Link to={analyzerLink}>
                  <ClipboardCheck className="mr-1.5 h-4 w-4" />
                  Run analysis
                </Link>
              </Button>
            </div>
          </Panel>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="space-y-6"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <DataSourceBadge
                kind="live"
                detail="KPIs and findings are read from document_annotations written by the Code Compliance Analyzer."
              />
              {projectName ? <span className="font-medium text-foreground">{projectName}</span> : null}
              {summary.latestUpdatedAt ? (
                <span>Updated {new Date(summary.latestUpdatedAt).toLocaleString()}</span>
              ) : null}
              {summary.jurisdiction ? <span>Jurisdiction: {summary.jurisdiction}</span> : null}
              {summary.codeYear ? <span>Code year: {summary.codeYear}</span> : null}
              {(summary.hasIbc || summary.hasLocal) && (
                <span>
                  Codes: {[summary.hasIbc ? "IBC" : null, summary.hasLocal ? "Local" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard
                label="Readiness score"
                value={
                  <span
                    className={cn(
                      summary.summary.overallScore >= 80
                        ? "text-emerald-600 dark:text-emerald-400"
                        : summary.summary.overallScore >= 60
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-destructive",
                    )}
                  >
                    {summary.summary.overallScore}%
                  </span>
                }
                icon={ClipboardCheck}
                hint="Derived from persisted findings"
              />
              <StatCard
                label="Critical"
                value={summary.summary.critical}
                icon={AlertCircle}
                hint="Severity = critical"
              />
              <StatCard
                label="Warnings"
                value={summary.summary.warnings}
                icon={AlertTriangle}
                hint="Severity = warning"
              />
              <StatCard
                label="Advisory"
                value={summary.summary.advisory}
                icon={Info}
                hint="Severity = advisory"
              />
              <StatCard
                label="Total findings"
                value={summary.summary.totalIssues}
                icon={ShieldAlert}
                hint={`${summary.documents.length} analyzed document${summary.documents.length === 1 ? "" : "s"}`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                eyebrow="Weighted impact"
                title="Findings by impact bucket"
                action={<DataSourceBadge kind="live" />}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      "Life Safety",
                      "Accessibility",
                      "Administrative",
                      "Other",
                    ] as const
                  ).map((bucket) => (
                    <div
                      key={bucket}
                      className="rounded-md border border-border bg-muted/30 px-3 py-3"
                    >
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">{bucket}</p>
                      <p className="mt-1 font-data text-2xl font-semibold tabular-nums">
                        {summary.impact[bucket]}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Buckets map analyzer categories (e.g. Egress → Life Safety). Unknown categories → Other.
                </p>
              </Panel>

              <Panel
                eyebrow="Analyzed documents"
                title="Documents with compliance results"
                action={<DataSourceBadge kind="live" />}
              >
                <ul className="space-y-2">
                  {summary.documents.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-medium">{doc.fileName}</span>
                      <Link
                        to={analyzerLink}
                        className="shrink-0 text-xs font-semibold text-primary hover:underline"
                      >
                        Open in Analyzer
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>

            <Panel
              eyebrow="AI code citation findings"
              title="Findings from persisted analysis"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <DataSourceBadge kind="live" />
                  <StatusPill tone={scoreTone(summary.summary.overallScore)}>
                    Score {summary.summary.overallScore}%
                  </StatusPill>
                </div>
              }
            >
              <FindingsTable findings={summary.findings} />
              <p className="mt-3 text-xs text-muted-foreground">
                AI confidence %, Shadow Match, and accept/modify/reject workflow status are not
                persisted — see Coming Soon below. Detail rows show real description / suggested fix
                only.
              </p>
            </Panel>
          </motion.div>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <ComingSoonPanel
            id="designcheck-agents"
            eyebrow="Agent review matrix"
            title="8 specialized review agents"
            body="Multi-agent orchestration is not live in PermitPilot. This panel is reserved for future agent status and never shows fabricated Clear/Conflict metrics."
          />
          <ComingSoonPanel
            id="designcheck-comments"
            eyebrow="Comment reconciliation"
            title="Municipal comment reconciliation"
            body="DesignCheck does not invent reconciled comment counts. Use Response Matrix for live comment/response work on the selected project."
            softLink={
              projectId
                ? {
                    href: `/response-matrix?projectId=${encodeURIComponent(projectId)}`,
                    label: "Open Response Matrix",
                  }
                : { href: "/response-matrix", label: "Open Response Matrix" }
            }
          />
          <ComingSoonPanel
            id="designcheck-delay"
            eyebrow="Compliance intelligence"
            title="Predictive delay analysis"
            body="No jurisdictional delay model is connected. Hardcoded day estimates (e.g. +22 days) are intentionally omitted."
          />
          <ComingSoonPanel
            id="designcheck-prescreen"
            eyebrow="Internal prescreen"
            title="Filing completeness checklist"
            body="Prescreen agents exist backend-only and are not wired to this UI. Fake pass/fail readiness percentages are not shown."
          />
        </div>

        <Panel
          eyebrow="Workflow status"
          title="AI confidence & finding responses"
          className="border-dashed"
          action={<DataSourceBadge kind="upcoming" />}
        >
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Users className="h-4 w-4" aria-hidden /> Agent statuses — Coming Soon
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Timer className="h-4 w-4" aria-hidden /> Predictive delay — Coming Soon
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4" aria-hidden /> Shadow Match / accept-reject — Coming Soon
            </span>
          </div>
        </Panel>
      </div>
    </>
  );
}
