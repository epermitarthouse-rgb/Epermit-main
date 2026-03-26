# Baltimore Plan Review — Extraction and Persistence Diagnosis (No Fixes)

**Scope:** Diagnosis only. No code or frontend changes. Prove what the scraper extracts, whether it is the wrong concept, and whether hash-skip causes stale display.

---

## 1. Plan Review extractor in `scraper-service/accela-scraper.js`

### 1.1 Exact function

- **Name:** `extractPlanReview`
- **Location:** Lines 1325–1416 (approx).

### 1.2 Click flow (no dropdown)

- **Function:** `clickAccelaNavPanel(ctx, page, selectors, "Plan Review", { checkpointLabel: "after_plan_review" })`
- **No** `expandRecordInfoFirst` or `expandPaymentsFirst` — Plan Review is a direct tab.
- **Selectors (in order):**
  - `'[id*="TabDataList"] a:has-text("Plan Review")'`
  - `'a:has-text("Plan Review")'`
  - `'a[id*="PlanReview"]'`
- After click: `page.waitForTimeout(1500)` then parser runs in `ctx` (record frame).

### 1.3 Parsing logic (exact)

```js
const data = await ctx.evaluate(() => {
  const comments = [];
  const candidateTables = Array.from(document.querySelectorAll("table")).filter((table) => {
    const text = (table.innerText || "").replace(/\s+/g, " ").trim().toLowerCase();
    return (
      text.includes("reviewer") ||
      text.includes("department") ||
      text.includes("comment") ||
      text.includes("review status")
    );
  });
  const root = candidateTables[0] || null;   // FIRST matching table only
  if (!root) return { comments: [], text: "" };
  const rows = root.querySelectorAll("tr");
  rows.forEach((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map(...).filter(Boolean);
    if (cells.length >= 3) {
      comments.push({
        reviewer: cells[0] || "",
        department: cells[1] || "",
        comment: cells[2] || "",
        date: cells[3] || "",
      });
    }
  });
  // build text from comments, return { comments, text }
});
```

- **Container:** Entire document in `ctx` — **all** `document.querySelectorAll("table")` in the frame.
- **Filter:** Keep only tables whose innerText (lowercase) contains **any** of: `"reviewer"`, `"department"`, `"comment"`, `"review status"`.
- **Selection:** `candidateTables[0]` — first such table in DOM order.
- **Row parsing:** Every `tr` under that table; each row’s `td` cells; require `cells.length >= 3`; map to `{ reviewer: cells[0], department: cells[1], comment: cells[2], date: cells[3] }`. No header row skip.

### 1.4 Output shape from extractor

- **Return value:**  
  `{ comments: Array<{ reviewer, department, comment, date }>, text: string, screenshot: string | null }`
- **`text`:** Concatenation of "Reviewer: X", "Department: Y", "Comment: Z", "Date: W" for each comment.

### 1.5 Where it goes in `portalData`

- **Path:** `portalData.tabs.reports.pdfs`
- **Code (accela-scraper.js ~2260–2285):**

```js
reports: {
  pdfs: [
    ...(processingStatus.screenshot ? [{ fileName: "Processing Status", ... }] : []),
    ...(planReview.text
      ? [
          {
            fileName: "Plan Review - Review Comments",
            text: planReview.text,
            screenshot: planReview.screenshot,
            source: "accela",
            comments: planReview.comments,
          },
        ]
      : []),
    ...(headerScreenshotBase64 ? [{ fileName: "Record Overview", ... }] : []),
  ],
  keyValues: [],
  tables: [],
},
```

- **Plan Review entry is added only when** `planReview.text` is truthy (i.e. at least one comment was parsed).
- **Runtime shape for Plan Review (in-memory before hash):**

```js
portalData.tabs.reports.pdfs[]  // one element when planReview.text is set
  .fileName === "Plan Review - Review Comments"
  .text   = string (reviewer/department/comment/date lines)
  .screenshot = base64 or null
  .source = "accela"
  .comments = [
    { reviewer: string, department: string, comment: string, date: string },
    ...
  ]
```

So the **exact** runtime object for Plan Review is:  
`portalData.tabs.reports.pdfs` where `pdf.fileName === "Plan Review - Review Comments"`; that element’s `comments` array is what the UI shows under Plan Review.

---

## 2. Baltimore Plan Review page structure (evidence)

### 2.1 Real Baltimore Plan Review tab (from `Accela Citizen Access.html`)

- **Section title:** "Plan Review Status:" (`span.pil-section-title`).
- **Structure:** **No `<table>`.** Content is:
  - `div.pil-section` → multiple `div.pil-subsection` → each has `span.pil-subsection-title` + `span.pil-subsection-value` (label/value pairs).
- **Real fields present:**
  - Review Type (e.g. "BIC Building")
  - Total Number of Files (e.g. "4") + "View uploaded files"
  - Time Elapsed (e.g. "16 days  15.5 hrs")
  - Prescreen Review Comments (Unresolved)
  - Time with Jurisdiction / Time with Applicant
  - Status (e.g. "Approved") + "Download Approved Plans"
  - Current Non-Completed Tasks (e.g. "0")

So the **actual** Plan Review tab is a **summary/status** page built from **divs/spans**, not tables.

### 2.2 What the extractor actually sees

- **Extractor:** Runs in the **record frame** after clicking "Plan Review". The frame’s document can still contain **other tabs’ markup** (e.g. Processing Status) in the same DOM, with visibility toggled by CSS/JS.
- **`document.querySelectorAll("table")`** returns **every** `<table>` in that document.
- **Processing Status** lives in `#tab-processing_status` (`Accela Citizen Access.html` ~4998) and is a **table** with:
  - Rows like "Application Intake", "Initial Zoning Review", "Architectural and Structural Review", …
  - Each row has "Due: …" and "Status: …".
  - So the table’s innerText contains **"Status"** (and often "Due", and task names that can read like departments).
- **Filter:** A table is kept if its innerText includes **"reviewer"** | **"department"** | **"comment"** | **"review status"**. The Processing Status table contains **"Status"** in many cells; **"review status"** is a substring of that. So this table **matches** the filter.
- **Order:** If the Processing Status table appears **before** any other table that also matches (or is the only match), then **`candidateTables[0]`** is the **Processing Status** table, not Plan Review content.
- **Parsing:** Every `tr` with ≥3 `td` is turned into one “comment” with reviewer/department/comment/date. Nested tables inside the workflow yield many rows. That easily produces **32** entries (e.g. one per task or per nested row).

### 2.3 Comparison: what is captured vs what is real

| Real Baltimore Plan Review (summary fields) | Extractor behavior |
|--------------------------------------------|--------------------|
| Review Type, Total Number of Files, Time Elapsed, Prescreen Review Comments, Time with Jurisdiction, Time with Applicant, Status, Current Non-Completed Tasks, Download Approved Plans | **Not captured.** They are in divs/spans; the extractor only considers **tables** and uses the **first** table matching reviewer/department/comment/review status. |
| Any table that looks like “review comments” (reviewer, department, comment) | **Not present** on the real Plan Review tab in the saved HTML; the summary is div-based. |

| What is actually captured | Source |
|---------------------------|--------|
| Dozens of rows (e.g. 32 “review comments”) | **Processing Status** table: task name, Due, Status, etc., parsed as reviewer/department/comment/date. So the extractor is **scraping workflow/task rows**, not Plan Review summary fields. |

**Conclusion:** The scraper’s Plan Review extractor uses a **table-based, first-match** model (reviewer/department/comment/review status). On Baltimore, (1) the real Plan Review content is **not** in a table, and (2) the first matching table in the DOM is the **Processing Status** table. So the extracted “plan review” data is **the wrong concept** — it is workflow/due-date/task data, not Plan Review summary/status.

---

## 3. Runtime `portalData.tabs.reports` (and Plan Review) shape

We cannot run the scraper here; the following is the **exact shape** the code produces when Plan Review returns 32 comments.

- **Path:** `portalData.tabs.reports`
- **Content:**

```js
{
  pdfs: [
    { fileName: "Processing Status", text: "...", screenshot: "...", source: "accela" },
    {
      fileName: "Plan Review - Review Comments",
      text: "Reviewer: Application Intake\nDepartment: ...\nComment: ...\nDate: ...\n\nReviewer: Initial Zoning Review\n...",  // 32 blocks
      screenshot: "<base64>",
      source: "accela",
      comments: [
        { reviewer: "Application Intake", department: "...", comment: "...", date: "02/24/2025" },
        { reviewer: "Initial Zoning Review", department: "...", comment: "...", date: "03/02/2025" },
        // ... 30 more workflow-style rows
      ],
    },
    { fileName: "Record Overview", text: "...", screenshot: "...", source: "accela" },
  ],
  keyValues: [],
  tables: [],
}
```

So the **32 “review comments”** in the log are **32 workflow/task rows** stored under `reports.pdfs[].comments` for "Plan Review - Review Comments". The app’s Plan Review panel reads this same array, so it shows workflow/due-date style entries — because that is what was written, not because the UI is reading the wrong key.

---

## 4. Hash and persistence

### 4.1 Hash computation

- **Function:** `hashPortalData(portalData)` (server.js ~174–179).
- **Implementation:** `stableStringify(portalData)` → SHA-256 hex.
- **`stableStringify`:** Recursive; object keys **sorted**; arrays in order; entire `portalData` is serialized, including `tabs.reports.pdfs` and every `comments` array.

So **Plan Review data is included in the hash.** Any change in `planReview.comments` or `planReview.text` changes the string and thus the hash.

### 4.2 Persistence flow (accela-scraper.js ~2405–2430)

1. Build `portalData` (including `planReview` → `tabs.reports.pdfs`).
2. `newHash = hashPortalData(portalData)`.
3. Load existing project row: `existingRow.portal_data_hash`.
4. If `existingRow.portal_data_hash === newHash` → log **"Data unchanged (hash match), skipping update"** and only update `last_checked_at`; **do not** write `portal_data`.
5. If hash differs → update row with `portal_data` and `portal_data_hash: newHash`.

### 4.3 Why hash matched

- **Same extraction every run:** The Plan Review extractor always:
  - Clicks Plan Review tab,
  - Runs in the same frame,
  - Picks the same first table (Processing Status),
  - Parses the same workflow rows → same 32 (or N) comments.
- So **scraper output is effectively unchanged** between runs. Therefore **`portalData` is the same** → **`newHash` is the same** → **hash match** → skip update.
- So **“Data unchanged (hash match), skipping update”** does **not** mean the hash “ignores” Plan Review. It means the **payload is identical** (same wrong data) so the hash is identical. We are not “losing” a correct Plan Review update; we never wrote correct Plan Review summary data in the first place.

### 4.4 Current DB vs newly scraped vs UI

- **Current DB `portal_data`:** Contains the last written payload — i.e. the one with 32 workflow rows in `tabs.reports.pdfs[Plan Review - Review Comments].comments`.
- **Newly scraped in-memory `portalData` (before hash check):** Same structure and same content as long as the page and extractor are unchanged.
- **Resulting hash:** Same as stored `portal_data_hash`; hence skip.
- **UI:** Reads `portalData.tabs.reports.pdfs[].comments` for the Plan Review panel. So it shows exactly what’s in DB: the 32 workflow-style entries. So the UI is **not** reading a wrong field; it is reading the field we filled with the wrong concept.

---

## 5. Root-cause summary

| Question | Answer |
|----------|--------|
| Is the scraper extracting the wrong concept? | **Yes.** It expects a table with reviewer/department/comment/review status and takes the **first** such table. On Baltimore, the real Plan Review tab is **div-based summary** (Review Type, Time Elapsed, Status, etc.). The first matching table is the **Processing Status** table, so we store workflow/task rows as “plan review comments.” |
| Are real Plan Review fields captured? | **No.** Review Type, Total Number of Files, Time Elapsed, Prescreen Review Comments, Time with Jurisdiction/Applicant, Status, Current Non-Completed Tasks, Download Approved Plans are **not** in any table the extractor uses; they are in divs/spans and are never read. |
| Is the app showing stale DB data because of hash-skip? | **No.** Hash-skip occurs because the **new** scrape produces the **same** wrong payload as before. The DB already holds that wrong payload; the UI shows it. We are not skipping an update that would have fixed Plan Review. |
| Does the hash ignore Plan Review? | **No.** The full `portalData` (including `tabs.reports.pdfs` and `comments`) is hashed. |
| Is the frontend reading the wrong field? | **No.** It correctly reads `portalData.tabs.reports.pdfs[].comments` for the Plan Review panel; that array is exactly what the scraper put there (workflow rows). |

---

## 6. Single precise root-cause statement

**The Plan Review section shows workflow/due-date entries because the scraper uses a table-based “review comments” model and, on Baltimore, the first matching table in the record frame is the Processing Status workflow table; the scraper therefore persists workflow/task rows into `portalData.tabs.reports.pdfs[Plan Review - Review Comments].comments`. The real Baltimore Plan Review summary (Review Type, Time Elapsed, Status, etc.) is rendered in divs/spans and is never extracted. Hash-skip is a consequence of unchanged (wrong) output, not the cause of stale or incorrect data; the frontend displays the data the scraper wrote.**

In short: **Wrong Plan Review scraper model** (table selection + first-match) for Baltimore’s div-based summary and mixed DOM with Processing Status table — **not** stale persistence from hash-skip, and **not** frontend reading the wrong field.
