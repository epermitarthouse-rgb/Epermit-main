# Baltimore Scraper Completeness — Diagnosis Only

**Scope:** Identify why Baltimore Accela scraper output is sparse for some sections. No code changes; frontend unchanged. Evidence from `scraper-service/accela-scraper.js` and observed logs (e.g. "Record Details: 1 field", "Processing Status: link not found", "Plan Review: works").

---

## Shared context

- **Record frame:** `getExtractionContext(page)` returns `page._recordFrame || page`. `_recordFrame` is set in `openRecordDetailPage` to the first frame whose URL matches `Cap/CapDetail`, `capDetail`, `Record`, or `permit`, or else the frame containing the permit number. All extraction runs in this single context (`ctx`).
- **Click flow:** Each section uses `clickAccelaNavPanel(ctx, page, selectors, label, options)`. For Record Info sub-items, `expandRecordInfoFirst: true` runs first: clicks "Record Info" in `ctx`, waits 800 ms, then looks for the panel link (e.g. "Record Details") in `ctx`. For Payments/Fees, `expandPaymentsFirst: true` clicks "Payments", waits 800 ms, then looks for "Fees" or "Payments" in `ctx`. After a successful click: `waitForAccelaLoad(page)`, then 1200 ms wait, optional checkpoint screenshot.
- **Observed Baltimore behavior (from logs):** Record Details opens and yields 1 field; Plan Review opens and yields comments; Processing Status, Related Records, Attachments report "link not found"; Inspections opens but 0 extracted; Payments/Fees "link not found".

---

## 1. Record Details

**Extractor:** `extractRecordDetails` (lines 897–1009).

**Click flow:**
- `expandRecordInfoDropdown(ctx, page)` then click one of: `[id*="TabDataList"] a:has-text("Record Details")`, `a:has-text("Record Details")`, `a:has-text("Record Detail")`, `a[id*="RecordDetail"]`.
- After click: `page.waitForTimeout(1500)` then run parser in `ctx`.

**Parser logic:**
- Find **candidate tables** with `document.querySelectorAll("table")` filtered by innerText containing any of: "application name", "work location", "address", "parcel", "description", "job value", "project name", "applicant", "contractor", "fee", "parcel number", "lot", "block".
- For each candidate table, iterate `tr`, each row: `td` cells; require `cells.length >= 2`; label = cells[0], value = cells[1]; skip if label/value in badLabels, or label/value too long, or value is "add"/"cancel", etc.; merge into `fields`; also build `rows` as `{ key, value }` for first table.

**Likely failure points:**
- **Panel/tab not opened:** Unlikely; logs show "Record Details: 1 field", so the link was found and the panel opened.
- **Wrong selector:** Unlikely for the link; possible for tables if Baltimore uses different layout (e.g. divs instead of tables, or table without those keywords).
- **Timing:** 1500 ms after click may be short if Baltimore loads Record Details content asynchronously.
- **Table parsing assumption:** Parser assumes label in first cell, value in second; filters tables by a fixed keyword list. If Baltimore uses different labels (e.g. "Project #" instead of "application name") the table may be excluded. If there are multiple tables and only one has a matching keyword, we only read that one; if that table has one row we get "1 field".
- **Portal variation:** Baltimore may use one main table with many rows but only one row passing the badLabels/length checks, or multiple small tables and only one matches the keyword filter.

**Likely reason for sparse output:** Parser logic — table filter keywords may not match Baltimore’s labels, or only one table/row passes; possible timing if content is lazy-loaded.

**Confidence:** Medium (panel opens; parser and/or timing is the constraint).

**Fix likely belongs in:** Parser logic (broaden table detection / keyword list, or fallback to any table with 2+ column rows); optionally click/wait (longer or wait for a content selector).

---

## 2. Processing Status

**Extractor:** `extractProcessingStatus` (lines 1011–1161).

**Click flow:**
- `expandRecordInfoDropdown(ctx, page)` then click one of: `[id*="TabDataList"] a:has-text("Processing Status")`, `a:has-text("Processing Status")`, `a[id*="ProcessingStatus"]`, `a:has-text("Workflow")`.
- After click: click any expand buttons (`[id*="expand"]`, `.collapse-icon`, etc.), wait 500 ms each, then 2000 ms; run parser in `ctx`.

**Parser logic:**
- Container: first of `#ctl00_PlaceHolderMain_PermitDetailList`, `#ctl00_PlaceHolderMain_CAPDetail`, `[id*="PlaceHolderMain"][id*="Detail"]`, etc. with non-empty text.
- Rows: `container.querySelectorAll('[id*="WorkflowTask"], [id*="ProcessStatus"] tr, .workflow-task, li[id*="task"]')`. For each row, look for task name, status, date, details via specific IDs/classes; push into `depts`. Fallback: find any table whose header row contains "task", "department", or "step", then read data rows as cells.

**Likely failure points:**
- **Panel not opened:** Logs say "Processing Status: link not found". So the **link** was not found in `ctx` after expanding Record Info. The dropdown may not be exposing "Processing Status" in the same document as `ctx`, or the text/ID differs (e.g. "Workflow" or different casing).
- **Wrong selector:** Sub-menu item might not be `a:has-text("Processing Status")` in Baltimore (e.g. different label or structure). Selectors are scoped to `ctx`; if the menu is rendered in main page or another iframe, `ctx.$(...)` will not find it.
- **Timing:** 800 ms after "Record Info" click might be too short for Baltimore’s dropdown to open and render sub-items.
- **Iframe/context:** Dropdown might render outside the record frame (e.g. overlay in main document), so all sub-item selectors fail in `ctx`.

**Likely reason for sparse/empty output:** Click flow — "Processing Status" link not found; either dropdown not open/long enough in `ctx`, or sub-menu rendered outside record frame, or different label/ID.

**Confidence:** High (log explicitly says "link not found").

**Fix likely belongs in:** Click/wait flow (e.g. wait for menu to be visible before clicking sub-item, or longer delay; try main page if not in `ctx`); or selector logic (Baltimore-specific text/ID for Processing Status or Workflow).

---

## 3. Related Records

**Extractor:** `extractRelatedRecords` (lines 1257–1337).

**Click flow:**
- `expandRecordInfoDropdown(ctx, page)` then click one of: `[id*="TabDataList"] a:has-text("Related Records")`, `a:has-text("Related Records")`, `a[id*="RelatedRecord"]`.
- Optional: click "View Entire Tree" / "Entire Tree" if present, then `waitForAccelaLoad(page)`.
- Parser runs in `ctx`.

**Parser logic:**
- Same container resolution as Processing Status.
- Rows: `container.querySelectorAll('[id*="RelatedRecord"] tr, [id*="Related"] table tr')`. Each row: cells; row 0 = record number (skip if "record number" header); push `record_number`, `record_type`, `status`, `project_name`, `date`.

**Likely failure points:**
- **Panel not opened:** Logs say "Related Records: link not found". Same as Processing Status: the sub-item link is not found in `ctx` after expanding Record Info.
- **Wrong selector / iframe:** Same as Processing Status — sub-menu visibility or context.

**Likely reason for sparse/empty output:** Click flow — link not found (dropdown or context).

**Confidence:** High.

**Fix likely belongs in:** Click/wait flow; or selector logic if Baltimore uses different label/structure for Related Records.

---

## 4. Attachments

**Extractor:** `extractAttachments` (lines 1339–1622).

**Click flow:**
- `expandRecordInfoDropdown(ctx, page)` then click one of: `[id*="TabDataList"] a:has-text("Attachments")`, `a:has-text("Attachments")`, `a:has-text("Attachment")`, `a[id*="Attachment"]`, `a:has-text("Documents")`, `a[id*="Document"]`.
- Parser runs in `ctx`; then download loop uses `page` for clicks and navigation.

**Parser logic:**
- Same container resolution.
- Rows: `container.querySelectorAll('[id*="Attachment"] tr, [id*="Document"] tr')`. Cells: name (skip "file name"/"document name"), record_id, type, etc.; filter by name length and header skip.

**Likely failure points:**
- **Panel not opened:** Logs say "Attachments: link not found". Again the Record Info sub-item is not found in `ctx`.
- **Iframe/context:** Same pattern as Processing Status and Related Records.

**Likely reason for sparse/empty output:** Click flow — link not found.

**Confidence:** High.

**Fix likely belongs in:** Click/wait flow (same as other Record Info sub-items); or selector if Baltimore uses different label.

---

## 5. Inspections

**Extractor:** `extractInspections` (lines 1674–1827).

**Click flow:**
- `expandRecordInfoDropdown(ctx, page)` then click one of: `[id*="TabDataList"] a:has-text("Inspections")`, `a:has-text("Inspections")`, `a:has-text("Inspection")`, `a[id*="Inspection"]`.
- Parser runs in `ctx`.

**Parser logic:**
- Same container resolution.
- Look for sections: `mainContainer.querySelector('[id*="Upcoming"], ...')` and `'[id*="Completed"], ...'`; for each, get table (closest/child) and parse rows (type, status, date, inspector, result). If no sections found, fallback: `mainContainer.querySelectorAll('[id*="Inspection"] tr, [id*="inspection"] tr')` and infer category from status text (pass/fail/etc.).

**Likely failure points:**
- **Panel opened:** Logs indicate Inspections was clicked and panel opened (no "link not found"), but "0 extracted". So either the panel is empty on the portal or the parser does not see the content.
- **Wrong selector:** Baltimore may not use IDs containing "Upcoming", "Completed", or "Inspection"; or structure may be div/grid instead of table with those IDs.
- **Table structure:** Rows might be in a different structure (e.g. different table class, or content in an iframe within the panel).

**Likely reason for sparse output:** Parser logic — section/row selectors may not match Baltimore’s DOM (IDs or structure).

**Confidence:** Medium (click works; 0 rows points to parser or empty panel).

**Fix likely belongs in:** Parser logic (add Baltimore-friendly selectors or generic table fallback for inspection-like tables); confirm panel actually has content in checkpoint screenshot.

---

## 6. Fees / Payments

**Extractor:** `extractPayments` (lines 1829–1906).

**Click flow:**
- `expandPaymentsDropdown(ctx, page)` then click one of: `[id*="TabDataList"] a:has-text("Fees")`, `a:has-text("Fees")`, `[id*="TabDataList"] a:has-text("Payments")`, `a:has-text("Payments")`, `a:has-text("Payment")`, `a[id*="Payment"]`.
- Parser runs in `ctx`.

**Parser logic:**
- Same container resolution.
- Rows: `container.querySelectorAll('[id*="Payment"] tr, [id*="Fee"] tr')`; cells: description, amount, status, date; skip header row by description check.

**Likely failure points:**
- **Panel not opened:** Logs say "Payments/Fees: link not found". So after expanding the Payments dropdown, neither "Fees" nor "Payments" was found in `ctx`. Same pattern as Record Info sub-items: dropdown may not be in frame, or not open long enough, or different label.
- **Wrong selector / timing:** 800 ms after "Payments" click might be too short; or "Fees" might be in a different container.

**Likely reason for sparse/empty output:** Click flow — Fees/Payments link not found after expanding Payments dropdown.

**Confidence:** High.

**Fix likely belongs in:** Click/wait flow (wait for Payments sub-menu to be visible, or longer delay); or selector (Baltimore-specific text/ID for Fees).

---

## 7. Plan Review

**Extractor:** `extractPlanReview` (lines 1163–1255).

**Click flow:**
- No dropdown; direct tab. `clickAccelaNavPanel(ctx, page, selectors, label, { checkpointLabel: "after_plan_review" })` with `a:has-text("Plan Review")`, `a[id*="PlanReview"]`.
- After click: `page.waitForTimeout(1500)` then parser in `ctx`.

**Parser logic:**
- Find tables whose innerText includes "reviewer", "department", "comment", or "review status"; take first; for each `tr`, cells >= 3 → reviewer, department, comment, date; push into `comments`.

**Likely failure points:**
- **Panel opened:** Observed to work (comments extracted). So link is in `ctx` and panel content is in `ctx` with table structure the parser expects.
- **Portal variation:** Plan Review is a direct tab (no dropdown), so it behaves like Record Details and Plan Review for visibility; dropdown sub-items are the ones failing.

**Likely reason for sparse/empty output:** N/A for Baltimore when comments exist; frontend mapping bug (`.text` vs `.comment`) was fixed separately.

**Confidence:** N/A (section working).

**Fix likely belongs in:** None for completeness; optional parser robustness if some tenants use different table text.

---

## Summary table

| Section           | Extractor               | Click flow summary                    | Parser summary                          | Observed issue        | Likely reason           | Confidence | Fix likely in   |
|------------------|-------------------------|----------------------------------------|-----------------------------------------|------------------------|--------------------------|------------|-----------------|
| Record Details   | extractRecordDetails    | Expand Record Info → Record Details     | Tables by keywords; rows as label/value  | 1 field only           | Table filter / structure | Medium     | Parser          |
| Processing Status| extractProcessingStatus | Expand Record Info → Processing Status  | WorkflowTask/ProcessStatus or table      | Link not found         | Sub-menu not in ctx/time | High       | Click/wait      |
| Related Records  | extractRelatedRecords   | Expand Record Info → Related Records    | RelatedRecord/Related table tr          | Link not found         | Sub-menu not in ctx/time | High       | Click/wait      |
| Attachments      | extractAttachments      | Expand Record Info → Attachments        | Attachment/Document tr                  | Link not found         | Sub-menu not in ctx/time | High       | Click/wait      |
| Inspections      | extractInspections      | Expand Record Info → Inspections        | Upcoming/Completed sections or Inspection tr | 0 extracted      | Selectors/structure      | Medium     | Parser          |
| Fees / Payments  | extractPayments         | Expand Payments → Fees/Payments         | Payment/Fee tr                          | Link not found         | Sub-menu not in ctx/time | High       | Click/wait      |
| Plan Review      | extractPlanReview       | Direct Plan Review tab                  | Table with reviewer/department/comment  | Works                  | —                        | —          | —               |

---

## Top 3 scraper fixes (prioritized)

1. **Record Info dropdown sub-item visibility / context (Processing Status, Related Records, Attachments).**  
   Multiple "link not found" for sub-items after "Record Info" expand. Fix: ensure the sub-menu is visible and in scope before clicking — e.g. wait for a visible sub-menu container or for a specific link (e.g. "Processing Status") to appear in `ctx` after expand; optionally try main page or another frame if the menu is known to render outside the record frame. Optionally increase the delay after "Record Info" click (e.g. 800 → 1200–1500 ms) or add an explicit wait for a menu selector. This single change could fix Processing Status, Related Records, and Attachments together. **Priority: 1.**

2. **Payments dropdown → Fees visibility (Payments/Fees).**  
   "Link not found" for Fees/Payments after expanding Payments. Same idea as (1): wait for the Payments sub-menu to be visible (e.g. wait for "Fees" or a menu container) before clicking; optionally increase delay after "Payments" click; or add Baltimore-specific selector if the label differs. **Priority: 2.**

3. **Record Details table detection and Inspections row detection (parser logic).**  
   Record Details: only 1 field extracted — broaden table selection (e.g. include tables with other keywords, or a safe fallback for any table with 2-column label/value-like rows) and relax filters so more rows are included. Inspections: 0 extracted — add fallback selectors (e.g. generic tables under the Inspections panel, or Baltimore-specific IDs/classes) and ensure we parse rows even when "Upcoming"/"Completed" sections are not found. **Priority: 3.**

---

**End of diagnosis.** No code or frontend changes were made.
