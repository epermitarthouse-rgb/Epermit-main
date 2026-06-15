/**
 * Arlington Plan Set: hide stale plan_set_row/API shadows and metadata-only
 * duplicates when a downloaded twin exists (mirror scraper `arlingtonFinalizePlanSetDocumentsSink`).
 * Keep pending / retry rows that still have ERMS invoke/document id signals.
 */

export interface ArlingtonPlanSetCleanupRow {
  name?: string;
  filename?: string;
  status?: string;
  downloadStatus?: string;
  storagePath?: string;
  publicUrl?: string;
  downloadUrl?: string;
  downloaded?: boolean;
  saved?: boolean;
  documentId?: string;
  retryCount?: number | string;
  action?: {
    href?: string;
    onclick?: string;
    id?: string;
    title?: string;
    name?: string;
    documentId?: string;
  };
}

function normNameKey(row: ArlingtonPlanSetCleanupRow): string {
  return `${row.name ?? row.filename ?? ""}`.trim().toLowerCase();
}

/** @inline keep in sync with scraper `planReviewNormAttachmentName` */
function groupedNameKey(
  row: ArlingtonPlanSetCleanupRow,
  ix: number,
): string {
  const nk = normNameKey(row);
  return nk || `__blank_name__:${ix}`;
}

function inferPlanDocIdHaystack(hayRaw: string): string {
  const hay = `${hayRaw || ""}`.slice(0, 8000);
  if (!hay.trim()) return "";
  const patterns: RegExp[] = [
    /\bPlanDoc(?:ID|Id)\s*[:=]\s*['"]?(\d{5,})['"]?/i,
    /\bplanDocId\s*[:=]\s*['"]?(\d{5,})['"]?/i,
    /\b(?:DocumentId|DOCUMENTID|DOCUMENT_ID)\s*[:=']\s*['"]?(\d{5,})['"]?/i,
    /InvokeDownloadDocument\D*(\d{5,})\b/i,
    /PollDownloadDocument\D*[\(\[]\s*['"]?(\d{5,})['"]?/i,
    /DownloadDocument\D*[\(\[]\s*['"]?(\d{5,})['"]?/i,
    /\(?\s*['"]?\s*(\d{7,})\s*['"]?\s*\)?/,
    /[=,]\s*['"]?\s*(\d{7,})\s*['"]?\s*[,;)}\]]/,
  ];
  for (const p of patterns) {
    const m = hay.match(p);
    const v = m && m[1] ? `${m[1]}`.trim() : "";
    if (/^\d{5,}$/.test(v)) return v;
  }
  return "";
}

function looksUploadComplete(doc: ArlingtonPlanSetCleanupRow): boolean {
  if (doc.downloaded === true || doc.saved === true) return true;
  const pu = /^https?:\/\//i.test(`${doc.publicUrl || ""}`)
    ? String(doc.publicUrl)
    : "";
  const du = /^https?:\/\//i.test(`${doc.downloadUrl || ""}`)
    ? String(doc.downloadUrl)
    : "";
  const sp = `${doc.storagePath || ""}`.trim();
  const ds = `${doc.downloadStatus || ""}`.trim();
  const st = `${doc.status || ""}`.trim().toLowerCase();
  if (pu || du || sp) return true;
  if (st === "downloaded" || st === "saved") return true;
  return (
    ds === "uploaded" ||
    ds === "aliased_duplicate" ||
    ds === "aliased_attachment" ||
    ds === "aliased_plan_set" ||
    ds === "oversized_for_supabase"
  );
}

function pinnedOrInferredNumericId(doc: ArlingtonPlanSetCleanupRow): boolean {
  let pid = `${doc.documentId ?? ""}`.trim();
  if (/^\d{5,}$/.test(pid)) return true;
  const act = doc.action;
  pid = `${act?.documentId ?? ""}`.trim();
  return /^\d{5,}$/.test(pid);
}

function recoverableErmsInteractive(doc: ArlingtonPlanSetCleanupRow): boolean {
  if (pinnedOrInferredNumericId(doc)) return true;
  const act = doc.action;
  const hay = [act?.onclick, act?.href, act?.id, act?.name, doc.documentId];
  const inferred = inferPlanDocIdHaystack(hay.filter(Boolean).join("\n"));
  if (/^\d{5,}$/.test(inferred)) return true;
  const low = hay.filter(Boolean).join("\n").toLowerCase();
  if (
    /\binvokedownloaddocument\b|\bdocumentstream\b|\bpolldownloaddocument\b|\bplandocid\b/.test(
      low,
    )
  )
    return true;
  const hrefRaw = `${act?.href ?? ""}`.trim();
  if (
    /^https?:\/\//i.test(hrefRaw) &&
    !/^javascript:void/i.test(hrefRaw.toLowerCase())
  )
    return true;
  return false;
}

function actionHaystack(doc: ArlingtonPlanSetCleanupRow): string {
  const act = doc.action;
  return `${act?.title ?? ""} ${act?.alt ?? ""} ${act?.onclick ?? ""} ${act?.href ?? ""} ${act?.name ?? ""}`
    .trim()
    .replace(/\s+/g, " ");
}

function hasRealDownloadInput(doc: ArlingtonPlanSetCleanupRow): boolean {
  if (looksUploadComplete(doc)) return true;
  const act = doc.action;
  const docId = `${doc.documentId ?? act?.documentId ?? ""}`.trim();
  if (/^\d+$/.test(docId)) {
    const tit = `${act?.title ?? ""} ${act?.alt ?? ""}`.toLowerCase();
    if (/browse|download/.test(tit)) return true;
    const oc = `${act?.onclick ?? ""}`.toLowerCase();
    if (
      /\binvokedownloaddocument\b|\bpolldownloaddocument\b|\bdocumentstream\b/.test(
        oc,
      )
    )
      return true;
    if (/browse|download/.test(oc)) return true;
  }
  const hay = actionHaystack(doc).toLowerCase();
  if (/browse\s*\.*\s*download|download\s*\.*\s*browse/.test(hay)) return true;
  if (/\bbrowse\b/.test(hay) && /\bdownload\b/.test(hay)) return true;
  const hrefRaw = `${act?.href ?? ""}`.trim();
  if (
    /^https?:\/\//i.test(hrefRaw) &&
    !/^javascript:void/i.test(hrefRaw.toLowerCase())
  )
    return true;
  const low = [act?.onclick, act?.href, act?.id, act?.name, doc.documentId]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (
    /\binvokedownloaddocument\b|\bpolldownloaddocument\b|\bdocumentstream\b/.test(
      low,
    )
  )
    return true;
  return false;
}

/** Delete-only portal shadows — no Browse/Download input. */
function isDeleteOnlyInactive(doc: ArlingtonPlanSetCleanupRow): boolean {
  if (looksUploadComplete(doc)) return false;
  if (hasRealDownloadInput(doc)) return false;
  const ds = `${doc.downloadStatus ?? ""}`.trim();
  const st = `${doc.status ?? ""}`.trim();
  if (ds === "inactive_delete_only" || st === "plan_set_delete_only_inactive")
    return true;
  const hay = actionHaystack(doc).toLowerCase();
  if (!/\bdelete\b/.test(hay)) return false;
  if (/browse\s*\.*\s*download|download\s*\.*\s*browse/.test(hay)) return false;
  if (/\bbrowse\b/.test(hay) && /\bdownload\b/.test(hay)) return false;
  return true;
}

function temporalAttemptSignals(doc: ArlingtonPlanSetCleanupRow): boolean {
  const ds = `${doc.downloadStatus || ""}`.trim();
  const temporal = [
    "pending_stream_timeout",
    "upload_failed",
    "invoke_error",
    "invoke_timeout",
    "invoke_click_failed",
    "empty_buffer",
    "failed_html_stub",
    "write_failed",
    "no_file_buffer",
    "no_file_after_invoke",
    "upload_timeout",
    "missing_document_id",
  ];
  if (temporal.includes(ds)) return true;
  const rcRaw = Number(doc.retryCount ?? 0);
  return !Number.isNaN(rcRaw) && rcRaw > 0;
}

function eligiblePendingOrRetryTwin(doc: ArlingtonPlanSetCleanupRow): boolean {
  if (isDeleteOnlyInactive(doc)) return false;
  if (looksUploadComplete(doc)) return false;
  if (temporalAttemptSignals(doc)) return true;
  return recoverableErmsInteractive(doc);
}

function staleOrphanPlaceholder(
  doc: ArlingtonPlanSetCleanupRow,
  sweep: boolean,
): boolean {
  if (!sweep) return false;
  if (looksUploadComplete(doc)) return false;
  if (eligiblePendingOrRetryTwin(doc)) return false;
  return true;
}

/**
 * Returns a new array with stale / duplicate metadata-only Plan Set rows removed.
 */
export function filterArlingtonPlanSetDocumentsForUi(
  docs: readonly ArlingtonPlanSetCleanupRow[],
): ArlingtonPlanSetCleanupRow[] {
  if (!Array.isArray(docs) || docs.length === 0) return [...docs];

  const pass0 = docs.filter(
    (d) =>
      d &&
      typeof d === "object" &&
      !isDeleteOnlyInactive(d as ArlingtonPlanSetCleanupRow),
  ) as ArlingtonPlanSetCleanupRow[];

  const harvested = pass0.some(
    (d) => looksUploadComplete(d) || recoverableErmsInteractive(d),
  );

  const pass1: ArlingtonPlanSetCleanupRow[] = [];
  for (const d of pass0) {
    if (harvested && staleOrphanPlaceholder(d, true)) continue;
    pass1.push(d);
  }

  const buckets = new Map<string, ArlingtonPlanSetCleanupRow[]>();
  pass1.forEach((d, ix) => {
    const nk = groupedNameKey(d, ix);
    if (!buckets.has(nk)) buckets.set(nk, []);
    buckets.get(nk)!.push(d);
  });

  const pass2: ArlingtonPlanSetCleanupRow[] = [];
  for (const grp of buckets.values()) {
    if (!grp.length) continue;
    const hasWinner = grp.some((x) => looksUploadComplete(x));
    if (!hasWinner) {
      pass2.push(...grp);
      continue;
    }
    for (const x of grp) {
      if (looksUploadComplete(x)) {
        pass2.push(x);
        continue;
      }
      if (eligiblePendingOrRetryTwin(x)) pass2.push(x);
    }
  }

  return pass2;
}
