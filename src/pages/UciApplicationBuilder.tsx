import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Construction,
  Download,
  FileQuestion,
  FileText,
  ListChecks,
  Loader2,
  Save,
  Send,
  Upload,
} from "lucide-react";
import { DataSourceBadge } from "@/components/operations/DataSourceBadge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useUciApplicationBuilder } from "@/hooks/useUciApplicationBuilder";
import {
  canSubmitApplication,
  formatApplicationPackageStatus,
  formatDraftStatus,
  formatPackageFieldProvenance,
  formatPackageMappedValue,
  formatPackageDocumentSource,
  formatPackageReviewItemStatus,
  formatPackageReviewStatus,
  formatPackageValidationStatus,
  formatSuggestionConfidence,
  getPackageValidationStatus,
  parseCanonicalPackageReviewSummary,
  summarizePackageReview,
} from "@/lib/uciApplicationPrep";
import {
  LOVABLE_EXHIBIT_PLACEHOLDERS,
  OWNER_BILLING_FIELDS,
  SITE_LOGISTICS_COMING_SOON,
  UCI_BUILDER_SECTIONS,
  type UciBuilderSectionId,
} from "@/lib/uciBuilder/uciBuilderReadiness";
import { cn } from "@/lib/utils";

function ComingSoonChip({ detail }: { detail: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-muted/40 px-2 py-0.5 font-data text-[10px] uppercase tracking-wider text-muted-foreground"
      title={detail}
    >
      <Construction className="h-3 w-3" aria-hidden />
      Coming soon
    </span>
  );
}

export default function UciApplicationBuilder() {
  const navigate = useNavigate();
  const builder = useUciApplicationBuilder();
  const [active, setActive] = useState<UciBuilderSectionId>("service");

  const sectionState = useMemo(
    () => Object.fromEntries(builder.sections.map((s) => [s.id, s])),
    [builder.sections],
  );

  const submitReady = canSubmitApplication(builder.packageApp?.draft_status);
  const isReviewed = builder.packageApp?.draft_status === "reviewed";
  const localPackageReview = summarizePackageReview(
    builder.packageMeta,
    builder.packageDocs,
    builder.packageApp?.draft_status,
  );
  const canonicalPackageReview = parseCanonicalPackageReviewSummary(
    builder.packageApp?.package_review_summary,
  );
  const canonicalReviewItems = new Map(
    canonicalPackageReview?.items.map((item) => [item.id, item]) ?? [],
  );
  const packageReview = {
    ...localPackageReview,
    ...(canonicalPackageReview
      ? {
          status: canonicalPackageReview.status,
          allConfirmed: canonicalPackageReview.all_confirmed,
          readyForFinalReview: canonicalPackageReview.ready_for_final_review,
          activeCorrectionCount: canonicalPackageReview.active_correction_count,
          confirmedCount: canonicalPackageReview.confirmed_count,
          totalCount: canonicalPackageReview.total_count,
        }
      : {}),
    fields: localPackageReview.fields.map((field) => ({
      ...field,
      reviewStatus:
        canonicalReviewItems.get(`field:${field.key}`)?.status ?? field.reviewStatus,
    })),
    documents: localPackageReview.documents.map((document) => ({
      ...document,
      reviewStatus:
        canonicalReviewItems.get(`document:${document.key}`)?.status ??
        document.reviewStatus,
    })),
  };
  const submissionMetadata =
    builder.packageApp?.agent_draft_metadata?.submission &&
    typeof builder.packageApp.agent_draft_metadata.submission === "object" &&
    !Array.isArray(builder.packageApp.agent_draft_metadata.submission)
      ? (builder.packageApp.agent_draft_metadata.submission as Record<string, unknown>)
      : null;
  const validationMetadata =
    submissionMetadata?.validation &&
    typeof submissionMetadata.validation === "object" &&
    !Array.isArray(submissionMetadata.validation)
      ? (submissionMetadata.validation as Record<string, unknown>)
      : null;
  const packageValidationStatus = getPackageValidationStatus(
    builder.packageMeta,
    validationMetadata,
  );
  const validationOnlyPassed =
    submissionMetadata?.validation_only === true && validationMetadata?.ok === true;
  const validationSupported = builder.isDominionSynthetic || builder.isPepco;
  const providerLabel = builder.serviceFields.utility || "Utility provider";

  const markCompleteAndContinue = () => {
    const current = sectionState[active];
    if (!current?.complete) {
      return;
    }
    const idx = UCI_BUILDER_SECTIONS.findIndex((s) => s.id === active);
    if (idx < UCI_BUILDER_SECTIONS.length - 1) {
      setActive(UCI_BUILDER_SECTIONS[idx + 1].id);
    }
  };

  const goBack = () => {
    const idx = UCI_BUILDER_SECTIONS.findIndex((s) => s.id === active);
    if (idx > 0) setActive(UCI_BUILDER_SECTIONS[idx - 1].id);
  };

  return (
    <>
      <Helmet>
        <title>UCI Builder | PermitPilot</title>
        <meta
          name="description"
          content="Guided commercial service application builder using live UCI coordination, load profile, and package APIs."
        />
      </Helmet>

      <div className="space-y-6 pb-12">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="pilot-kicker text-primary">UCI · Utility Coordination Intelligence</div>
            <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">
              Commercial Service Application
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Guided builder for purveyor service applications. Prefills from the active project,
              load profile analyzer, and document vault. Package draft, document mapping, review, and
              dry-run submit use live UCI APIs — blocked fields stay labeled Coming Soon.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <DataSourceBadge
                kind="partial"
                detail="Live project, coordination, load profile, and package APIs. Owner/billing, Agent QA, and some site logistics are Coming Soon."
              />
              <Link
                to={
                  builder.coordinationId
                    ? `/uci/records/${encodeURIComponent(builder.coordinationId)}?tab=load-profile`
                    : "/uci"
                }
                className="text-xs font-semibold text-primary hover:underline"
              >
                Open Load Profile workspace
              </Link>
              <Link to="/uci" className="text-xs font-semibold text-primary hover:underline">
                UCI hub
              </Link>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="pilot-button-ghost"
              disabled={builder.buildBusy || !builder.buildEligibility.ok}
              title={builder.buildEligibility.reason ?? "Save application package draft"}
              onClick={() => void builder.saveDraft()}
            >
              {builder.buildBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save draft
            </button>
            <button
              type="button"
              className="pilot-button-primary"
              disabled={builder.submitBusy || !submitReady || !validationSupported}
              title={
                !validationSupported
                  ? "Validation is unavailable until this provider has an approved validation adapter"
                  : submitReady
                  ? builder.isDominionSynthetic
                    ? "Runs validation only — no email, portal, or lifecycle transition"
                    : "Runs Pepco validation dry-run by default — not a live portal filing"
                  : "Mark the package reviewed before validation"
              }
              onClick={() => void builder.submitPackage()}
            >
              {builder.submitBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {builder.isDominionSynthetic
                ? "Validate synthetic package"
                : builder.isPepco
                  ? "Validate PEPCO package"
                  : "Validation unavailable"}
            </button>
          </div>
        </header>

        {!builder.projectId ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-4 py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
              <FileQuestion className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-lg font-medium text-foreground">No project selected</p>
            <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
              Select a project from the header picker (or open with ?projectId=) to load coordination
              and package data.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/uci")}>
              Go to UCI hub
            </Button>
          </div>
        ) : builder.loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading UCI Builder…
          </div>
        ) : (
          <>
            {builder.error ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {builder.error}
              </div>
            ) : null}

            {builder.actionMessage ? (
              <div
                className={cn(
                  "rounded-md border px-4 py-3 text-sm",
                  builder.actionMessage.tone === "ok" &&
                    "border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-200",
                  builder.actionMessage.tone === "warn" &&
                    "border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-200",
                  builder.actionMessage.tone === "bad" &&
                    "border-destructive/40 bg-destructive/5 text-destructive",
                )}
              >
                {builder.actionMessage.text}
              </div>
            ) : null}

            {!builder.buildEligibility.ok && builder.buildEligibility.reason ? (
              <p className="text-xs text-muted-foreground">{builder.buildEligibility.reason}</p>
            ) : null}

            <section className="pilot-card space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="pilot-kicker text-primary">Application progress</div>
                  <div className="mt-1 font-tight text-base font-semibold text-foreground">
                    {builder.sections.filter((s) => s.complete).length} of{" "}
                    {UCI_BUILDER_SECTIONS.length} sections complete
                  </div>
                </div>
                <div className="font-data text-2xl font-semibold text-primary">
                  {builder.completion}%
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${builder.completion}%` }}
                />
              </div>
              {builder.records.length > 1 ? (
                <div className="max-w-md">
                  <Label className="text-xs text-muted-foreground">Coordination record</Label>
                  <Select
                    value={builder.coordinationId ?? undefined}
                    onValueChange={(id) => void builder.selectCoordination(id)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select coordination" />
                    </SelectTrigger>
                    <SelectContent>
                      {builder.records.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {(r.utility_type || "utility").toUpperCase()} · stage {r.current_stage} ·{" "}
                          {r.id.slice(0, 8)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {!builder.record ? (
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  No coordination record for this project.{" "}
                  <Link to="/uci" className="font-semibold underline">
                    Open UCI hub
                  </Link>{" "}
                  to run provider setup / init first.
                </p>
              ) : null}
            </section>

            <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
              <nav className="pilot-card p-3">
                <ul className="space-y-1">
                  {UCI_BUILDER_SECTIONS.map((s, i) => {
                    const state = sectionState[s.id];
                    const done = Boolean(state?.complete);
                    const isActive = active === s.id;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setActive(s.id)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                            isActive
                              ? "bg-primary/15 text-primary"
                              : "text-foreground hover:bg-muted/40",
                          )}
                        >
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                          ) : state?.status === "coming_soon" ? (
                            <Construction className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-data text-[11px] text-muted-foreground">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="font-tight font-medium">{s.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <section className="pilot-card p-6 md:p-8">
                {active === "service" && (
                  <div>
                    <div className="pilot-kicker text-primary">Step 01 · Service requested</div>
                    <h2 className="mt-1 font-tight text-xl font-bold text-foreground">
                      What you&apos;re applying for
                    </h2>
                    {sectionState.service?.helper ? (
                      <p className="mt-2 text-sm text-muted-foreground">{sectionState.service.helper}</p>
                    ) : null}
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {(
                        [
                          ["project", "Project", builder.serviceFields.project],
                          ["utility", "Purveyor + service", builder.serviceFields.utility],
                          ["voltage", "Voltage / phase", builder.serviceFields.voltage],
                          ["amperage", "Service size", builder.serviceFields.amperage],
                          ["serviceType", "Service type", builder.serviceFields.serviceType],
                          ["targetDate", "Target energization", builder.serviceFields.targetDate],
                        ] as const
                      ).map(([key, label, value]) => (
                        <label key={key} className="block">
                          <span className="pilot-kicker mb-2 block">{label}</span>
                          <input
                            readOnly
                            value={value}
                            placeholder={value ? undefined : "Not available from live data yet"}
                            className="w-full rounded-md border border-border bg-muted/20 px-3 py-2.5 text-sm text-foreground outline-none"
                          />
                        </label>
                      ))}
                    </div>
                    {builder.serviceFields.contact ? (
                      <p className="mt-4 text-sm text-muted-foreground">
                        Utility contact: {builder.serviceFields.contact}
                      </p>
                    ) : (
                      <p className="mt-4 text-sm text-muted-foreground">
                        No utility contact on the coordination record yet.
                      </p>
                    )}
                  </div>
                )}

                {active === "load" && (
                  <div>
                    <div className="pilot-kicker text-primary">Step 02 · Load profile</div>
                    <h2 className="mt-1 font-tight text-xl font-bold text-foreground">
                      Pulled from Load Profile Analyzer
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {builder.loadSummary
                        ? `Analysis status: ${builder.loadSummary.analysis_status}`
                        : "No load profile draft yet — open the analyzer workspace to run analysis."}
                    </p>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {builder.loadMetrics.map((metric) => (
                        <div
                          key={metric.label}
                          className="rounded-md border border-border bg-background px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="pilot-kicker">{metric.label}</div>
                            {metric.comingSoon ? (
                              <ComingSoonChip detail={metric.helper || "Coming soon"} />
                            ) : null}
                          </div>
                          <div className="mt-1 font-data text-sm font-semibold text-foreground">
                            {metric.comingSoon
                              ? "—"
                              : metric.value || "No verified/calculated value yet"}
                          </div>
                          {metric.helper ? (
                            <p className="mt-1 text-[11px] text-muted-foreground">{metric.helper}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="mt-4">
                      <Link
                        to={
                          builder.coordinationId
                            ? `/uci/records/${encodeURIComponent(builder.coordinationId)}?tab=load-profile`
                            : "/uci"
                        }
                        className="pilot-button-ghost"
                      >
                        Open Load Profile Analyzer
                      </Link>
                    </div>
                  </div>
                )}

                {active === "site" && (
                  <div>
                    <div className="pilot-kicker text-primary">Step 03 · Site &amp; access</div>
                    <h2 className="mt-1 font-tight text-xl font-bold text-foreground">
                      Where the service lands
                    </h2>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Confirm parcel, primary connection point, and field access constraints.
                    </p>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <label className="block md:col-span-2">
                        <span className="pilot-kicker mb-2 block">Service entrance address</span>
                        <input
                          readOnly
                          value={builder.projectAddress || ""}
                          placeholder="No resolved project address"
                          className="w-full rounded-md border border-border bg-muted/20 px-3 py-2.5 text-sm outline-none"
                        />
                        {builder.packageMeta?.project_address?.source ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Source: {builder.packageMeta.project_address.source.replace(/_/g, " ")}
                          </p>
                        ) : null}
                      </label>
                      {SITE_LOGISTICS_COMING_SOON.map((label) => (
                        <label key={label} className="block">
                          <span className="pilot-kicker mb-2 flex items-center gap-2">
                            {label}
                            <ComingSoonChip detail="No UCI persistence for this field yet" />
                          </span>
                          <input
                            disabled
                            placeholder="Coming soon — not persisted"
                            className="w-full cursor-not-allowed rounded-md border border-dashed border-border bg-muted/10 px-3 py-2.5 text-sm text-muted-foreground outline-none"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {active === "owner" && (
                  <div>
                    <div className="pilot-kicker text-primary">Step 04 · Owner &amp; billing</div>
                    <h2 className="mt-1 font-tight text-xl font-bold text-foreground">
                      Account-holder and billing routing
                    </h2>
                    <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-100">
                      Coming soon — PermitPilot has no secure UCI store for Federal Tax ID or billing
                      account data. These fields are visible for workflow parity only and are not
                      collected or saved.
                    </div>
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {OWNER_BILLING_FIELDS.map((label) => (
                        <label key={label} className="block">
                          <span className="pilot-kicker mb-2 flex items-center gap-2">
                            {label}
                            <ComingSoonChip detail="Blocked — no insecure storage" />
                          </span>
                          <input
                            disabled
                            type={label === "Federal Tax ID" ? "password" : "text"}
                            placeholder={
                              label === "Federal Tax ID"
                                ? "Not collected — Coming Soon"
                                : "Coming soon — not persisted"
                            }
                            autoComplete="off"
                            className="w-full cursor-not-allowed rounded-md border border-dashed border-border bg-muted/10 px-3 py-2.5 text-sm text-muted-foreground outline-none"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {active === "drawings" && (
                  <div>
                    <div className="pilot-kicker text-primary">Step 05 · Drawings &amp; exhibits</div>
                    <h2 className="mt-1 font-tight text-xl font-bold text-foreground">
                      Attach the purveyor&apos;s required exhibits
                    </h2>
                    {!builder.packageApp ? (
                      <>
                        <p className="mt-3 text-sm text-muted-foreground">
                          Save a package draft to load provider-specific slots. Dominion is available
                          only through the explicitly labeled synthetic test checklist; production
                          Dominion requirements remain unknown.
                        </p>
                        <ul className="mt-5 space-y-2">
                          {LOVABLE_EXHIBIT_PLACEHOLDERS.map((d) => (
                            <li
                              key={d}
                              className="flex items-center justify-between rounded-md border border-dashed border-border bg-background px-4 py-3"
                            >
                              <div className="flex items-center gap-3">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span className="font-tight text-sm font-medium text-foreground">
                                  {d}
                                </span>
                                <ComingSoonChip detail="Awaiting real package template slots" />
                              </div>
                              <button type="button" className="pilot-button-ghost" disabled>
                                <Upload className="h-3.5 w-3.5" /> Attach
                              </button>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="pilot-button-primary mt-4"
                          disabled={builder.buildBusy || !builder.buildEligibility.ok}
                          onClick={() => void builder.saveDraft()}
                        >
                          {builder.buildBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Prepare application draft
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                          {isReviewed ? (
                            <span className="rounded-md border border-border px-2 py-0.5 font-data text-xs">
                              Reviewed
                            </span>
                          ) : (
                            <>
                              <span className="rounded-md border border-border px-2 py-0.5 font-data text-xs">
                                {formatApplicationPackageStatus(builder.packageMeta?.package_status)}
                              </span>
                              <span className="rounded-md border border-border px-2 py-0.5 font-data text-xs">
                                {formatDraftStatus(builder.packageApp.draft_status)}
                              </span>
                            </>
                          )}
                          {validationOnlyPassed ? (
                            <span className="rounded-md border border-border px-2 py-0.5 font-data text-xs">
                              Validation-only passed
                            </span>
                          ) : null}
                        </div>

                        {builder.isPepco && builder.portalApplications.length > 0 ? (
                          <div className="mt-4 max-w-md">
                            <Label className="text-xs text-muted-foreground">
                              Portal application scope (required for mapping)
                            </Label>
                            <Select
                              value={builder.externalApplicationId ?? undefined}
                              onValueChange={builder.setExternalApplicationId}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue placeholder="Select portal application" />
                              </SelectTrigger>
                              <SelectContent>
                                {builder.portalApplications.map((app) => (
                                  <SelectItem
                                    key={app.id}
                                    value={String(app.external_application_id)}
                                  >
                                    {app.external_application_id}
                                    {app.portal_status ? ` · ${app.portal_status}` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : builder.isPepco ? (
                          <p className="mt-3 text-xs text-amber-800 dark:text-amber-200">
                            No portal-synced applications yet. Sync Pepco projects from the UCI hub
                            before confirming document mappings.
                          </p>
                        ) : null}

                        {builder.isDominionSynthetic ? (
                          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                            <p className="font-semibold text-amber-900 dark:text-amber-100">
                              {builder.packageMeta?.checklist_label}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Not authoritative Dominion requirements. External submission is disabled.
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="pilot-button-primary"
                                disabled={
                                  builder.reviewBusy ||
                                  builder.packageMeta?.synthetic_checklist?.status === "approved"
                                }
                                onClick={() => void builder.approveSyntheticChecklist()}
                              >
                                Approve synthetic checklist
                              </button>
                              <button
                                type="button"
                                className="pilot-button-ghost"
                                onClick={() => void builder.exportSyntheticChecklist()}
                              >
                                <Download className="h-3.5 w-3.5" />
                                Export read-only JSON
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {builder.candidatesError ? (
                          <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                            {builder.candidatesError}
                          </p>
                        ) : null}

                        <ul className="mt-5 space-y-3">
                          {builder.packageDocs.map((slot) => {
                            const suggested =
                              builder.candidates?.suggestions_by_slot[slot.key] ?? [];
                            const candidates = (() => {
                              if (!builder.candidates) return [];
                              const other = builder.candidates.candidates.filter(
                                (c) => c.suggested_package_slot !== slot.key,
                              );
                              const merged = [...suggested];
                              for (const c of other) {
                                if (!merged.some((m) => m.candidate_id === c.candidate_id)) {
                                  merged.push(c);
                                }
                              }
                              return merged;
                            })();
                            const selection = builder.selectedCandidateBySlot[slot.key] ?? "";
                            const attached = slot.status === "attached";

                            return (
                              <li
                                key={slot.key}
                                className="rounded-md border border-border bg-background px-4 py-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-3">
                                    <FileText className="h-4 w-4 text-primary" />
                                    <span className="font-tight text-sm font-medium text-foreground">
                                      {slot.label || slot.key.replace(/_/g, " ")}
                                    </span>
                                    <span className="font-data text-[10px] uppercase text-muted-foreground">
                                      {attached ? "Attached" : "Missing"}
                                    </span>
                                  </div>
                                  {attached ? (
                                    <button
                                      type="button"
                                      className="pilot-button-ghost"
                                      disabled={builder.mappingBusySlot === slot.key}
                                      onClick={() => void builder.removeMapping(slot.key)}
                                    >
                                      Remove
                                    </button>
                                  ) : null}
                                </div>
                                {attached ? (
                                  <>
                                    <p className="mt-2 text-xs text-muted-foreground">
                                      {slot.file_name} ·{" "}
                                      {formatPackageDocumentSource(slot.source)}
                                      {slot.user_confirmed ? " · human confirmed" : ""}
                                    </p>
                                    {slot.signature_required ? (
                                      <div className="mt-3 space-y-2 rounded-md border border-amber-500/30 p-3">
                                        <p className="text-xs font-semibold">
                                          Signature: {slot.signature_status || "unknown"}
                                        </p>
                                        <input
                                          value={builder.signatureReviewNote}
                                          onChange={(event) =>
                                            builder.setSignatureReviewNote(event.target.value)
                                          }
                                          placeholder="Manual verification note required to mark signed"
                                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
                                        />
                                        <div className="flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            className="pilot-button-ghost"
                                            disabled={
                                              builder.signatureBusyAction === `${slot.key}:unsigned`
                                            }
                                            onClick={() =>
                                              void builder.setSignatureStatus(slot.key, "unsigned")
                                            }
                                          >
                                            Mark unsigned
                                          </button>
                                          <button
                                            type="button"
                                            className="pilot-button-primary"
                                            disabled={
                                              !builder.signatureReviewNote.trim() ||
                                              builder.signatureBusyAction ===
                                                `${slot.key}:signed_manual_verified`
                                            }
                                            onClick={() =>
                                              void builder.setSignatureStatus(
                                                slot.key,
                                                "signed_manual_verified",
                                              )
                                            }
                                          >
                                            {builder.signatureBusyAction ===
                                            `${slot.key}:signed_manual_verified` ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : null}
                                            Manually verify signed
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}
                                  </>
                                ) : (
                                  <div className="mt-3 space-y-2">
                                    {suggested.length > 0 ? (
                                      <p className="text-xs text-muted-foreground">
                                        Suggested (not verified):{" "}
                                        {suggested
                                          .map(
                                            (c) =>
                                              `${c.file_name} (${formatSuggestionConfidence(c.confidence)})`,
                                          )
                                          .join("; ")}
                                      </p>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">
                                        No filename suggestion for this slot.
                                      </p>
                                    )}
                                    {candidates.length > 0 ? (
                                      <div className="flex flex-wrap items-end gap-2">
                                        <div className="min-w-[12rem] flex-1">
                                          <Select
                                            value={selection || undefined}
                                            onValueChange={(value) =>
                                              builder.setSelectedCandidateBySlot((prev) => ({
                                                ...prev,
                                                [slot.key]: value,
                                              }))
                                            }
                                          >
                                            <SelectTrigger className="h-9 text-xs">
                                              <SelectValue placeholder="Select a document" />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {candidates.map((c) => (
                                                <SelectItem
                                                  key={c.candidate_id}
                                                  value={c.candidate_id}
                                                >
                                                  {c.file_name} (
                                                  {formatPackageDocumentSource(
                                                    c.source_type === "pepco_portal"
                                                      ? "pepco_portal"
                                                      : "project_documents",
                                                  )}
                                                  )
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <button
                                          type="button"
                                          className="pilot-button-primary"
                                          disabled={
                                            builder.mappingBusySlot === slot.key || !selection
                                          }
                                          onClick={() => void builder.confirmMapping(slot.key)}
                                        >
                                          {builder.mappingBusySlot === slot.key ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          ) : (
                                            <Upload className="h-3.5 w-3.5" />
                                          )}
                                          Attach
                                        </button>
                                      </div>
                                    ) : builder.candidatesLoading ? (
                                      <p className="text-xs text-muted-foreground">
                                        Loading candidates…
                                      </p>
                                    ) : (
                                      <p className="text-xs text-muted-foreground">
                                        No PEPCO or uploaded candidates available for this slot.
                                      </p>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                )}

                {active === "review" && (
                  <div>
                    <div className="pilot-kicker text-primary">Step 06 · Review &amp; submit</div>
                    <h2 className="mt-1 font-tight text-xl font-bold text-foreground">
                      Pre-flight check
                    </h2>
                    {builder.packageApp ? (
                      <div className="mt-5 space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 p-4">
                          <div>
                            <div className="font-tight font-semibold text-foreground">
                              {formatPackageReviewStatus(packageReview.status)}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {packageReview.confirmedCount} of {packageReview.totalCount} required
                              mappings confirmed for this package
                            </p>
                          </div>
                          {!isReviewed ? (
                            <button
                              type="button"
                              className="pilot-button-ghost"
                              disabled={builder.reviewItemBusy === "all-fields"}
                              onClick={() => void builder.confirmAllVerifiedFields()}
                            >
                              Confirm all verified fields
                            </button>
                          ) : null}
                        </div>

                        <div className="overflow-x-auto rounded-md border border-border">
                          <table className="w-full min-w-[760px] text-left text-xs">
                            <thead className="bg-muted/40 text-muted-foreground">
                              <tr>
                                <th className="px-3 py-2">Requirement</th>
                                <th className="px-3 py-2">Mapped value</th>
                                <th className="px-3 py-2">Source</th>
                                <th className="px-3 py-2">Mapping status</th>
                                <th className="px-3 py-2">Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {packageReview.fields.map((field) => (
                                <tr key={field.key} className="border-t border-border align-top">
                                  <td className="px-3 py-3 font-medium">{field.label}</td>
                                  <td className="max-w-xs px-3 py-3">
                                    {formatPackageMappedValue(field.value)}
                                  </td>
                                  <td className="px-3 py-3 text-muted-foreground">
                                    {formatPackageFieldProvenance(field)}
                                    <details className="mt-1">
                                      <summary className="cursor-pointer text-[10px]">
                                        View technical provenance
                                      </summary>
                                      <code className="break-all text-[10px]">
                                        {field.source || "unknown"}
                                      </code>
                                    </details>
                                  </td>
                                  <td className="px-3 py-3">
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium",
                                        field.reviewStatus === "confirmed" &&
                                          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                        field.reviewStatus === "needs_correction" &&
                                          "bg-amber-500/10 text-amber-800 dark:text-amber-200",
                                        field.reviewStatus === "ready_for_re_review" &&
                                          "bg-sky-500/10 text-sky-700 dark:text-sky-300",
                                        field.reviewStatus === "not_reviewed" &&
                                          "bg-muted text-muted-foreground",
                                      )}
                                    >
                                      {field.reviewStatus === "confirmed" ? (
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                      ) : null}
                                      {formatPackageReviewItemStatus(field.reviewStatus)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3">
                                    {isReviewed ? (
                                      <span className="text-muted-foreground">Snapshot locked</span>
                                    ) : (
                                      <div className="flex flex-wrap gap-1">
                                        {field.reviewStatus !== "confirmed" ? (
                                          <button
                                            type="button"
                                            className="pilot-button-primary"
                                            disabled={
                                              field.status !== "present" ||
                                              builder.reviewItemBusy === `field:${field.key}`
                                            }
                                            onClick={() =>
                                              void builder.updateReviewItem(
                                                "field",
                                                field.key,
                                                "confirmed",
                                              )
                                            }
                                          >
                                            {builder.reviewItemBusy === `field:${field.key}` ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : null}
                                            Confirm for package
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          className="pilot-button-ghost"
                                          disabled={
                                            !builder.reviewNotes.trim() ||
                                            builder.reviewItemBusy === `field:${field.key}`
                                          }
                                          onClick={() =>
                                            navigate(
                                              field.source?.startsWith(
                                                "load_summary.verified_values",
                                              )
                                                ? `/uci/records/${encodeURIComponent(builder.coordinationId || "")}?tab=load-profile&field=${encodeURIComponent(field.key)}`
                                                : field.source?.startsWith("project.")
                                                  ? `/projects?project=${encodeURIComponent(builder.packageApp?.project_id || "")}&field=${encodeURIComponent(field.source.slice("project.".length))}`
                                                  : `/uci/records/${encodeURIComponent(builder.coordinationId || "")}?tab=application-prep&field=${encodeURIComponent(field.key)}`,
                                            )
                                          }
                                        >
                                          {field.source?.startsWith("load_summary.verified_values")
                                            ? "Open verified input"
                                            : field.source?.startsWith("project.")
                                              ? "Edit project field"
                                              : "Edit mapping"}
                                        </button>
                                        <button
                                          type="button"
                                          className="pilot-button-ghost"
                                          disabled={
                                            !builder.reviewNotes.trim() ||
                                            builder.reviewItemBusy === `field:${field.key}`
                                          }
                                          onClick={() =>
                                            void builder.updateReviewItem(
                                              "field",
                                              field.key,
                                              "needs_correction",
                                            )
                                          }
                                        >
                                          Flag for correction
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="space-y-2">
                          <div className="pilot-kicker">Required documents</div>
                          {packageReview.documents.map((document) => (
                            <div
                              key={document.key}
                              className="grid gap-3 rounded-md border border-border p-3 text-xs md:grid-cols-[1.2fr_1fr_1fr_auto]"
                            >
                              <div>
                                <div className="font-medium">{document.label || document.key}</div>
                                <div className="mt-1 text-muted-foreground">
                                  {document.file_name || "No document mapped"}
                                </div>
                              </div>
                              <div className="text-muted-foreground">
                                Source: {formatPackageDocumentSource(document.source)}
                              </div>
                              <div>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-2 py-1 font-medium",
                                    document.reviewStatus === "confirmed" &&
                                      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                    document.reviewStatus === "needs_correction" &&
                                      "bg-amber-500/10 text-amber-800 dark:text-amber-200",
                                    document.reviewStatus === "ready_for_re_review" &&
                                      "bg-sky-500/10 text-sky-700 dark:text-sky-300",
                                    document.reviewStatus === "not_reviewed" &&
                                      "bg-muted text-muted-foreground",
                                  )}
                                >
                                  {document.reviewStatus === "confirmed" ? (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  ) : null}
                                  {formatPackageReviewItemStatus(document.reviewStatus)}
                                </span>
                              </div>
                              {isReviewed ? (
                                <span className="text-muted-foreground">Snapshot locked</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {document.reviewStatus !== "confirmed" ? (
                                    <button
                                      type="button"
                                      className="pilot-button-primary"
                                      disabled={
                                        document.status !== "attached" ||
                                        (document.signature_required &&
                                          document.signature_status !== "signed_manual_verified") ||
                                        builder.reviewItemBusy === `document:${document.key}`
                                      }
                                      onClick={() =>
                                        void builder.updateReviewItem(
                                          "document",
                                          document.key,
                                          "confirmed",
                                        )
                                      }
                                    >
                                      {builder.reviewItemBusy === `document:${document.key}` ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : null}
                                      Confirm document
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="pilot-button-ghost"
                                    onClick={() => setActive("drawings")}
                                  >
                                    Change
                                  </button>
                                  {document.status === "attached" ? (
                                    <button
                                      type="button"
                                      className="pilot-button-ghost"
                                      onClick={() => void builder.removeMapping(document.key)}
                                    >
                                      Remove
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="pilot-button-ghost"
                                    disabled={
                                      !builder.reviewNotes.trim() ||
                                      builder.reviewItemBusy === `document:${document.key}`
                                    }
                                    onClick={() =>
                                      void builder.updateReviewItem(
                                        "document",
                                        document.key,
                                        "needs_correction",
                                      )
                                    }
                                  >
                                    Flag for correction
                                  </button>
                                </div>
                              )}
                              {document.signature_required ? (
                                <div className="space-y-2 rounded-md border border-amber-500/30 p-3 md:col-span-4">
                                  <p className="font-medium text-foreground">
                                    Signature:{" "}
                                    {document.signature_status === "signed_manual_verified"
                                      ? "Signed — manually verified ✓"
                                      : document.signature_status === "unsigned"
                                        ? "Unsigned"
                                        : "Unknown"}
                                  </p>
                                  {document.signature_review_note ? (
                                    <p className="text-muted-foreground">
                                      Verification note: {document.signature_review_note}
                                    </p>
                                  ) : null}
                                  {!isReviewed ? (
                                    <>
                                      {document.signature_status !==
                                      "signed_manual_verified" ? (
                                        <input
                                          value={builder.signatureReviewNote}
                                          onChange={(event) =>
                                            builder.setSignatureReviewNote(event.target.value)
                                          }
                                          placeholder="Verification note required to verify signed"
                                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
                                        />
                                      ) : null}
                                      {document.signature_status ===
                                      "signed_manual_verified" ? (
                                        <button
                                          type="button"
                                          className="pilot-button-ghost"
                                          disabled={
                                            builder.signatureBusyAction ===
                                            `${document.key}:unsigned`
                                          }
                                          onClick={() =>
                                            void builder.setSignatureStatus(
                                              document.key,
                                              "unsigned",
                                            )
                                          }
                                        >
                                          {builder.signatureBusyAction ===
                                          `${document.key}:unsigned` ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          ) : null}
                                          Mark unsigned
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          className="pilot-button-primary"
                                          disabled={
                                            !builder.signatureReviewNote.trim() ||
                                            builder.signatureBusyAction ===
                                              `${document.key}:signed_manual_verified`
                                          }
                                          onClick={() =>
                                            void builder.setSignatureStatus(
                                              document.key,
                                              "signed_manual_verified",
                                            )
                                          }
                                        >
                                          {builder.signatureBusyAction ===
                                          `${document.key}:signed_manual_verified` ? (
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          ) : null}
                                          Verify signed
                                        </button>
                                      )}
                                    </>
                                  ) : null}
                                  <p className="text-muted-foreground">
                                    Signature verification is separate from document confirmation.
                                  </p>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {[
                      ...packageReview.fields,
                      ...packageReview.documents,
                    ].some(
                      (item) =>
                        item.reviewStatus === "needs_correction" ||
                        item.reviewStatus === "ready_for_re_review",
                    ) || builder.packageMeta?.package_review?.package_correction?.active ? (
                      <div className="mt-6 space-y-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
                        <div className="pilot-kicker">Changes required</div>
                        {builder.packageMeta?.package_review?.package_correction?.note ? (
                          <p className="text-xs text-muted-foreground">
                            {builder.packageMeta.package_review.package_correction.note}
                          </p>
                        ) : null}
                        {[...packageReview.fields, ...packageReview.documents]
                          .filter(
                            (item) =>
                              item.reviewStatus === "needs_correction" ||
                              item.reviewStatus === "ready_for_re_review",
                          )
                          .map((item) => (
                            <p key={item.key} className="text-xs">
                              {item.label || item.key} ·{" "}
                              {formatPackageReviewItemStatus(item.reviewStatus)}
                            </p>
                          ))}
                      </div>
                    ) : null}

                    {builder.packageApp ? (
                      <div className="mt-6 space-y-3 rounded-md border border-border p-4">
                        <Label htmlFor="uci-builder-review-notes" className="text-xs">
                          Correction reason (required for Reopen or Flag for correction)
                        </Label>
                        <Textarea
                          id="uci-builder-review-notes"
                          value={builder.reviewNotes}
                          onChange={(e) => builder.setReviewNotes(e.target.value)}
                          rows={2}
                          className="text-sm"
                          placeholder="Document review comments for the team"
                        />
                        <div className="flex flex-wrap gap-2">
                          {!isReviewed ? (
                            <button
                              type="button"
                              className="pilot-button-primary"
                              disabled={
                                builder.reviewBusy ||
                                !packageReview.readyForFinalReview
                              }
                              onClick={() => void builder.markReviewed("reviewed")}
                            >
                              {builder.reviewBusy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              Mark package reviewed
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="pilot-button-ghost"
                            disabled={builder.reviewBusy || !builder.reviewNotes.trim()}
                            onClick={() => void builder.markReviewed("needs_changes")}
                          >
                            {isReviewed ? "Reopen review" : "Request changes"}
                          </button>
                          <button
                            type="button"
                            className="hidden"
                            aria-hidden="true"
                            disabled={!submitReady || builder.submitBusy}
                            onClick={() => void builder.submitPackage()}
                          >
                            {builder.submitBusy ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            {builder.isDominionSynthetic
                              ? "Run validation-only dry run"
                              : "Submit to utility"}{" "}
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {isReviewed && builder.packageMeta?.package_review ? (
                            <>
                              Reviewed by{" "}
                              {builder.packageMeta.package_review.reviewer_display ||
                                builder.packageMeta.package_review.reviewed_by_user_id ||
                                builder.packageApp.reviewed_by ||
                                "unknown reviewer"}
                              {builder.packageMeta.package_review.reviewed_at ||
                              builder.packageApp.reviewed_at
                                ? ` · ${new Date(
                                    builder.packageMeta.package_review.reviewed_at ||
                                      builder.packageApp.reviewed_at ||
                                      "",
                                  ).toLocaleString()}`
                                : ""}
                              . The exact reviewed field and document snapshot is retained.
                            </>
                          ) : submitReady
                            ? builder.isDominionSynthetic
                              ? "Reviewed — validation only. No email, portal action, or lifecycle transition."
                              : "Reviewed — submit runs Pepco validation dry-run by default (no live portal submit unless explicitly enabled)."
                            : packageReview.readyForFinalReview
                              ? "Every required mapping is confirmed. Mark the package reviewed to lock the snapshot."
                              : "Confirm every required field and document before final review."}
                        </p>
                        {builder.lastSubmitResult ? (
                          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                            <p>
                              Last submit status:{" "}
                              <span className="font-semibold text-foreground">
                                {builder.lastSubmitResult.status || "recorded"}
                              </span>
                              {builder.lastSubmitResult.dry_run ? " · dry-run" : ""}
                              {builder.lastSubmitResult.live_submission_enabled === false
                                ? " · live submission disabled"
                                : ""}
                            </p>
                            {builder.lastSubmitResult.message ? (
                              <p className="mt-1">{builder.lastSubmitResult.message}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-6 text-sm text-muted-foreground">
                        Build a package draft before review and submit actions become available.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
                  <button type="button" onClick={goBack} className="pilot-button-ghost">
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={markCompleteAndContinue}
                    className="pilot-button-primary"
                    disabled={!sectionState[active]?.complete}
                    title={
                      sectionState[active]?.complete
                        ? "Continue to next section"
                        : sectionState[active]?.helper || "Section not ready yet"
                    }
                  >
                    <ListChecks className="h-4 w-4" /> Mark complete &amp; continue
                  </button>
                </div>
                {sectionState[active]?.helper && !sectionState[active]?.complete ? (
                  <p className="mt-3 text-xs text-muted-foreground">{sectionState[active]?.helper}</p>
                ) : null}
              </section>
            </div>
          </>
        )}
      </div>
    </>
  );
}
