import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { filterArlingtonPlanSetDocumentsForUi } from "@/lib/arlingtonPlanSetDocumentsCleanup";
import { ArlingtonPlanReviewContinuePanel } from "@/components/portal/ArlingtonPlanReviewContinuePanel";
import {
  CheckCircle2,
  Clock,
  FileText,
  ClipboardList,
  Link2,
  DollarSign,
  AlertCircle,
  ExternalLink,
  XCircle,
  FileSearch,
  CalendarCheck,
} from "lucide-react";

interface AccelaDepartment {
  name: string;
  status: string;
  statusIcon: string;
  date: string;
  details: string;
}

interface AccelaAttachment {
  name: string;
  record_id: string;
  record_type: string;
  entity_type: string;
  type: string;
  size: string;
  latest_update: string;
  viewUrl?: string;
  downloadStatus?: string;
  downloadError?: string;
}

interface AccelaInspectionRow {
  type: string;
  status: string;
  date: string;
  inspector: string;
  result: string;
  category?: string;
}

interface AccelaRelatedRecord {
  record_number: string;
  record_type: string;
  status: string;
  project_name: string;
  date: string;
}

interface AccelaPaymentRow {
  [key: string]: string;
}

interface AccelaTableBlock {
  title: string;
  headers: string[];
  rows: Record<string, string>[];
}

/** Normalized Arlington Plan Review documents (portal_data.tabs.planReview.tabs.*). */
interface ArlingtonPlanReviewDocRow {
  name?: string;
  filename?: string;
  documentType?: string;
  documentDate?: string;
  size?: string;
  status?: string;
  discipline?: string;
  sheetType?: string;
  description?: string;
  revision?: string;
  uploadStatus?: string;
  downloadStatus?: string;
  storagePath?: string;
  publicUrl?: string;
  downloadUrl?: string;
  sourceTab?: string;
  sourceSection?: string;
  /** Mapped from scraped portal attachments (`record_info_attachments`). */
  source?: string;
  /** ERMS row action control (scraped metadata; HTTP href only populated when present). */
  action?: {
    href?: string;
    onclick?: string;
    id?: string;
    title?: string;
    alt?: string;
    name?: string;
    documentId?: string;
  };
}

/** Compact comment row persisted from Arlington Plan Review scraper. */
interface ArlingtonPlanReviewCommentRow {
  commentId?: string;
  reviewGroup?: string;
  reviewerName?: string;
  sheet?: string;
  status?: string;
  comment?: string;
}

function arlingtonPlanSetOpenUrl(doc: ArlingtonPlanReviewDocRow): string | null {
  for (const u of [doc.publicUrl, doc.downloadUrl]) {
    const s = `${u ?? ""}`.trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return null;
}

interface ArlingtonPlanTenantPrConfig {
  enabled?: boolean;
  downloadFromIntegratedIframe?: boolean;
  mapDocumentsFromAttachments?: boolean;
  extractBudgetMs?: number;
  /** Stage 2 — Review Results, Approved Documents, Project Information */
  planReviewIncludeSecondaryTabs?: boolean;
  perTabExtractBudgetMs?: number;
  /** When true, UI + scraper expose only Plans & Documents → Plan Set Documents. */
  scopePlanSetDocumentsOnly?: boolean;
}

interface ArlingtonPlanReviewSectionNorm {
  label?: string;
  documents?: ArlingtonPlanReviewDocRow[];
  fields?: unknown[];
  comments?: ArlingtonPlanReviewCommentRow[];
  /** Arlington ERMS: nested grids under Plans & Documents */
  sections?: Partial<
    Record<
      | "planSetDocuments"
      | "supportingDocuments"
      | "commentResponseLetters",
      { label?: string; documents?: ArlingtonPlanReviewDocRow[] }
    >
  >;
}

interface ArlingtonNormalizedPlanTabs {
  plansAndDocuments?: ArlingtonPlanReviewSectionNorm;
  reviewResultsAndMarkups?: ArlingtonPlanReviewSectionNorm;
  approvedDocuments?: ArlingtonPlanReviewSectionNorm;
  projectInformation?: ArlingtonPlanReviewSectionNorm;
}

/** Structured Plan Review (Arlington ACA). */
interface AccelaPlanReviewSubTab {
  label?: string;
  found?: boolean;
  reason?: string;
  error?: string;
  tables?: Array<{ rows: string[][] }>;
  links?: Array<{ text: string; href: string }>;
  downloadCandidates?: Array<{ text: string; href: string }>;
  textPreview?: string;
}

interface AccelaPlanReviewTab {
  comments?: Array<{
    reviewer?: string;
    department?: string;
    comment?: string;
    date?: string;
  }>;
  text?: string;
  screenshot?: string | null;
  planReviewSummary?: unknown;
  downloadLinks?: Array<{ text?: string; href?: string; label?: string }>;
  used?: boolean;
  message?: string | null;
  source?: string | null;
  tabs?: Record<string, AccelaPlanReviewSubTab> | ArlingtonNormalizedPlanTabs;
  jurisdiction?: string;
  /** Arlington: Plan Review iframe scrape hit budget timeout. */
  timeout?: boolean;
  /** Checkpointed scrape left retryable ERMS downloads pending. */
  partialPendingDownloads?: boolean;
  tenantPlanReview?: ArlingtonPlanTenantPrConfig;
}

/** Arlington structured Record Info (portal_data.tabs.info.arlingtonRecordInfo). */
interface ArlingtonRecordInfoSectionBlock {
  label: string;
  lines: string[];
  text: string;
  name?: string;
  company?: string;
  phone?: string;
  contractorNumber?: string;
}

interface ArlingtonRecordInfoPayload {
  workLocation: ArlingtonRecordInfoSectionBlock;
  applicant: ArlingtonRecordInfoSectionBlock;
  licensedProfessional: ArlingtonRecordInfoSectionBlock;
  owner: ArlingtonRecordInfoSectionBlock;
}

interface AccelaPortalData {
  schemaVersion?: number;
  portalType: string;
  name: string;
  projectNum: string;
  description: string;
  location: string;
  dashboardStatus: string;
  tabs: {
    info?: {
      title?: string;
      /** Present when Record Info uses Arlington section parser. */
      jurisdiction?: string;
      fields?: {
        record_number?: string;
        record_type?: string;
        record_status?: string;
        expiration_date?: string;
        [key: string]: string | undefined;
      };
      keyValues?: { key: string; value: string }[];
      tables?: AccelaTableBlock[];
      screenshot?: string;
      arlingtonRecordInfo?: ArlingtonRecordInfoPayload;
    };
    status?: {
      departments?: AccelaDepartment[];
      tables?: AccelaTableBlock[];
    };
    reports?: {
      pdfs?: {
        fileName: string;
        text?: string;
        screenshot?: string;
        source?: string;
        comments?: { text: string; status?: string }[];
      }[];
      keyValues?: { key: string; value: string }[];
      tables?: AccelaTableBlock[];
    };
    attachments?: {
      tables?: AccelaTableBlock[];
    };
    inspections?: {
      tables?: AccelaTableBlock[];
    };
    payments?: {
      tables?: AccelaTableBlock[];
    };
    relatedRecords?: {
      tables?: AccelaTableBlock[];
    };
    planReview?: AccelaPlanReviewTab;
    [key: string]: unknown;
  };
}

function humanizeCamelKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function absolutePortalHref(href: string): string {
  const h = (href || "").trim();
  if (!h) return "#";
  if (/^https?:\/\//i.test(h)) return h;
  try {
    return new URL(h, "https://aca-prod.accela.com").href;
  } catch {
    return h;
  }
}

/** Tab keys for Arlington integrated Plan Review (portal_data.tabs.planReview.tabs). */
const ARLINGTON_PLAN_REVIEW_INTEGRATED_TAB_KEYS = [
  "plansAndDocuments",
  "reviewResultsAndMarkups",
  "approvedDocuments",
  "projectInformation",
] as const;

type ArlingtonPlanReviewIntegratedTabKey =
  (typeof ARLINGTON_PLAN_REVIEW_INTEGRATED_TAB_KEYS)[number];

const ARLINGTON_PLAN_REVIEW_TAB_LABELS: Record<
  ArlingtonPlanReviewIntegratedTabKey,
  string
> = {
  plansAndDocuments: "Plans & Documents",
  reviewResultsAndMarkups: "Review Results & Mark-ups",
  approvedDocuments: "Approved Documents",
  projectInformation: "Project Information",
};

function isIntegratedPlanReviewTabBucket(
  v: unknown,
): v is Record<string, unknown> {
  return (
    v != null && typeof v === "object" && !Array.isArray(v) && !("found" in v)
  );
}

/**
 * Use nested Arlington Plan Review UI when tab buckets match the integrated scraper shape.
 * (Do not require root-level `plansAndDocuments.documents` — Plan Set lives under `sections`.)
 */
function shouldUseArlingtonIntegratedPlanReviewUI(
  planReview: AccelaPlanReviewTab | undefined,
): boolean {
  if (!planReview?.tabs || typeof planReview.tabs !== "object") return false;
  const t = planReview.tabs as Record<string, unknown>;
  const hasBucket = ARLINGTON_PLAN_REVIEW_INTEGRATED_TAB_KEYS.some(
    (k) => k in t && isIntegratedPlanReviewTabBucket(t[k]),
  );
  if (hasBucket) return true;
  return planReview.jurisdiction === "arlington_county_va";
}

function arlingtonIntegratedTabKeysPresent(
  tabs: Record<string, unknown>,
): ArlingtonPlanReviewIntegratedTabKey[] {
  return ARLINGTON_PLAN_REVIEW_INTEGRATED_TAB_KEYS.filter((k) => k in tabs);
}

const ARLINGTON_PLAN_NESTED_KEYS: ReadonlyArray<
  keyof NonNullable<ArlingtonPlanReviewSectionNorm["sections"]>
> = ["planSetDocuments"];

function collectArlingtonPlanReviewDocRows(section?: ArlingtonPlanReviewSectionNorm): {
  flat: ArlingtonPlanReviewDocRow[];
  nested: Array<{ key: string; label: string; docs: ArlingtonPlanReviewDocRow[] }>;
  fields: unknown[];
} {
  /** Root-level Plans & Documents rows are out of Arlington Plan Review scope — Plan Set Documents only. */
  const flat: ArlingtonPlanReviewDocRow[] = [];
  const fields = Array.isArray(section?.fields) ? section!.fields : [];
  const nested: Array<{
    key: string;
    label: string;
    docs: ArlingtonPlanReviewDocRow[];
  }> = [];

  const subs = section?.sections;
  if (subs && typeof subs === "object") {
    for (const nk of ARLINGTON_PLAN_NESTED_KEYS) {
      const blk = subs[nk];
      const docsArrRaw = blk?.documents;
      if (!Array.isArray(docsArrRaw) || !docsArrRaw.length) continue;
      const docsArr =
        nk === "planSetDocuments"
          ? filterArlingtonPlanSetDocumentsForUi(
              docsArrRaw as ArlingtonPlanReviewDocRow[],
            )
          : docsArrRaw;
      if (!docsArr.length) continue;
      const lab =
        (blk?.label || "").trim() ||
        nk.replace(/([A-Z])/g, " $1").trim() ||
        String(nk);
      nested.push({ key: String(nk), label: lab, docs: docsArr });
    }
  }

  return { flat, nested, fields };
}

function countArlingtonPlanSetDocuments(norm: ArlingtonNormalizedPlanTabs): number {
  const raw = norm.plansAndDocuments?.sections?.planSetDocuments?.documents;
  if (!Array.isArray(raw) || !raw.length) return 0;
  return filterArlingtonPlanSetDocumentsForUi(
    raw as ArlingtonPlanReviewDocRow[],
  ).length;
}

function arlingtonIntegratedHasAnyDocRows(
  tabs: ArlingtonNormalizedPlanTabs | null,
): boolean {
  if (!tabs) return false;
  if (countArlingtonPlanSetDocuments(tabs) > 0) return true;
  const rr = tabs.reviewResultsAndMarkups?.documents;
  if (Array.isArray(rr) && rr.length > 0) return true;
  const ad = tabs.approvedDocuments?.documents;
  if (Array.isArray(ad) && ad.length > 0) return true;
  const pi = tabs.projectInformation?.documents;
  if (Array.isArray(pi) && pi.length > 0) return true;
  return false;
}

function arlingtonDocDisplayStatus(doc: ArlingtonPlanReviewDocRow): string {
  const dsRaw = `${doc.downloadStatus ?? ""}`.trim();
  if (dsRaw === "oversized_for_supabase") {
    return "Pending — oversized (needs alternate storage)";
  }
  const s = `${doc.status ?? ""}`.trim();
  if (s) return s;
  return `${doc.downloadStatus ?? ""}`.trim() || "—";
}

const ARLINGTON_PLAN_REVIEW_PENDING_DOWNLOAD_STATUSES = new Set([
  "pending_not_attempted",
  "pending_stream_timeout",
  "pending_tab_not_resolved",
  "pending_token_missing",
  "pending_timeout_resume",
  "pending_session_closed",
]);

function arlingtonPlanReviewDocHasStoredFile(
  doc: ArlingtonPlanReviewDocRow,
): boolean {
  for (const u of [doc.publicUrl, doc.downloadUrl]) {
    if (/^https?:\/\//i.test(`${u ?? ""}`.trim())) return true;
  }
  return !!`${doc.storagePath ?? ""}`.trim();
}

/** QA helper — aligned with Open-link / continue-panel download completion rules. */
function arlingtonPlanReviewDocIsDownloaded(
  doc: ArlingtonPlanReviewDocRow,
): boolean {
  const ds = `${doc.downloadStatus ?? ""}`.trim();
  const statusLo = `${doc.status ?? ""}`.trim().toLowerCase();

  if (ARLINGTON_PLAN_REVIEW_PENDING_DOWNLOAD_STATUSES.has(ds)) return false;
  if (ds === "failed_non_retryable" || ds === "metadata_only") return false;

  if (ds === "plan_set_row" || ds === "plan_review_secondary_row") {
    return arlingtonPlanReviewDocHasStoredFile(doc) || statusLo === "downloaded";
  }

  if (statusLo === "downloaded") return true;
  if (arlingtonPlanReviewDocHasStoredFile(doc)) return true;
  if (
    ds === "uploaded" ||
    ds === "already_downloaded" ||
    ds === "duplicate_skipped"
  ) {
    return true;
  }
  if (arlingtonPlanSetOpenUrl(doc)) return true;

  return false;
}

function countArlingtonPlanReviewDocDownloads(
  docs: ArlingtonPlanReviewDocRow[],
): { total: number; downloaded: number; pending: number } {
  const total = docs.length;
  const downloaded = docs.filter(arlingtonPlanReviewDocIsDownloaded).length;
  return { total, downloaded, pending: Math.max(0, total - downloaded) };
}

function ArlingtonPlanReviewDownloadSummary({
  tabLabel,
  docs,
}: {
  tabLabel: string;
  docs: ArlingtonPlanReviewDocRow[];
}) {
  if (docs.length === 0) return null;
  const { total, downloaded, pending } =
    countArlingtonPlanReviewDocDownloads(docs);
  return (
    <p className="text-xs text-muted-foreground">
      {tabLabel}: Downloaded {downloaded} / {total} documents
      {pending > 0 ? ` · ${pending} pending` : null}
    </p>
  );
}

/** Plan Set — columns requested for Arlington integrated UI */
function ArlingtonPlanSetDocumentsTable({
  docs,
}: {
  docs: ArlingtonPlanReviewDocRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-xs text-muted-foreground w-10">#</TableHead>
            <TableHead className="text-xs text-muted-foreground">Name</TableHead>
            <TableHead className="text-xs text-muted-foreground whitespace-nowrap">
              Discipline
            </TableHead>
            <TableHead className="text-xs text-muted-foreground whitespace-nowrap">
              Sheet Type
            </TableHead>
            <TableHead className="text-xs text-muted-foreground whitespace-nowrap">
              Revision
            </TableHead>
            <TableHead className="text-xs text-muted-foreground whitespace-nowrap">
              Status
            </TableHead>
            <TableHead className="text-xs text-muted-foreground w-[100px]">
              Open
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc, di) => {
            const label = doc.name || doc.filename || "—";
            const openHref = arlingtonPlanSetOpenUrl(doc);
            return (
              <TableRow key={di} className="border-border">
                <TableCell className="text-xs text-muted-foreground tabular-nums w-10">
                  {di + 1}
                </TableCell>
                <TableCell className="max-w-[240px] text-sm text-foreground break-words">
                  {label}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {doc.discipline || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {doc.sheetType || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {doc.revision || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {arlingtonDocDisplayStatus(doc)}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {openHref ? (
                    <a
                      href={openHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      Open
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ArlingtonReviewResultsDocumentsTable({
  docs,
}: {
  docs: ArlingtonPlanReviewDocRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-xs text-muted-foreground w-10">#</TableHead>
            <TableHead className="text-xs text-muted-foreground">Name</TableHead>
            <TableHead className="text-xs text-muted-foreground">Type</TableHead>
            <TableHead className="text-xs text-muted-foreground">Date</TableHead>
            <TableHead className="text-xs text-muted-foreground">Status</TableHead>
            <TableHead className="text-xs text-muted-foreground w-[120px]">
              Open
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc, di) => {
            const label = doc.name || doc.filename || "—";
            const typeStr =
              `${doc.documentType ?? (doc as { type?: string }).type ?? ""}`.trim() ||
              "—";
            const dateStr = doc.documentDate || "—";
            const openHref = arlingtonPlanSetOpenUrl(doc);
            return (
              <TableRow key={di} className="border-border">
                <TableCell className="text-xs text-muted-foreground tabular-nums w-10">
                  {di + 1}
                </TableCell>
                <TableCell className="max-w-[220px] text-sm break-words">
                  {label}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {typeStr}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {dateStr}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {arlingtonDocDisplayStatus(doc)}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {openHref ? (
                    <a
                      href={openHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      Open
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Metadata only</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ArlingtonApprovedDocumentsTable({
  docs,
}: {
  docs: ArlingtonPlanReviewDocRow[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-xs text-muted-foreground w-10">#</TableHead>
            <TableHead className="text-xs text-muted-foreground">Name</TableHead>
            <TableHead className="text-xs text-muted-foreground">
              Document Type
            </TableHead>
            <TableHead className="text-xs text-muted-foreground">Date</TableHead>
            <TableHead className="text-xs text-muted-foreground">Status</TableHead>
            <TableHead className="text-xs text-muted-foreground w-[120px]">
              Open
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {docs.map((doc, di) => {
            const label = doc.name || doc.filename || "—";
            const typeStr =
              `${doc.documentType ?? (doc as { type?: string }).type ?? ""}`.trim() ||
              "—";
            const dateStr = doc.documentDate || "—";
            const openHref = arlingtonPlanSetOpenUrl(doc);
            return (
              <TableRow key={di} className="border-border">
                <TableCell className="text-xs text-muted-foreground tabular-nums w-10">
                  {di + 1}
                </TableCell>
                <TableCell className="max-w-[220px] text-sm break-words">
                  {label}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {typeStr}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {dateStr}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {arlingtonDocDisplayStatus(doc)}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {openHref ? (
                    <a
                      href={openHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      Open
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground">Metadata only</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ArlingtonPlanReviewCommentsTable({
  comments,
}: {
  comments: ArlingtonPlanReviewCommentRow[];
}) {
  if (!comments.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">Comments</h4>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-xs text-muted-foreground">
                Reviewer
              </TableHead>
              <TableHead className="text-xs text-muted-foreground">Group</TableHead>
              <TableHead className="text-xs text-muted-foreground">Sheet</TableHead>
              <TableHead className="text-xs text-muted-foreground">Status</TableHead>
              <TableHead className="text-xs text-muted-foreground min-w-[200px]">
                Comment
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {comments.map((c, i) => (
              <TableRow key={`${c.commentId ?? ""}-${i}`} className="border-border align-top">
                <TableCell className="text-xs text-foreground">
                  {c.reviewerName || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.reviewGroup || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.sheet || "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {c.status || "—"}
                </TableCell>
                <TableCell className="text-xs text-foreground whitespace-pre-wrap break-words max-w-md">
                  {c.comment || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ArlingtonPlansAndDocumentsTabContent({
  section,
}: {
  section?: ArlingtonPlanReviewSectionNorm;
}) {
  const pd = collectArlingtonPlanReviewDocRows(section);
  if (!pd.nested.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No Plan Set documents in this section.
      </p>
    );
  }
  const allDocs = pd.nested.flatMap((block) => block.docs);
  return (
    <div className="space-y-4">
      <ArlingtonPlanReviewDownloadSummary
        tabLabel={ARLINGTON_PLAN_REVIEW_TAB_LABELS.plansAndDocuments}
        docs={allDocs}
      />
      {pd.nested.map((block) => (
        <div key={block.key} className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {block.label}
          </h4>
          <ArlingtonPlanSetDocumentsTable docs={block.docs} />
        </div>
      ))}
    </div>
  );
}

function ArlingtonReviewResultsTabContent({
  section,
}: {
  section?: ArlingtonPlanReviewSectionNorm;
}) {
  const docs = Array.isArray(section?.documents) ? section.documents : [];
  const comments = Array.isArray(section?.comments) ? section.comments : [];
  const emptyDocs = docs.length === 0;
  const emptyComments = comments.length === 0;
  return (
    <div className="space-y-6">
      {!emptyDocs ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Documents</h4>
          <ArlingtonPlanReviewDownloadSummary
            tabLabel={ARLINGTON_PLAN_REVIEW_TAB_LABELS.reviewResultsAndMarkups}
            docs={docs}
          />
          <ArlingtonReviewResultsDocumentsTable docs={docs} />
        </div>
      ) : null}
      {!emptyComments ? (
        <ArlingtonPlanReviewCommentsTable comments={comments} />
      ) : null}
      {emptyDocs && emptyComments ? (
        <p className="text-sm text-muted-foreground">
          No review results, mark-ups, or comments were returned.
        </p>
      ) : null}
    </div>
  );
}

function ArlingtonApprovedDocumentsTabContent({
  section,
}: {
  section?: ArlingtonPlanReviewSectionNorm;
}) {
  const docs = Array.isArray(section?.documents) ? section.documents : [];
  if (!docs.length) {
    return (
      <p className="text-sm text-muted-foreground">No approved documents.</p>
    );
  }
  return (
    <div className="space-y-2">
      <ArlingtonPlanReviewDownloadSummary
        tabLabel={ARLINGTON_PLAN_REVIEW_TAB_LABELS.approvedDocuments}
        docs={docs}
      />
      <ArlingtonApprovedDocumentsTable docs={docs} />
    </div>
  );
}

function ArlingtonProjectInformationTabContent({
  section,
}: {
  section?: ArlingtonPlanReviewSectionNorm;
}) {
  const fields = Array.isArray(section?.fields) ? section.fields : [];
  const docs = Array.isArray(section?.documents) ? section.documents : [];
  const fieldRows = fields.filter(
    (f): f is { label?: string; value?: string } =>
      f != null && typeof f === "object" && !Array.isArray(f),
  );
  if (fieldRows.length === 0 && docs.length === 0) {
    return (
      <Card className="border-border bg-muted/20">
        <CardContent className="p-4 text-sm text-muted-foreground">
          No project information documents or fields were returned for this record.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      {docs.length === 0 && fieldRows.length > 0 ? (
        <p className="text-xs text-muted-foreground">No downloadable documents</p>
      ) : null}
      {fieldRows.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Fields</h4>
          <div className="rounded-md border border-border divide-y divide-border">
            {fieldRows.map((f, i) => (
              <div
                key={i}
                className="grid grid-cols-1 sm:grid-cols-[minmax(120px,200px)_1fr] gap-2 px-3 py-2 text-sm"
              >
                <span className="text-muted-foreground">
                  {(f.label || "—").toString()}
                </span>
                <span className="text-foreground break-words">
                  {f.value != null &&
                  String(f.value).trim() !== ""
                    ? String(f.value)
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {docs.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Documents</h4>
          <ArlingtonPlanReviewDownloadSummary
            tabLabel={ARLINGTON_PLAN_REVIEW_TAB_LABELS.projectInformation}
            docs={docs}
          />
          <ArlingtonReviewResultsDocumentsTable docs={docs} />
        </div>
      ) : null}
    </div>
  );
}

function ArlingtonIntegratedPlanReviewNestedTabs({
  normTabs,
  recordNumber,
}: {
  normTabs: ArlingtonNormalizedPlanTabs;
  recordNumber: string;
}) {
  const tabRec = normTabs as Record<string, unknown>;
  const keys = arlingtonIntegratedTabKeysPresent(tabRec);
  const defaultKey = keys[0] ?? "plansAndDocuments";
  return (
    <Tabs
      defaultValue={defaultKey}
      key={`pr-nested-${recordNumber}-${keys.join(",")}`}
      className="w-full"
    >
      <TabsList className="flex h-auto flex-wrap gap-1 bg-muted/30 border border-border mb-3 p-1">
        {keys.map((k) => (
          <TabsTrigger key={k} value={k} className="text-xs shrink-0">
            {ARLINGTON_PLAN_REVIEW_TAB_LABELS[k]}
          </TabsTrigger>
        ))}
      </TabsList>
      {keys.includes("plansAndDocuments") ? (
        <TabsContent value="plansAndDocuments" className="mt-0 space-y-4">
          <ArlingtonPlansAndDocumentsTabContent
            section={normTabs.plansAndDocuments}
          />
        </TabsContent>
      ) : null}
      {keys.includes("reviewResultsAndMarkups") ? (
        <TabsContent value="reviewResultsAndMarkups" className="mt-0 space-y-4">
          <ArlingtonReviewResultsTabContent
            section={normTabs.reviewResultsAndMarkups}
          />
        </TabsContent>
      ) : null}
      {keys.includes("approvedDocuments") ? (
        <TabsContent value="approvedDocuments" className="mt-0 space-y-4">
          <ArlingtonApprovedDocumentsTabContent
            section={normTabs.approvedDocuments}
          />
        </TabsContent>
      ) : null}
      {keys.includes("projectInformation") ? (
        <TabsContent value="projectInformation" className="mt-0 space-y-4">
          <ArlingtonProjectInformationTabContent
            section={normTabs.projectInformation}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

/** Legacy Arlington Plan Review sub-tabs (matrix / download candidates). */
function ArlingtonLegacyPlanReviewTabCards({
  planReviewTab,
}: {
  planReviewTab: AccelaPlanReviewTab;
}) {
  if (
    !planReviewTab.tabs ||
    planReviewTab.used !== true ||
    Object.keys(planReviewTab.tabs).length === 0
  ) {
    return null;
  }
  return (
    <div
      className="space-y-4"
      data-testid="arlington-plan-review-tabs-legacy"
    >
      {Object.entries(planReviewTab.tabs).map(([key, section]) => {
        const sec = section as AccelaPlanReviewSubTab;
        const title = sec.label || humanizeCamelKey(key);
        const showFailureCard =
          sec.found === false &&
          (!sec.tables || sec.tables.length === 0) &&
          (!sec.downloadCandidates || sec.downloadCandidates.length === 0);
        if (showFailureCard) return null;
        return (
          <Card key={key} className="border-border bg-muted/20">
            <CardHeader className="py-3 px-4 pb-0">
              <CardTitle className="text-sm font-medium">{title}</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              {Array.isArray(sec.tables) &&
                sec.tables.length > 0 &&
                sec.tables.map((t, ti) => (
                  <MatrixTable key={ti} rows={t.rows || []} />
                ))}
              {sec.downloadCandidates &&
                sec.downloadCandidates.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Download links (this tab)
                    </p>
                    <ul className="space-y-1">
                      {sec.downloadCandidates.map((d, di) => (
                        <li key={di}>
                          <a
                            href={absolutePortalHref(d.href)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                          >
                            {d.text || d.href}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function MatrixTable({ rows }: { rows: string[][] }) {
  if (!rows?.length) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i} className="border-border">
              {r.map((c, j) => (
                <TableCell key={j} className="text-xs align-top py-2">
                  {c || "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function getStatusBadgeStyle(status: string): { className: string } {
  const s = status.toLowerCase();
  if (s.includes("expired"))
    return { className: "bg-warning/20 text-warning border-warning/30" };
  if (s.includes("approved") || s.includes("issued") || s.includes("active"))
    return {
      className: "bg-success/20 text-success border-success/30",
    };
  if (s.includes("closed"))
    return { className: "bg-muted text-muted-foreground border-border" };
  if (
    s.includes("pending") ||
    s.includes("review") ||
    s.includes("in progress")
  )
    return { className: "bg-warning/15 text-warning border-warning/30" };
  if (s.includes("denied") || s.includes("rejected"))
    return { className: "bg-destructive/15 text-destructive border-destructive/40" };
  return { className: "bg-muted text-muted-foreground border-border" };
}

interface AccelaProjectViewProps {
  portalData: AccelaPortalData;
  projectId?: string | null;
  userId?: string | null;
  permitNumber?: string | null;
  onPortalDataRefresh?: () => void | Promise<void>;
}

export default function AccelaProjectView({
  portalData,
  projectId = null,
  userId = null,
  permitNumber: permitNumberProp = null,
  onPortalDataRefresh,
}: AccelaProjectViewProps) {
  const [activeTab, setActiveTab] = useState("info");

  const header = portalData.tabs?.info?.fields || {};
  const recordNumber =
    header.record_number || portalData.name || portalData.projectNum;
  const recordType = header.record_type || portalData.description || "";
  const recordStatus = (
    header.record_status ||
    portalData.dashboardStatus ||
    ""
  )
    .replace(/^Record Status:\s*/i, "")
    .trim();

  const expirationDate = (header.expiration_date || "")
    .replace(/^Expiration Date:\s*/i, "")
    .trim();

  const departments: AccelaDepartment[] =
    portalData.tabs?.status?.departments || [];

  const allAttachmentTables = portalData.tabs?.attachments?.tables || [];
  const attachmentRows: AccelaAttachment[] = allAttachmentTables
    .flatMap((t) => (Array.isArray(t.rows) ? t.rows : []))
    .filter(
      (r): r is AccelaAttachment =>
        typeof r === "object" && r !== null && "name" in r,
    );

  const inspectionTables = (portalData.tabs?.inspections?.tables || []).filter(
    (t) => Array.isArray(t.rows),
  );

  const allRelatedTables = portalData.tabs?.relatedRecords?.tables || [];
  const relatedRecordRows: AccelaRelatedRecord[] = allRelatedTables
    .flatMap((t) => (Array.isArray(t.rows) ? t.rows : []))
    .filter(
      (r): r is AccelaRelatedRecord => typeof r === "object" && r !== null,
    );

  const paymentTables = (portalData.tabs?.payments?.tables || []).filter((t) =>
    Array.isArray(t.rows),
  );

  const planReviewPdf = portalData.tabs?.reports?.pdfs?.find((p) =>
    p.fileName?.includes("Plan Review"),
  );

  const planReviewTab = portalData.tabs?.planReview;
  const isArlingtonPortalUi =
    planReviewTab?.jurisdiction === "arlington_county_va";
  const planReviewUseIntegratedUi =
    !!planReviewTab &&
    shouldUseArlingtonIntegratedPlanReviewUI(planReviewTab);
  const planReviewTabsRaw =
    planReviewTab?.tabs && typeof planReviewTab.tabs === "object"
      ? (planReviewTab.tabs as Record<string, unknown>)
      : null;
  const arlingtonIntegratedKeys = planReviewTabsRaw
    ? arlingtonIntegratedTabKeysPresent(planReviewTabsRaw)
    : [];
  const arlingtonNormTabs =
    planReviewTabsRaw as ArlingtonNormalizedPlanTabs | null;

  const showInspectionsTab =
    !isArlingtonPortalUi ||
    inspectionTables.some((t) => t.rows.length > 0);
  const showLinksTab =
    !isArlingtonPortalUi || relatedRecordRows.length > 0;
  const showPaymentsTab = !isArlingtonPortalUi;

  const arlingtonHasAnyPlanDocs =
    arlingtonIntegratedHasAnyDocRows(arlingtonNormTabs);

  const infoKeyValues = portalData.tabs?.info?.keyValues || [];

  const infoTab = portalData.tabs?.info;
  const isArlingtonStructuredRecordInfo =
    !!infoTab?.arlingtonRecordInfo &&
    (infoTab?.jurisdiction === "arlington_county_va" ||
      planReviewTab?.jurisdiction === "arlington_county_va");
  const arlingtonRecordSections = infoTab?.arlingtonRecordInfo;

  const showInfoFields =
    isArlingtonStructuredRecordInfo ||
    infoKeyValues.length > 0;

  const completedCount = departments.filter(
    (d) => d.statusIcon === "complete",
  ).length;
  const pendingCount = departments.filter(
    (d) => d.statusIcon !== "complete",
  ).length;

  return (
    <div className="space-y-4" data-testid="accela-project-view">
      <Card className="border-border bg-card">
        <CardContent className="pt-5 pb-4 px-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Accela Record
              </p>
              <h2
                className="text-lg font-semibold text-foreground truncate"
                data-testid="text-record-number"
              >
                {recordNumber}
              </h2>
              {recordType && (
                <p
                  className="text-sm text-muted-foreground mt-0.5"
                  data-testid="text-record-type"
                >
                  {recordType}
                </p>
              )}
              {portalData.location && (
                <p className="text-xs text-muted-foreground mt-1">
                  {portalData.location}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
              {recordStatus && (
                <Badge
                  variant="outline"
                  className={`text-sm px-3 py-1 ${getStatusBadgeStyle(recordStatus).className}`}
                  data-testid="badge-record-status"
                >
                  {recordStatus}
                </Badge>
              )}
              {expirationDate && (
                <Badge
                  variant="outline"
                  className={`text-sm px-3 py-1 ${
                    recordStatus.toLowerCase().includes("expired")
                      ? "bg-warning/20 text-warning border-warning/30"
                      : "bg-muted/40 text-muted-foreground border-border"
                  }`}
                  data-testid="badge-expiration-date"
                >
                  Exp: {expirationDate}
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col lg:flex-row gap-4">
        {departments.length > 0 && (
          <Card className="border-border bg-card lg:w-80 flex-shrink-0">
            <CardHeader className="pb-3 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                Processing Status
                <span className="ml-auto text-xs text-muted-foreground font-normal">
                  {completedCount}/{departments.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div
                className="max-h-[520px] overflow-y-auto pr-1 space-y-0"
                data-testid="timeline-processing-status"
              >
                {departments.map((dept, idx) => {
                  const isComplete = dept.statusIcon === "complete";
                  const isLast = idx === departments.length - 1;
                  return (
                    <div
                      key={idx}
                      className="flex gap-3 relative"
                      data-testid={`timeline-step-${idx}`}
                    >
                      <div className="flex flex-col items-center flex-shrink-0 w-6">
                        <div
                          className={`rounded-full p-0.5 ${isComplete ? "text-success" : "text-muted-foreground"}`}
                        >
                          {isComplete ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : (
                            <Clock className="h-4 w-4" />
                          )}
                        </div>
                        {!isLast && (
                          <div
                            className={`w-px flex-1 min-h-[16px] ${
                              isComplete ? "bg-success/30" : "bg-border"
                            }`}
                          />
                        )}
                      </div>
                      <div className="pb-3 min-w-0 flex-1">
                        <p
                          className={`text-xs leading-tight ${isComplete ? "text-foreground" : "text-muted-foreground"}`}
                        >
                          {dept.name}
                        </p>
                        {dept.date && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {dept.date}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex-1 min-w-0">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-muted/40 border border-border mb-3">
              <TabsTrigger
                value="info"
                className="gap-1.5 text-xs"
                data-testid="tab-info"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                {isArlingtonPortalUi ? "Record Info" : "Info"}
                {showInfoFields && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    (
                    {isArlingtonStructuredRecordInfo
                      ? 8
                      : infoKeyValues.length}
                    )
                  </span>
                )}
              </TabsTrigger>

              <TabsTrigger
                value="files"
                className="gap-1.5 text-xs"
                data-testid="tab-files"
              >
                <FileText className="h-3.5 w-3.5" />
                {isArlingtonPortalUi ? "Attachments" : "Files"}
                {attachmentRows.length > 0 && (
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    ({attachmentRows.length})
                  </span>
                )}
              </TabsTrigger>
              {showInspectionsTab ? (
                <TabsTrigger
                  value="inspections"
                  className="gap-1.5 text-xs"
                  data-testid="tab-inspections"
                >
                  <CalendarCheck className="h-3.5 w-3.5" />
                  Inspections
                </TabsTrigger>
              ) : null}
              {showLinksTab ? (
                <TabsTrigger
                  value="links"
                  className="gap-1.5 text-xs"
                  data-testid="tab-links"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Links
                  {relatedRecordRows.length > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      ({relatedRecordRows.length})
                    </span>
                  )}
                </TabsTrigger>
              ) : null}
              <TabsTrigger
                value="planReview"
                className="gap-1.5 text-xs"
                data-testid="tab-plan-review"
              >
                <FileSearch className="h-3.5 w-3.5" />
                Plan Review
              </TabsTrigger>
              {showPaymentsTab ? (
                <TabsTrigger
                  value="payments"
                  className="gap-1.5 text-xs"
                  data-testid="tab-payments"
                >
                  <DollarSign className="h-3.5 w-3.5" />
                  Payments
                </TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="info">
              <Card className="border-border bg-card">
                <CardContent className="p-4">
                  {isArlingtonStructuredRecordInfo &&
                  arlingtonRecordSections ? (
                    <div
                      className="space-y-6"
                      data-testid="arlington-record-info-clean"
                    >
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                          <div className="text-xs text-muted-foreground mb-1">
                            Record Number
                          </div>
                          <div className="text-sm text-foreground break-words">
                            {header.record_number || recordNumber || "—"}
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                          <div className="text-xs text-muted-foreground mb-1">
                            Record Type
                          </div>
                          <div className="text-sm text-foreground break-words">
                            {header.record_type || recordType || "—"}
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                          <div className="text-xs text-muted-foreground mb-1">
                            Record Status
                          </div>
                          <div className="text-sm text-foreground break-words">
                            {(header.record_status || recordStatus || "")
                              .replace(/^Record Status:\s*/i, "")
                              .trim() || "—"}
                          </div>
                        </div>
                        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                          <div className="text-xs text-muted-foreground mb-1">
                            Expiration Date
                          </div>
                          <div className="text-sm text-foreground break-words">
                            {(header.expiration_date || expirationDate || "")
                              .replace(/^Expiration Date:\s*/i, "")
                              .trim() || "—"}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-4 pt-2 border-t border-border">
                        <div data-testid="arlington-section-work-location">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Work Location
                          </h4>
                          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                            {arlingtonRecordSections.workLocation?.text?.trim() ||
                              "—"}
                          </p>
                        </div>
                        <div data-testid="arlington-section-applicant">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Applicant
                          </h4>
                          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                            {arlingtonRecordSections.applicant?.text?.trim() ||
                              "—"}
                          </p>
                        </div>
                        <div data-testid="arlington-section-licensed">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Licensed Professional
                          </h4>
                          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                            {arlingtonRecordSections.licensedProfessional?.text?.trim() ||
                              "—"}
                          </p>
                        </div>
                        <div data-testid="arlington-section-owner">
                          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Owner
                          </h4>
                          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                            {arlingtonRecordSections.owner?.text?.trim() ||
                              "—"}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : infoKeyValues.length > 0 ? (
                    <div
                      className="grid grid-cols-1 md:grid-cols-2 gap-3"
                      data-testid="info-fields"
                    >
                      {infoKeyValues.map((kv, i) => (
                        <div
                          key={i}
                          className="rounded-md border border-border bg-muted/40 px-3 py-2"
                          data-testid={`info-field-${i}`}
                        >
                          <div className="text-xs text-muted-foreground mb-1">
                            {kv.key}
                          </div>
                          <div className="text-sm text-foreground break-words whitespace-pre-wrap">
                            {kv.value || "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={ClipboardList}
                      message="No record details available"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="files">
              <Card className="border-border bg-card">
                <CardContent className="p-0">
                  {attachmentRows.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs text-muted-foreground">
                            Name
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Type
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Size
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Updated
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground w-20">
                            Status
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attachmentRows.map((att, idx) => (
                          <TableRow
                            key={idx}
                            className="border-border"
                            data-testid={`file-row-${idx}`}
                          >
                            <TableCell className="max-w-[300px]">
                              {att.viewUrl ? (
                                <a
                                  href={att.viewUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:text-primary/90 hover:underline flex items-center gap-1 text-sm"
                                  data-testid={`link-file-${idx}`}
                                >
                                  <span className="truncate">{att.name}</span>
                                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                </a>
                              ) : (
                                <span className="text-sm text-foreground truncate block">
                                  {att.name}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {att.type || att.entity_type || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {att.size || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {att.latest_update || "—"}
                            </TableCell>
                            <TableCell>
                              {att.downloadStatus === "failed" ? (
                                <Badge
                                  variant="outline"
                                  className="bg-destructive/15 text-destructive border-destructive/40 text-[10px]"
                                  data-testid={`badge-file-failed-${idx}`}
                                >
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Failed
                                </Badge>
                              ) : att.viewUrl ? (
                                <Badge
                                  variant="outline"
                                  className="bg-success/15 text-success border-success/35 text-[10px]"
                                >
                                  Saved
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <EmptyState
                      icon={FileText}
                      message="No attachments found"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {showInspectionsTab ? (
            <TabsContent value="inspections">
              <Card className="border-border bg-card">
                <CardContent className="p-0">
                  {inspectionTables.length > 0 &&
                  inspectionTables.some((t) => t.rows.length > 0) ? (
                    <div className="divide-y divide-border">
                      {inspectionTables.map((table, tIdx) => (
                        <div key={tIdx}>
                          <div className="px-4 py-2 bg-muted/40">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                              {table.title}
                            </p>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow className="border-border hover:bg-transparent">
                                <TableHead className="text-xs text-muted-foreground">
                                  Type
                                </TableHead>
                                <TableHead className="text-xs text-muted-foreground">
                                  Status
                                </TableHead>
                                <TableHead className="text-xs text-muted-foreground">
                                  Date
                                </TableHead>
                                <TableHead className="text-xs text-muted-foreground">
                                  Inspector
                                </TableHead>
                                <TableHead className="text-xs text-muted-foreground">
                                  Result
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {table.rows.map((row, rIdx) => {
                                const r = row as unknown as AccelaInspectionRow;
                                return (
                                  <TableRow
                                    key={rIdx}
                                    className="border-border"
                                    data-testid={`inspection-row-${tIdx}-${rIdx}`}
                                  >
                                    <TableCell className="text-sm text-foreground">
                                      {r.type || row["Type"] || "—"}
                                    </TableCell>
                                    <TableCell>
                                      <Badge
                                        variant="outline"
                                        className={`text-[10px] ${getStatusBadgeStyle(r.status || row["Status"] || "").className}`}
                                      >
                                        {r.status || row["Status"] || "—"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                      {r.date || row["Date"] || "—"}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {r.inspector || row["Inspector"] || "—"}
                                    </TableCell>
                                    <TableCell className="text-xs text-muted-foreground">
                                      {r.result || row["Result"] || "—"}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={CalendarCheck}
                      message="No inspections scheduled"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            ) : null}

            {showLinksTab ? (
            <TabsContent value="links">
              <Card className="border-border bg-card">
                <CardContent className="p-0">
                  {relatedRecordRows.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          <TableHead className="text-xs text-muted-foreground">
                            Record Number
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Type
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Status
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Project
                          </TableHead>
                          <TableHead className="text-xs text-muted-foreground">
                            Date
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {relatedRecordRows.map((rec, idx) => (
                          <TableRow
                            key={idx}
                            className="border-border"
                            data-testid={`related-record-${idx}`}
                          >
                            <TableCell className="text-sm text-primary font-mono">
                              {rec.record_number || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {rec.record_type || "—"}
                            </TableCell>
                            <TableCell>
                              {rec.status ? (
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${getStatusBadgeStyle(rec.status).className}`}
                                >
                                  {rec.status}
                                </Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {rec.project_name || "—"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {rec.date || "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <EmptyState
                      icon={Link2}
                      message="No related records found"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            ) : null}

            <TabsContent value="planReview">
              <Card className="border-border bg-card">
                <CardContent className="p-4 space-y-4">
                  {isArlingtonPortalUi &&
                  portalData.portalType === "accela" &&
                  planReviewTab ? (
                    <ArlingtonPlanReviewContinuePanel
                      projectId={projectId}
                      userId={userId}
                      permitNumber={
                        permitNumberProp ||
                        recordNumber ||
                        portalData.projectNum ||
                        null
                      }
                      planReviewTab={planReviewTab}
                      normTabs={arlingtonNormTabs}
                      onRefresh={onPortalDataRefresh}
                    />
                  ) : null}
                  {planReviewUseIntegratedUi && planReviewTab ? (
                    <>
                      {planReviewTabsRaw ? (
                        <p className="text-[10px] text-muted-foreground font-mono">
                          Plan Review tabs:{" "}
                          {Object.keys(planReviewTabsRaw).join(", ")}
                        </p>
                      ) : null}

                      {planReviewTab.source ? (
                        <p
                          className="text-[10px] text-muted-foreground"
                          data-testid="arlington-plan-review-source"
                        >
                          Plan Review data source:{" "}
                          {planReviewTab.source.replace(/_/g, " ")}
                        </p>
                      ) : null}

                      {planReviewTab.used === false &&
                      !arlingtonHasAnyPlanDocs &&
                      (planReviewTab.message || planReviewPdf?.text) ? (
                        <div
                          className="flex gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                          data-testid="arlington-plan-review-unused"
                        >
                          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          <p className="text-sm text-foreground">
                            {planReviewTab.message ||
                              planReviewPdf?.text ||
                              "Plan review is not used for this record."}
                          </p>
                        </div>
                      ) : null}

                      {planReviewTab.message &&
                      arlingtonHasAnyPlanDocs &&
                      planReviewTab.used === false ? (
                        <div className="flex gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          <p className="text-sm text-foreground">
                            {planReviewTab.message}
                          </p>
                        </div>
                      ) : null}

                      {planReviewTab.timeout && planReviewTab.message ? (
                        <div
                          className="flex gap-2 rounded-md border border-border bg-muted/20 px-3 py-2"
                          data-testid="arlington-plan-review-timeout"
                        >
                          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                          <p className="text-sm text-foreground">
                            {planReviewTab.message}
                          </p>
                        </div>
                      ) : null}

                      {arlingtonIntegratedKeys.length > 0 &&
                      arlingtonNormTabs ? (
                        <div
                          className="space-y-2"
                          data-testid="arlington-plan-review-tabs"
                        >
                          <ArlingtonIntegratedPlanReviewNestedTabs
                            normTabs={arlingtonNormTabs}
                            recordNumber={recordNumber}
                          />
                        </div>
                      ) : (
                        <ArlingtonLegacyPlanReviewTabCards
                          planReviewTab={planReviewTab}
                        />
                      )}

                      {planReviewTab.used === true &&
                      !arlingtonHasAnyPlanDocs &&
                      arlingtonIntegratedKeys.length === 0 ? (
                        <EmptyState
                          icon={FileSearch}
                          message={
                            planReviewTab.message?.trim()
                              ? planReviewTab.message
                              : "Plan Set Documents were not extracted yet"
                          }
                        />
                      ) : null}

                      {Array.isArray(planReviewTab.downloadLinks) &&
                        planReviewTab.downloadLinks.length > 0 && (
                          <div data-testid="arlington-plan-review-dl-root">
                            <p className="text-xs text-muted-foreground mb-2">
                              Plan Review download candidates
                            </p>
                            <ul className="space-y-1">
                              {planReviewTab.downloadLinks.map((d, i) => {
                                const href = (d.href || "").trim();
                                if (!href) return null;
                                return (
                                  <li key={i}>
                                    <a
                                      href={absolutePortalHref(href)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                                    >
                                      {d.text || d.label || href}
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}

                      {planReviewPdf?.text ? (
                        <details className="group">
                          <summary className="text-xs text-muted-foreground cursor-pointer list-none flex items-center gap-1">
                            <span className="underline decoration-dotted">
                              Full extracted text
                            </span>
                          </summary>
                          <pre className="mt-2 text-xs whitespace-pre-wrap text-foreground max-h-[480px] overflow-y-auto rounded-md border border-border bg-muted/20 p-3">
                            {planReviewPdf.text}
                          </pre>
                        </details>
                      ) : null}
                    </>
                  ) : isArlingtonPortalUi && planReviewTab ? (
                    <>
                      {planReviewTab.used === false &&
                        (planReviewTab.message || planReviewPdf?.text) && (
                          <div
                            className="flex gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                            data-testid="arlington-plan-review-unused"
                          >
                            <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                            <p className="text-sm text-foreground">
                              {planReviewTab.message ||
                                planReviewPdf?.text ||
                                "Plan review is not used for this record."}
                            </p>
                          </div>
                        )}
                      <ArlingtonLegacyPlanReviewTabCards
                        planReviewTab={planReviewTab}
                      />
                      {Array.isArray(planReviewTab.downloadLinks) &&
                        planReviewTab.downloadLinks.length > 0 && (
                          <div data-testid="arlington-plan-review-dl-root">
                            <p className="text-xs text-muted-foreground mb-2">
                              Plan Review download candidates
                            </p>
                            <ul className="space-y-1">
                              {planReviewTab.downloadLinks.map((d, i) => {
                                const href = (d.href || "").trim();
                                if (!href) return null;
                                return (
                                  <li key={i}>
                                    <a
                                      href={absolutePortalHref(href)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                                    >
                                      {d.text || d.label || href}
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      {planReviewPdf?.text ? (
                        <details className="group">
                          <summary className="text-xs text-muted-foreground cursor-pointer list-none flex items-center gap-1">
                            <span className="underline decoration-dotted">
                              Full extracted text
                            </span>
                          </summary>
                          <pre className="mt-2 text-xs whitespace-pre-wrap text-foreground max-h-[480px] overflow-y-auto rounded-md border border-border bg-muted/20 p-3">
                            {planReviewPdf.text}
                          </pre>
                        </details>
                      ) : null}
                    </>
                  ) : planReviewPdf?.text ? (
                    <div
                      className="space-y-3"
                      data-testid="plan-review-content"
                    >
                      {planReviewPdf.text
                        .split("\n")
                        .filter(Boolean)
                        .map((line, i) => {
                          const colonIdx = line.indexOf(":");
                          if (colonIdx > 0 && colonIdx < 40) {
                            const label = line.substring(0, colonIdx).trim();
                            const value = line.substring(colonIdx + 1).trim();
                            const isStatus = label.toLowerCase() === "status";

                            return (
                              <div
                                key={i}
                                className="flex items-baseline gap-2"
                                data-testid={`plan-review-field-${i}`}
                              >
                                <span className="text-xs text-muted-foreground whitespace-nowrap min-w-[140px]">
                                  {label}:
                                </span>
                                {isStatus ? (
                                  <Badge
                                    variant="outline"
                                    className={`text-[10px] ${getStatusBadgeStyle(value).className}`}
                                  >
                                    {value}
                                  </Badge>
                                ) : (
                                  <span className="text-sm text-foreground">
                                    {value}
                                  </span>
                                )}
                              </div>
                            );
                          }

                          return (
                            <p key={i} className="text-sm text-foreground">
                              {line}
                            </p>
                          );
                        })}
                    </div>
                  ) : (
                    <EmptyState
                      icon={FileSearch}
                      message="No plan review data available"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {showPaymentsTab ? (
            <TabsContent value="payments">
              <Card className="border-border bg-card">
                <CardContent className="p-0">
                  {paymentTables.length > 0 &&
                  paymentTables.some((t) => t.rows.length > 0) ? (
                    <div className="divide-y divide-border">
                      {paymentTables.map((table, tIdx) => (
                        <div key={tIdx}>
                          <Table>
                            <TableHeader>
                              <TableRow className="border-border hover:bg-transparent">
                                {table.headers.map((h, hIdx) => (
                                  <TableHead
                                    key={hIdx}
                                    className="text-xs text-muted-foreground"
                                  >
                                    {h}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {table.rows.map((row, rIdx) => (
                                <TableRow
                                  key={rIdx}
                                  className="border-border"
                                  data-testid={`payment-row-${rIdx}`}
                                >
                                  {table.headers.map((h, hIdx) => {
                                    const val =
                                      (row as Record<string, string>)[h] ||
                                      (row as Record<string, string>)[
                                        h.toLowerCase()
                                      ] ||
                                      Object.values(row)[hIdx] ||
                                      "—";
                                    return (
                                      <TableCell
                                        key={hIdx}
                                        className="text-sm text-foreground"
                                      >
                                        {val}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={DollarSign}
                      message="No payment records found"
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
            ) : null}
          </Tabs>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: typeof FileText;
  message: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center py-12 text-center"
      data-testid="empty-state"
    >
      <div className="rounded-full bg-muted/40 p-4 mb-3">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
