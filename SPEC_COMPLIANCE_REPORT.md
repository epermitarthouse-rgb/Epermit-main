# DesignCheck Agent Optimization Analysis — SPEC COMPLIANCE REPORT

**Scope:** Agentic intake pipeline + portal report table fidelity + response matrix workflow.  
**Audit date:** File-based; all paths and code excerpts are from the repo.

---

## Summary checklist

| # | Requirement | Status | Evidence (file) |
|---|-------------|--------|------------------|
| 1 | Portal Monitor / Scraper | **PASS** | `scraper-service/server.js` |
| 2 | Comment Parser Agent | **PARTIAL** | `supabase/functions/comment-parser-agent/index.ts` |
| 3 | Discipline Classifier Agent | **PASS** | `supabase/functions/discipline-classifier-agent/index.ts`, `src/pages/ClassifiedComments.tsx` |
| 4 | Orchestrator (intake-pipeline-agent) | **PARTIAL** | `supabase/functions/intake-pipeline-agent/index.ts` |
| 5 | Auto-Router Agent (assigned_to) | **PASS** | `supabase/functions/auto-router-agent/index.ts` |
| 6 | Deadline Tracker (UI) | **PASS** | `src/components/dashboard/ProjectHealthCard.tsx` |
| 7 | Completeness Validator | **PASS** | `supabase/functions/validate-completeness-agent/index.ts`, `src/pages/ResponseMatrix.tsx` |
| 8 | Guardian Agent (quality scoring) | **PASS** | `supabase/functions/guardian-quality-agent/index.ts`, `src/pages/ResponseMatrix.tsx` |
| 9 | Document & Package Agent (export-response-package) | **PARTIAL** | `supabase/functions/export-response-package/index.ts` |

---

## PART A — Agent pipeline compliance

### 1) Portal Monitor / Scraper — **PASS**

**Evidence**

- **File:** `scraper-service/server.js`
- **Functions:** `scrapeAll`, `extractPDFsFromPage`, `extractPageData`; Supabase write in `scrapeAll` after loop.

**Extraction logic (Reports tab)**

Reports are extracted by:

1. **Report list:** Names come from the Reports tab table (second column), then each report is opened by clicking the link with that text (so “Plan Review - Review Comments”, “Plan Review - Review Details”, “Plan Review - Workflow Routing Slip”, etc. are all scraped if present).

```javascript
// scraper-service/server.js (lines 589–606, 616–618)
const reportNames = await page.evaluate(() => {
  const names = [];
  document.querySelectorAll("table tr").forEach(tr => {
    const cells = tr.querySelectorAll("td");
    if (cells.length >= 3) {
      const nameCell = cells[1];
      if (nameCell) {
        const link = nameCell.querySelector("a");
        const text = (link || nameCell).textContent.trim();
        if (text && text.length > 5 && !text.toLowerCase().includes("contains")) {
          names.push(text);
        }
      }
    }
  });
  return names;
});
// ...
for (let i = 0; i < reportNames.length; i++) {
  const reportName = reportNames[i];
  const linkHandle = await page.locator(`a:has-text("${reportName}")`).first().elementHandle().catch(() => null);
  await linkHandle.click();
  // popup opens → content extracted
}
```

2. **Report content (popup):** Single `popup.evaluate()` finds a target node (SSRS divs, then iframe body, then cloned body), gets `innerText` and scrapes `<table>` elements into `{ headers, rows: [{ text, html }] }`. Tabs are not used for table detection in the popup; frontend uses tab-delimited text from `text` for table parsing.

```javascript
// scraper-service/server.js (lines 661–741)
const content = await popup.evaluate(() => {
  const selectors = [
    '[id*="oReportDiv"]', '[id*="ReportDiv"]',
    '[id*="VisibleReportContent"]', '[id*="ReportViewerControl"]', '[id*="reportDiv"]'
  ];
  let targetEl = null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length > 50) {
      targetEl = el;
      break;
    }
  }
  if (!targetEl) {
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc?.body?.innerText?.length > 50) {
          targetEl = doc.body;
          break;
        }
      } catch (e) {}
    }
  }
  // ... clone body fallback ...
  const text = targetEl.innerText?.trim() || "";
  const tables = [];
  targetEl.querySelectorAll("table").forEach((table) => {
    // headers from thead tr or first tr; rows as { text, html } per cell
    tables.push(tableData);
  });
  return { text, tables, source: ... };
});
```

3. **Storing in Supabase:** After `scrapeAll`, for each project `session.data[project.id]` (which includes `tabs.reports.pdfs` from `extractPDFsFromPage`) is written to `projects.portal_data` (and `portal_status`, `last_checked_at`).

```javascript
// scraper-service/server.js (lines 447–454, 470–476)
const updatePayloadFields = (currentData) => ({
  portal_status: currentData.dashboardStatus || "Scraped",
  last_checked_at: new Date().toISOString(),
  portal_data: currentData,
  permit_number: null,
});
// ...
const updatePayload = { ...updatePayloadFields(currentData), permit_number: projectNum };
let query = supabase.from("projects").update(updatePayload);
// .eq("id", useProjectId) or .eq("permit_number", projectNum)
let { data, error } = await query.select();
```

**Repro:** Run scraper (e.g. Dashboard “Run Manual Check” with credentials), open Portal Data → Reports; expand “Plan Review - Review Comments” (or similar). Confirm `portal_data.tabs.reports.pdfs[]` in DB and in UI.

**Fix plan:** None for spec. Optional: if SSRS uses divs not `<table>`, tables from popup may be empty; frontend already parses tables from `text` via `parseSSRSText` in `PortalDataViewer.tsx`.

---

### 2) Comment Parser Agent — **PARTIAL**

**Evidence**

- **File:** `supabase/functions/comment-parser-agent/index.ts`
- **Reads:** `project.portal_data.tabs.reports.pdfs[].text`; filters to PDFs whose `fileName` includes `"Review Comments"`.
- **Pipeline:** `splitIntoCommentBlocks` → `filterNoiseBlocks` (noise + `looksLikeRealComment`) → `classifyCommentBlocks` (OpenAI) → insert into `parsed_comments`.

**Relevant code**

```typescript
// comment-parser-agent/index.ts (328–333, 420–421)
const pdfs = portalData.tabs?.reports?.pdfs ?? [];
const pdfsWithTextRaw = pdfs.filter((p): p is PortalPdf & { text: string } => !!p.text && p.text.trim().length > 0);
const pdfsWithText = pdfsWithTextRaw.filter((p) => (p.fileName ?? "").includes("Review Comments"));
// ...
const blocks = filterNoiseBlocks(splitIntoCommentBlocks(pdf.text));
// ...
await supabase.from("parsed_comments").insert({
  project_id: projectId,
  original_text: orig,
  discipline: null,
  code_reference: c.code_reference ?? null,
  page_number: pageNumber,
  status: "Pending",
});
```

Noise filtering (footer / metadata):

```typescript
// comment-parser-agent/index.ts (54–62, 86–88, 110)
const METADATA_PHRASES = [
  "Created in ProjectDox version",
  "Report Generated:",
  // ...
];
function isNoiseBlock(block: string): boolean {
  for (const phrase of METADATA_PHRASES) {
    if (t.includes(phrase)) return true;
  }
  // ...
  if (t.includes("Created in ProjectDox version")) return true;
  // ...
}
```

**Why noisy rows can still appear**

1. **Split strategy:** `splitIntoCommentBlocks` uses `\n\s*\n` or numbered splits. A line like “Created in ProjectDox version X.Y” can end up in a block that also contains real-comment text; that block may pass `isNoiseBlock` (which only checks `includes(phrase)`) and `looksLikeRealComment`, and the LLM can then return a “comment” that includes or is the footer.
2. **No insert-time filter:** There is no check before `insert` to reject `original_text` that contains “Created in ProjectDox” or matches date/timestamp patterns.

**Fix plan (minimal)**

- **Option A (recommended):** Before inserting, skip any item whose `original_text` contains a metadata/footer phrase or matches a timestamp pattern, e.g.:

```typescript
// Before: await supabase.from("parsed_comments").insert({...})
if (METADATA_PHRASES.some((phrase) => orig.includes(phrase)) || DATE_TIME_PATTERN.test(orig)) {
  skippedCount++;
  continue;
}
```

- **Option B:** Restrict to a single “Plan Review - Review Comments” PDF (e.g. `fileName` exactly or includes “Plan Review - Review Comments” and not “Report” if there are two) and ensure only that one is parsed.
- **Option C:** Add a post-LLM filter: drop any `c` where `c.original_text` matches metadata/footer or date pattern before the insert loop.

---

### 3) Discipline Classifier Agent — **PASS**

**Evidence**

- **File:** `supabase/functions/discipline-classifier-agent/index.ts`
- **Selection:** `parsed_comments` where `discipline` IS NULL or `General` or `''`, and `status = 'Pending'`, limited by `batch_limit` (default 50), scoped to user’s project(s).
- **Update:** `discipline` (and optionally other fields) updated per row after OpenAI classification.

```typescript
// discipline-classifier-agent/index.ts (114–124, 184–210)
const orDiscipline = "discipline.is.null,discipline.eq.General,discipline.eq.";
let query = supabase
  .from("parsed_comments")
  .select("id, original_text, project_id, discipline")
  .or(orDiscipline)
  .eq("status", "Pending")
  .in("project_id", projectId ? [projectId] : projectIds)
  .limit(batchLimit);
// ... after LLM ...
const { error: updateError } = await supabase
  .from("parsed_comments")
  .update({ discipline: mapped })
  .eq("id", row.id);
```

**UI**

- **File:** `src/pages/ClassifiedComments.tsx`
- **Route:** `/classified-comments` (linked from dashboard / Comment Review flow).
- **Behavior:** Fetches `parsed_comments` for selected project, groups by `discipline` (null → “Unclassified”), shows counts; “Run classifier” invokes `discipline-classifier-agent` and refetches.

**Repro:** Run intake pipeline for a project with parsed comments, open Classified Comments, click “Run classifier”; confirm disciplines update and UI reflects them.

**Fix plan:** None for spec.

---

### 4) Orchestrator (intake-pipeline-agent) — **PARTIAL**

**Evidence**

- **File:** `supabase/functions/intake-pipeline-agent/index.ts`
- **Auth:** Reads `Authorization` header, validates JWT with Supabase Auth, forwards same `Authorization` and `apikey` to comment-parser and discipline-classifier.

```typescript
// intake-pipeline-agent/index.ts (40–46, 79–84, 103–106, 148–153)
const authHeader = req.headers.get("Authorization");
// ...
const headers: Record<string, string> = {
  "Content-Type": "application/json",
  "Authorization": authHeader,
  "apikey": anonKey,
};
const commentParserRes = await fetchWithTimeout(`${baseUrl}/comment-parser-agent`, {
  method: "POST",
  headers,
  body: JSON.stringify({ project_id: projectId, cursor, max_pdfs: 2 }),
  timeoutMs: PARSER_TIMEOUT_MS,
});
// Same headers passed to discipline-classifier-agent
```

**Timeouts and error handling**

- Parser: `PARSER_TIMEOUT_MS = 20_000` (20s).
- Classifier: `CLASSIFIER_TIMEOUT_MS = 30_000` (30s).
- On parser timeout/error, orchestrator still returns 200 with `comment_parser: { error: "timeout", done: false }` and does **not** call the classifier (`parserDone` is false when parser errors or not done).

```typescript
// intake-pipeline-agent/index.ts (9–10, 134–145, 143–144)
const PARSER_TIMEOUT_MS = 20_000;
const CLASSIFIER_TIMEOUT_MS = 30_000;
// ...
} catch (err) {
  const isTimeout = err instanceof Error && err.name === "AbortError";
  commentParserResult = { error: isTimeout ? "timeout" : ..., done: false };
}
const parserDone = commentParserResult.done === true && !commentParserResult.error;
if (parserDone) {
  // call discipline-classifier
}
```

**Why comment_parser can timeout while classifier still runs**

- Classifier is only invoked when `parserDone` is true. So in a single request you do not get “parser timeout then classifier runs.” You can get: (1) parser times out → 200 with parser error, no classifier call; (2) parser completes, classifier runs and may complete or timeout. So “comment_parser timeout while classifier ran” likely means: parser timed out on an earlier run; on a later run parser completed and classifier ran. Or the client retries and the second run succeeds for parser and then classifier runs.

**Fix plan (timeouts / robustness)**

1. **Increase parser timeout** for large reports: e.g. `PARSER_TIMEOUT_MS = 60_000` or 90_000, and/or make it configurable via body.
2. **Per-agent time budget:** Keep separate timeouts; optionally add a total pipeline timeout (e.g. 120s) and abort remaining work if exceeded.
3. **Batching / early return:** Parser already supports `cursor` and `max_pdfs: 2`; ensure client polls until `done` so parser never has to process all PDFs in one 20s window. Optionally reduce `max_pdfs` to 1 for very long reports.
4. **Return partial on parser timeout:** Already done (200 + `comment_parser: { error: "timeout", ... }`). Document that client should poll again with same `project_id` and optional `cursor` from last response.

---

### 5) Auto-Router Agent (assigned_to) — **PASS**

**Evidence**

- **File:** `supabase/functions/auto-router-agent/index.ts`
- **Logic:** Loads `parsed_comments` for project where `assigned_to` is null or empty; maps `discipline` to assignee via `DISCIPLINE_ROUTING`; updates `parsed_comments.assigned_to`.

```typescript
// auto-router-agent/index.ts (9–26, 89–127)
const DISCIPLINE_ROUTING: Record<string, string> = {
  Structural: "Structural Engineer",
  Architectural: "Project Architect",
  Mechanical: "MEP Engineer",
  // ...
  Other: "Project Manager",
};
const DEFAULT_ASSIGNEE = "Project Manager";
// ...
const { data: rows } = await supabase
  .from("parsed_comments")
  .select("id, discipline")
  .eq("project_id", projectId)
  .or("assigned_to.is.null,assigned_to.eq.")
  .limit(500);
for (const row of comments) {
  const assignee = discipline ? (DISCIPLINE_ROUTING[discipline] ?? DEFAULT_ASSIGNEE) : DEFAULT_ASSIGNEE;
  await supabase.from("parsed_comments").update({ assigned_to: assignee }).eq("id", row.id);
}
```

**Repro:** Run classifier so disciplines are set, then invoke auto-router-agent with `project_id`; confirm `parsed_comments.assigned_to` updated. (UI that triggers auto-router was not searched; if missing, add a “Route comments” button that calls this function.)

**Fix plan:** None for spec. Optional: ensure dashboard or Response Matrix has a button to run auto-router when desired.

---

### 6) Deadline Tracker (UI) — **PASS**

**Evidence**

- **File:** `src/components/dashboard/ProjectHealthCard.tsx`
- **Data:** `projects.last_checked_at`, `projects.deadline`; `parsed_comments` for counts (pending / ready / approved).

**Displayed**

- **“Days since last check”:** `lastCheckText` — “Last portal check: X hours ago” or “X days ago” (or “never”).
- **“Deadline in N days”:** `deadlineText` — “MMM d, yyyy (in N days)” or “(N days ago)”.
- **“X comments unresponded”:** “Comments: Total N · Pending X ⚠ · Ready for review … · Approved …”.

```typescript
// ProjectHealthCard.tsx (64–68, 86–88, 128–131, 184–194)
const daysSinceCheck = lastCheckedAt != null ? daysBetween(lastCheckedAt, now) : null;
const daysUntilDeadline = deadline != null ? daysBetween(now, deadline) : null;
// ...
const lastCheckText = lastCheckedAt == null
  ? "Last portal check: never"
  : (hoursSinceCheck ?? 0) < 24
    ? `Last portal check: ${hoursSinceCheck} hour(s) ago`
    : `Last portal check: ${daysSinceCheck} day(s) ago`;
const deadlineText = ... `${format(deadline, "MMM d, yyyy")} (in ${daysUntilDeadline} days)` ...
// ...
<span>Total {total_comments}</span>
{pending_comments > 0 && <span className="...">· Pending {pending_comments} ⚠</span>}
```

**Repro:** Open Dashboard with a selected project that has `last_checked_at` and `deadline` and some `parsed_comments`; confirm Project Health card shows last check time, deadline, and comment counts.

**Fix plan:** None.

---

### 7) Completeness Validator — **PASS**

**Evidence**

- **Edge function:** `supabase/functions/validate-completeness-agent/index.ts`
- **UI:** `src/pages/ResponseMatrix.tsx` — “Validate completeness” (or similar) invokes it and shows result.

**Logic**

- Fetches `parsed_comments` for project (`id`, `response_text`, `status`).
- **Complete:** `response_text` non-empty and `status` in `Ready for review` or `Approved`; otherwise row is in `missing`.
- Response shape: `{ complete, stats: { total, responded, pending }, missing }`.

```typescript
// validate-completeness-agent/index.ts (70–111)
const { data: comments } = await supabase
  .from("parsed_comments")
  .select("id, response_text, status")
  .eq("project_id", projectId);
const missing: string[] = [];
let responded = 0;
for (const row of rows) {
  const hasResponse = row.response_text != null && String(row.response_text).trim() !== "";
  const statusOk =
    (row.status ?? "").toLowerCase() === "ready for review" ||
    (row.status ?? "").toLowerCase() === "approved";
  if (hasResponse && statusOk) {
    responded++;
  } else {
    missing.push(row.id);
  }
}
const complete = pending === 0;
return new Response(JSON.stringify({ complete, stats: { total, responded, pending }, missing }), ...);
```

**Repro:** Response Matrix → select project → click “Validate completeness”; confirm modal/dialog shows complete/pending and missing count.

**Fix plan:** None.

---

### 8) Guardian Agent (quality scoring) — **PASS**

**Evidence**

- **Edge function:** `supabase/functions/guardian-quality-agent/index.ts`
- **UI:** `src/pages/ResponseMatrix.tsx` — “Quality check” (or similar) invokes `guardian-quality-agent` and shows results (scores, flags, summary).

**Behavior**

- Loads comments with responses; chunks (e.g. 25); sends to OpenAI for score 1–10, flags, notes, suggested_improvement.
- Returns `{ project_id, results: [{ id, score, flags, notes, suggested_improvement }], summary: { avg_score, flagged_count, top_issues } }`.
- Can persist quality check runs (e.g. insert into a checks table).

```typescript
// guardian-quality-agent/index.ts (13–25, 62–64)
const SYSTEM_INSTRUCTION = `You are a permit plan review response QA reviewer. Score each response...
Return ONLY valid JSON in this exact shape:
{
  "results": [ { "id": "...", "score": number, "flags": [], "notes": "...", "suggested_improvement": "..." } ],
  "summary": { "avg_score": number, "flagged_count": number, "top_issues": ["..."] }
}`;
```

**Repro:** Response Matrix → “Run quality check”; confirm results and summary display.

**Fix plan:** None.

---

### 9) Document & Package Agent (export-response-package) — **PARTIAL**

**Evidence**

- **File:** `supabase/functions/export-response-package/index.ts`
- **Flow:** Auth → load project → fetch all `parsed_comments` for project → filter to rows with non-empty `response_text` → if any missing, return **400** with `{ error: "Incomplete responses", missing_count }` → else build PDF with pdf-lib, upload to storage `exports/`, create signed URL, return 200 with `{ url, file_path }`.

**Failing path (incomplete responses)**

```typescript
// export-response-package/index.ts (92–108)
const { data: allComments } = await supabase
  .from("parsed_comments")
  .select("...")
  .eq("project_id", projectId)
  .order(...);
const withResponse = rows.filter((r) => r.response_text != null && String(r.response_text).trim() !== "");
const missingCount = rows.length - withResponse.length;
if (missingCount > 0) {
  return json({ error: "Incomplete responses", missing_count: missingCount }, 400);
}
// ...
if (toExport.length === 0) {
  return json({ error: "No comments to export", missing_count: 0 }, 400);
}
```

**“EarlyDrop”**

- No string `EarlyDrop` appears in the repo. A non-2xx or early exit could be logged by the Supabase runtime or a proxy. The only intentional non-2xx in this function are **400** (incomplete or no comments) and **401/404/500** for auth/project/upload/errors.

**Possible causes of failure**

1. **Incomplete responses:** One or more comments have no `response_text` → 400 with `missing_count`. **Fix:** Ensure all comments have responses before export, or change spec to “export only responded” and remove this 400 when partial export is allowed.
2. **Memory/timeouts:** Large project + pdf-lib in one shot could hit memory or function timeout. **Fix:** Process comments in chunks (e.g. 50 per page), stream or paginate PDF generation; or increase function memory/timeout in Supabase.
3. **Storage/signed URL:** Upload or `createSignedUrl` fails → 500. **Fix:** Ensure `exports` bucket exists and RLS allows insert; check logs for upload/sign errors.

**Fix plan (minimal)**

1. **Incomplete vs partial export:** If spec allows “export only completed,” change to: do not return 400 for missing_count; export only `withResponse` and return 200 (and optionally include `missing_count` in body for UI). If spec requires all complete, keep 400 but add a UI message: “Complete all responses before exporting” and show `missing_count`.
2. **Time/memory:** For large N, build PDF in chunks (e.g. one page per chunk of comments), or move PDF generation to client (e.g. jsPDF) using data fetched from an API that returns only the export payload (no PDF in edge function).
3. **Diff outline:**  
   - Option A: In `export-response-package/index.ts`, remove the `if (missingCount > 0) return json(..., 400)` block; export `withResponse` only; return `missing_count` in success body.  
   - Option B: Add pagination: accept `limit`/`offset` or `comment_ids[]`, fetch that subset, generate PDF for that subset, return URL; client can call multiple times and merge or show “Page 1 of K” downloads.

---

## Next 5 commits (prioritized)

1. **Comment parser — drop metadata/footer from inserts**  
   In `comment-parser-agent/index.ts`, before inserting each parsed comment, skip if `original_text` contains any `METADATA_PHRASES` or matches `DATE_TIME_PATTERN`. Reduces noisy “Created in ProjectDox…” and timestamp rows in `parsed_comments`.

2. **Export package — allow partial export or clearer 400**  
   Either (a) export only comments with non-empty `response_text` and return 200 with `missing_count` in body, or (b) keep 400 but add a dedicated error code and UI message that shows “Complete N more responses to export full package.”

3. **Intake pipeline — increase parser timeout and document polling**  
   Raise `PARSER_TIMEOUT_MS` to 60s (or make it configurable); in docs or UI, state that “Run Manual Check” may need to poll until `comment_parser.done === true` for large reports.

4. **Comment parser — restrict to single “Plan Review - Review Comments” PDF**  
   When multiple PDFs match “Review Comments”, prefer the one whose `fileName` is exactly “Plan Review - Review Comments” or “Plan Review - Review Comments Report” and parse only that one (or the first match) to avoid mixing in other report types.

5. **Auto-router — UI trigger**  
   Add a “Route comments” (or “Assign by discipline”) button on Dashboard or Response Matrix that calls `auto-router-agent` with current `project_id`, so assignees are set without ad-hoc invocation.

---

*End of SPEC COMPLIANCE REPORT.*
