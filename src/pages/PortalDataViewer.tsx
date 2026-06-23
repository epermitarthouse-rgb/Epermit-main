import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useNavigate, Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { useScrape } from "@/contexts/ScrapeContext";
import {
  isLiveScrapeJobActive,
  useScrapeFileResults,
} from "@/hooks/useScrapeFileResults";
import type { ScrapeFileResult } from "@/lib/scrapeFileResultTypes";
import { supabase } from "@/lib/supabase";
import {
  normalizePgcFlattenedReviewCommentsText,
  shouldNormalizePgcReviewCommentsDisplayText,
} from "@/lib/pgcReviewCommentsText";
import {
  parsePgcReviewComments,
  type PgcReviewCommentsRow,
} from "@/lib/pgcReviewCommentsStackedParse";
import {
  groupPgcWorkflowRowsIntoReviewItems,
  sanitizePgcWorkflowRows,
} from "@/lib/pgcReviewRowViewModel";
import { formatDistanceToNow } from "date-fns";
import {
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
  AlertCircle,
  ListChecks,
  FolderOpen,
  MessageSquare,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { Section } from "@/components/ui/Section";
import { Eyebrow, EyebrowDark } from "@/components/ui/Typography";
import AccelaProjectView from "@/components/portal/AccelaProjectView";
import {
  PgcStatusTab,
  type PgcStatusTabData,
} from "@/components/portal/PgcStatusTab";
import { BaltimorePortalDataView } from "@/components/baltimore/BaltimorePortalDataView";
import { FairfaxPortalDataView } from "@/components/fairfax/FairfaxPortalDataView";
import {
  isBaltimorePortal,
  isFairfaxPortal,
  isProjectDoxUrl,
  isArlingtonPortalContext,
  buildEmptyArlingtonAccelaPortalShell,
  resolvePortalView,
} from "@/lib/portalView";
import { resolvePgcPortalFileOpenUrl } from "@/lib/pgcPortalFileUrl";
import { cn } from "@/lib/utils";

/** Commun-ET tab pills — presentation only; tab `value` and visibility unchanged. */
const PORTAL_TAB_TRIGGER =
  "h-auto rounded-full border border-cream-sunken bg-cream-raised px-4 py-2 text-sm font-medium text-ink-secondary-light shadow-none transition-all hover:bg-cream-sunken hover:text-ink-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/35 focus-visible:ring-offset-2 focus-visible:ring-offset-cream data-[state=active]:border-gold data-[state=active]:bg-gold data-[state=active]:px-4 data-[state=active]:py-2 data-[state=active]:text-sm data-[state=active]:font-semibold data-[state=active]:text-cream data-[state=active]:shadow-cream data-[state=active]:hover:bg-gold data-[state=active]:hover:text-cream";

/** PortalDataViewer primary actions — h-9 / px-3.5 / icon 16px (see [&_svg] on base). */
const PORTAL_ACTION_BUTTON_BASE =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition-all duration-200 ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/35 disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0";

const PORTAL_ACTION_BUTTON_PRIMARY = `${PORTAL_ACTION_BUTTON_BASE} bg-gold text-cream shadow-cream hover:bg-gold-deep`;

const PORTAL_ACTION_BUTTON_OUTLINE = `${PORTAL_ACTION_BUTTON_BASE} border border-gold/45 bg-transparent text-gold hover:bg-gold hover:text-cream`;

const PORTAL_ACTION_BUTTON_SECONDARY_FILL = `${PORTAL_ACTION_BUTTON_BASE} border border-cream-sunken bg-cream-sunken/90 text-ink-primary-light hover:bg-cream-sunken`;

const PORTAL_ACTION_BUTTON_LIGHT_OUTLINE = `${PORTAL_ACTION_BUTTON_BASE} border border-cream-sunken bg-cream-raised text-ink-secondary-light hover:bg-cream-sunken hover:text-ink-primary-light`;

const PORTAL_ACTION_BUTTON_AI = `${PORTAL_ACTION_BUTTON_BASE} border border-teal/30 bg-teal/10 text-teal hover:bg-teal/18`;

class TabErrorBoundary extends React.Component<
  { tabName: string; children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { tabName: string; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[PortalDataViewer] ${this.props.tabName} tab render error:`,
      error,
      info,
    );
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          <span>
            Failed to render {this.props.tabName} tab. The data format may be
            unexpected.
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

interface KeyValue {
  key: string;
  value: string;
}

interface TableData {
  headers: string[];
  rows: Record<string, string>[];
  tableIndex?: number;
  title?: string;
}

/**
 * ProjectDox extractPageData uses Col_0, Col_1, … when a table has no <th>/thead.
 * Status tab UI iterated tbl.headers only, so those tables rendered with zero columns.
 */
function statusTableDisplayHeaders(tbl: TableData): string[] {
  const headers = tbl.headers ?? [];
  if (headers.length > 0) return headers;
  const rows = tbl.rows ?? [];
  if (!rows.length) return [];
  const order: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const k of Object.keys(row)) {
      if (seen.has(k)) continue;
      seen.add(k);
      order.push(k);
    }
  }
  return order;
}

/** Display-only: fixes duplicated scraped status strings (e.g. "Decision IssuedDecision Issued"). */
function normalizeRepeatedStatusLabel(value?: string | null) {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed === "Decision IssuedDecision Issued") {
    return "Decision Issued";
  }
  const half = Math.floor(trimmed.length / 2);
  if (
    trimmed.length % 2 === 0 &&
    trimmed.slice(0, half) === trimmed.slice(half)
  ) {
    return trimmed.slice(0, half).trim();
  }
  return trimmed;
}

interface FileComment {
  text: string;
  author: string;
  date: string;
  page: number | null;
}

interface FileEntry {
  name: string;
  fileId?: string;
  folderName?: string;
  status: string;
  reviewedBy: string;
  uploadedDate: string;
  commentCount: number;
  comments?: FileComment[];
  publicUrl?: string;
  viewUrl?: string;
  downloadUrl?: string;
  downloadStatus?: string;
  downloadError?: string;
}

interface FolderEntry {
  name: string;
  fileCount: number;
  files: FileEntry[];
  folderName?: string;
  parentFolder?: string;
  filesCount?: number;
}

interface FilesTabData {
  keyValues?: KeyValue[];
  tables?: TableData[];
  links?: { text: string; href: string }[];
  error?: string;
  folders?: FolderEntry[];
}

interface ReportEntryDownload {
  fileSlug?: string;
  reportName: string;
  reportType?: string;
  reportDescription?: string;
  reportUrl?: string;
  /** PGC ePlan: ReportViewer.aspx URL when exports are not yet uploaded */
  viewerUrl?: string | null;
  viewerReady?: boolean;
  pdfUrl?: string | null;
  excelUrl?: string | null;
  excelDownloaded?: boolean;
  pdfDownloaded?: boolean;
  /** PGC: no navigate URL / export path (e.g. missing WFlowInstanceID and no live link) */
  exportUnavailable?: boolean;
}

interface ReviewCorrectionRow {
  correctionID?: string;
  referenceNumber?: string | null;
  department?: string | null;
  reviewerName?: string | null;
  statusName?: string | null;
  statusCompleted?: boolean | null;
  correctionType?: string | null;
  commentText?: string | null;
  responseText?: string | null;
  fileID?: string | null;
  fileName?: string | null;
  markupPdfUrl?: string | null;
  markupPdfPublicUrl?: string;
  reviewCycle?: string | null;
  isLatestCycle?: boolean | null;
  dateCreated?: string | null;
}

/** Status tab links (Montgomery: resolvedViewerUrl, viewerUrl, reportUrl, pdfUrl, excelUrl). */
interface StatusTabLink {
  text?: string;
  href?: string;
  onclick?: string;
  target?: string;
  resolvedViewerUrl?: string;
  viewerUrl?: string;
  reportUrl?: string;
  reportName?: string;
  pdfUrl?: string;
  excelUrl?: string;
  hasResolved?: boolean;
  linkWflowInstanceID?: string;
}

interface TabData {
  keyValues?: KeyValue[];
  projectInfo?: KeyValue[];
  tables?: TableData[];
  /** PGC ePlan: scraper diagnostics when Info tab is guarded or fails. */
  info_debug?: unknown;
  links?: StatusTabLink[];
  error?: string;
  pdfs?: {
    fileName: string;
    text?: string;
    screenshot?: string;
    pages?: number;
    error?: string;
    url?: string;
    pdfUrl?: string;
    excelUrl?: string;
    info?: { source?: string };
  }[];
  folders?: FolderEntry[];
  reportEntries?: ReportEntryDownload[];
}

interface ReviewTabData extends TabData {
  workflow?: Record<string, unknown> | null;
  reviewProbe?: Record<string, unknown> | null;
  summary?: Record<string, unknown>;
  latestCycleCorrections?: ReviewCorrectionRow[];
  workflowBuckets?: {
    workflowName: string;
    rows: Record<string, string>[];
  }[];
}

interface PortalData {
  portalType?: string;
  name: string;
  projectNum: string;
  description: string;
  location: string;
  dashboardStatus: string;
  portalSubtype?: string;
  jurisdiction?: string;
  tabs: {
    info?: TabData;
    reports?: TabData;
    files?: FilesTabData;
    status?: TabData;
    tasks?: TabData;
    review?: ReviewTabData;
    attachments?: TabData;
    inspections?: TabData;
    payments?: TabData;
    relatedRecords?: TabData;
    [key: string]: TabData | FilesTabData | undefined;
  };
}

function isHttpUrlCandidate(s: unknown): boolean {
  const t = String(s ?? "").trim();
  return t.length > 8 && /^https?:\/\//i.test(t);
}

function pickMontgomeryStatusPrimaryViewerUrl(link: StatusTabLink): string | null {
  if (isHttpUrlCandidate(link.resolvedViewerUrl))
    return String(link.resolvedViewerUrl).trim();
  if (isHttpUrlCandidate(link.viewerUrl)) return String(link.viewerUrl).trim();
  if (isHttpUrlCandidate(link.reportUrl)) return String(link.reportUrl).trim();
  const href = String(link.href ?? "").trim();
  if (href && href !== "#" && isHttpUrlCandidate(href)) return href;
  return null;
}

function pickMontgomeryStatusPdfExcelUrls(link: StatusTabLink): {
  pdf: string | null;
  excel: string | null;
} {
  return {
    pdf: isHttpUrlCandidate(link.pdfUrl) ? String(link.pdfUrl).trim() : null,
    excel: isHttpUrlCandidate(link.excelUrl)
      ? String(link.excelUrl).trim()
      : null,
  };
}

function montgomeryStatusLinksActionable(links: StatusTabLink[]): StatusTabLink[] {
  return links.filter((L) => {
    const v = pickMontgomeryStatusPrimaryViewerUrl(L);
    const { pdf, excel } = pickMontgomeryStatusPdfExcelUrls(L);
    return !!(v || pdf || excel);
  });
}

function normalizeMontgomeryReportNameKey(s: string): string {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findMontgomeryReportEntryForRow(
  byExactName: Map<string, ReportEntryDownload>,
  entries: ReportEntryDownload[],
  reportName: string,
): ReportEntryDownload | null {
  const exact = byExactName.get(reportName);
  if (exact) return exact;
  const k = normalizeMontgomeryReportNameKey(reportName);
  if (!k) return null;
  for (const e of entries) {
    const nk = normalizeMontgomeryReportNameKey(e.reportName || "");
    if (nk === k) return e;
    if (
      nk.length >= 12 &&
      k.length >= 12 &&
      (nk.includes(k) || k.includes(nk))
    ) {
      return e;
    }
  }
  return null;
}

function montgomeryReportStatusLabelFromEntry(
  entry: ReportEntryDownload,
): string {
  const exported =
    !!entry.pdfDownloaded ||
    !!entry.excelDownloaded ||
    isHttpUrlCandidate(entry.pdfUrl) ||
    isHttpUrlCandidate(entry.excelUrl);
  if (exported) return "Exported";
  const ready =
    !!entry.viewerReady ||
    isHttpUrlCandidate(entry.viewerUrl) ||
    isHttpUrlCandidate(entry.reportUrl);
  if (ready) return "Ready";
  return "Not ready";
}

function montgomeryReportStatusForRow(
  tableStatus: string,
  entry: ReportEntryDownload | null,
): { text: string; source: "table" | "entry" } {
  if (entry) {
    return {
      text: montgomeryReportStatusLabelFromEntry(entry),
      source: "entry",
    };
  }
  const t = String(tableStatus || "").trim();
  return { text: t || "Not ready", source: "table" };
}

/** True when viewer and PDF point at the same document (exact URL or same origin+pathname). */
function montgomeryUrlsMateriallySameForViewerVsPdf(
  viewerUrl: string,
  pdfUrl: string,
): boolean {
  const v = String(viewerUrl || "").trim();
  const p = String(pdfUrl || "").trim();
  if (!v || !p) return false;
  if (v === p) return true;
  try {
    const uv = new URL(v);
    const up = new URL(p);
    if (uv.origin !== up.origin) return false;
    const pv = uv.pathname.replace(/\/+$/, "");
    const pp = up.pathname.replace(/\/+$/, "");
    return pv === pp;
  } catch {
    return false;
  }
}

/**
 * Montgomery Reports: viewer = viewerUrl ?? reportUrl; PDF/Excel only from their fields.
 * Open viewer is hidden when it matches the PDF target (redundant SSRS viewer vs Format=PDF).
 */
function getMontgomeryReportEntryActionUrls(entry: ReportEntryDownload): {
  viewerUrl: string | null;
  pdfUrl: string | null;
  excelUrl: string | null;
  showOpenViewer: boolean;
} {
  const viewerUrl =
    (isHttpUrlCandidate(entry.viewerUrl)
      ? String(entry.viewerUrl).trim()
      : null) ||
    (isHttpUrlCandidate(entry.reportUrl)
      ? String(entry.reportUrl).trim()
      : null);
  const pdfUrl = isHttpUrlCandidate(entry.pdfUrl)
    ? String(entry.pdfUrl).trim()
    : null;
  const excelUrl = isHttpUrlCandidate(entry.excelUrl)
    ? String(entry.excelUrl).trim()
    : null;
  const showOpenViewer =
    !!viewerUrl &&
    (!pdfUrl || !montgomeryUrlsMateriallySameForViewerVsPdf(viewerUrl, pdfUrl));
  return { viewerUrl, pdfUrl, excelUrl, showOpenViewer };
}

function getMontgomeryStatusLinkActionUrls(link: StatusTabLink): {
  viewerUrl: string | null;
  pdfUrl: string | null;
  excelUrl: string | null;
  showOpenViewer: boolean;
} {
  const viewerUrl = pickMontgomeryStatusPrimaryViewerUrl(link);
  const { pdf: pdfUrl, excel: excelUrl } =
    pickMontgomeryStatusPdfExcelUrls(link);
  const showOpenViewer =
    !!viewerUrl &&
    (!pdfUrl || !montgomeryUrlsMateriallySameForViewerVsPdf(viewerUrl, pdfUrl));
  return { viewerUrl, pdfUrl, excelUrl, showOpenViewer };
}

/** Washington DC default ProjectDox: split label/value rows vs URL-only rows (actions). */
function partitionWashingtonStatusKeyValues(kvs: KeyValue[]): {
  fields: KeyValue[];
  urlActions: KeyValue[];
} {
  const fields: KeyValue[] = [];
  const urlActions: KeyValue[] = [];
  for (const kv of kvs || []) {
    const v = String(kv.value ?? "").trim();
    if (isHttpUrlCandidate(v)) urlActions.push(kv);
    else fields.push(kv);
  }
  return { fields, urlActions };
}

/**
 * Generic extractPageData still builds tables from the same status DOM; those rows
 * duplicate keyValues (values as fake labels). Omit tables when we already have the
 * standard DC status summary in keyValues (covers legacy portal_data too).
 */
function shouldOmitWashingtonStatusTables(
  fields: KeyValue[],
  tables: TableData[] | undefined,
): boolean {
  if (!tables?.length) return true;
  const keys = fields.map((f) => String(f.key ?? "").trim().toLowerCase());
  const hasReviewType = keys.some((k) => /review\s+type/.test(k));
  const hasOwnerOrFiles = keys.some(
    (k) =>
      /^owner$/.test(k) ||
      /total\s+number\s+of\s+files/.test(k) ||
      /files/i.test(k),
  );
  return fields.length >= 4 && hasReviewType && hasOwnerOrFiles;
}

/** Drop DC status noise: permit-as-key description rows; dedupe repeated workflow lines. */
function filterWashingtonStatusFieldsForDisplay(
  fields: KeyValue[],
  projectNum: string | null | undefined,
): KeyValue[] {
  const pn = (projectNum ?? "").trim();
  const seenWorkflowValue = new Set<string>();
  const out: KeyValue[] = [];
  for (const kv of fields) {
    const k = String(kv.key ?? "").trim();
    const v = String(kv.value ?? "").trim();
    if (pn && k === pn && v.length > 80) continue;
    if (/^workflow$/i.test(k) && v.length > 80) {
      if (seenWorkflowValue.has(v)) continue;
      seenWorkflowValue.add(v);
    }
    out.push(kv);
  }
  return out;
}

/** Long narrative fields: keep on-page but visually subordinate (portal-like compact summary). */
function isWashingtonStatusLongField(kv: KeyValue): boolean {
  const k = String(kv.key ?? "").toLowerCase();
  if (
    /description|workflow|comment|detail|summary|notes/i.test(k)
  )
    return true;
  return String(kv.value ?? "").length > 180;
}

/**
 * Two-column status tables → plain label/value lines (no HTML table chrome).
 */
function washingtonStatusTableAsLines(tbl: TableData): {
  label: string;
  value: string;
}[] | null {
  const displayHeaders = statusTableDisplayHeaders(tbl);
  const rows = tbl.rows ?? [];
  if (rows.length === 0) return null;
  if (displayHeaders.length === 2) {
    const h0 = displayHeaders[0];
    const h1 = displayHeaders[1];
    const out: { label: string; value: string }[] = [];
    for (const row of rows) {
      const a = String(row[h0] ?? "").trim();
      const b = String(row[h1] ?? "").trim();
      if (!a && !b) continue;
      const isHeaderish =
        /^field$/i.test(a) && /^value$/i.test(b) && out.length === 0;
      if (isHeaderish) continue;
      out.push({ label: a || "—", value: b });
    }
    return out.length ? out : null;
  }
  return null;
}

function WashingtonStatusFieldLine({
  label,
  value,
  denseValue,
}: {
  label: string;
  value: string;
  denseValue?: boolean;
}) {
  const v = (value || "").trim() || "—";
  return (
    <div className="flex gap-3 py-1.5 items-start">
      <div className="min-w-[11rem] max-w-[45%] shrink-0 text-right text-[12px] font-semibold text-ink-secondary-light leading-snug">
        {label && label !== "—" ? `${label}:` : ""}
      </div>
      <div
        className={
          denseValue
            ? "flex-1 text-xs leading-snug text-ink-primary-light max-h-24 overflow-y-auto break-words"
            : "flex-1 text-[13px] leading-snug text-ink-primary-light break-words"
        }
      >
        {v}
      </div>
    </div>
  );
}

/** Portal-like: compact gold-outline actions (same URL deduped vs linkActions in Washington panel). */
function WashingtonStatusActionControl({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Button asChild variant="ghost" className={cn(PORTAL_ACTION_BUTTON_OUTLINE)}>
      <a href={href} target="_blank" rel="noreferrer">
        {label}
      </a>
    </Button>
  );
}

/**
 * Washington-only: lightweight centered summary (portal-like), dark theme preserved.
 * PGC / Montgomery / Howard / Baltimore unchanged.
 */
function WashingtonStatusTabPanel({
  tab,
  projectNum,
}: {
  tab: TabData;
  projectNum?: string | null;
}) {
  const partitioned = partitionWashingtonStatusKeyValues(tab.keyValues ?? []);
  const fields = filterWashingtonStatusFieldsForDisplay(
    partitioned.fields,
    projectNum,
  );
  const { urlActions } = partitioned;
  const rawLinks = Array.isArray(tab.links) ? tab.links : [];
  const linkActions = montgomeryStatusLinksActionable(rawLinks);
  const viewerUrlsFromLinkActions = new Set<string>();
  for (const L of linkActions) {
    const { viewerUrl, showOpenViewer } =
      getMontgomeryStatusLinkActionUrls(L);
    if (showOpenViewer && viewerUrl) {
      viewerUrlsFromLinkActions.add(viewerUrl.trim());
    }
  }
  /** Drop key/value URL rows that duplicate the structured link "Open viewer" URL (same tab, same target). */
  const urlActionsDeduped = urlActions.filter((kv) => {
    const href = String(kv.value ?? "").trim();
    if (!isHttpUrlCandidate(href)) return true;
    return !viewerUrlsFromLinkActions.has(href);
  });
  const hasBottomActions =
    linkActions.length > 0 ||
    urlActionsDeduped.length > 0 ||
    rawLinks.some((L) => {
      const h = String(L.href ?? "").trim();
      return h && h !== "#" && isHttpUrlCandidate(h);
    });

  const omitTables = shouldOmitWashingtonStatusTables(
    fields,
    tab.tables ?? [],
  );

  return (
    <div className="max-w-lg mx-auto space-y-3 rounded-xl border border-cream-sunken bg-cream-raised px-5 py-6 shadow-cream">
      <div className="space-y-1">
        {fields.map((kv, i) => (
          <WashingtonStatusFieldLine
            key={`${kv.key}-${i}`}
            label={kv.key}
            value={kv.value}
            denseValue={isWashingtonStatusLongField(kv)}
          />
        ))}
        {!omitTables &&
          (tab.tables ?? []).map((tbl, ti) => {
          const asLines = washingtonStatusTableAsLines(tbl);
          if (asLines) {
            return (
              <div key={`wst-t-${ti}`} className="mt-4 pt-3 border-t border-cream-sunken/80">
                {tbl.title ? (
                  <p className="text-[11px] text-ink-tertiary-light mb-1.5">
                    {tbl.title}
                  </p>
                ) : null}
                <div className="space-y-1">
                  {asLines.map((line, li) => (
                    <WashingtonStatusFieldLine
                      key={`wst-tl-${ti}-${li}`}
                      label={line.label}
                      value={line.value}
                      denseValue={isWashingtonStatusLongField({
                        key: line.label,
                        value: line.value,
                      })}
                    />
                  ))}
                </div>
              </div>
            );
          }
          const displayHeaders = statusTableDisplayHeaders(tbl);
          if (!displayHeaders.length && !(tbl.rows?.length ?? 0)) return null;
          return (
            <div key={`wst-t-${ti}`} className="mt-4 pt-3 border-t border-cream-sunken/80">
              {tbl.title ? (
                <p className="text-[11px] text-ink-tertiary-light mb-1.5">
                  {tbl.title}
                </p>
              ) : null}
              <div className="space-y-2">
                {(tbl.rows ?? []).map((row, ri) => (
                  <p
                    key={ri}
                    className="text-[12px] leading-snug text-ink-primary-light"
                  >
                    {displayHeaders
                      .map((h) => String(row[h] ?? "").trim())
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {hasBottomActions ? (
        <div className="mt-8 pt-4 border-t border-cream-sunken">
          <p className="text-sm font-semibold text-ink-primary-light mb-3">
            For more details:
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {(() => {
              const seenViewerUrl = new Set<string>();
              return linkActions.map((L, mi) => {
                const {
                  viewerUrl,
                  pdfUrl,
                  excelUrl,
                  showOpenViewer,
                } = getMontgomeryStatusLinkActionUrls(L);
                const label =
                  (L.reportName && String(L.reportName).trim()) ||
                  (L.text && String(L.text).trim()) ||
                  `Action ${mi + 1}`;
                const simpleDc =
                  !!showOpenViewer &&
                  !!viewerUrl &&
                  !pdfUrl &&
                  !excelUrl;
                let renderOpen = !!(showOpenViewer && viewerUrl);
                if (renderOpen && viewerUrl) {
                  const v = viewerUrl.trim();
                  if (seenViewerUrl.has(v)) renderOpen = false;
                  else seenViewerUrl.add(v);
                }
                return (
                  <span
                    key={`wst-lk-${mi}`}
                    className="inline-flex flex-wrap gap-2 items-center"
                  >
                    {renderOpen && viewerUrl ? (
                      simpleDc ? (
                        <WashingtonStatusActionControl
                          href={viewerUrl}
                          label={label}
                        />
                      ) : (
                        <Button
                          asChild
                          variant="ghost"
                          className={cn(PORTAL_ACTION_BUTTON_PRIMARY)}
                        >
                          <a
                            href={viewerUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileText />
                            {label}
                          </a>
                        </Button>
                      )
                    ) : null}
                    {pdfUrl ? (
                      <Button
                        asChild
                        variant="ghost"
                        className={cn(PORTAL_ACTION_BUTTON_OUTLINE)}
                      >
                        <a href={pdfUrl} target="_blank" rel="noreferrer">
                          Download PDF
                        </a>
                      </Button>
                    ) : null}
                    {excelUrl ? (
                      <Button
                        asChild
                        variant="ghost"
                        className={cn(PORTAL_ACTION_BUTTON_OUTLINE)}
                      >
                        <a href={excelUrl} target="_blank" rel="noreferrer">
                          Download Excel
                        </a>
                      </Button>
                    ) : null}
                  </span>
                );
              });
            })()}
            {urlActionsDeduped.map((kv, ui) => {
              const href = String(kv.value ?? "").trim();
              const label = kv.key || "Open link";
              return (
                <WashingtonStatusActionControl
                  key={`wst-url-${ui}`}
                  href={href}
                  label={label}
                />
              );
            })}
            {rawLinks.map((L, ri) => {
              if (linkActions.includes(L)) return null;
              const href = String(L.href ?? "").trim();
              if (!href || href === "#" || !isHttpUrlCandidate(href))
                return null;
              const label =
                (L.text && String(L.text).trim()) ||
                (L.reportName && String(L.reportName).trim()) ||
                "Open link";
              return (
                <WashingtonStatusActionControl
                  key={`wst-raw-${ri}`}
                  href={href}
                  label={label}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Reports tab (obsidian): extracted text disclosure — collapsed by default; presentation only. */
function ReportsExtractedTextDetails({
  text,
  summaryLabel = "Show extracted text",
  testId,
}: {
  text: string;
  summaryLabel?: string;
  testId?: string;
}) {
  const len = text.length;
  const display =
    len > 120_000 ? `${text.slice(0, 120_000)}\n\n[truncated]` : text;
  return (
    <div className="mt-4 w-full min-w-0">
      <p className="text-xs text-ink-tertiary-dark">Extracted text available</p>
      <details
        className="mt-2 rounded-lg border border-obsidian-raised bg-obsidian-sunken"
        data-testid={testId}
      >
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 px-4 py-3 text-sm font-medium text-gold [&::-webkit-details-marker]:hidden">
          <span>{summaryLabel}</span>
          <span className="text-xs font-mono font-normal text-ink-tertiary-dark">
            {len.toLocaleString()} chars
          </span>
        </summary>
        <pre className="max-h-[min(55vh,480px)] overflow-auto border-t border-obsidian-raised p-4 font-mono text-[11px] leading-relaxed text-ink-secondary-dark whitespace-pre-wrap break-words">
          {display}
        </pre>
      </details>
    </div>
  );
}

function detectPortalTypeFromUrl(url: string | null | undefined): string {
  if (!url) return "unknown";
  if (isProjectDoxUrl(url)) return "projectdox";
  const lower = url.toLowerCase();
  if (lower.includes("accela.com")) return "accela";
  if (/\/citizenaccess\//i.test(lower)) return "accela";
  return "unknown";
}

export default function PortalDataViewer() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { selectedProjectId } = useSelectedProject();
  const [loading, setLoading] = useState(true);
  const [portalData, setPortalData] = useState<PortalData | null>(null);
  const [portalStatus, setPortalStatus] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [noPermitConfigured, setNoPermitConfigured] = useState(false);
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(
    null,
  );
  const [resolvedPermitNumber, setResolvedPermitNumber] = useState<string | null>(
    null,
  );
  const [resolvedCredentialId, setResolvedCredentialId] = useState<string | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [expectedPortalType, setExpectedPortalType] = useState<string | null>(
    null,
  );
  /** Stored credential fields used to derive Baltimore vs generic Accela UI at render time. */
  const [credentialForView, setCredentialForView] = useState<{
    login_url: string | null;
    jurisdiction: string | null;
  } | null>(null);
  const scrape = useScrape();
  const liveScrapeJobActive = isLiveScrapeJobActive(
    scrape.activeJobId,
    scrape.scrapeJobStatus,
  );
  const liveFileResults = useScrapeFileResults(
    scrape.activeJobId,
    resolvedProjectId,
    !liveScrapeJobActive,
  );
  const liveFoldersGrouped = useMemo(() => {
    const map = new Map<string, ScrapeFileResult[]>();
    for (const row of liveFileResults.rows) {
      const folder = row.folder_name || "Files";
      const list = map.get(folder) ?? [];
      list.push(row);
      map.set(folder, list);
    }
    return [...map.entries()].map(([name, files]) => ({ name, files }));
  }, [liveFileResults.rows]);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [expandedFileComments, setExpandedFileComments] = useState<Set<string>>(
    new Set(),
  );
  /** Report reader: text / portal URL first; thumbnail only labeled as low-res (no full-screen image zoom). */
  const [reportReaderOpen, setReportReaderOpen] = useState<{
    reportName: string;
    pdf: NonNullable<TabData["pdfs"]>[number];
  } | null>(null);
  const [selectedReviewWorkflow, setSelectedReviewWorkflow] = useState<string | null>(
    null,
  );
  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (portalData?.portalSubtype !== "pgc-eplan") return;
    const rt = portalData.tabs?.review as ReviewTabData | undefined;
    const buckets =
      rt?.workflowBuckets
        ?.map((w) => {
          const rawRows = (w.rows ?? []) as Record<string, string>[];
          const rows = sanitizePgcWorkflowRows(rawRows);
          const groupedItems = groupPgcWorkflowRowsIntoReviewItems(
            rows,
            w.workflowName,
            { rawRowCount: rawRows.length },
          );
          return { workflowName: w.workflowName, rows, groupedItems };
        })
        .filter((w) => w.rows.length > 0) ?? [];
    if (!buckets.length) return;
    if (
      selectedReviewWorkflow == null ||
      !buckets.some((b) => b.workflowName === selectedReviewWorkflow)
    ) {
      setSelectedReviewWorkflow(buckets[0].workflowName);
    }
  }, [portalData?.portalSubtype, portalData?.tabs?.review, selectedReviewWorkflow]);

  useEffect(() => {
    if (!reportReaderOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setReportReaderOpen(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [reportReaderOpen]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(
        "[PortalDataViewer] selectedProjectId changed →",
        selectedProjectId,
      );
    }
        setResolvedProjectId(null);
        setResolvedPermitNumber(null);
        setResolvedCredentialId(null);
        setExpectedPortalType(null);
        setCredentialForView(null);
        setNoPermitConfigured(false);
        setLoading(true);
  }, [selectedProjectId]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    const thisRequestId = ++fetchIdRef.current;
    setLoading(true);
    setNoPermitConfigured(false);
    try {
      let project: {
        id: string;
        portal_data: unknown;
        portal_status: string | null;
        last_checked_at: string | null;
        permit_number?: string;
        credential_id?: string;
      } | null = null;

      if (selectedProjectId) {
        const { data, error } = await supabase
          .from("projects")
          .select(
            "id, portal_data, portal_status, last_checked_at, permit_number, credential_id",
          )
          .eq("id", selectedProjectId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!error) project = data as typeof project;
        if (import.meta.env.DEV)
          console.log(
            "[PortalDataViewer] fetch for selectedProjectId:",
            selectedProjectId,
            "→ project:",
            project?.id ?? "(none)",
            "permit:",
            (project as any)?.permit_number ?? "(none)",
            "credential:",
            (project as any)?.credential_id ?? "(none)",
            "hasPortalData:",
            !!project?.portal_data,
            "portalType:",
            (project?.portal_data as any)?.portalType ?? "(none)",
          );
      }

      if (thisRequestId !== fetchIdRef.current) return;

      if (!project) {
        const { data: creds } = await supabase
          .from("portal_credentials")
          .select("project_id")
          .eq("user_id", user.id)
          .not("project_id", "is", null);
        const hasLinkedCreds = (creds?.length ?? 0) > 0;
        setNoPermitConfigured(!hasLinkedCreds);
        setPortalData(null);
        setPortalStatus(null);
        setLastCheckedAt(null);
        setResolvedProjectId(null);
        setResolvedPermitNumber(null);
        setResolvedCredentialId(null);
        setExpectedPortalType(null);
        setCredentialForView(null);
      } else {
        let credExpectedType: string | null = null;
        if (project.credential_id) {
          const { data: cred } = await supabase
            .from("portal_credentials")
            .select("login_url, jurisdiction")
            .eq("id", project.credential_id)
            .maybeSingle();
          if (thisRequestId !== fetchIdRef.current) return;
          if (cred) {
            credExpectedType = detectPortalTypeFromUrl(cred.login_url);
            setCredentialForView({
              login_url: cred.login_url ?? null,
              jurisdiction: cred.jurisdiction ?? null,
            });
            if (import.meta.env.DEV)
              console.log(
                `[PortalDataViewer] credential=${project.credential_id}, login_url=${cred.login_url}, jurisdiction=${cred.jurisdiction}, expectedPortalType=${credExpectedType}, isBaltimore=${isBaltimorePortal(cred)}`,
              );
          } else {
            setCredentialForView(null);
          }
        } else {
          setCredentialForView(null);
        }
        setExpectedPortalType(credExpectedType);

        if (!project.portal_data) {
          setPortalData(null);
          setPortalStatus((project.portal_status as string) ?? null);
          setLastCheckedAt(null);
          setResolvedProjectId(project.id);
          setResolvedPermitNumber(project.permit_number ?? null);
          setResolvedCredentialId(project.credential_id ?? null);
          if (import.meta.env.DEV)
            console.log(
              `[PortalDataViewer] empty state: no saved portal_data for project ${project.id}${!project.credential_id ? " (no credential linked)" : ""}`,
            );
        } else {
          const pd = (project.portal_data as PortalData) || null;
          const actualType = pd?.portalType || "unknown";

          if (
            pd &&
            credExpectedType &&
            credExpectedType !== "unknown" &&
            actualType !== "unknown" &&
            credExpectedType !== actualType
          ) {
            if (import.meta.env.DEV) {
              console.log(
                `[PortalDataViewer] MISMATCH: credential expects "${credExpectedType}", but portal_data has "${actualType}". Hiding mismatched data only.`,
              );
            }
            setPortalData(null);
            setPortalStatus((project.portal_status as string) ?? null);
            setLastCheckedAt((project.last_checked_at as string) ?? null);
            setResolvedProjectId(project.id);
            setResolvedPermitNumber(project.permit_number ?? null);
            setResolvedCredentialId(project.credential_id ?? null);
          } else {
            setPortalData(pd);
            setPortalStatus((project.portal_status as string) ?? null);
            setLastCheckedAt((project.last_checked_at as string) ?? null);
            setResolvedProjectId(project.id);
            setResolvedPermitNumber(project.permit_number ?? null);
            setResolvedCredentialId(project.credential_id ?? null);
            if (import.meta.env.DEV) {
              console.log(
                `[PortalDataViewer] ✅ saved data rendered immediately: project=${project.id}, portalType=${actualType}, expectedType=${credExpectedType ?? "none"}`,
              );
              if (pd?.tabs?.files) {
                const filesTab = pd.tabs.files as FilesTabData;
                const allFiles =
                  filesTab.folders?.flatMap((f) => f.files ?? []) ?? [];
                const withUrl = allFiles.filter((f) => !!f.viewUrl);
                console.log(
                  `[PortalDataViewer] Loaded ${allFiles.length} files, ${withUrl.length} with viewUrl`,
                  withUrl.map((f) => ({ name: f.name, viewUrl: f.viewUrl })),
                );
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(err);
      if (thisRequestId === fetchIdRef.current) {
        setPortalData(null);
        setExpectedPortalType(null);
        setCredentialForView(null);
      }
    } finally {
      if (thisRequestId === fetchIdRef.current) setLoading(false);
    }
  }, [user, selectedProjectId]);

  const silentRefetch = useCallback(async () => {
    if (!user || !resolvedProjectId) return;
    if (selectedProjectId && resolvedProjectId !== selectedProjectId) {
      if (import.meta.env.DEV)
        console.log(
          "[PortalDataViewer] silentRefetch skipped — resolvedProjectId",
          resolvedProjectId,
          "≠ selectedProjectId",
          selectedProjectId,
        );
      return;
    }
    try {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id, portal_data, portal_status, last_checked_at, credential_id",
        )
        .eq("id", resolvedProjectId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!error && data) {
        setPortalStatus((data.portal_status as string) ?? null);
        setLastCheckedAt((data.last_checked_at as string) ?? null);

        let credExpectedType: string | null = null;
        if ((data as any).credential_id) {
          const { data: cred } = await supabase
            .from("portal_credentials")
            .select("login_url, jurisdiction")
            .eq("id", (data as any).credential_id)
            .maybeSingle();
          if (cred) {
            credExpectedType = detectPortalTypeFromUrl(cred.login_url);
            setCredentialForView({
              login_url: cred.login_url ?? null,
              jurisdiction: cred.jurisdiction ?? null,
            });
          } else {
            setCredentialForView(null);
          }
        } else {
          setCredentialForView(null);
        }
        setExpectedPortalType(credExpectedType);

        if (data.portal_data) {
          const pd = data.portal_data as PortalData;
          const actualType = pd.portalType || "unknown";

          if (
            credExpectedType &&
            credExpectedType !== "unknown" &&
            actualType !== "unknown" &&
            credExpectedType !== actualType
          ) {
            if (import.meta.env.DEV)
              console.log(
                `[PortalDataViewer] silentRefetch MISMATCH: credential expects "${credExpectedType}", but portal_data has "${actualType}". Ignoring stale data.`,
              );
            setPortalData(null);
            return;
          }

          const filesTab = pd.tabs?.files as FilesTabData | undefined;
          if (filesTab?.folders) {
            const urlCount = filesTab.folders.reduce(
              (sum, f) =>
                sum + (f.files?.filter((file) => !!file.viewUrl).length ?? 0),
              0,
            );
            if (import.meta.env.DEV)
              console.log(
                `[PortalDataViewer] silentRefetch: ${urlCount} files with viewUrl`,
              );
          }
          setPortalData(pd);
        } else {
          setPortalData(null);
        }
      }
    } catch {}
  }, [user, resolvedProjectId, selectedProjectId, expectedPortalType]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await silentRefetch();
    } finally {
      setRefreshing(false);
    }
  }, [silentRefetch]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }
    fetchData();
  }, [user, authLoading, navigate, fetchData]);

  useEffect(() => {
    if (!user || !resolvedProjectId) return;
    const channel = supabase
      .channel(`portal-data-${resolvedProjectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "projects",
          filter: `id=eq.${resolvedProjectId}`,
        },
        () => {
          silentRefetch();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, resolvedProjectId, silentRefetch]);

  useEffect(() => {
    if (!scrape.isScraping || !resolvedProjectId) return;
    const interval = setInterval(silentRefetch, 10000);
    return () => clearInterval(interval);
  }, [scrape.isScraping, resolvedProjectId, silentRefetch]);

  /** Must run before any early return — same hook count on every render (PGC report row → download links). */
  const reportEntryByReportName = useMemo(() => {
    const m = new Map<string, ReportEntryDownload>();
    const list = portalData?.tabs?.reports?.reportEntries;
    if (!Array.isArray(list)) return m;
    for (const e of list) {
      const name = e?.reportName;
      if (name != null && String(name).length > 0) {
        m.set(String(name), e);
      }
    }
    return m;
  }, [portalData?.tabs?.reports?.reportEntries]);

  const montgomeryStatusActionLinks = useMemo(() => {
    const st = portalData?.portalSubtype;
    if (st !== "montgomery-projectdox" && st !== "howard-projectdox") return [];
    const links = (portalData.tabs?.status?.links ?? []) as StatusTabLink[];
    return montgomeryStatusLinksActionable(links);
  }, [portalData?.portalSubtype, portalData?.tabs?.status?.links]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const st = portalData?.portalSubtype;
    if (st !== "montgomery-projectdox" && st !== "howard-projectdox") return;
    const stLinks = (portalData.tabs?.status?.links ?? []) as StatusTabLink[];
    console.log(
      `[Montgomery][ui][status] links parsed = ${stLinks.length}`,
    );
    console.log(
      `[Montgomery][ui][status] actionable buttons = ${montgomeryStatusLinksActionable(stLinks).length}`,
    );
    const entries = portalData.tabs?.reports?.reportEntries ?? [];
    console.log(
      `[Montgomery][ui][reports] reportEntries count = ${entries.length}`,
    );
    for (const e of entries) {
      const a = getMontgomeryReportEntryActionUrls(e);
      console.log(
        `[Montgomery][ui][reports-actions] ${e.reportName} viewer=${a.viewerUrl ? "set" : "none"} pdf=${a.pdfUrl ? "set" : "none"} excel=${a.excelUrl ? "set" : "none"}`,
      );
    }
    const pdfArtifacts = portalData.tabs?.reports?.pdfs ?? [];
    if (Array.isArray(pdfArtifacts)) {
      for (const p of pdfArtifacts) {
        const fn = String(p.fileName ?? "");
        console.log(
          `[Montgomery][ui][reports-render] ${fn} renderer=generic`,
        );
      }
    }
    const rows = portalData.tabs?.reports?.tables?.[0]?.rows ?? [];
    for (const row of rows) {
      const name = String(
        row["REPORT NAME"] ?? row["Report Name"] ?? "",
      ).trim();
      if (!name) continue;
      const m = new Map<string, ReportEntryDownload>();
      for (const e of entries) {
        if (e?.reportName) m.set(String(e.reportName), e);
      }
      const ent = findMontgomeryReportEntryForRow(m, entries, name);
      const tableSt = String(row["Status"] ?? "");
      const { text, source } = montgomeryReportStatusForRow(tableSt, ent);
      const viewer = ent
        ? isHttpUrlCandidate(ent.viewerUrl) || isHttpUrlCandidate(ent.reportUrl)
        : false;
      const pdf = ent ? isHttpUrlCandidate(ent.pdfUrl) : false;
      const xl = ent ? isHttpUrlCandidate(ent.excelUrl) : false;
      console.log(
        `[Montgomery][ui][reports] row ${name} statusSource = ${source}`,
      );
      console.log(
        `[Montgomery][ui][reports] row ${name} buttons viewer=${viewer ? "yes" : "no"} pdf=${pdf ? "yes" : "no"} excel=${xl ? "yes" : "no"} displayStatus=${text}`,
      );
    }
  }, [portalData]);

  if (authLoading || (loading && !portalData)) {
    return (
      <section className="py-6 px-4 sm:px-6 max-w-5xl">
        <Skeleton className="h-12 w-64 mb-4" />
        <Skeleton className="h-6 w-full mb-2" />
        <Skeleton className="h-6 w-3/4 mb-6" />
        <Skeleton className="h-10 w-48 mb-6" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }

  if (noPermitConfigured) {
    return (
      <section className="py-6 px-4 sm:px-6 max-w-5xl">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">No project linked</h2>
            <p className="text-muted-foreground mb-4">
              In Settings &gt; Portal Credentials, link credentials to a
              project. Then select that project in the sidebar and set Permit #
              there.
            </p>
            <Button asChild variant="outline">
              <Link to="/settings">Open Settings</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  const accelaExpectedByCredential = expectedPortalType === "accela";
  const arlingtonViewerContext = isArlingtonPortalContext({
    selectedCredential: credentialForView,
    portalType: expectedPortalType ?? portalData?.portalType ?? null,
    portalData,
    project: resolvedPermitNumber ? { permit_number: resolvedPermitNumber } : null,
  });
  const shouldRenderArlingtonAccelaShell =
    accelaExpectedByCredential &&
    arlingtonViewerContext.isArlington &&
    !!resolvedProjectId &&
    (!portalData || !portalData.tabs);
  const arlingtonAccelaPortalData = shouldRenderArlingtonAccelaShell
    ? (() => {
        const shell = buildEmptyArlingtonAccelaPortalShell(
          resolvedPermitNumber ??
            portalData?.projectNum ??
            portalData?.name ??
            null,
        );
        if (!portalData) return shell;
        return {
          ...shell,
          ...portalData,
          tabs: portalData.tabs ?? shell.tabs,
        };
      })()
    : null;

  const lastCheckedStr = lastCheckedAt
    ? `Last checked: ${formatDistanceToNow(new Date(lastCheckedAt), { addSuffix: true })}`
    : null;

  const renderAccelaPortalSection = (
    accelaPortalDataForView: NonNullable<typeof arlingtonAccelaPortalData>,
  ) => {
    const accelaPortalView = credentialForView
      ? resolvePortalView(
          credentialForView,
          accelaPortalDataForView.portalType ?? null,
          accelaPortalDataForView,
        )
      : null;

    if (import.meta.env.DEV) {
      console.log(
        `[PortalDataViewer] rendering UI: expectedPortalType=${expectedPortalType}, portalData.portalType=${accelaPortalDataForView.portalType}, renderAccelaUI=true, credentialForView=${credentialForView ? "set" : "null"}, accelaPortalView=${accelaPortalView}, arlingtonContext=${arlingtonViewerContext.isArlington}`,
      );
    }

    return (
      <section
        className="py-6 px-4 sm:px-6 max-w-5xl"
        data-testid="portal-data-viewer"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-foreground">
              Portal Data
            </h1>
            {loading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {lastCheckedStr && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {lastCheckedStr}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            onClick={handleManualRefresh}
            disabled={refreshing}
            className={cn(PORTAL_ACTION_BUTTON_OUTLINE, "gap-2")}
            data-testid="button-refresh"
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
        {accelaPortalView === "baltimore" ? (
          <BaltimorePortalDataView
            portalData={accelaPortalDataForView as any}
            projectId={resolvedProjectId}
            permitNumber={
              accelaPortalDataForView?.projectNum ??
              accelaPortalDataForView?.name ??
              resolvedPermitNumber
            }
            credentialLoginUrl={credentialForView?.login_url ?? null}
          />
        ) : accelaPortalView === "fairfax" ? (
          <FairfaxPortalDataView
            portalData={accelaPortalDataForView as any}
            projectId={resolvedProjectId}
            permitNumber={
              accelaPortalDataForView?.projectNum ??
              accelaPortalDataForView?.name ??
              resolvedPermitNumber
            }
            credentialLoginUrl={credentialForView?.login_url ?? null}
          />
        ) : (
          <AccelaProjectView
            portalData={accelaPortalDataForView as any}
            projectId={resolvedProjectId}
            userId={user?.id ?? null}
            credentialId={resolvedCredentialId}
            permitNumber={
              accelaPortalDataForView?.projectNum ??
              accelaPortalDataForView?.name ??
              resolvedPermitNumber
            }
            credentialLoginUrl={credentialForView?.login_url ?? null}
            credentialJurisdiction={credentialForView?.jurisdiction ?? null}
            onPortalDataRefresh={silentRefetch}
          />
        )}
      </section>
    );
  };

  if (shouldRenderArlingtonAccelaShell && arlingtonAccelaPortalData) {
    return renderAccelaPortalSection(arlingtonAccelaPortalData);
  }

  if (!portalData) {
    const emptyLabel =
      expectedPortalType === "accela"
        ? "No Accela data yet"
        : expectedPortalType === "projectdox"
          ? "No ProjectDox data yet"
          : "No portal data yet";
    if (import.meta.env.DEV)
      console.log(
        `[PortalDataViewer] rendering empty state: expectedPortalType=${expectedPortalType}, label="${emptyLabel}"`,
      );
    return (
      <section className="py-6 px-4 sm:px-6 max-w-5xl">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-lg font-semibold mb-2">{emptyLabel}</h2>
            <p className="text-muted-foreground mb-4">
              Saved data for the selected project will appear here
              automatically. Run a new scrape only if this project does not have
              valid saved data yet.
            </p>
            <Button asChild className="bg-accent hover:bg-accent/90">
              <Link to="/dashboard">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }

  if (!portalData?.tabs) {
    const noTabsLabel =
      expectedPortalType === "accela"
        ? "No Accela data available."
        : expectedPortalType === "projectdox"
          ? "No ProjectDox data available."
          : "No portal data available.";
    return (
      <section className="py-6 px-4 sm:px-6 max-w-5xl">
        <div className="p-8 text-center text-muted-foreground">
          {noTabsLabel} Run a scrape first.
        </div>
      </section>
    );
  }

  const renderAccelaUI =
    expectedPortalType === "accela" ||
    (!expectedPortalType && portalData.portalType === "accela");

  if (renderAccelaUI) {
    return renderAccelaPortalSection(portalData as any);
  }

  const infoTab = portalData.tabs?.info;
  const reportsTab = portalData.tabs?.reports;
  const filesTab = portalData.tabs?.files;
  const isPgcEplan = portalData.portalSubtype === "pgc-eplan";

  function getReviewCommentsDisplayTextForPortal(pdf: {
    text?: string;
    fileName?: string;
    info?: { source?: string };
  }): string {
    const raw = pdf.text ?? "";
    const useRawForPgcStacked =
      isPgcEplan && String(pdf.fileName ?? "").includes("Review Comments");
    if (useRawForPgcStacked) return raw;
    return shouldNormalizePgcReviewCommentsDisplayText(pdf.fileName, pdf.info)
      ? normalizePgcFlattenedReviewCommentsText(raw)
      : raw;
  }

  const isMontgomeryProjectDox =
    portalData.portalSubtype === "montgomery-projectdox";
  const isHowardProjectDox =
    portalData.portalSubtype === "howard-projectdox";
  /** Default DC Avolve / generic ProjectDox (not PGC, not Montgomery/Howard). */
  const isWashingtonDcProjectDox =
    portalData.portalType === "projectdox" &&
    !isPgcEplan &&
    !isMontgomeryProjectDox &&
    !isHowardProjectDox;
  // Tenants rendered via Montgomery-style report URL resolver
  // (getMontgomeryReportEntryActionUrls). Washington shares Montgomery's
  // reportEntries[] shape including Supabase-backed pdfUrl/excelUrl, so it
  // belongs in this group despite the "Md" in the name.
  const isMdAvolveProjectDox =
    isMontgomeryProjectDox ||
    isHowardProjectDox ||
    isWashingtonDcProjectDox;
  const foldersForRender = (() => {
    const folders = filesTab?.folders ?? [];
    if (!isPgcEplan) return folders;
    return folders.filter(
      (f) => (f.filesCount ?? 0) > 0 || (f.files?.length ?? 0) > 0,
    );
  })();
  const statusTabData = portalData.tabs?.status;
  const statusSectionsList = (
    statusTabData as { sections?: unknown[] } | undefined
  )?.sections;
  const tasksTabData = portalData.tabs?.tasks;
  const reviewTab = portalData.tabs?.review as ReviewTabData | undefined;
  const reportsTable = reportsTab?.tables?.[0];
  const reportsRows = reportsTable?.rows ?? [];
  const rawPdfs = reportsTab?.pdfs;
  const pdfs = Array.isArray(rawPdfs) ? rawPdfs : [];
  const reportEntries = reportsTab?.reportEntries ?? [];
  const showWashingtonReportsTable =
    !!reportsTable && (reportsRows?.length ?? 0) > 0;

  const hasStatusTab =
    !!statusTabData &&
    ((statusTabData.keyValues?.length ?? 0) > 0 ||
      (statusTabData.tables?.length ?? 0) > 0 ||
      (Array.isArray(statusSectionsList) && statusSectionsList.length > 0) ||
      !!statusTabData.error ||
      (isMdAvolveProjectDox && montgomeryStatusActionLinks.length > 0));
  const hasTasksTab =
    !!tasksTabData &&
    ((tasksTabData.keyValues?.length ?? 0) > 0 ||
      (tasksTabData.tables?.length ?? 0) > 0 ||
      !!tasksTabData.error);
  const corrections = reviewTab?.latestCycleCorrections ?? [];
  /** PGC: sanitize DOM rows, then group into logical review items (one card per comment). */
  const reviewWorkflowBuckets = isPgcEplan
    ? (reviewTab?.workflowBuckets ?? [])
        .map((w) => {
          const rawRows = (w.rows ?? []) as Record<string, string>[];
          const rows = sanitizePgcWorkflowRows(rawRows);
          const groupedItems = groupPgcWorkflowRowsIntoReviewItems(
            rows,
            w.workflowName,
            { rawRowCount: rawRows.length },
          );
          return { workflowName: w.workflowName, rows, groupedItems };
        })
        .filter((w) => w.rows.length > 0)
    : [];
  const activePgcReviewWorkflow =
    reviewWorkflowBuckets.find((w) => w.workflowName === selectedReviewWorkflow) ||
    reviewWorkflowBuckets[0] ||
    null;
  const hasReviewTab =
    !!reviewTab &&
    (reviewWorkflowBuckets.length > 0 ||
      corrections.length > 0 ||
      !!reviewTab.summary ||
      !!reviewTab.workflow ||
      !!reviewTab.error);
  const PROJECT_INFO_LABELS = [
    "Project name",
    "Description",
    "Location",
    "Contact",
    "Contact's Email",
    "Phone",
    "Cell Phone",
    "Job Class",
    "Project Owner",
    "Owner's Email",
    "Status",
    "Review Cycle",
    "Project Start/End",
  ] as const;

  const infoTables = infoTab?.tables ?? [];
  const projectInfoFromTab = infoTab?.projectInfo ?? [];

  /** DC ProjectDox "weird" table: headers like ["Project name:", "B2508799"], rows like {"Project name:": "<value>"}. First column holds values in label order. */
  const isWeirdProjectInfoTable = (table: TableData, projectNum: string) => {
    const headers = table.headers ?? [];
    const first = headers[0] ?? "";
    const second = headers[1] ?? "";
    return (
      first.includes("Project name:") &&
      (second === projectNum || (second.length <= 20 && !second.includes(":")))
    );
  };

  /** Detect if tabs.info.projectInfo is malformed (scraper put values as keys). Do not use for display. */
  const isProjectInfoMalformed = (): boolean => {
    const jurisdiction =
      (portalData?.dashboardStatus ?? "") +
      (portalData?.location ?? "") +
      (portalData?.name ?? "");
    const isDC =
      /washington\s*dc|projectdox|avolve|dc\s*accela/i.test(jurisdiction) ||
      (portalData?.location && /sheridan|dc\b/i.test(portalData.location));
    if (isDC) return true;
    const projectNum = portalData?.projectNum ?? "";
    if (!projectNum) return false;
    const hasProjectNumAsKey = projectInfoFromTab.some(
      (kv) => kv.key === projectNum || kv.key?.trim() === projectNum,
    );
    if (hasProjectNumAsKey) return true;
    const emptyCount = projectInfoFromTab.filter(
      (kv) => !kv.value?.trim(),
    ).length;
    if (
      projectInfoFromTab.length >= 5 &&
      emptyCount >= projectInfoFromTab.length - 2
    )
      return true;
    return false;
  };

  /**
   * Build Project Info from portalData + the weird info table (DC ProjectDox).
   * Table: first column key is "Project name:", row i value = row[i][firstHeader]. Order: description, location, contact, contact email, phone, cell phone, job class, project owner, owner email, status, review cycle, start/end.
   */
  const buildProjectInfoFromPortalAndTable = (): KeyValue[] => {
    const projectNum = portalData?.projectNum ?? "";
    const name = portalData?.name ?? "";
    const description = portalData?.description ?? "";
    const location = portalData?.location ?? "";

    const infoTable = infoTables.find((t) =>
      isWeirdProjectInfoTable(t, projectNum),
    );
    const firstColKey = infoTable?.headers?.[0] ?? "Project name:";

    const getRowValue = (rowIndex: number): string => {
      if (!infoTable?.rows?.[rowIndex]) return "";
      const row = infoTable.rows[rowIndex];
      const v =
        row[firstColKey] ?? (Object.values(row)[0] as string | undefined);
      return typeof v === "string"
        ? v
            .replace(/\s+/g, " ")
            .replace(/\u00a0/g, "")
            .trim()
        : "";
    };

    const rowCount = infoTable?.rows?.length ?? 0;
    const values: string[] = [];
    for (let i = 0; i < Math.max(rowCount, 12); i++) {
      values.push(getRowValue(i));
    }

    if (typeof window !== "undefined" && import.meta.env.DEV) {
      console.log("[PortalDataViewer] weirdTable debug:", {
        headers: infoTable?.headers,
        rowCount,
        extractedByIndex: values
          .slice(0, rowCount)
          .map((v, i) => `[${i}]: ${(v || "(empty)").slice(0, 50)}`),
      });
    }

    const projectName =
      projectNum ||
      name ||
      (infoTable?.headers?.[1] && !infoTable.headers[1].includes(":")
        ? infoTable.headers[1].trim()
        : "");

    const v5 = values[5] ?? "";
    const looksLikeJobClass = (s: string) =>
      /^[A-Z]{1,3}-[A-Z]{1,3}$/.test(s.trim()) ||
      /C-C|Job\s*Class/i.test(s) ||
      (s.length <= 6 && /^[A-Z0-9\-]+$/.test(s.trim()));
    const looksLikePhone = (s: string) =>
      s.length >= 7 &&
      /^[\d\s\-\(\)]+$/.test(s.replace(/\s/g, "")) &&
      /\d{7,}/.test(s);

    const hasCellPhoneRow =
      v5 !== "" && looksLikePhone(v5) && !looksLikeJobClass(v5);

    let jobClassIdx: number;
    let projectOwnerIdx: number;
    let ownerEmailIdx: number;
    let statusIdx: number;
    let reviewCycleIdx: number;
    let startEndIdx: number;
    let cellPhoneValue: string;

    if (!hasCellPhoneRow) {
      cellPhoneValue = "";
      jobClassIdx = 5;
      projectOwnerIdx = 6;
      ownerEmailIdx = 7;
      statusIdx = 8;
      startEndIdx = 9;
      reviewCycleIdx = -1;
    } else {
      cellPhoneValue = v5;
      jobClassIdx = 6;
      projectOwnerIdx = 7;
      ownerEmailIdx = 8;
      statusIdx = 9;
      reviewCycleIdx = rowCount >= 11 ? 10 : -1;
      startEndIdx = rowCount >= 12 ? 11 : rowCount >= 11 ? 10 : -1;
    }

    const startEndValue = startEndIdx >= 0 ? (values[startEndIdx] ?? "") : "";

    const rows: KeyValue[] = [
      { key: "Project name", value: projectName },
      { key: "Description", value: description || values[0] },
      { key: "Location", value: location || values[1] },
      { key: "Contact", value: values[2] },
      { key: "Contact's Email", value: values[3] },
      { key: "Phone", value: values[4] },
      { key: "Cell Phone", value: cellPhoneValue },
      { key: "Job Class", value: values[jobClassIdx] ?? "" },
      { key: "Project Owner", value: values[projectOwnerIdx] ?? "" },
      { key: "Owner's Email", value: values[ownerEmailIdx] ?? "" },
      { key: "Status", value: values[statusIdx] ?? "" },
      {
        key: "Review Cycle",
        value: reviewCycleIdx >= 0 ? (values[reviewCycleIdx] ?? "") : "",
      },
      { key: "Project Start/End", value: startEndValue },
    ];
    return rows;
  };

  const isMalformedInfoTable = (table: TableData) => {
    const headers = table.headers ?? [];
    const hasProjectNameHeader = headers[0]?.includes("Project name:");
    const hasVeryLongHeader = headers.some((h) => (h ?? "").length > 100);
    const hasLabelLikeHeaders = headers.some((h) =>
      /^(Description|Location|Contact):?$/i.test((h ?? "").trim()),
    );
    return hasProjectNameHeader || hasVeryLongHeader || hasLabelLikeHeaders;
  };
  const filteredInfoTables = isPgcEplan
    ? infoTables
    : infoTables.filter((table) => !isMalformedInfoTable(table));

  let displayProjectInfo: KeyValue[] = [];
  const weirdTable = infoTables.find((t) =>
    isWeirdProjectInfoTable(t, portalData?.projectNum ?? ""),
  );
  if (isPgcEplan) {
    displayProjectInfo = projectInfoFromTab;
  } else if (isProjectInfoMalformed() || weirdTable) {
    displayProjectInfo = buildProjectInfoFromPortalAndTable();
  } else if (projectInfoFromTab.length > 2) {
    displayProjectInfo = projectInfoFromTab;
  } else {
    const infoTable = infoTables.find((t) =>
      t.headers?.some(
        (h) =>
          h?.includes("Project name:") ||
          (h ?? "").length > 100 ||
          /^(Description|Location|Contact):?$/i.test((h ?? "").trim()),
      ),
    );
    if (infoTable) {
      const parsedInfo: KeyValue[] = [];
      const projectNameValue = infoTable.headers?.find(
        (h) => h && h.length < 20 && !h.includes(":"),
      );
      if (projectNameValue?.trim()) {
        parsedInfo.push({
          key: "Project name",
          value: projectNameValue.trim(),
        });
      }
      const headers = infoTable.headers ?? [];
      const valueColumnKey = headers[1] ?? null;
      infoTable.rows?.forEach((row, idx) => {
        const labelIdx = parsedInfo.length;
        if (labelIdx >= PROJECT_INFO_LABELS.length) return;
        let value = "";
        if (valueColumnKey != null && row[valueColumnKey] !== undefined) {
          const v = row[valueColumnKey];
          value =
            typeof v === "string"
              ? v
                  .replace(/\s+/g, " ")
                  .replace(/\u00a0/g, "")
                  .trim()
              : "";
        } else {
          const values = Object.values(row);
          const second = values[1];
          value =
            typeof second === "string"
              ? String(second)
                  .replace(/\s+/g, " ")
                  .replace(/\u00a0/g, "")
                  .trim()
              : "";
        }
        parsedInfo.push({ key: PROJECT_INFO_LABELS[labelIdx], value });
      });
      displayProjectInfo = parsedInfo;
    }
  }

  if (
    typeof window !== "undefined" &&
    import.meta.env.DEV &&
    displayProjectInfo.length > 0
  ) {
    const cellPhoneIdx = displayProjectInfo.findIndex((kv) =>
      /cell\s*phone/i.test(kv.key),
    );
    if (cellPhoneIdx >= 0 && cellPhoneIdx + 1 < displayProjectInfo.length) {
      const nextKey = displayProjectInfo[cellPhoneIdx + 1].key;
      if (nextKey !== "Job Class") {
        console.warn(
          "[PortalDataViewer] Project Info alignment: after Cell Phone expected Job Class, got",
          nextKey,
        );
      }
    }
  }

  const hasInfoData = isPgcEplan
    ? (filteredInfoTables.length > 0 || (infoTab?.keyValues?.length ?? 0) > 0)
    : (displayProjectInfo.length > 0 ||
        (infoTab?.keyValues?.length ?? 0) > 0 ||
        filteredInfoTables.length > 0);
  const pgcInfoFallbackRows: KeyValue[] = isPgcEplan
    ? [
        { key: "Permit Number", value: portalData.projectNum ?? "" },
        {
          key: "Project Title",
          value: portalData.description || portalData.name || "",
        },
        { key: "Address", value: portalData.location ?? "" },
        { key: "Portal Type", value: portalData.portalSubtype || portalData.portalType || "" },
        {
          key: "Last Checked",
          value: lastCheckedAt ? new Date(lastCheckedAt).toLocaleString() : "",
        },
        {
          key: "Workflow Instance",
          value:
            (reviewTab?.workflow as Record<string, unknown> | undefined)
              ?.wflowInstanceID != null
              ? String(
                  (reviewTab?.workflow as Record<string, unknown>).wflowInstanceID,
                )
              : "",
        },
        { key: "Project ID", value: resolvedProjectId ?? "" },
      ].filter((kv) => (kv.value || "").trim() !== "")
    : [];
  const hasInfoFallbackForPgc = false;

  const pgcTaskTablesForRender = (() => {
    const sourceTables = tasksTabData?.tables ?? [];
    if (!isPgcEplan) return sourceTables;
    return sourceTables.map((tbl) => {
      const headers = (tbl.headers ?? []).map((h) => String(h || "").trim());
      const lower = headers.join(" ").toLowerCase();
      const isWorkflow =
        /coordinator group|integration mode|version|started|completed/.test(lower);
      if (isWorkflow) {
        const wfHeaders = [
          "Name",
          "Coordinator Group",
          "State",
          "Integration Mode",
          "Version",
          "Started",
          "Completed",
        ];
        const rows = (tbl.rows ?? []).map((row) => ({
          Name: String(row["Name"] ?? row["name"] ?? ""),
          "Coordinator Group": String(
            row["Coordinator Group"] ?? row["coordinatorGroup"] ?? "",
          ),
          State: String(row["State"] ?? row["state"] ?? ""),
          "Integration Mode": String(
            row["Integration Mode"] ?? row["integrationMode"] ?? "",
          ),
          Version: String(row["Version"] ?? row["version"] ?? ""),
          Started: String(row["Started"] ?? row["started"] ?? ""),
          Completed: String(row["Completed"] ?? row["completed"] ?? ""),
        }));
        return { headers: wfHeaders, rows, title: "Workflows" };
      }
      const taskHeaders = [
        "Action",
        "Task",
        "Project",
        "Group",
        "Status",
        "Priority",
        "Due Date",
        "Created",
        "Case Type",
        "Description",
      ];
      const rows = (tbl.rows ?? []).map((row) => ({
        Action: String(row["Action"] ?? row["action"] ?? ""),
        Task: String(row["Task"] ?? row["taskName"] ?? row["Name"] ?? ""),
        Project: String(row["Project"] ?? row["project"] ?? ""),
        Group: String(row["Group"] ?? row["Assignee"] ?? row["assignee"] ?? ""),
        Status: String(row["Status"] ?? row["State"] ?? row["state"] ?? ""),
        Priority: String(row["Priority"] ?? row["priority"] ?? ""),
        "Due Date": String(
          row["Due Date"] ?? row["Due"] ?? row["dueDate"] ?? "",
        ),
        Created: String(row["Created"] ?? row["created"] ?? ""),
        "Case Type": String(row["Case Type"] ?? row["caseType"] ?? ""),
        Description: String(row["Description"] ?? row["rawText"] ?? ""),
      }));
      return { headers: taskHeaders, rows, title: "Tasks" };
    });
  })();

  const findPdfForReport = (reportName: string) =>
    pdfs.find(
      (p) =>
        p.fileName &&
        reportName &&
        (p.fileName.includes(reportName) || reportName.includes(p.fileName)),
    );

  /** Skip "STATUS" when it is the PGC/SSRS table column header, not a Washington STATUS block. */
  function findWashingtonStatusAnchorIndex(text: string): number {
    let from = 0;
    while (from < text.length) {
      const i = text.indexOf("STATUS", from);
      if (i === -1) return -1;
      const lineStart = text.lastIndexOf("\n", i);
      const lineStartIdx = lineStart === -1 ? 0 : lineStart + 1;
      const lineEnd = text.indexOf("\n", i);
      const line = text.slice(
        lineStartIdx,
        lineEnd === -1 ? undefined : lineEnd,
      );
      if (
        /\bREF\s*#|CYCLE|REVIEWED BY|DISCUSSION|FILENAME|TYPE\b/i.test(line)
      ) {
        from = i + 6;
        continue;
      }
      return i;
    }
    return -1;
  }

  function parseReviewComments(originalText: string) {
    const comments: Array<{
      ref: string;
      cycle: string;
      department: string;
      reviewer: string;
      date: string;
      status: string;
      body: string[];
    }> = [];

    const rcIdx = findWashingtonStatusAnchorIndex(originalText);
    if (rcIdx === -1) return comments;

    const afterHeader = originalText.substring(rcIdx + "STATUS".length);
    const lines = afterHeader.split("\n").map((l) => l.trim());

    let current: (typeof comments)[0] | null = null;

    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      if (!line) continue;
      if (line.includes("Created in ProjectDox")) break;

      if (/^[\t ]+$/.test(line)) continue;

      if (/^\d{1,2}$/.test(line) && parseInt(line, 10) <= 50) {
        if (current) comments.push(current);
        current = {
          ref: line,
          cycle: "",
          department: "",
          reviewer: "",
          date: "",
          status: "",
          body: [],
        };

        const next = lines[j + 1]?.trim();
        if (next && /^\d{1,2}$/.test(next) && parseInt(next, 10) <= 10) {
          current.cycle = next;
          j++;
        }
        continue;
      }

      if (!current) continue;

      if (/^(Resolved|Unresolved|Info Only)$/i.test(line)) {
        current.status = line;
        continue;
      }

      if (
        !current.department &&
        line === line.toUpperCase() &&
        line.length >= 2 &&
        line.length <= 30 &&
        /^[A-Z]/.test(line) &&
        !line.includes(":") &&
        !line.includes(".") &&
        line.split(" ").length <= 4 &&
        !line.startsWith("SUBJECT") &&
        !line.startsWith("NO ") &&
        !line.startsWith("ENGAGING") &&
        line !== "REVIEW COMMENTS"
      ) {
        current.department = line;
        continue;
      }

      if (
        !current.reviewer &&
        /^[A-Z][a-z]+ [A-Z][a-z]+/.test(line) &&
        line.length < 40 &&
        !line.includes(":") &&
        !line.includes("http") &&
        !line.includes(".") &&
        line.split(" ").length <= 4
      ) {
        current.reviewer = line;
        continue;
      }

      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line)) {
        if (!current.date) {
          current.date = line;
          const nextLine = lines[j + 1]?.trim();
          if (nextLine && /^\d{2}\s*(AM|PM)/i.test(nextLine)) {
            current.date += " " + nextLine;
            j++;
          }
        }
        continue;
      }

      if (line === "Comment" || line === "Markup" || line === "Checklist") {
        continue;
      }

      if (/^-{5,}$/.test(line)) {
        current.body.push("---");
        continue;
      }

      current.body.push(line);
    }
    if (current) comments.push(current);

    return comments;
  }

  function renderReportContent(text: string): React.ReactNode {
    if (!text) return null;

    const elements: React.ReactNode[] = [];
    let keyInc = 0;

    // SSRS uses \n\t as cell separator. Join any line starting with \t
    // to the previous line, converting \n\t into just \t
    const processed = text.replace(/\n\t/g, "\t");
    const lines = processed.split("\n");

    const tableRegions: Array<{
      start: number;
      end: number;
      headers: string[];
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || /^\t+$/.test(line)) continue;

      if (
        line === line.toUpperCase() &&
        line.length >= 2 &&
        line.length <= 40 &&
        /[A-Z]/.test(line) &&
        !line.includes(":")
      ) {
        const headers: string[] = [line];
        let j = i + 1;
        while (j < lines.length) {
          const jl = lines[j].trim();
          if (/^\t*$/.test(jl)) {
            j++;
            continue;
          }
          if (
            jl === jl.toUpperCase() &&
            jl.length >= 2 &&
            jl.length <= 40 &&
            /[A-Z]/.test(jl) &&
            !jl.includes(":")
          ) {
            headers.push(jl);
            j++;
          } else {
            break;
          }
        }

        if (headers.length >= 3) {
          const numCols = headers.length;
          const dataStart = j;
          const rows: string[][] = [];
          let currentRow: string[] = [];

          while (j < lines.length) {
            const dl = lines[j];
            const dt = dl.trim();

            if (dt.includes("Created in ProjectDox")) break;
            if (
              dt === dt.toUpperCase() &&
              dt.length > 10 &&
              !dt.includes(":") &&
              /[A-Z]/.test(dt) &&
              currentRow.length === 0 &&
              !dt.match(/^\d/) &&
              !dt.startsWith("-")
            ) {
              let isNewTable = false;
              for (let nk = j + 1; nk < Math.min(j + 5, lines.length); nk++) {
                const nkl = lines[nk].trim();
                if (/^\t*$/.test(nkl) || !nkl) continue;
                if (
                  nkl === nkl.toUpperCase() &&
                  nkl.length >= 2 &&
                  /[A-Z]/.test(nkl)
                ) {
                  isNewTable = true;
                }
                break;
              }
              if (!isNewTable) break;
            }

            if (/^\t+ *$/.test(dl)) {
              j++;
              continue;
            }

            if (dt === "") {
              if (currentRow.length > 0) {
                while (currentRow.length < numCols) currentRow.push("");
                rows.push(currentRow.slice(0, numCols));
                currentRow = [];
              }
              j++;
              continue;
            }

            currentRow.push(dt);
            j++;
          }
          if (currentRow.length > 0) {
            while (currentRow.length < numCols) currentRow.push("");
            rows.push(currentRow.slice(0, numCols));
          }

          if (rows.length > 0) {
            tableRegions.push({ start: i, end: j, headers });
          }

          i = j - 1;
          continue;
        }
      }
    }

    let lineIdx = 0;

    const tablesByStart = new Map<
      number,
      { headers: string[]; rows: string[][]; end: number }
    >();
    for (const region of tableRegions) {
      const numCols = region.headers.length;
      const rows: string[][] = [];
      let currentRow: string[] = [];
      let pastHeaders = false;
      let headerCount = 0;
      for (let li = region.start; li < region.end; li++) {
        const lt = lines[li].trim();
        if (!pastHeaders) {
          if (
            lt &&
            lt === lt.toUpperCase() &&
            /[A-Z]/.test(lt) &&
            !lt.includes(":") &&
            lt.length <= 40
          ) {
            headerCount++;
            if (headerCount >= numCols) {
              pastHeaders = true;
            }
          }
          continue;
        }
        if (/^\t+ *$/.test(lines[li])) continue;
        if (lt === "") {
          if (currentRow.length > 0) {
            while (currentRow.length < numCols) currentRow.push("");
            rows.push(currentRow.slice(0, numCols));
            currentRow = [];
          }
          continue;
        }
        if (lt.includes("Created in ProjectDox")) break;
        currentRow.push(lt);
      }
      if (currentRow.length > 0) {
        while (currentRow.length < numCols) currentRow.push("");
        rows.push(currentRow.slice(0, numCols));
      }
      tablesByStart.set(region.start, {
        headers: region.headers,
        rows,
        end: region.end,
      });
    }

    lineIdx = 0;
    while (lineIdx < lines.length) {
      const table = tablesByStart.get(lineIdx);
      if (table) {
        elements.push(
          <div
            key={keyInc++}
            className="overflow-x-auto my-4 border rounded-lg"
          >
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b-2 border-border">
                  {table.headers.map((h, hi) => (
                    <th
                      key={hi}
                      className="text-left p-2 px-3 text-xs font-bold text-primary font-mono border-r border-border whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    className={`border-b border-border ${ri % 2 === 0 ? "bg-muted/25" : "bg-muted/40"} hover:bg-primary/10`}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="p-2 px-3 align-top border-r border-border whitespace-nowrap text-foreground max-w-[200px] overflow-hidden text-ellipsis"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        lineIdx = table.end;
        continue;
      }

      const line = lines[lineIdx];
      const trimmed = line.trim();

      if (!trimmed || /^\t+$/.test(trimmed)) {
        lineIdx++;
        continue;
      }

      if (trimmed.includes("Created in ProjectDox")) {
        elements.push(
          <p
            key={keyInc++}
            className="text-xs text-muted-foreground mt-6 pt-2 border-t border-border italic"
          >
            {trimmed}
          </p>,
        );
        lineIdx++;
        continue;
      }

      if (
        elements.length === 0 &&
        (trimmed.startsWith("Plan Review") ||
          trimmed.startsWith("Current Project") ||
          trimmed.includes("Review Comments Report") ||
          trimmed.includes("Review Details") ||
          trimmed.includes("Routing Slip") ||
          trimmed.includes("Department Review"))
      ) {
        elements.push(
          <h3
            key={keyInc++}
            className="text-xl font-light text-foreground pb-2 mb-4 border-b-2 border-primary"
          >
            {trimmed}
          </h3>,
        );
        lineIdx++;
        continue;
      }

      if (
        trimmed === trimmed.toUpperCase() &&
        trimmed.length > 3 &&
        trimmed.length < 80 &&
        !trimmed.includes(":") &&
        /[A-Z]/.test(trimmed) &&
        !/^\d+$/.test(trimmed)
      ) {
        elements.push(
          <div
            key={keyInc++}
            className="text-center text-sm font-bold tracking-wider text-foreground bg-muted/40 py-2 my-4 border-y border-border"
          >
            {trimmed}
          </div>,
        );
        lineIdx++;
        continue;
      }

      if (
        trimmed.includes(":") &&
        trimmed.indexOf(":") > 1 &&
        trimmed.indexOf(":") < 45 &&
        !trimmed.startsWith("http")
      ) {
        const ci = trimmed.indexOf(":");
        const key = trimmed.substring(0, ci).trim();
        const val = trimmed.substring(ci + 1).trim();
        if (key.length > 1 && key.length < 45) {
          elements.push(
            <div key={keyInc++} className="flex gap-2 py-0.5">
              <span className="text-sm text-muted-foreground whitespace-nowrap min-w-[160px]">
                {key}:
              </span>
              <span className="text-sm font-semibold text-foreground">
                {val}
              </span>
            </div>,
          );
          lineIdx++;
          continue;
        }
      }

      elements.push(
        <p key={keyInc++} className="text-sm text-foreground py-0.5">
          {trimmed}
        </p>,
      );
      lineIdx++;
    }

    return <>{elements}</>;
  }

  function splitSsrsDataRow(line: string): string[] {
    const t = line.replace(/\u00a0/g, " ");
    if (t.includes("\t")) {
      return t.split("\t").map((c) => c.trim()).filter((c) => c.length > 0);
    }
    return t.split(/\s{2,}/).map((c) => c.trim()).filter((c) => c.length > 0);
  }

  function renderSsrsColumnTable(
    lines: string[],
    startIdx: number,
    headerCellsRaw: string[],
    dataLineIndices: number[],
  ): React.ReactNode {
    const maxCols = Math.max(
      headerCellsRaw.length,
      ...dataLineIndices.map((i) => splitSsrsDataRow(lines[i]).length),
      1,
    );
    const pad = (cells: string[]) => {
      const out = [...cells];
      while (out.length < maxCols) out.push("");
      return out.slice(0, maxCols);
    };
    const headerCells = pad(headerCellsRaw);
    const beforeText = lines.slice(0, startIdx).join("\n").trim();
    const beforeNode = beforeText ? (
      <div className="mb-4 text-sm space-y-1">{renderReportContent(beforeText)}</div>
    ) : null;

    const tableNode = (
      <div className="overflow-x-auto rounded border border-border my-2">
        <table className="text-xs w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="bg-muted/40 border-b-2 border-border">
              {headerCells.map((h, hi) => (
                <th
                  key={hi}
                  className="text-left p-2 px-3 font-semibold text-primary border-r border-border align-top whitespace-pre-wrap max-w-[min(200px,28vw)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dataLineIndices.map((li, ri) => {
              const line = lines[li];
              return (
                <tr
                  key={`${li}-${ri}`}
                  className={ri % 2 === 0 ? "bg-muted/25" : "bg-muted/40"}
                >
                  {pad(splitSsrsDataRow(line)).map((cell, ci) => (
                    <td
                      key={ci}
                      className="border border-border px-2 py-1.5 align-top text-foreground whitespace-pre-wrap max-w-[min(320px,45vw)] break-words"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );

    return (
      <>
        {beforeNode}
        {tableNode}
      </>
    );
  }

  /**
   * PGC / SSRS "Review Comments" PDF text: one row per line; columns are tabs OR 2+ spaces.
   * Stored extracts often have **no tab chars** (runtime logs: linesWithTab: 0) — use multi-space split.
   * `renderReportContent` mis-builds tables from ALL-CAPS line runs + one cell per line.
   */
  function renderSsrsTabSeparatedTable(raw: string): React.ReactNode | null {
    const normalized = raw.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n").map((l) => l.trim());

    const firstTabIdx = lines.findIndex((l) => l.includes("\t"));
    if (firstTabIdx !== -1) {
      const tabLines = lines
        .slice(firstTabIdx)
        .filter((l) => l.length > 0 && l.includes("\t"));
      if (tabLines.length >= 2) {
        const splitRow = (r: string) =>
          r.split("\t").map((c) => c.trim().replace(/\u00a0/g, " "));
        const maxCols = Math.max(...tabLines.map((r) => splitRow(r).length), 1);
        if (maxCols >= 2) {
          const headerCells = splitRow(tabLines[0]);
          const dataIndices: number[] = [];
          for (let i = firstTabIdx + 1; i < lines.length; i++) {
            const ln = lines[i];
            if (!ln || !ln.includes("\t")) continue;
            if (ln.includes("Created in ProjectDox")) break;
            dataIndices.push(i);
          }
          if (dataIndices.length > 0) {
            return renderSsrsColumnTable(
              lines,
              firstTabIdx,
              headerCells,
              dataIndices,
            );
          }
        }
      }
    }

    const nonEmpty = lines
      .map((l, i) => ({ l, i }))
      .filter((x) => x.l.length > 0);
    let headerIdx = -1;
    for (let k = 0; k < nonEmpty.length; k++) {
      const { l, i } = nonEmpty[k];
      const cells = splitSsrsDataRow(l);
      if (
        cells.length >= 4 &&
        /REF|CYCLE|REVIEWED|STATUS|FILENAME|DISCUSSION|TYPE/i.test(l)
      ) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) {
      for (let k = 0; k < nonEmpty.length; k++) {
        const { l, i } = nonEmpty[k];
        if (splitSsrsDataRow(l).length >= 6) {
          headerIdx = i;
          break;
        }
      }
    }
    if (headerIdx === -1) return null;

    const headerCells = splitSsrsDataRow(lines[headerIdx]);
    const maxCols = headerCells.length;
    if (maxCols < 4) return null;

    const dataIndices: number[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln) continue;
      if (ln.includes("Created in ProjectDox")) break;
      if (/^REVIEW COMMENTS$/i.test(ln)) continue;
      const cells = splitSsrsDataRow(ln);
      if (cells.length >= Math.max(4, maxCols - 2)) {
        dataIndices.push(i);
      }
    }
    if (dataIndices.length === 0) return null;

    return renderSsrsColumnTable(lines, headerIdx, headerCells, dataIndices);
  }

  /** When SSRS/Excel text is tab-separated rows (typical PGC export) and structured parse fails. */
  function renderTabularReportPreview(raw: string): React.ReactNode {
    const rows = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const dataRows = rows.filter((r) => r.includes("\t"));
    if (dataRows.length < 2) return null;
    const splitRow = (r: string) => r.split("\t").map((c) => c.trim());
    const maxCols = Math.max(...dataRows.map((r) => splitRow(r).length), 1);
    const cap = 400;
    const slice = dataRows.length > cap ? dataRows.slice(0, cap) : dataRows;
    return (
      <div className="overflow-x-auto rounded border border-border my-2">
        <table className="text-xs w-full border-collapse min-w-[480px]">
          <tbody>
            {slice.map((row, ri) => (
              <tr
                key={ri}
                className={ri % 2 === 0 ? "bg-muted/25" : "bg-muted/40"}
              >
                {Array.from({ length: maxCols }, (_, ci) => {
                  const cells = splitRow(row);
                  const cell = cells[ci] ?? "";
                  return (
                    <td
                      key={ci}
                      className="border border-border px-2 py-1.5 align-top text-foreground whitespace-pre-wrap max-w-[min(280px,40vw)] break-words"
                    >
                      {cell}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {dataRows.length > cap ? (
          <p className="text-xs text-muted-foreground px-2 py-1">
            Showing first {cap} of {dataRows.length} rows.
          </p>
        ) : null}
      </div>
    );
  }

  type ReviewCommentsRenderVariant = "pgc" | "washington" | "generic";

  function renderPgcStackedReviewCommentsTable(rows: PgcReviewCommentsRow[]) {
    const thClass =
      "text-left p-2 px-3 font-semibold text-primary border-r border-border align-top whitespace-pre-wrap max-w-[min(200px,28vw)]";
    const tdBase =
      "border border-border px-2 py-1.5 align-top text-foreground whitespace-pre-wrap";
    return (
      <div className="overflow-x-auto rounded border border-border my-2">
        <table className="text-xs w-full border-collapse min-w-[920px]">
          <thead>
            <tr className="bg-muted/40 border-b-2 border-border">
              <th className={thClass}>Ref #</th>
              <th className={thClass}>Cycle</th>
              <th className={thClass}>Reviewed by</th>
              <th className={thClass}>Date / time</th>
              <th className={thClass}>Type</th>
              <th className={thClass}>Filename</th>
              <th className={`${thClass} max-w-[min(360px,45vw)]`}>
                Discussion
              </th>
              <th className={`${thClass} whitespace-nowrap`}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                className={ri % 2 === 0 ? "bg-muted/25" : "bg-muted/40"}
              >
                <td className={`${tdBase} whitespace-nowrap`}>{row.ref}</td>
                <td className={`${tdBase} whitespace-nowrap`}>{row.cycle}</td>
                <td className={`${tdBase} max-w-[min(240px,32vw)] break-words`}>
                  {row.reviewedBy}
                </td>
                <td className={tdBase}>{row.dateTime}</td>
                <td className={tdBase}>{row.type}</td>
                <td className={`${tdBase} max-w-[min(200px,28vw)] break-words`}>
                  {row.filename}
                </td>
                <td className={`${tdBase} max-w-[min(360px,45vw)] break-words`}>
                  {row.discussion}
                </td>
                <td className={tdBase}>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderReviewComments(
    text: string,
    variant: ReviewCommentsRenderVariant,
    reviewCtx?: { fileName?: string | null },
  ): React.ReactNode {
    if (!text) return null;

    const isPgcReviewCommentsReport =
      variant === "pgc" &&
      isPgcEplan &&
      String(reviewCtx?.fileName ?? "").includes("Review Comments");

    if (isPgcReviewCommentsReport) {
      const parsed = parsePgcReviewComments(text);
      if (parsed.ok && parsed.rows.length > 0) {
        return renderPgcStackedReviewCommentsTable(parsed.rows);
      }
      return (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Could not parse this PGC Review Comments layout into rows. Showing
            raw extracted text.
          </p>
          <pre className="text-xs bg-card text-foreground p-3 rounded border border-border overflow-auto max-h-[min(60vh,520px)] whitespace-pre-wrap break-words">
            {text.length > 120_000
              ? `${text.slice(0, 120_000)}\n\n[truncated]`
              : text}
          </pre>
        </div>
      );
    }

    const comments = parseReviewComments(text);

    /** PGC exports are often space-aligned, not tab-separated — renderTabularReportPreview returns null. Single renderReportContent avoids duplicate blocks + misleading italic. */
    if (variant === "pgc" && comments.length === 0) {
      const ssrsTable = renderSsrsTabSeparatedTable(text);
      return ssrsTable ?? renderReportContent(text);
    }

    const elements: React.ReactNode[] = [];
    let keyInc = 0;

    const rcSectionIdx = text.indexOf("REVIEW COMMENTS");
    if (rcSectionIdx > 0) {
      const beforeRC = text.substring(0, rcSectionIdx);
      const skipBeforeDuplicate =
        variant === "pgc" && beforeRC.includes("\t");
      if (!skipBeforeDuplicate) {
        elements.push(
          <div key={keyInc++}>{renderReportContent(beforeRC)}</div>,
        );
      }
    }

    elements.push(
      <div
        key={keyInc++}
        className="text-center text-sm font-bold tracking-wider text-foreground bg-muted/40 py-2 my-4 border-y border-border"
      >
        REVIEW COMMENTS
      </div>,
    );

    if (comments.length === 0) {
      const tabular = renderTabularReportPreview(text);
      const showPgcTabularWithoutMisleadingNote =
        variant === "pgc" && tabular != null;
      if (!showPgcTabularWithoutMisleadingNote) {
        const emptyParseMessage =
          variant === "pgc"
            ? "No structured comment blocks detected in this export. Showing tabular or formatted preview when available."
            : variant === "washington"
              ? "No structured comment blocks found (expected Washington-style STATUS section). Showing tabular or formatted preview when available."
              : "No structured comment blocks detected. Showing tabular or formatted preview when available.";
        elements.push(
          <p key={keyInc++} className="text-sm text-muted-foreground italic py-2">
            {emptyParseMessage}
          </p>,
        );
      }
      if (tabular) {
        elements.push(<div key={keyInc++}>{tabular}</div>);
        elements.push(
          <details key={keyInc++} className="mt-2 text-xs">
            <summary className="cursor-pointer select-none text-muted-foreground hover:text-primary">
              Show raw extracted text
            </summary>
            <pre className="mt-2 p-3 bg-muted/40 rounded border border-border overflow-auto max-h-64 whitespace-pre-wrap text-foreground">
              {text.length > 120_000 ? `${text.slice(0, 120_000)}\n\n[truncated]` : text}
            </pre>
          </details>,
        );
      } else {
        elements.push(
          <div key={keyInc++} className="max-h-96 overflow-y-auto">
            {renderReportContent(text)}
          </div>,
        );
      }
    }

    comments.forEach((comment) => {
      elements.push(
        <div key={keyInc++} className="border rounded-lg mb-3 overflow-hidden">
          <div className="flex items-center justify-between bg-muted/40 px-4 py-2 border-b border-border flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="bg-primary text-primary-foreground text-xs font-bold px-2.5 py-1 rounded-full">
                #{comment.ref}
              </span>
              {comment.cycle && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  Cycle {comment.cycle}
                </span>
              )}
              {comment.department && (
                <span className="bg-muted text-foreground text-xs font-semibold px-2 py-0.5 rounded">
                  {comment.department}
                </span>
              )}
              {comment.reviewer && (
                <span className="text-sm text-foreground font-medium">
                  {comment.reviewer}
                </span>
              )}
              {comment.date && (
                <span className="text-xs text-muted-foreground">{comment.date}</span>
              )}
            </div>
            {comment.status && (
              <span
                className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${
                  comment.status === "Resolved"
                    ? "bg-success/15 text-success"
                    : comment.status === "Unresolved"
                      ? "bg-destructive/15 text-destructive"
                      : comment.status === "Info Only"
                        ? "bg-warning/15 text-warning"
                        : "bg-primary/10 text-primary"
                }`}
              >
                {comment.status}
              </span>
            )}
          </div>
          <div className="px-4 py-3 space-y-1">
            {comment.body.map((line, idx) => {
              if (
                line.startsWith("Responded by:") ||
                line.startsWith("Reviewer Response:")
              ) {
                return (
                  <div
                    key={idx}
                    className="text-sm font-semibold text-primary mt-3 pt-2 border-t border-dashed border-border"
                  >
                    {line}
                  </div>
                );
              }
              if (line === "---") {
                return <hr key={idx} className="my-2 border-border" />;
              }
              return (
                <p key={idx} className="text-sm text-foreground leading-relaxed">
                  {line}
                </p>
              );
            })}
          </div>
        </div>,
      );
    });

    const footerMatch = text.match(/Created in ProjectDox[^\n]*/);
    if (footerMatch) {
      elements.push(
        <p
          key={keyInc++}
          className="text-xs text-muted-foreground mt-4 pt-2 border-t border-border italic"
        >
          {footerMatch[0]}
        </p>,
      );
    }

    return <>{elements}</>;
  }

  const displayPortalStatus = normalizeRepeatedStatusLabel(
    portalData.dashboardStatus ?? portalStatus,
  );

  return (
    <>
      <Section variant="cream" className="pt-12 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/dashboard")}
            data-testid="button-back-to-dashboard"
            className={cn(
              PORTAL_ACTION_BUTTON_LIGHT_OUTLINE,
              "mb-3 -ml-1 border-transparent bg-transparent shadow-none hover:bg-cream-sunken",
            )}
          >
            <ArrowLeft />
            Back to Dashboard
          </Button>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="min-w-0">
              <Eyebrow>PORTAL DATA</Eyebrow>
              <h1 className="mt-3 font-serif text-4xl sm:text-5xl text-ink-primary-light leading-tight">
                Portal Data <em className="text-gold italic">Viewer</em>
              </h1>
              <p className="mt-3 text-ink-secondary-light max-w-2xl text-sm sm:text-base leading-relaxed">
                Review extracted permit information, reports, attachments, screenshots, and jurisdiction-specific portal data.
              </p>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mt-8">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-serif text-ink-primary-light font-normal">
                      {portalData.projectNum}
                    </h2>
                    {loading && (
                      <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary-light" />
                    )}
                  </div>
                  {portalData.description && (
                    <p className="text-ink-secondary-light mt-1 max-w-2xl text-sm">
                      {portalData.description}
                    </p>
                  )}
                  {portalData.location && (
                    <p className="text-sm text-ink-tertiary-light mt-0.5">
                      {portalData.location}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {displayPortalStatus && (
                      <span className="inline-flex items-center rounded-full border border-gold/25 bg-gold-soft/70 px-3 py-1 text-xs font-semibold text-ink-primary-light">
                        {displayPortalStatus}
                      </span>
                    )}
                    {lastCheckedStr && (
                      <span className="text-sm text-ink-tertiary-light">
                        {lastCheckedStr}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {scrape.isScraping && (
                <span
                  className="text-xs text-teal flex items-center gap-1"
                  data-testid="text-auto-refresh-active"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Auto-refreshing
                </span>
              )}
              <Button
                variant="outline"
                onClick={handleManualRefresh}
                disabled={refreshing}
                data-testid="button-refresh-portal-data"
                className={
                  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-gold/60 bg-transparent px-3.5 text-sm font-semibold text-gold-deep shadow-none transition-colors hover:bg-gold hover:text-cream hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:cursor-not-allowed disabled:border-cream-sunken disabled:bg-cream-raised disabled:text-ink-tertiary-light disabled:opacity-70 [&_svg]:h-4 [&_svg]:w-4"
                }
              >
                {refreshing ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCw />
                )}
                {refreshing ? "Refreshing..." : "Refresh Data"}
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <div className="mt-10 bg-cream border-b border-cream-raised">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
      <Tabs defaultValue="info" className="w-full">
        <TabsList className="h-auto w-full flex flex-wrap gap-2 bg-transparent p-0 py-4 justify-start border-0 rounded-none text-ink-secondary-light">
          <TabsTrigger value="info" className={PORTAL_TAB_TRIGGER}>
            Info
          </TabsTrigger>
          {hasStatusTab && (
            <TabsTrigger value="status" className={PORTAL_TAB_TRIGGER}>
              Status
            </TabsTrigger>
          )}
          {hasTasksTab && (
            <TabsTrigger value="tasks" className={PORTAL_TAB_TRIGGER}>
              Tasks
            </TabsTrigger>
          )}
          {hasReviewTab && (
            <TabsTrigger
              value="review"
              className={PORTAL_TAB_TRIGGER}
              data-testid="tab-review"
            >
              Review
            </TabsTrigger>
          )}
          <TabsTrigger value="reports" className={PORTAL_TAB_TRIGGER}>
            Reports
          </TabsTrigger>
          {filesTab || liveFileResults.active ? (
            <TabsTrigger
              value="files"
              className={PORTAL_TAB_TRIGGER}
              data-testid="tab-files"
            >
              Files
              {liveFileResults.active ? (
                <Badge className="ml-2 border border-teal/30 bg-teal/10 text-[10px] text-teal">
                  Live
                </Badge>
              ) : null}
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="info" className="mt-8 pt-6 pb-10 bg-cream focus-visible:outline-none">
          <Card className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream overflow-hidden">
            <CardContent className="p-0">
              <TabErrorBoundary tabName="Info">
                <>
                {infoTab?.error ? (
                  <div className="p-4 text-destructive flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {infoTab?.error}
                  </div>
                ) : hasInfoData || hasInfoFallbackForPgc ? (
                  <div className="p-4 space-y-6">
                    {!isPgcEplan && displayProjectInfo.length > 0 && (
                      <div className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream overflow-hidden">
                        <div className="border-b border-cream-sunken px-6 py-5">
                          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gold">
                            PROJECT INFO
                          </div>
                          <h2 className="mt-2 font-serif text-3xl sm:text-4xl text-ink-primary-light leading-tight">
                            Project <em className="text-gold italic">Details</em>
                          </h2>
                        </div>
                        <div className="overflow-x-auto">
                          <div className="min-w-0">
                            <div className="grid grid-cols-3 border-b border-cream-sunken bg-cream">
                              <div className="col-span-1 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-light">
                                Field
                              </div>
                              <div className="col-span-2 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-light">
                                Value
                              </div>
                            </div>
                          {displayProjectInfo.map((kv, i) => (
                            <div
                              key={`${kv.key}-${i}`}
                              className={`grid grid-cols-3 border-t border-cream-sunken last:border-b-0 hover:bg-cream-raised/50 transition-colors ${
                                i % 2 === 0 ? "bg-cream" : "bg-cream-raised/40"
                              }`}
                            >
                              <div className="col-span-1 w-1/3 min-w-[140px] px-4 py-3 text-sm font-medium text-ink-primary-light bg-cream-raised/60 border-r border-cream-sunken">
                                {kv.key}
                              </div>
                              <div
                                className={`col-span-2 px-4 py-3 text-sm text-ink-primary-light ${
                                  kv.key === "Description"
                                    ? "whitespace-normal break-words"
                                    : ""
                                }`}
                              >
                                {isPgcEplan
                                  ? kv.value
                                  : kv.value.trim() !== ""
                                    ? kv.value
                                    : <span className="text-ink-tertiary-light/60">—</span>}
                              </div>
                            </div>
                          ))}
                          </div>
                        </div>
                      </div>
                    )}
                    {!isPgcEplan &&
                      displayProjectInfo.length === 0 &&
                      hasInfoFallbackForPgc && (
                        <div className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream overflow-hidden">
                          <div className="border-b border-cream-sunken px-6 py-5">
                            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-gold">
                              PROJECT SUMMARY
                            </div>
                            <h2 className="mt-2 font-serif text-3xl sm:text-4xl text-ink-primary-light leading-tight">
                              Portal <em className="text-gold italic">Summary</em>
                            </h2>
                          </div>
                          <div className="overflow-x-auto">
                            <div className="min-w-0">
                              <div className="grid grid-cols-3 border-b border-cream-sunken bg-cream">
                                <div className="col-span-1 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-light">
                                  Field
                                </div>
                                <div className="col-span-2 px-4 py-3 text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-light">
                                  Value
                                </div>
                              </div>
                            {pgcInfoFallbackRows.map((kv, i) => (
                              <div
                                key={`${kv.key}-${i}`}
                                className={`grid grid-cols-3 border-t border-cream-sunken last:border-b-0 hover:bg-cream-raised/50 transition-colors ${
                                  i % 2 === 0 ? "bg-cream" : "bg-cream-raised/40"
                                }`}
                              >
                                <div className="col-span-1 px-4 py-3 text-sm font-medium text-ink-primary-light bg-cream-raised/60 border-r border-cream-sunken">
                                  {kv.key}
                                </div>
                                <div className="col-span-2 px-4 py-3 text-sm text-ink-primary-light">
                                  {kv.value.trim() !== "" ? kv.value : <span className="text-ink-tertiary-light/60">—</span>}
                                </div>
                              </div>
                            ))}
                            </div>
                          </div>
                        </div>
                      )}
                    {!isPgcEplan &&
                      infoTab?.keyValues &&
                      infoTab?.keyValues?.length > 0 &&
                      displayProjectInfo.length === 0 && (
                        <div className="rounded-xl border border-cream-sunken overflow-hidden bg-cream">
                          {infoTab?.keyValues?.map((kv, i) => (
                            <div
                              key={i}
                              className={`flex border-t border-cream-raised first:border-t-0 last:border-b-0 hover:bg-cream-raised/50 transition-colors ${
                                i % 2 === 0 ? "bg-cream" : "bg-cream-raised/30"
                              }`}
                            >
                              <div className="w-1/3 min-w-[140px] px-4 py-3 text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-light bg-cream-raised/60 shrink-0 border-r border-cream-sunken">
                                {kv.key}
                              </div>
                              <div className="flex-1 px-4 py-3 text-sm text-ink-primary-light">
                                {kv.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    {filteredInfoTables.map((tbl, ti) => (
                      <div
                        key={ti}
                        className={`overflow-x-auto rounded-xl border border-cream-sunken bg-cream min-w-0 ${
                          ti === 0 &&
                          !infoTab?.keyValues?.length &&
                          displayProjectInfo.length === 0
                            ? ""
                            : "mt-4"
                        }`}
                      >
                        <Table className="min-w-[800px] w-full">
                          <TableHeader>
                            <TableRow className="bg-cream-raised hover:bg-cream-raised border-b border-cream-sunken">
                              {tbl.headers?.map((h, hi) => (
                                <TableHead
                                  key={hi}
                                  className="table-head-sticky text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-light font-normal whitespace-nowrap"
                                >
                                  {h}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {tbl.rows?.map((row, ri) => (
                              <TableRow
                                key={ri}
                                className={
                                  "border-t border-cream-raised hover:bg-cream-raised/60 transition-colors " +
                                  (ri % 2 === 1 ? "bg-cream-raised/35" : "bg-cream")
                                }
                              >
                                {tbl.headers?.map((h) => (
                                  <TableCell
                                    key={h}
                                    className="whitespace-nowrap text-ink-primary-light"
                                  >
                                    {row[h] ?? ""}
                                  </TableCell>
                                ))}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="p-4 text-ink-tertiary-light">
                    No info data available.
                  </p>
                )}
                {isPgcEplan && infoTab?.info_debug != null && (
                  <details className="p-4 border-t border-cream-sunken text-xs">
                    <summary className="cursor-pointer text-ink-tertiary-light select-none hover:text-ink-primary-light">
                      Info extraction debug
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-obsidian-raised bg-obsidian-sunken/90 p-3 font-mono text-ink-secondary-dark">
                      {JSON.stringify(infoTab.info_debug, null, 2)}
                    </pre>
                  </details>
                )}
                </>
              </TabErrorBoundary>
            </CardContent>
          </Card>
        </TabsContent>

        {hasStatusTab && (
          <TabsContent value="status" className="mt-8 pt-6 pb-10 bg-cream focus-visible:outline-none">
            <Card className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream overflow-hidden">
              <CardContent
                className={cn(
                  isPgcEplan || isWashingtonDcProjectDox ? "p-4 pt-4" : "p-0",
                )}
              >
                <TabErrorBoundary tabName="Status">
                  {statusTabData?.error ? (
                    <div className="p-4 text-destructive flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {statusTabData.error}
                    </div>
                  ) : isPgcEplan ? (
                    <PgcStatusTab
                      status={statusTabData as PgcStatusTabData}
                    />
                  ) : isWashingtonDcProjectDox ? (
                    <WashingtonStatusTabPanel
                      tab={statusTabData as TabData}
                      projectNum={portalData?.projectNum ?? null}
                    />
                  ) : (
                    <div className="p-4 space-y-4">
                      {isMdAvolveProjectDox &&
                        montgomeryStatusActionLinks.length > 0 && (
                          <div className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream p-5 space-y-2">
                            <p className="text-sm font-medium text-ink-primary-light">
                              Report actions
                            </p>
                            <div className="flex flex-col gap-3">
                              {(() => {
                                const seenViewerUrl = new Set<string>();
                                return montgomeryStatusActionLinks.map(
                                  (L, mi) => {
                                    const {
                                      viewerUrl,
                                      pdfUrl,
                                      excelUrl,
                                      showOpenViewer,
                                    } = getMontgomeryStatusLinkActionUrls(L);
                                    const label =
                                      (L.reportName &&
                                        String(L.reportName).trim()) ||
                                      (L.text && String(L.text).trim()) ||
                                      `Link ${mi + 1}`;
                                    let renderOpen = !!(
                                      showOpenViewer && viewerUrl
                                    );
                                    if (renderOpen && viewerUrl) {
                                      const v = viewerUrl.trim();
                                      if (seenViewerUrl.has(v)) renderOpen = false;
                                      else seenViewerUrl.add(v);
                                    }
                                    return (
                                      <div
                                        key={`mdc-st-${mi}`}
                                        className="flex flex-wrap items-center gap-2"
                                      >
                                        <span className="text-xs text-muted-foreground min-w-[8rem] max-w-[20rem] truncate">
                                          {label}
                                        </span>
                                        <div className="flex flex-wrap gap-2">
                                          {renderOpen && viewerUrl ? (
                                            <Button
                                              asChild
                                              variant="ghost"
                                              className={cn(
                                                PORTAL_ACTION_BUTTON_PRIMARY,
                                              )}
                                            >
                                              <a
                                                href={viewerUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                <FileText />
                                                Open viewer
                                              </a>
                                            </Button>
                                          ) : null}
                                          {pdfUrl ? (
                                            <Button
                                              asChild
                                              variant="ghost"
                                              className={cn(
                                                PORTAL_ACTION_BUTTON_OUTLINE,
                                              )}
                                            >
                                              <a
                                                href={pdfUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                Download PDF
                                              </a>
                                            </Button>
                                          ) : null}
                                          {excelUrl ? (
                                            <Button
                                              asChild
                                              variant="ghost"
                                              className={cn(
                                                PORTAL_ACTION_BUTTON_OUTLINE,
                                              )}
                                            >
                                              <a
                                                href={excelUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                Download Excel
                                              </a>
                                            </Button>
                                          ) : null}
                                        </div>
                                      </div>
                                    );
                                  },
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      {statusTabData?.keyValues &&
                        statusTabData.keyValues.length > 0 && (
                          <div className="rounded-xl border border-cream-sunken bg-cream shadow-cream overflow-hidden">
                            {statusTabData.keyValues.map((kv, i) => (
                              <div
                                key={`${kv.key}-${i}`}
                                className={`grid grid-cols-3 border-t border-cream-sunken first:border-t-0 ${
                                  i % 2 === 0 ? "bg-cream" : "bg-cream-raised/35"
                                }`}
                              >
                                <div className="col-span-1 px-3 py-2 text-sm font-semibold border-r border-cream-sunken bg-cream-raised/50 text-ink-primary-light">
                                  {kv.key}
                                </div>
                                <div className="col-span-2 px-3 py-2 text-sm text-ink-primary-light">
                                  {kv.value || "—"}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      {(statusTabData?.tables ?? []).map((tbl, ti) => {
                        const displayHeaders = statusTableDisplayHeaders(tbl);
                        return (
                          <div key={ti} className="overflow-x-auto rounded-xl border border-cream-sunken bg-cream shadow-cream">
                            <Table>
                              <TableHeader>
                                <TableRow className="border-b border-cream-sunken bg-cream hover:bg-cream">
                                  {displayHeaders.map((h, hi) => (
                                    <TableHead
                                      key={hi}
                                      className="text-[10px] font-mono uppercase tracking-[0.12em] text-ink-tertiary-light font-normal"
                                    >
                                      {h}
                                    </TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {tbl.rows?.map((row, ri) => (
                                  <TableRow
                                    key={ri}
                                    className={
                                      ri % 2 === 1
                                        ? "bg-cream-raised/35 border-t border-cream-sunken hover:bg-cream-raised/55"
                                        : "bg-cream border-t border-cream-sunken hover:bg-cream-raised/45"
                                    }
                                  >
                                    {displayHeaders.map((h, ci) => (
                                      <TableCell
                                        key={`${ri}-${ci}`}
                                        className="text-ink-primary-light"
                                      >
                                        {row[h] ?? ""}
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabErrorBoundary>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {hasTasksTab && (
          <TabsContent value="tasks" className="mt-8 pt-6 pb-10 bg-cream focus-visible:outline-none">
            <Card className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream overflow-hidden">
              <CardContent className="p-0">
                <TabErrorBoundary tabName="Tasks">
                  {tasksTabData?.error ? (
                    <div className="p-4 text-destructive flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {tasksTabData.error}
                    </div>
                  ) : (
                    <div className="p-4 space-y-4">
                      {tasksTabData?.keyValues &&
                        tasksTabData.keyValues.length > 0 && (
                          <div className="rounded-xl border border-cream-sunken bg-cream shadow-cream overflow-hidden">
                            {tasksTabData.keyValues.map((kv, i) => (
                              <div
                                key={`${kv.key}-${i}`}
                                className={`grid grid-cols-3 border-t border-cream-sunken first:border-t-0 ${
                                  i % 2 === 0 ? "bg-cream" : "bg-cream-raised/35"
                                }`}
                              >
                                <div className="col-span-1 px-3 py-2 text-sm font-semibold border-r border-cream-sunken bg-cream-raised/50 text-ink-primary-light">
                                  {kv.key}
                                </div>
                                <div className="col-span-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink-primary-light">
                                  {kv.value || "—"}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      {pgcTaskTablesForRender.map((tbl, ti) => (
                        <div key={ti} className="overflow-x-auto rounded-xl border border-cream-sunken bg-cream shadow-cream">
                          {isPgcEplan && tbl.title && (
                            <p className="text-sm font-semibold mb-2 px-4 pt-4 text-ink-primary-light">{tbl.title}</p>
                          )}
                          <Table wrapperClassName="!rounded-xl !border-cream-sunken !border !bg-cream !shadow-none dark:!border-cream-sunken">
                            <TableHeader>
                              <TableRow className="!border-cream-sunken border-b bg-cream hover:!bg-cream">
                                {tbl.headers?.map((h, hi) => (
                                  <TableHead
                                    key={hi}
                                    className="!text-ink-secondary-light text-[10px] font-mono font-medium uppercase tracking-[0.14em]"
                                  >
                                    {h}
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {tbl.rows?.map((row, ri) => (
                                <TableRow
                                  key={ri}
                                  className={
                                    ri % 2 === 1
                                      ? "border-t border-cream-sunken bg-cream-raised/50 hover:!bg-cream-raised/80"
                                      : "border-t border-cream-sunken bg-cream hover:!bg-cream-raised/65"
                                  }
                                >
                                  {tbl.headers?.map((h) => (
                                    <TableCell
                                      key={h}
                                      className="!text-ink-primary-light font-tight text-sm"
                                    >
                                      {row[h] ?? ""}
                                    </TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  )}
                </TabErrorBoundary>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {hasReviewTab && (
          <TabsContent value="review" className="mt-8 pt-6 pb-10 bg-cream focus-visible:outline-none">
            <Card>
              <CardContent className="p-4">
                <TabErrorBoundary tabName="Review">
                  {reviewTab?.error ? (
                    <div className="text-destructive flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {reviewTab.error}
                    </div>
                  ) : isPgcEplan && reviewWorkflowBuckets.length > 0 ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-muted-foreground shrink-0">
                          Workflow
                        </span>
                        {reviewWorkflowBuckets.map((wf) => {
                          const active =
                            (activePgcReviewWorkflow?.workflowName || "") ===
                            wf.workflowName;
                          return (
                            <Button
                              key={wf.workflowName}
                              type="button"
                              variant="ghost"
                              title={wf.workflowName}
                              onClick={() =>
                                setSelectedReviewWorkflow(wf.workflowName)
                              }
                              className={cn(
                                active
                                  ? PORTAL_ACTION_BUTTON_PRIMARY
                                  : PORTAL_ACTION_BUTTON_LIGHT_OUTLINE,
                                "max-w-[min(100%,20rem)] truncate",
                              )}
                            >
                              {wf.workflowName}
                            </Button>
                          );
                        })}
                      </div>
                      {activePgcReviewWorkflow &&
                        (activePgcReviewWorkflow.groupedItems?.length ?? 0) >
                          0 && (
                          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                              Active workflow
                            </p>
                            <p className="text-base font-semibold leading-snug text-foreground">
                              {activePgcReviewWorkflow.workflowName}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {activePgcReviewWorkflow.groupedItems?.length ?? 0}{" "}
                              review
                              {(activePgcReviewWorkflow.groupedItems?.length ??
                                0) === 1
                                ? ""
                                : "s"}{" "}
                              in this workflow
                            </p>
                          </div>
                        )}
                      {!activePgcReviewWorkflow ||
                      (activePgcReviewWorkflow.groupedItems?.length ?? 0) ===
                        0 ? (
                        <p className="text-sm text-muted-foreground">
                          No review rows for the selected workflow.
                        </p>
                      ) : (
                        <div className="space-y-3 max-w-full">
                          {activePgcReviewWorkflow.groupedItems.map((vm, i) => {
                            const link =
                              vm.fileOrMarkupUrl &&
                              /^https?:\/\//i.test(vm.fileOrMarkupUrl.trim())
                                ? vm.fileOrMarkupUrl.trim()
                                : null;
                            return (
                              <div
                                  key={`${activePgcReviewWorkflow.workflowName}-${i}`}
                                className="rounded-lg border border-border/60 bg-card p-3 shadow-sm space-y-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2 gap-y-2">
                                  <div className="flex flex-wrap gap-x-5 gap-y-2 min-w-0 flex-1">
                                    <div className="min-w-[5.5rem]">
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Ref #
                                      </div>
                                      <div className="text-xs font-medium tabular-nums">
                                        {vm.refNumber || "—"}
                                      </div>
                                    </div>
                                    <div className="min-w-[5.5rem]">
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Changemark
                                      </div>
                                      <div className="text-xs font-medium">
                                        {vm.changemarkNumber || "—"}
                                      </div>
                                    </div>
                                    <div className="min-w-[5.5rem]">
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Cycle
                                      </div>
                                      <div className="text-xs font-medium">
                                        {vm.cycle || "—"}
                                      </div>
                                    </div>
                                    <div className="min-w-[7rem]">
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Reviewer
                                      </div>
                                      <div className="text-xs font-medium break-words">
                                        {vm.reviewer || "—"}
                                      </div>
                                    </div>
                                    <div className="min-w-[8rem]">
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Date / time
                                      </div>
                                      <div className="text-xs font-medium break-words">
                                        {vm.datetime || "—"}
                                      </div>
                                    </div>
                                    <div className="min-w-[7rem]">
                                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                        Department
                                      </div>
                                      <div className="text-xs font-medium break-words">
                                        {vm.department || "—"}
                                      </div>
                                    </div>
                                  </div>
                                  {vm.status ? (
                                    <Badge
                                      variant="secondary"
                                      className="shrink-0 text-xs font-normal max-w-[12rem] truncate"
                                      title={vm.status}
                                    >
                                      {vm.status}
                                    </Badge>
                                  ) : null}
                                </div>
                                {vm.fileName ? (
                                  <div className="text-xs">
                                    <span className="text-muted-foreground">
                                      File:{" "}
                                    </span>
                                    <span className="break-all font-medium">
                                      {vm.fileName}
                                    </span>
                                  </div>
                                ) : null}
                                <div className="border-t border-border/40 pt-2">
                                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                                    Comment
                                  </div>
                                  <div className="text-sm text-foreground/95 whitespace-pre-wrap break-words leading-relaxed">
                                    {vm.commentText || "—"}
                                  </div>
                                </div>
                                {vm.responseText ? (
                                  <div className="border-t border-border/40 pt-2 bg-muted/30 -mx-3 px-3 pb-0.5 rounded-b-md">
                                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                                      Response
                                    </div>
                                    <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                                      {vm.responseText}
                                    </div>
                                  </div>
                                ) : null}
                                {link ? (
                                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/30 text-xs">
                                    <a
                                      href={link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-primary hover:underline inline-flex items-center gap-1"
                                    >
                                      <FileText className="h-3.5 w-3.5 shrink-0" />
                                      Open file / markup
                                    </a>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : corrections.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No review corrections in the latest cycle for this project.
                    </p>
                  ) : !isPgcEplan || reviewWorkflowBuckets.length === 0 ? (
                    <div className="overflow-x-auto max-h-[min(70vh,720px)] overflow-y-auto rounded-md border border-border/60">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40">
                            <TableHead className="table-head-sticky">Ref</TableHead>
                            <TableHead className="table-head-sticky">Type</TableHead>
                            <TableHead className="table-head-sticky">Status</TableHead>
                            <TableHead className="table-head-sticky">Department</TableHead>
                            <TableHead className="table-head-sticky">File</TableHead>
                            {!isPgcEplan && <TableHead className="table-head-sticky">Markup</TableHead>}
                            <TableHead className="table-head-sticky">Comment</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {corrections.map((c, i) => {
                            const ctype = (c.correctionType || "").toLowerCase();
                            const typeLabel =
                              ctype.includes("change") ||
                              ctype.includes("markup")
                                ? "Changemark"
                                : ctype.includes("comment")
                                  ? "Comment"
                                  : c.correctionType || "—";
                            const markupHref =
                              c.markupPdfPublicUrl ||
                              (c.markupPdfUrl &&
                              String(c.markupPdfUrl).startsWith("http")
                                ? c.markupPdfUrl
                                : null);
                            const snippet = (c.commentText || "").slice(0, 200);
                            return (
                              <TableRow
                                key={c.correctionID || i}
                                className={
                                  i % 2 === 1 ? "bg-muted/40" : "bg-muted/25"
                                }
                              >
                                <TableCell className="whitespace-nowrap font-mono-data tabular-nums text-xs">
                                  {c.referenceNumber || c.correctionID || "—"}
                                </TableCell>
                                <TableCell>{typeLabel}</TableCell>
                                <TableCell>{c.statusName || "—"}</TableCell>
                                <TableCell className="max-w-[140px] truncate">
                                  {c.department || "—"}
                                </TableCell>
                                <TableCell className="max-w-[160px] truncate text-xs">
                                  {c.fileName || "—"}
                                </TableCell>
                                {!isPgcEplan && (
                                  <TableCell>
                                    {markupHref ? (
                                      <a
                                        href={markupHref}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary hover:underline text-sm"
                                      >
                                        PDF
                                      </a>
                                    ) : (
                                      "—"
                                    )}
                                  </TableCell>
                                )}
                                <TableCell className="max-w-xs text-xs whitespace-pre-wrap">
                                  {snippet || "—"}
                                  {(c.commentText || "").length > 200
                                    ? "…"
                                    : ""}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </TabErrorBoundary>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent
          value="reports"
          className="mt-8 pt-0 pb-0 bg-obsidian text-ink-primary-dark focus-visible:outline-none"
        >
          <Section variant="obsidian" className="py-10 sm:py-14 px-4 sm:px-6 md:px-8">
            <div className="max-w-7xl mx-auto">
              <EyebrowDark className="mb-2">REPORTS</EyebrowDark>
              <h2 className="mt-2 font-serif text-3xl sm:text-4xl text-ink-primary-dark">
                Extracted <em className="text-gold italic">Reports</em>
              </h2>
              <p className="mt-3 text-ink-secondary-dark max-w-2xl text-sm sm:text-base leading-relaxed">
                Stored report artifacts, live viewer links, screenshots, and extracted text used by the AI pipeline.
              </p>
              <p className="text-sm text-ink-secondary-dark/90 mb-6 mt-4">
            Source data from the portal. For an actionable comment list and
            responses, use <strong className="text-ink-primary-dark font-semibold">Comment Review</strong>.
          </p>
          <Card className="border border-obsidian-raised bg-obsidian-raised/50 shadow-none">
            <CardContent className="p-0">
              <TabErrorBoundary tabName="Reports">
                {reportsTab?.error ? (
                  <div className="p-4 text-destructive flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {reportsTab?.error}
                  </div>
                ) : showWashingtonReportsTable ||
                  reportEntries.length > 0 ? (
                  <>
                    {showWashingtonReportsTable ? (
                  (() => {
                    const rh = reportsTable.headers ?? [];
                    const statusCol = rh.find((h) =>
                      /^status$/i.test(String(h).trim()),
                    );
                    return (
                    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-obsidian-raised bg-obsidian-raised/50">
                    <div className="grid w-full min-w-0 grid-cols-[1fr_minmax(120px,140px)_80px] items-center gap-2 border-b border-obsidian-raised px-5 py-3">
                      <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark">
                        Report Name
                      </div>
                      <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-ink-tertiary-dark">
                        Status
                      </div>
                      <div className="justify-self-end" aria-hidden />
                    </div>
                      {reportsRows.map((row, ri) => {
                        const reportName = String(
                          row["REPORT NAME"] ?? row["Report Name"] ?? "",
                        );
                        const isExpanded = expandedReport === reportName;
                        const pdf = findPdfForReport(reportName);
                        const hasError = pdf?.error;
                        const rowEntry = isMdAvolveProjectDox
                          ? findMontgomeryReportEntryForRow(
                              reportEntryByReportName,
                              reportEntries,
                              reportName,
                            )
                          : null;

                        const statusRaw = statusCol ? row[statusCol] ?? "" : "";
                        const statusLabel = statusCol
                          ? isMdAvolveProjectDox && rowEntry
                            ? montgomeryReportStatusForRow(
                                String(statusRaw),
                                rowEntry,
                              ).text
                            : String(statusRaw).trim() || "—"
                          : "—";

                        return (
                          <Collapsible
                            key={ri}
                            open={isExpanded}
                            onOpenChange={(open) =>
                              setExpandedReport(open ? reportName : null)
                            }
                          >
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className={`grid w-full min-w-0 grid-cols-[1fr_minmax(120px,140px)_80px] items-center gap-2 border-b border-obsidian-raised px-5 py-4 text-left transition-colors ${ri % 2 === 1 ? "bg-obsidian-sunken/40 hover:bg-obsidian-sunken/60" : "bg-obsidian/80 hover:bg-obsidian-raised/45"}`}
                              >
                                <span className="truncate text-sm font-medium text-ink-primary-dark">
                                  {reportName}
                                </span>
                                <span className="text-sm text-ink-secondary-dark">
                                  {statusLabel}
                                </span>
                                <span className="flex justify-end text-ink-tertiary-dark">
                                  {isExpanded ? (
                                    <ChevronDown
                                      className="h-4 w-4 shrink-0"
                                      aria-hidden
                                    />
                                  ) : (
                                    <ChevronRight
                                      className="h-4 w-4 shrink-0"
                                      aria-hidden
                                    />
                                  )}
                                </span>
                              </button>
                            </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="w-full border-b border-obsidian-raised bg-obsidian-sunken/50 p-4">
                                      <Card className="rounded-xl border border-gold/25 bg-obsidian-raised/70 p-5 shadow-none">
                                        <CardHeader className="space-y-0 p-0 pb-4">
                                          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0 flex-1">
                                              <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="font-serif text-2xl text-ink-primary-dark">
                                              {reportName}
                                            </h3>
                                              {hasError &&
                                                (() => {
                                                  const soft =
                                                    isMdAvolveProjectDox &&
                                                    rowEntry &&
                                                    (isHttpUrlCandidate(
                                                      rowEntry.viewerUrl,
                                                    ) ||
                                                      isHttpUrlCandidate(
                                                        rowEntry.reportUrl,
                                                      ) ||
                                                      isHttpUrlCandidate(
                                                        rowEntry.pdfUrl,
                                                      ) ||
                                                      isHttpUrlCandidate(
                                                        rowEntry.excelUrl,
                                                      ));
                                                  return (
                                                    <Badge
                                                      variant={
                                                        soft
                                                          ? "outline"
                                                          : "destructive"
                                                      }
                                                      className="text-xs"
                                                    >
                                                      {soft
                                                        ? "No preview text"
                                                        : "Error"}
                                                    </Badge>
                                                  );
                                                })()}
                                              </div>
                                            </div>
                                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                                              {isPgcEplan
                                                ? (() => {
                                                    const ent =
                                                      reportEntryByReportName.get(
                                                        reportName,
                                                      );
                                                    const viewerHref =
                                                      ent &&
                                                      (isHttpUrlCandidate(
                                                        ent.viewerUrl,
                                                      )
                                                        ? String(
                                                            ent.viewerUrl,
                                                          ).trim()
                                                        : isHttpUrlCandidate(
                                                            ent.reportUrl,
                                                          )
                                                          ? String(
                                                              ent.reportUrl,
                                                            ).trim()
                                                          : null);
                                                    return (
                                                      <>
                                                        {viewerHref ? (
                                                          <Button
                                                            asChild
                                                            variant="ghost"
                                                            className={cn(
                                                              PORTAL_ACTION_BUTTON_PRIMARY,
                                                            )}
                                                          >
                                                            <a
                                                              href={viewerHref}
                                                              target="_blank"
                                                              rel="noreferrer"
                                                              title="Open SSRS ReportViewer in ePlan (original layout)"
                                                            >
                                                              <FileText />
                                                              Open viewer
                                                            </a>
                                                          </Button>
                                                        ) : null}
                                                        {ent?.pdfUrl ? (
                                                          <Button
                                                            asChild
                                                            variant="ghost"
                                                            className={cn(
                                                              PORTAL_ACTION_BUTTON_OUTLINE,
                                                            )}
                                                          >
                                                            <a
                                                              href={ent.pdfUrl}
                                                              target="_blank"
                                                              rel="noreferrer"
                                                              title="PDF exported from SSRS and stored for this project (binary file)"
                                                            >
                                                              <FileText />
                                                              Download PDF
                                                            </a>
                                                          </Button>
                                                        ) : null}
                                                        {ent?.excelUrl ? (
                                                          <Button
                                                            asChild
                                                            variant="ghost"
                                                            className={cn(
                                                              PORTAL_ACTION_BUTTON_OUTLINE,
                                                            )}
                                                          >
                                                            <a
                                                              href={
                                                                ent.excelUrl
                                                              }
                                                              target="_blank"
                                                              rel="noreferrer"
                                                              title="Excel export from SSRS (not a substitute for the PDF)"
                                                            >
                                                              Download Excel
                                                            </a>
                                                          </Button>
                                                        ) : null}
                                                      </>
                                                    );
                                                  })()
                                                : isMdAvolveProjectDox
                                                  ? (() => {
                                                      const ent =
                                                        findMontgomeryReportEntryForRow(
                                                          reportEntryByReportName,
                                                          reportEntries,
                                                          reportName,
                                                        );
                                                      if (!ent) return null;
                                                      const {
                                                        viewerUrl: viewerHref,
                                                        pdfUrl: pdfHref,
                                                        excelUrl: xlHref,
                                                        showOpenViewer,
                                                      } =
                                                        getMontgomeryReportEntryActionUrls(
                                                          ent,
                                                        );
                                                      return (
                                                        <>
                                                          {showOpenViewer &&
                                                          viewerHref ? (
                                                            <Button
                                                              asChild
                                                              variant="ghost"
                                                              className={cn(
                                                                PORTAL_ACTION_BUTTON_PRIMARY,
                                                              )}
                                                            >
                                                              <a
                                                                href={viewerHref}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                              >
                                                                <FileText />
                                                                Open viewer
                                                              </a>
                                                            </Button>
                                                          ) : null}
                                                          {pdfHref ? (
                                                            <Button
                                                              asChild
                                                              variant="ghost"
                                                              className={cn(
                                                                PORTAL_ACTION_BUTTON_OUTLINE,
                                                              )}
                                                            >
                                                              <a
                                                                href={pdfHref}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                              >
                                                                <FileText />
                                                                Download PDF
                                                              </a>
                                                            </Button>
                                                          ) : null}
                                                          {xlHref ? (
                                                            <Button
                                                              asChild
                                                              variant="ghost"
                                                              className={cn(
                                                                PORTAL_ACTION_BUTTON_OUTLINE,
                                                              )}
                                                            >
                                                              <a
                                                                href={xlHref}
                                                                target="_blank"
                                                                rel="noreferrer"
                                                              >
                                                                Download Excel
                                                              </a>
                                                            </Button>
                                                          ) : null}
                                                        </>
                                                      );
                                                    })()
                                                  : null}
                                              {!isMdAvolveProjectDox &&
                                                reportName &&
                                                reportName.includes(
                                                  "Review Comments",
                                                ) && (
                                                  <Button
                                                    variant="ghost"
                                                    className={cn(
                                                      PORTAL_ACTION_BUTTON_AI,
                                                    )}
                                                    onClick={() =>
                                                      navigate(
                                                        "/comment-review",
                                                        {
                                                          state: {
                                                            fromReports: true,
                                                          },
                                                        },
                                                      )
                                                    }
                                                  >
                                                    <ListChecks />
                                                    Open Comment Review
                                                  </Button>
                                                )}
                                            </div>
                                          </div>
                                        </CardHeader>
                                        <CardContent className="pt-0">
                                          {hasError ? (
                                            <p className="text-sm text-destructive">
                                              {pdf?.error}
                                            </p>
                                          ) : pdf?.screenshot ? (
                                            <div>
                                              <p className="text-xs text-muted-foreground mb-2">
                                                Compressed preview (storage-sized). Click
                                                for full reading view — text or portal link
                                                when available.
                                              </p>
                                              <div
                                                className="overflow-auto rounded-lg border border-obsidian-raised bg-obsidian-sunken cursor-pointer transition-all hover:ring-1 hover:ring-gold/40"
                                                style={{ maxHeight: "420px" }}
                                                onClick={() => {
                                                  setReportReaderOpen({
                                                    reportName,
                                                    pdf,
                                                  });
                                                }}
                                                data-testid={`img-report-${reportName}`}
                                                role="button"
                                                tabIndex={0}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter" || e.key === " ")
                                                    setReportReaderOpen({
                                                      reportName,
                                                      pdf,
                                                    });
                                                }}
                                              >
                                                <img
                                                  src={`data:image/png;base64,${pdf.screenshot}`}
                                                  alt={reportName}
                                                  className="w-full pointer-events-none"
                                                />
                                              </div>
                                              {pdf.text && (
                                                <ReportsExtractedTextDetails
                                                  text={pdf.text}
                                                />
                                              )}
                                            </div>
                                          ) : pdf?.text ? (
                                            isMontgomeryProjectDox ? (
                                              <ReportsExtractedTextDetails
                                                text={pdf.text}
                                                testId="montgomery-report-extracted-text"
                                              />
                                            ) : (
                                              <div className="space-y-3">
                                                <div className="max-h-96 overflow-y-auto rounded-md border border-border bg-card p-4">
                                                  {!isMdAvolveProjectDox &&
                                                  pdf.fileName?.includes(
                                                    "Review Comments",
                                                  )
                                                    ? renderReviewComments(
                                                        getReviewCommentsDisplayTextForPortal(
                                                          pdf,
                                                        ),
                                                        isPgcEplan
                                                          ? "pgc"
                                                          : isWashingtonDcProjectDox
                                                            ? "washington"
                                                            : "generic",
                                                        { fileName: pdf.fileName },
                                                      )
                                                    : renderReportContent(
                                                        pdf.text,
                                                      )}
                                                </div>
                                                {isPgcEplan &&
                                                  pdf.fileName?.includes(
                                                    "Review Comments",
                                                  ) &&
                                                  String(pdf.text ?? "").trim() ? (
                                                  <ReportsExtractedTextDetails
                                                    text={pdf.text}
                                                    summaryLabel="Raw extracted text (stored — copyable)"
                                                    testId="pgc-review-comments-raw-text"
                                                  />
                                                ) : null}
                                              </div>
                                            )
                                          ) : (
                                            <p className="text-sm text-muted-foreground">
                                              {isMdAvolveProjectDox &&
                                              rowEntry &&
                                              (isHttpUrlCandidate(
                                                rowEntry.viewerUrl,
                                              ) ||
                                                isHttpUrlCandidate(
                                                  rowEntry.reportUrl,
                                                ) ||
                                                isHttpUrlCandidate(
                                                  rowEntry.pdfUrl,
                                                ) ||
                                                isHttpUrlCandidate(
                                                  rowEntry.excelUrl,
                                                ))
                                                ? "No extracted preview in portal data. Use the buttons above to open the viewer or files."
                                                : "No content available."}
                                            </p>
                                          )}
                                        </CardContent>
                                      </Card>
                                </div>
                              </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                    );
                  })()
                    ) : (
                      <div className="w-full space-y-4 p-4">
                        {reportEntries.map((entry, idx) => {
                          if (isMdAvolveProjectDox) {
                            const {
                              viewerUrl: viewerCardHref,
                              pdfUrl: pdfCardHref,
                              excelUrl: xlCardHref,
                              showOpenViewer: showViewerCard,
                            } = getMontgomeryReportEntryActionUrls(entry);
                            return (
                              <Card
                                key={`${entry.fileSlug ?? entry.reportName}-${idx}`}
                                className="w-full border border-obsidian-raised bg-obsidian-sunken/20 text-ink-primary-dark shadow-none"
                              >
                                <CardHeader className="pb-2">
                                  <CardTitle className="text-base">
                                    {entry.reportName}
                                  </CardTitle>
                                  <p className="text-xs text-muted-foreground font-normal pt-1">
                                    {montgomeryReportStatusLabelFromEntry(
                                      entry,
                                    )}
                                  </p>
                                </CardHeader>
                                <CardContent className="flex flex-wrap gap-2 pt-0">
                                  {showViewerCard && viewerCardHref ? (
                                    <Button
                                      asChild
                                      variant="ghost"
                                      className={cn(PORTAL_ACTION_BUTTON_PRIMARY)}
                                    >
                                      <a
                                        href={viewerCardHref}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        <FileText />
                                        Open viewer
                                      </a>
                                    </Button>
                                  ) : null}
                                  {pdfCardHref ? (
                                    <Button
                                      asChild
                                      variant="ghost"
                                      className={cn(PORTAL_ACTION_BUTTON_OUTLINE)}
                                    >
                                      <a
                                        href={pdfCardHref}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        <FileText />
                                        Download PDF
                                      </a>
                                    </Button>
                                  ) : null}
                                  {xlCardHref ? (
                                    <Button
                                      asChild
                                      variant="ghost"
                                      className={cn(PORTAL_ACTION_BUTTON_OUTLINE)}
                                    >
                                      <a
                                        href={xlCardHref}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Download Excel
                                      </a>
                                    </Button>
                                  ) : null}
                                  {!(
                                    (showViewerCard && viewerCardHref) ||
                                    pdfCardHref ||
                                    xlCardHref
                                  ) ? (
                                    <span className="text-xs text-muted-foreground self-center">
                                      No viewer or export URLs in saved data
                                      yet.
                                    </span>
                                  ) : null}
                                </CardContent>
                              </Card>
                            );
                          }
                          return (
                            <Card
                              key={`${entry.fileSlug ?? entry.reportName}-${idx}`}
                              className="w-full border border-obsidian-raised bg-obsidian-sunken/20 text-ink-primary-dark shadow-none"
                            >
                              <CardHeader className="pb-2">
                                <CardTitle className="text-base">
                                  {entry.reportName}
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="flex flex-wrap gap-2 pt-0">
                                {isPgcEplan &&
                                  (isHttpUrlCandidate(entry.viewerUrl) ||
                                    isHttpUrlCandidate(entry.reportUrl)) && (
                                    <Button
                                      asChild
                                      variant="ghost"
                                      className={cn(PORTAL_ACTION_BUTTON_PRIMARY)}
                                    >
                                      <a
                                        href={
                                          isHttpUrlCandidate(entry.viewerUrl)
                                            ? String(entry.viewerUrl).trim()
                                            : String(entry.reportUrl).trim()
                                        }
                                        target="_blank"
                                        rel="noreferrer"
                                        title="Open SSRS ReportViewer in ePlan (original layout)"
                                      >
                                        <FileText />
                                        Open viewer
                                      </a>
                                    </Button>
                                  )}
                                {entry.pdfUrl ? (
                                  <Button
                                    asChild
                                    variant="ghost"
                                    className={cn(PORTAL_ACTION_BUTTON_OUTLINE)}
                                  >
                                    <a
                                      href={entry.pdfUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="PDF exported from SSRS and stored for this project (binary file)"
                                    >
                                      <FileText />
                                      Download PDF
                                    </a>
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground self-center">
                                    PDF not available
                                  </span>
                                )}
                                {entry.excelUrl ? (
                                  <Button
                                    asChild
                                    variant="ghost"
                                    className={cn(PORTAL_ACTION_BUTTON_OUTLINE)}
                                  >
                                    <a
                                      href={entry.excelUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      title="Excel export from SSRS (not a substitute for the PDF)"
                                    >
                                      Download Excel
                                    </a>
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground self-center">
                                    Excel not available
                                  </span>
                                )}
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="p-4 text-muted-foreground">
                    No reports data available.
                  </p>
                )}
              </TabErrorBoundary>
            </CardContent>
          </Card>
            </div>
          </Section>
        </TabsContent>

        {(filesTab || liveFileResults.active) && (
          <TabsContent
            value="files"
            className="mt-8 pt-6 pb-10 bg-cream focus-visible:outline-none"
            data-testid="tabcontent-files"
          >
            <Card className="rounded-xl border border-cream-sunken bg-cream-raised shadow-cream overflow-hidden">
              <CardContent className="p-0">
                <TabErrorBoundary tabName="Files">
                  {liveFileResults.active ? (
                    <div
                      className="border-b border-cream-sunken bg-teal/5 px-5 py-4 space-y-3"
                      data-testid="live-scrape-files-banner"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="border border-teal/30 bg-teal/10 text-teal">
                          Current scrape
                        </Badge>
                        {liveFileResults.reconnecting ? (
                          <span className="text-xs text-ink-tertiary-light">
                            Reconnecting…
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-ink-primary-light">
                        Uploaded {liveFileResults.stats.uploaded} of{" "}
                        {liveFileResults.stats.total}
                        {liveFileResults.stats.failed > 0
                          ? ` · ${liveFileResults.stats.failed} failed`
                          : ""}
                        {liveFileResults.stats.inProgress > 0
                          ? ` · ${liveFileResults.stats.inProgress} in progress`
                          : ""}
                      </p>
                      {liveFoldersGrouped.length > 0 ? (
                        <div className="space-y-3">
                          {liveFoldersGrouped.map((folder) => (
                            <div key={`live-${folder.name}`} className="rounded-lg border border-cream-sunken bg-cream overflow-hidden">
                              <div className="px-4 py-2 text-xs font-mono uppercase tracking-wide text-ink-tertiary-light border-b border-cream-sunken">
                                {folder.name}
                              </div>
                              <ul className="divide-y divide-cream-sunken">
                                {folder.files.map((file) => (
                                  <li
                                    key={`${file.portal_file_id}-${file.file_version}`}
                                    className="flex items-center justify-between gap-3 px-4 py-2 text-sm"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <FileText className="h-4 w-4 shrink-0 text-gold/90" />
                                      {file.status === "uploaded" && file.public_url ? (
                                        <a
                                          href={file.public_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="truncate text-gold hover:underline"
                                        >
                                          {file.file_name}
                                        </a>
                                      ) : (
                                        <span className="truncate text-ink-primary-light">
                                          {file.file_name}
                                        </span>
                                      )}
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={
                                        file.status === "failed"
                                          ? "border-destructive/40 text-destructive"
                                          : file.status === "uploaded"
                                            ? "border-teal/40 text-teal"
                                            : "border-cream-sunken text-ink-secondary-light"
                                      }
                                    >
                                      {file.status === "discovered"
                                        ? "Queued"
                                        : file.status === "downloading"
                                          ? "Downloading"
                                          : file.status === "retrying"
                                            ? "Retrying"
                                            : file.status === "uploaded"
                                              ? "Uploaded"
                                              : file.status === "failed"
                                                ? "Failed"
                                                : "Skipped"}
                                    </Badge>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ) : liveFileResults.loading ? (
                        <p className="text-xs text-ink-tertiary-light">
                          Loading live file progress…
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {filesTab?.error ? (
                    <div className="p-4 text-destructive flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      {filesTab?.error}
                    </div>
                  ) : foldersForRender.length === 0 && !liveFileResults.active ? (
                    <p className="p-4 text-muted-foreground">
                      No files data available.
                    </p>
                  ) : foldersForRender.length > 0 ? (
                    <div className="divide-y divide-cream-sunken">
                      {liveFileResults.active ? (
                        <div className="px-5 py-3 text-xs font-mono uppercase tracking-wide text-ink-tertiary-light border-b border-cream-sunken bg-cream">
                          Saved files (last completed scrape)
                        </div>
                      ) : null}
                      {foldersForRender.map((folder, fi) => {
                        const folderKey = `${folder.name}-${fi}`;
                        const isOpen = expandedFolders.has(folderKey);
                        const totalComments =
                          folder.files?.reduce(
                            (sum, f) => sum + (f.commentCount || 0),
                            0,
                          ) ?? 0;
                        return (
                          <Collapsible
                            key={folderKey}
                            open={isOpen}
                            onOpenChange={(open) => {
                              setExpandedFolders((prev) => {
                                const next = new Set(prev);
                                if (open) next.add(folderKey);
                                else next.delete(folderKey);
                                return next;
                              });
                            }}
                          >
                            <CollapsibleTrigger asChild>
                              <button
                                className="w-full flex items-center justify-between gap-3 bg-cream px-5 py-4 text-left transition-colors hover:bg-cream-raised"
                                data-testid={`button-folder-${fi}`}
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4 shrink-0 text-ink-secondary-light" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-secondary-light" />
                                )}
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gold/35 bg-gold/12 text-gold shadow-sm">
                                  <FolderOpen className="h-4 w-4 shrink-0" />
                                </div>
                                <span className="flex-1 text-left text-sm font-medium text-ink-primary-light">
                                  {isPgcEplan
                                    ? [
                                        folder.parentFolder || "",
                                        folder.folderName || folder.name || "",
                                      ]
                                        .filter(Boolean)
                                        .join(" \u2192 ")
                                    : folder.folderName || folder.name}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-cream-sunken bg-cream-raised px-2 py-0.5 text-xs font-mono font-semibold tabular-nums text-ink-primary-light"
                                >
                                  {folder.fileCount ??
                                    folder.files?.length ??
                                    0}{" "}
                                  files
                                </Badge>
                                {totalComments > 0 && (
                                  <Badge className="shrink-0 border border-gold/30 bg-gold/12 text-xs font-semibold text-ink-primary-light">
                                    <MessageSquare className="mr-1 h-3 w-3 text-gold" />
                                    {totalComments}
                                  </Badge>
                                )}
                              </button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="overflow-x-auto bg-cream">
                                <Table wrapperClassName="!rounded-none !border-0 !border-t !border-cream-sunken !bg-cream !shadow-none">
                                  <TableHeader>
                                    <TableRow className="!border-cream-sunken border-b bg-cream-raised/60 hover:!bg-cream-raised/80">
                                      <TableHead className="!text-ink-secondary-light text-[10px] font-mono font-medium uppercase tracking-[0.14em]">
                                        File Name
                                      </TableHead>
                                      <TableHead className="!text-ink-secondary-light text-[10px] font-mono font-medium uppercase tracking-[0.14em]">
                                        Status
                                      </TableHead>
                                      <TableHead className="!text-ink-secondary-light text-[10px] font-mono font-medium uppercase tracking-[0.14em]">
                                        Reviewed By
                                      </TableHead>
                                      <TableHead className="!text-ink-secondary-light text-[10px] font-mono font-medium uppercase tracking-[0.14em]">
                                        Uploaded
                                      </TableHead>
                                      <TableHead className="!text-right !text-ink-secondary-light text-[10px] font-mono font-medium uppercase tracking-[0.14em]">
                                        Comments
                                      </TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {(folder.files ?? []).map((file, fIdx) => {
                                      const fileKey = `${folderKey}--${file.name}-${fIdx}`;
                                      const fileOpenUrl = isPgcEplan
                                        ? resolvePgcPortalFileOpenUrl(file)
                                        : String(
                                            file.publicUrl ||
                                              file.viewUrl ||
                                              file.downloadUrl ||
                                              "",
                                          ).trim() || null;
                                      const hasComments =
                                        Array.isArray(file.comments) &&
                                        file.comments.length > 0;
                                      const isFileExpanded =
                                        expandedFileComments.has(fileKey);
                                      return (
                                        <React.Fragment key={fileKey}>
                                          <TableRow
                                            className={`${fIdx % 2 === 1 ? "bg-cream-raised/50" : "bg-cream"} border-t border-cream-sunken ${hasComments ? "cursor-pointer hover:!bg-cream-raised/85" : "hover:!bg-cream-raised/70"}`}
                                            onClick={() => {
                                              if (!hasComments) return;
                                              setExpandedFileComments(
                                                (prev) => {
                                                  const next = new Set(prev);
                                                  if (next.has(fileKey))
                                                    next.delete(fileKey);
                                                  else next.add(fileKey);
                                                  return next;
                                                },
                                              );
                                            }}
                                            data-testid={`row-file-${fi}-${fIdx}`}
                                          >
                                            <TableCell className="!text-ink-primary-light text-sm">
                                              <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4 shrink-0 text-gold/90" />
                                                {fileOpenUrl ? (
                                                  <a
                                                    href={fileOpenUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="truncate max-w-[300px] text-gold hover:text-gold-deep hover:underline transition-colors"
                                                    onClick={(e) =>
                                                      e.stopPropagation()
                                                    }
                                                    data-testid={`link-file-${fi}-${fIdx}`}
                                                  >
                                                    {file.name}
                                                  </a>
                                                ) : (
                                                  <span className="truncate max-w-[300px] text-ink-primary-light">
                                                    {file.name}
                                                  </span>
                                                )}
                                                {(file.downloadStatus ===
                                                  "failed" ||
                                                  file.downloadStatus?.startsWith(
                                                    "failed_",
                                                  )) && (
                                                  <Badge
                                                    className="bg-destructive text-destructive-foreground text-[10px] px-1.5 py-0 shrink-0"
                                                    title={
                                                      file.downloadError ||
                                                      "Download failed"
                                                    }
                                                    data-testid={`badge-failed-${fi}-${fIdx}`}
                                                  >
                                                    Failed
                                                  </Badge>
                                                )}
                                              </div>
                                            </TableCell>
                                            <TableCell className="!text-ink-primary-light whitespace-nowrap text-sm">
                                              {file.status || "—"}
                                            </TableCell>
                                            <TableCell className="!text-ink-primary-light whitespace-nowrap text-sm">
                                              {file.reviewedBy || "—"}
                                            </TableCell>
                                            <TableCell className="!text-ink-primary-light whitespace-nowrap text-sm">
                                              {file.uploadedDate || "—"}
                                            </TableCell>
                                            <TableCell className="text-right text-sm">
                                              {(file.commentCount || 0) > 0 ? (
                                                <Badge className="border border-gold/25 bg-gold/12 text-xs font-semibold text-ink-primary-light">
                                                  {file.commentCount}
                                                </Badge>
                                              ) : (
                                                <span className="text-ink-secondary-light">
                                                  0
                                                </span>
                                              )}
                                            </TableCell>
                                          </TableRow>
                                          {hasComments && isFileExpanded && (
                                            <TableRow>
                                              <TableCell
                                                colSpan={5}
                                                className="p-0 bg-muted/30"
                                              >
                                                <div className="px-6 py-3 space-y-2">
                                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                                                    Comments (
                                                    {file.comments!.length})
                                                  </p>
                                                  {file.comments!.map(
                                                    (comment, ci) => (
                                                      <div
                                                        key={ci}
                                                        className="border border-border rounded-md p-3 bg-card"
                                                        data-testid={`comment-${fi}-${fIdx}-${ci}`}
                                                      >
                                                        <div className="flex items-center gap-3 mb-1 text-xs text-muted-foreground">
                                                          <span className="font-medium text-foreground">
                                                            {comment.author ||
                                                              "Unknown"}
                                                          </span>
                                                          {comment.date && (
                                                            <span>
                                                              {comment.date}
                                                            </span>
                                                          )}
                                                          {comment.page !=
                                                            null && (
                                                            <span>
                                                              Page{" "}
                                                              {comment.page}
                                                            </span>
                                                          )}
                                                        </div>
                                                        <p className="text-sm whitespace-pre-wrap">
                                                          {comment.text}
                                                        </p>
                                                      </div>
                                                    ),
                                                  )}
                                                </div>
                                              </TableCell>
                                            </TableRow>
                                          )}
                                        </React.Fragment>
                                      );
                                    })}
                                    {(!folder.files ||
                                      folder.files.length === 0) && (
                                      <TableRow>
                                        <TableCell
                                          colSpan={5}
                                          className="text-center text-muted-foreground py-4"
                                        >
                                          No files in this folder.
                                        </TableCell>
                                      </TableRow>
                                    )}
                                  </TableBody>
                                </Table>
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  ) : null}
                </TabErrorBoundary>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
        </div>
      </div>

      <Dialog
        open={!!reportReaderOpen}
        onOpenChange={(open) => {
          if (!open) setReportReaderOpen(null);
        }}
      >
        <DialogContent
          className="max-w-3xl max-h-[90vh] overflow-y-auto border-border bg-card text-card-foreground"
          data-testid="dialog-report-reader"
        >
          {reportReaderOpen ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-left pr-8">
                  {reportReaderOpen.reportName}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-1">
                {String(reportReaderOpen.pdf.text ?? "").trim() ? (
                  <>
                    {isPgcEplan &&
                    reportReaderOpen.pdf.fileName?.includes(
                      "Review Comments",
                    ) ? (
                      <ReportsExtractedTextDetails
                        text={reportReaderOpen.pdf.text || ""}
                        summaryLabel="Raw extracted text (stored — copyable)"
                        testId="dialog-pgc-review-comments-raw-text"
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No extracted text for this report in saved data.
                  </p>
                )}
                {reportReaderOpen.pdf.screenshot ? (
                  <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                    <p className="text-xs text-warning mb-2">
                      Low-resolution preview only (compressed for database
                      storage). It is not full quality — use extracted text or
                      the actions on the report card when available.
                    </p>
                    <img
                      src={`data:image/png;base64,${reportReaderOpen.pdf.screenshot}`}
                      alt=""
                      className="max-w-full max-h-64 w-auto mx-auto object-contain opacity-95"
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
