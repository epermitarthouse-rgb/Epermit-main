/**
 * View model for PGC correctionsTab / workflow bucket rows (DOM scrape shape + header variants).
 * Does not change API payloads — maps Record<string,string> rows for UI only.
 */
export type PgcReviewBlockViewModel = {
  refNumber: string;
  changemarkNumber: string;
  status: string;
  reviewer: string;
  datetime: string;
  cycle: string;
  department: string;
  fileName: string;
  commentText: string;
  responseText: string;
  /** Optional link from row if present (scrape may omit). */
  fileOrMarkupUrl: string;
};

/** One logical review comment after grouping multi-row DOM fragments (PGC frontend only). */
export type PgcGroupedReviewItemViewModel = PgcReviewBlockViewModel & {
  workflowName: string;
};

function normKey(k: string): string {
  return k.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** First non-empty value for any of the given keys (exact match on row keys). */
function pick(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    if (key in row) {
      const v = row[key];
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return "";
}

/** Match keys case-insensitively when headers differ from scraper field names. */
function pickLoose(row: Record<string, string>, want: string[]): string {
  const direct = pick(row, want);
  if (direct) return direct;
  const wantNorm = new Set(want.map((w) => normKey(w)));
  for (const [k, v] of Object.entries(row)) {
    if (wantNorm.has(normKey(k))) {
      if (v != null && String(v).trim()) return String(v).trim();
    }
  }
  return "";
}

function trimStr(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/\u00a0/g, " ").trim();
}

/** All non-empty cell values with keys (for redistribution when columns are misaligned). */
function rowEntries(row: Record<string, string>): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const [k, v] of Object.entries(row)) {
    const s = trimStr(v);
    if (s) out.push({ key: k, value: s });
  }
  return out;
}

function joinedRowTextLower(row: Record<string, string>): string {
  return rowEntries(row)
    .map((e) => e.value)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compactRawRowSummary(row: Record<string, string>, maxLen = 220): string {
  const parts = rowEntries(row).map((e) => `${e.key}=${e.value.slice(0, 72)}`);
  const s = parts.join(" | ");
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

const REF_HEADER_RE = /^ref\.?\s*#\s*(.+)$/i;
const CHANGEMARK_HEADER_RE = /^(?:changemark|change\s*mark)\s*#\s*(.+)$/i;

function looksLikeHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function looksLikeDateTimeField(s: string): boolean {
  const t = s.trim();
  if (t.length < 6 || t.length > 80) return false;
  return (
    /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(t) ||
    /\d{4}-\d{2}-\d{2}/.test(t) ||
    (/\d{1,2}:\d{2}/.test(t) && /\d/.test(t))
  );
}

/** File-ish label: extension or lone "markup", not multi-sentence prose. */
function looksLikeFileOrMarkupLabel(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 260) return false;
  const low = t.toLowerCase();
  if (low === "markup" || low === "mark up") return true;
  if (/\r|\n/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return false;
  return /\.(pdf|dwg|dxf|png|jpe?g|gif|tif{1,2}|bmp|docx?|xlsx?|txt|zip)\b/i.test(t);
}

function looksLikeLongProse(s: string): boolean {
  const t = s.trim();
  if (t.length < 48) return false;
  if (/\n{2,}/.test(t)) return true;
  if (/[.!?]\s+[A-Za-z]/.test(t)) return true;
  const words = t.split(/\s+/).length;
  return words >= 12;
}

function extractRefFromCell(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return REF_HEADER_RE.test(t) ? t : "";
}

function extractChangemarkFromCell(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return CHANGEMARK_HEADER_RE.test(t) ? t : "";
}

const SHORT_STATUS_RE = /^(unresolved|resolved|info\s*only|question)$/i;

function isShortStatusLabel(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length < 48 && SHORT_STATUS_RE.test(t.replace(/\s+/g, " "));
}

/**
 * Strip Ref.# / Ref # noise; collapse spaces; numeric refs compare equal ("01" → "1").
 */
export function normalizeRefNumber(value: string): string {
  let s = String(value ?? "").replace(/\u00a0/g, " ").trim();
  s = s.replace(/\s+/g, " ");
  s = s.replace(/^ref\.?\s*#\s*/i, "");
  s = s.replace(/^reference\s*#?\s*/i, "");
  s = s.replace(/^ref\s*#\s*/i, "");
  s = s.replace(/^#\s*/, "");
  s = s.trim().replace(/\s+/g, " ");
  s = s.replace(/\s*ref\.?\s*#?\s*$/i, "").trim();
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? String(n) : s;
  }
  return s;
}

/**
 * Strip Changemark # labels; pure numeric changemarks normalize like refs.
 */
export function normalizeChangemarkNumber(value: string): string {
  let s = String(value ?? "").replace(/\u00a0/g, " ").trim();
  s = s.replace(/\s+/g, " ");
  s = s.replace(/^changemark\s*#\s*/i, "");
  s = s.replace(/^change\s*mark\s*#\s*/i, "");
  s = s.replace(/^#\s*/, "");
  s = s.trim().replace(/\s+/g, " ");
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) ? String(n) : s;
  }
  return s;
}

/** Reject values that are review status words mistaken for Ref#/Changemark# in scraped cells. */
function isLikelyRefOrChangemarkIdentity(normalized: string): boolean {
  const t = normalized.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return false;
  if (/^(unresolved|resolved|info only|question|apply)$/.test(t)) return false;
  return true;
}

function mergeDistinctTextForMap(existing: string, add: string): string {
  const a = add.trim();
  if (!a) return existing.trim();
  const e = existing.trim();
  if (!e) return a;
  if (e === a) return e;
  if (e.includes(a)) return e;
  if (a.includes(e)) return a;
  return `${e}\n\n${a}`;
}

/**
 * Map a single workflow bucket row to a stable view model for card layout.
 * Reinterprets misaligned scraper cells (status in ref column, prose in ref, URLs in comment, etc.).
 */
export function mapPgcWorkflowRowToViewModel(
  row: Record<string, string>,
): PgcReviewBlockViewModel {
  const refNumber = pickLoose(row, [
    "refNumber",
    "Ref #",
    "Reference #",
    "Reference Number",
    "Col 2",
  ]);
  const changemarkNumber = pickLoose(row, [
    "changemarkNumber",
    "Changemark #",
    "Change Mark #",
    "Col 3",
  ]);
  const status = pickLoose(row, ["status", "Status", "State"]);
  const reviewer = pickLoose(row, ["reviewer", "Reviewer", "Reviewed By"]);
  const datetime = pickLoose(row, [
    "datetime",
    "Date/Time",
    "Date Time",
    "Date",
  ]);
  const cycle = pickLoose(row, ["cycle", "Cycle", "Review Cycle"]);
  const department = pickLoose(row, ["department", "Department", "Dept"]);
  const fileName = pickLoose(row, [
    "fileName",
    "File",
    "File Name",
    "Linked File",
    "Document",
  ]);
  let commentText = pickLoose(row, [
    "commentText",
    "Comment",
    "Comments",
    "Description",
  ]);
  const responseText = pickLoose(row, [
    "responseText",
    "Response",
    "Reviewer Response",
    "Applicant Response",
    "Response Text",
  ]);
  let fileOrMarkupUrl = pickLoose(row, [
    "viewUrl",
    "viewURL",
    "markupPdfPublicUrl",
    "markupPdfUrl",
    "downloadUrl",
    "publicUrl",
  ]);

  let r = refNumber || "";
  let cm = changemarkNumber || "";
  let st = status || "";
  let rev = reviewer || "";
  let dt = datetime || "";
  let cy = cycle || "";
  let dep = department || "";
  let fn = fileName || "";
  let ct = commentText || "";
  let rt = responseText || "";
  let url = fileOrMarkupUrl || "";

  const consumed = new Set<string>();
  const skipValueScanKeys = new Set(
    ["workflowName", "Workflow", "Workflow Name", "Name"].map((k) => normKey(k)),
  );

  const markConsumed = (s: string) => {
    const t = s.trim();
    if (t) consumed.add(t);
  };
  [r, cm, st, rev, dt, cy, dep, fn, ct, rt, url].forEach(markConsumed);

  for (const { key: colKey, value: v } of rowEntries(row)) {
    if (skipValueScanKeys.has(normKey(colKey))) continue;
    if (consumed.has(v)) continue;

    if (looksLikeHttpUrl(v)) {
      if (!url) url = v;
      markConsumed(v);
      continue;
    }

    if (!st && isShortStatusLabel(v)) {
      st = v;
      markConsumed(v);
      continue;
    }

    const refCand = extractRefFromCell(v);
    if (refCand && isLikelyRefOrChangemarkIdentity(normalizeRefNumber(refCand)) && !r) {
      r = refCand;
      markConsumed(v);
      continue;
    }

    const cmCand = extractChangemarkFromCell(v);
    if (
      cmCand &&
      isLikelyRefOrChangemarkIdentity(normalizeChangemarkNumber(cmCand)) &&
      !cm
    ) {
      cm = cmCand;
      markConsumed(v);
      continue;
    }

    if (!dt && looksLikeDateTimeField(v)) {
      dt = v;
      markConsumed(v);
      continue;
    }

    if (!fn && looksLikeFileOrMarkupLabel(v) && !looksLikeLongProse(v)) {
      fn = v;
      markConsumed(v);
      continue;
    }

    if (looksLikeLongProse(v)) {
      ct = ct ? mergeDistinctTextForMap(ct, v) : v;
      markConsumed(v);
    }
  }

  const vmDraft: PgcReviewBlockViewModel = {
    refNumber: r,
    changemarkNumber: cm,
    status: st,
    reviewer: rev,
    datetime: dt,
    cycle: cy,
    department: dep,
    fileName: fn,
    commentText: ct,
    responseText: rt,
    fileOrMarkupUrl: url,
  };

  return reconcileMisclassifiedFields(vmDraft);
}

/** Normalize misplaced ref/changemark/status/comment/file after initial picks + scan. */
function reconcileMisclassifiedFields(vm: PgcReviewBlockViewModel): PgcReviewBlockViewModel {
  let {
    refNumber: r,
    changemarkNumber: cm,
    status: st,
    commentText: ct,
    fileName: fn,
    fileOrMarkupUrl: url,
    reviewer: rev,
    datetime: dt,
    cycle: cy,
    department: dep,
    responseText: rt,
  } = vm;

  const nr = normalizeRefNumber(r);
  if (r.trim() && !isLikelyRefOrChangemarkIdentity(nr)) {
    if (isShortStatusLabel(r)) {
      st = st.trim() || r;
      r = "";
    } else if (looksLikeLongProse(r)) {
      ct = mergeDistinctTextForMap(ct, r);
      r = "";
    } else if (looksLikeHttpUrl(r)) {
      url = url.trim() || r;
      r = "";
    } else if (looksLikeFileOrMarkupLabel(r) && !looksLikeLongProse(r)) {
      fn = fn.trim() || r;
      r = "";
    }
  }

  const ncm = normalizeChangemarkNumber(cm);
  if (cm.trim() && !isLikelyRefOrChangemarkIdentity(ncm)) {
    if (isShortStatusLabel(cm)) {
      st = st.trim() || cm;
      cm = "";
    } else if (looksLikeLongProse(cm)) {
      ct = mergeDistinctTextForMap(ct, cm);
      cm = "";
    }
  }

  if (ct.trim() && isShortStatusLabel(ct)) {
    if (!st.trim()) st = ct.trim();
    ct = "";
  }

  const ctTrim = ct.trim();
  if (ctTrim && looksLikeHttpUrl(ctTrim) && !url.trim()) {
    url = ctTrim;
    ct = "";
  }

  if (ctTrim && looksLikeFileOrMarkupLabel(ctTrim) && !looksLikeLongProse(ctTrim)) {
    if (!fn.trim()) fn = ctTrim;
    ct = "";
  }

  return {
    refNumber: r.trim(),
    changemarkNumber: cm.trim(),
    status: st.trim(),
    reviewer: rev.trim(),
    datetime: dt.trim(),
    cycle: cy.trim(),
    department: dep.trim(),
    fileName: fn.trim(),
    commentText: ct.trim(),
    responseText: rt.trim(),
    fileOrMarkupUrl: url.trim(),
  };
}

/**
 * Portal block header: row carries a real Ref # and/or Changemark # (not status-as-ref noise).
 */
export function isIdentityRow(vm: PgcReviewBlockViewModel): boolean {
  const ir = normalizeRefNumber(vm.refNumber);
  const icm = normalizeChangemarkNumber(vm.changemarkNumber);
  const refRaw = vm.refNumber.trim();
  const cmRaw = vm.changemarkNumber.trim();
  return (
    (refRaw.length > 0 && ir.length > 0 && isLikelyRefOrChangemarkIdentity(ir)) ||
    (cmRaw.length > 0 && icm.length > 0 && isLikelyRefOrChangemarkIdentity(icm))
  );
}

/** Substrings typical of correctionsTab filter/toolbar chrome scraped as a pseudo-row. */
const PGC_ROW_UTILITY_MARKERS = [
  "[select one]",
  "select one",
  "info only",
  "question",
  "resolved",
  "unresolved",
  "apply",
  "add checklist",
  "add checklist items",
  "add library",
  "add library comments",
  "add comment",
  "add comment / ask question",
  "ask question",
] as const;

/** Raw DOM row text matches filter/toolbar strip (independent of column mapping). */
function isToolbarChromeRawRow(row: Record<string, string>): boolean {
  const j = joinedRowTextLower(row);
  if (j.length < 10) return false;

  if (rowEntries(row).some((e) => looksLikeLongProse(e.value))) return false;

  const hasReviewIdentityInRaw =
    /\bref\.?\s*#\s*\d+/i.test(j) || /\bchangemark\s*#\s*\d+/i.test(j);

  let markerHits = 0;
  for (const m of PGC_ROW_UTILITY_MARKERS) {
    if (j.includes(m)) markerHits += 1;
  }

  const hasSelectOne = /\[?\s*select\s*one\s*\]?/i.test(j);
  const hasApply = /\bapply\b/i.test(j);
  const addChrome =
    j.includes("add comment") ||
    j.includes("ask question") ||
    j.includes("add checklist") ||
    j.includes("add library");

  if (hasReviewIdentityInRaw && markerHits <= 2) return false;
  if (hasSelectOne && hasApply && markerHits >= 2) return true;
  if (hasSelectOne && addChrome && markerHits >= 2) return true;
  if (markerHits >= 4 && j.length < 480) return true;

  return false;
}

/**
 * True if this row is almost certainly portal UI chrome (filters/actions), not a review comment row.
 */
export function isPgcUtilityRow(
  vm: PgcReviewBlockViewModel,
  row?: Record<string, string>,
): boolean {
  if (row && isToolbarChromeRawRow(row)) return true;

  const joined = [
    vm.refNumber,
    vm.changemarkNumber,
    vm.status,
    vm.reviewer,
    vm.datetime,
    vm.cycle,
    vm.department,
    vm.fileName,
    vm.commentText,
    vm.responseText,
  ]
    .map((s) => String(s || "").toLowerCase())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const comment = String(vm.commentText || "").toLowerCase();
  const hasRealIdentity = isIdentityRow(vm);
  const hasMeaningfulComment =
    (vm.commentText || "").trim().length > 12 &&
    !/^\[?\s*select\s*one\s*\]?$/i.test((vm.commentText || "").trim());

  let markerHits = 0;
  for (const m of PGC_ROW_UTILITY_MARKERS) {
    if (joined.includes(m)) markerHits += 1;
  }

  const hasSelectOne = /\[?\s*select\s*one\s*\]?/i.test(joined);
  const hasApply = joined.includes("apply");
  const hasStatusToken =
    joined.includes("unresolved") ||
    joined.includes("resolved") ||
    joined.includes("info only") ||
    joined.includes("question");
  const addActionChrome =
    joined.includes("add comment") ||
    joined.includes("ask question") ||
    joined.includes("add checklist") ||
    joined.includes("add library");

  // Toolbar / filter strip: select + status tokens + apply + add-* without a real review identity or prose
  if (
    hasSelectOne &&
    hasApply &&
    markerHits >= 3 &&
    !hasRealIdentity &&
    !hasMeaningfulComment
  ) {
    return true;
  }

  if (
    hasSelectOne &&
    hasStatusToken &&
    addActionChrome &&
    !hasRealIdentity &&
    !hasMeaningfulComment
  ) {
    return true;
  }

  // Single squashed toolbar line in comment or across cells
  if (
    comment.includes("[select one]") &&
    (comment.includes("add comment") || comment.includes("ask question")) &&
    (comment.includes("apply") || comment.includes("unresolved") || comment.includes("resolved")) &&
    !hasRealIdentity
  ) {
    return true;
  }

  if (
    /\[?\s*select\s*one\s*\]?/i.test(joined) &&
    joined.includes("apply") &&
    markerHits >= 4 &&
    !hasRealIdentity &&
    !hasMeaningfulComment
  ) {
    return true;
  }

  if (
    !hasRealIdentity &&
    !hasMeaningfulComment &&
    markerHits >= 3 &&
    joined.length > 50
  ) {
    return true;
  }

  if (
    markerHits >= 5 &&
    !hasRealIdentity &&
    !hasMeaningfulComment
  ) {
    return true;
  }

  return false;
}

/** Alias: toolbar/filter rows removed by sanitize / skipped in parser. */
export function isUtilityToolbarRow(
  vm: PgcReviewBlockViewModel,
  row?: Record<string, string>,
): boolean {
  return isPgcUtilityRow(vm, row);
}

export function sanitizePgcWorkflowRows(
  rows: Record<string, string>[],
): Record<string, string>[] {
  return rows.filter((row) => {
    const vm = mapPgcWorkflowRowToViewModel(row);
    return !isPgcUtilityRow(vm, row);
  });
}

/** Continuation: short status in Status or Comment column, no Ref#/Changemark# identity. */
export function isStatusRow(
  vm: PgcReviewBlockViewModel,
  row?: Record<string, string>,
): boolean {
  if (isUtilityToolbarRow(vm, row) || isIdentityRow(vm)) return false;
  const st = (vm.status || "").trim();
  if (st && isShortStatusLabel(st)) return true;
  const ct = (vm.commentText || "").trim();
  return !!(ct && isShortStatusLabel(ct));
}

/** Continuation: non-trivial comment body (not toolbar, not identity header). */
export function isCommentRow(
  vm: PgcReviewBlockViewModel,
  row?: Record<string, string>,
): boolean {
  if (isUtilityToolbarRow(vm, row) || isIdentityRow(vm)) return false;
  const ct = (vm.commentText || "").trim();
  if (!ct || isShortStatusLabel(ct)) return false;
  return true;
}

/** Continuation: file name, URL, or markup indicator without identity row. */
export function isFileOrMarkupRow(
  vm: PgcReviewBlockViewModel,
  row?: Record<string, string>,
): boolean {
  if (isUtilityToolbarRow(vm, row) || isIdentityRow(vm)) return false;
  if ((vm.fileName || "").trim()) return true;
  const u = (vm.fileOrMarkupUrl || "").trim();
  if (u && /^https?:\/\//i.test(u)) return true;
  const low = (vm.commentText || "").trim().toLowerCase();
  return low === "markup" || low === "mark up";
}

/** Continuation: reviewer / department / datetime / cycle without identity or long comment. */
export function isMetaRow(
  vm: PgcReviewBlockViewModel,
  row?: Record<string, string>,
): boolean {
  if (isUtilityToolbarRow(vm, row)) return false;
  if (isIdentityRow(vm)) return false;
  if (isCommentRow(vm, row)) return false;
  if (isFileOrMarkupRow(vm, row)) return false;
  return !!(
    vm.reviewer?.trim() ||
    vm.department?.trim() ||
    vm.datetime?.trim() ||
    vm.cycle?.trim()
  );
}

/** DEV: compact role tags for one mapped row (identity, meta, status, file, comment). */
export function formatPgcRowDebugRoles(
  vm: PgcReviewBlockViewModel,
  row?: Record<string, string>,
): string {
  if (isUtilityToolbarRow(vm, row)) return "utility";
  const tags: string[] = [];
  if (isIdentityRow(vm)) tags.push("identity");
  if (isMetaRow(vm, row)) tags.push("meta");
  if (isStatusRow(vm, row)) tags.push("status");
  if (isFileOrMarkupRow(vm, row)) tags.push("file");
  if (isCommentRow(vm, row)) tags.push("comment");
  return tags.length ? tags.join("+") : "other";
}

let pgcRowMappingSampleLogged = false;

function mergeDistinctText(existing: string, add: string): string {
  const a = (add || "").trim();
  if (!a) return existing;
  const e = (existing || "").trim();
  if (!e) return a;
  if (e === a) return e;
  if (e.includes(a)) return e;
  if (a.includes(e)) return a;
  return `${e}\n\n${a}`;
}

type MutableGroup = {
  refNumber: string;
  changemarkNumber: string;
  status: string;
  reviewer: string;
  datetime: string;
  cycle: string;
  department: string;
  fileName: string;
  commentText: string;
  responseText: string;
  fileOrMarkupUrl: string;
};

function emptyMutable(): MutableGroup {
  return {
    refNumber: "",
    changemarkNumber: "",
    status: "",
    reviewer: "",
    datetime: "",
    cycle: "",
    department: "",
    fileName: "",
    commentText: "",
    responseText: "",
    fileOrMarkupUrl: "",
  };
}

function mutableFromVm(vm: PgcReviewBlockViewModel): MutableGroup {
  return {
    refNumber: vm.refNumber || "",
    changemarkNumber: vm.changemarkNumber || "",
    status: vm.status || "",
    reviewer: vm.reviewer || "",
    datetime: vm.datetime || "",
    cycle: vm.cycle || "",
    department: vm.department || "",
    fileName: vm.fileName || "",
    commentText: vm.commentText || "",
    responseText: vm.responseText || "",
    fileOrMarkupUrl: vm.fileOrMarkupUrl || "",
  };
}

function finalizeGroup(m: MutableGroup, workflowName: string): PgcGroupedReviewItemViewModel {
  return {
    refNumber: m.refNumber,
    changemarkNumber: m.changemarkNumber,
    status: m.status,
    reviewer: m.reviewer,
    datetime: m.datetime,
    cycle: m.cycle,
    department: m.department,
    fileName: m.fileName,
    commentText: m.commentText,
    responseText: m.responseText,
    fileOrMarkupUrl: m.fileOrMarkupUrl,
    workflowName,
  };
}

/**
 * Merge one sanitized DOM row into the current logical review item.
 */
function mergeRowIntoGroup(acc: MutableGroup, vm: PgcReviewBlockViewModel): void {
  if (vm.refNumber.trim() && !acc.refNumber.trim()) acc.refNumber = vm.refNumber;
  if (vm.changemarkNumber.trim() && !acc.changemarkNumber.trim())
    acc.changemarkNumber = vm.changemarkNumber;

  const st = (vm.status || "").trim();
  if (st) {
    if (isShortStatusLabel(st)) {
      acc.status = acc.status.trim() || st;
    } else if (!acc.status.trim()) {
      acc.status = st;
    }
  }

  if (vm.reviewer.trim()) acc.reviewer = acc.reviewer.trim() || vm.reviewer;
  if (vm.datetime.trim()) acc.datetime = acc.datetime.trim() || vm.datetime;
  if (vm.cycle.trim()) acc.cycle = acc.cycle.trim() || vm.cycle;
  if (vm.department.trim()) acc.department = acc.department.trim() || vm.department;

  const fn = (vm.fileName || "").trim();
  if (fn) {
    acc.fileName = acc.fileName.trim() || fn;
  }

  const url = (vm.fileOrMarkupUrl || "").trim();
  if (url && /^https?:\/\//i.test(url)) {
    acc.fileOrMarkupUrl = acc.fileOrMarkupUrl.trim() || url;
  }

  const ct = (vm.commentText || "").trim();
  if (ct) {
    const low = ct.toLowerCase();
    if (low === "markup" || low === "mark up") {
      acc.fileName = acc.fileName.trim() || "Markup";
    } else if (isShortStatusLabel(ct)) {
      if (!acc.status.trim()) acc.status = ct;
    } else {
      acc.commentText = mergeDistinctText(acc.commentText, ct);
    }
  }

  const rt = (vm.responseText || "").trim();
  if (rt) {
    acc.responseText = mergeDistinctText(acc.responseText, rt);
  }
}

function mutableGroupAsViewModel(m: MutableGroup): PgcReviewBlockViewModel {
  return {
    refNumber: m.refNumber,
    changemarkNumber: m.changemarkNumber,
    status: m.status,
    reviewer: m.reviewer,
    datetime: m.datetime,
    cycle: m.cycle,
    department: m.department,
    fileName: m.fileName,
    commentText: m.commentText,
    responseText: m.responseText,
    fileOrMarkupUrl: m.fileOrMarkupUrl,
  };
}

/** True when the open group already holds comment/file/response body but still has no Ref#/Changemark# header. */
function groupHasSubstantialBodyWithoutIdentity(m: MutableGroup): boolean {
  const vm = mutableGroupAsViewModel(m);
  if (isCommentRow(vm) || isFileOrMarkupRow(vm)) return true;
  return !!(vm.responseText || "").trim();
}

/**
 * Next portal review block starts: identity row whose (ref, changemark) is not continuing the current header/item.
 * Non-identity rows never start a block (handled as continuation merge).
 */
function isNewPortalBlock(
  current: MutableGroup,
  vm: PgcReviewBlockViewModel,
): boolean {
  if (!isIdentityRow(vm)) return false;

  const ir = normalizeRefNumber(vm.refNumber);
  const icm = normalizeChangemarkNumber(vm.changemarkNumber);
  const cr = normalizeRefNumber(current.refNumber);
  const ccm = normalizeChangemarkNumber(current.changemarkNumber);

  if (!cr && !ccm) {
    return groupHasSubstantialBodyWithoutIdentity(current);
  }

  if (cr && !ccm) {
    if (ir && ir !== cr) return true;
    if (icm && (!ir || ir === cr)) return false;
    if (ir && ir === cr && !icm) return false;
    return false;
  }

  if (ir && cr && ir !== cr) return true;

  if (icm && ccm && icm !== ccm && (!ir || ir === cr)) return true;

  if (ir && icm && cr && ccm && ir === cr && icm === ccm) return false;
  if (ir && ir === cr && !icm) return false;
  if (icm && icm === ccm && !ir) return false;

  return false;
}

export type PgcGroupWorkflowMeta = {
  /** Pre-sanitize row count for DEV logging only. */
  rawRowCount?: number;
};

/**
 * Portal-pattern parser: one grouped item = one on-screen review block (header + continuation rows).
 * Run after {@link sanitizePgcWorkflowRows}.
 */
export function groupPgcWorkflowRowsIntoReviewItems(
  rows: Record<string, string>[],
  workflowName: string,
  meta?: PgcGroupWorkflowMeta,
): PgcGroupedReviewItemViewModel[] {
  const items: PgcGroupedReviewItemViewModel[] = [];
  let current: MutableGroup | null = null;

  if (import.meta.env.DEV && !pgcRowMappingSampleLogged && rows.length > 0) {
    pgcRowMappingSampleLogged = true;
    const lim = Math.min(5, rows.length);
    for (let i = 0; i < lim; i++) {
      const row = rows[i];
      const vm = mapPgcWorkflowRowToViewModel(row);
      console.log(
        `[PGC row map sample] ${workflowName} row#${i}`,
        compactRawRowSummary(row),
        vm,
        formatPgcRowDebugRoles(vm, row),
      );
    }
  }

  for (const row of rows) {
    const vm = mapPgcWorkflowRowToViewModel(row);
    if (isUtilityToolbarRow(vm, row)) continue;

    if (!current) {
      current = mutableFromVm(vm);
      continue;
    }

    if (isNewPortalBlock(current, vm)) {
      items.push(finalizeGroup(current, workflowName));
      current = mutableFromVm(vm);
      continue;
    }

    mergeRowIntoGroup(current, vm);
  }

  if (current) {
    items.push(finalizeGroup(current, workflowName));
  }

  if (items.length === 0 && rows.length > 0) {
    const acc = emptyMutable();
    for (const row of rows) {
      const vm = mapPgcWorkflowRowToViewModel(row);
      if (isUtilityToolbarRow(vm, row)) continue;
      mergeRowIntoGroup(acc, vm);
    }
    if (
      acc.refNumber ||
      acc.changemarkNumber ||
      acc.commentText ||
      acc.status ||
      acc.fileName
    ) {
      items.push(finalizeGroup(acc, workflowName));
    }
  }

  if (import.meta.env.DEV) {
    const raw = meta?.rawRowCount;
    console.log(
      `[PGC Review normalize] workflow="${workflowName}" rawRows=${raw ?? "?"} sanitizedRows=${rows.length} groupedItems=${items.length}`,
    );
  }

  return items;
}
