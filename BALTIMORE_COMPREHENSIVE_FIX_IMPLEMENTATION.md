# Baltimore Accela Record Extraction — Comprehensive Fix Implementation

**Evidence base:** BALTIMORE_SCRAPER_COMPLETENESS_DIAGNOSIS.md, BALTIMORE_PLAN_REVIEW_DIAGNOSIS.md, Baltimore portal structure (Record Info/Payments dropdowns, direct Plan Review tab, div/span summary).

---

## Files modified

| File | Changes |
|------|--------|
| **scraper-service/accela-scraper.js** | Plan Review Baltimore branch, planReviewSummary extraction, Record Details div/span fallback, portalData schemaVersion and planReviewSummary, persistence force-overwrite for legacy Baltimore, validation logging, panel-load wait and logging. |
| **src/components/baltimore/BaltimorePortalDataView.tsx** | Type for `reports.planReviewSummary`; read `planReviewSummary.rawFields`; Plan Review panel shows summary first, then comments fallback. |

---

## Functions changed or added

### accela-scraper.js

- **extractPlanReviewSummaryBaltimore(ctx)** — **NEW.** Baltimore-only. Finds container by "Plan Review Status" section title and `.pil-section`; extracts label/value from `.pil-subsection-title` / `.pil-subsection-value`; collects download links (`.pil-button-link`, `.pil-link`, etc.). Returns `{ summary: { normalized fields + rawFields }, downloadLinks }`. Does not touch any table; ignores Processing Status.
- **extractPlanReview(page)** — **CHANGED.** When `isBaltimorePortal(page)`: calls `extractPlanReviewSummaryBaltimore(ctx)`, returns `{ comments: [], text, screenshot, planReviewSummary, downloadLinks }` (no table-based comments). Otherwise: unchanged table-based logic, returns `planReviewSummary: null`.
- **extractRecordDetails(page)** — **CHANGED.** After table-based extraction, when `isBaltimorePortal(page)`: runs a second `ctx.evaluate` that collects label/value from `.pil-subsection-title` and `.pil-subsection-value`, merges into `details.fields`, rebuilds `details.tables`.
- **clickAccelaNavPanel** — **CHANGED.** After click and 1200 ms wait, when Baltimore: extra 500 ms wait and log `panel load confirmed (record frame): ${label}`.
- **scrapeAccelaRecord** — **CHANGED.** Builds `portalData` with `schemaVersion: 2` when Baltimore; `tabs.reports.planReviewSummary` when Baltimore and `planReview.planReviewSummary`; Plan Review pdf entry only when `!isBaltimore || planReview.comments.length > 0`; selects `portal_data` when Baltimore for existing row; force-overwrite when `isLegacyBaltimore` (existing has no or old schemaVersion); validation log with extraction counts per section.

### BaltimorePortalDataView.tsx

- **AccelaPortalData** — **CHANGED.** `reports.planReviewSummary` optional with `reviewType`, `totalNumberOfFiles`, `timeElapsed`, etc., and `rawFields`.
- **Plan Review panel** — **CHANGED.** If `planReviewSummary.rawFields` has keys, render label/value list from `rawFields`; else if `planReviewComments.length > 0` render comments; else "No plan review data."

---

## Dropdown navigation (unchanged from prior fix; reinforced)

- **Record Info / Payments:** `expandRecordInfoDropdown` and `expandPaymentsDropdown` already do 1200 ms wait for Baltimore and `waitForSubmenuVisible` (record frame then main page). `clickAccelaNavPanel` uses `findPanelLinkMultiContext` (ctx → main → other frames). No further structural change.
- **Reinforcement:** After a successful panel click, for Baltimore an extra 500 ms wait and log **"panel load confirmed (record frame): &lt;label&gt;"** so it’s clear when the panel load step ran.

---

## Plan Review extraction redesign

- **Problem:** Plan Review was table-based and took the first table matching "reviewer|department|comment|review status", which on Baltimore was the Processing Status table → wrong 32 “comments.”
- **Baltimore fix:**
  1. **Scope:** Only parse inside the Plan Review container: find element with text "Plan Review Status" (e.g. `.pil-section-title`), then its `.pil-section` (or parent).
  2. **Structure:** Extract label/value from **div/span**: `.pil-subsection-title` and `.pil-subsection-value` (or same parent’s value element). No `querySelectorAll("table")` for Plan Review on Baltimore.
  3. **Output:** `planReviewSummary` with normalized keys (reviewType, totalNumberOfFiles, timeElapsed, prescreenReviewComments, timeWithJurisdiction, timeWithApplicant, status, currentNonCompletedTasks) and `rawFields` (all label/value pairs). Optional `downloadLinks` (e.g. "View uploaded files", "Download Approved Plans").
  4. **Storage:** For Baltimore, Plan Review returns `comments: []` so no workflow rows are stored under reports.pdfs. `tabs.reports.planReviewSummary` holds the summary. "Plan Review - Review Comments" pdf entry is only added when `planReview.comments.length > 0` (so not for Baltimore summary-only payloads).

---

## Persistence overwrite

- **Schema version:** When Baltimore, `portalData.schemaVersion = 2`. New scrapes get a different hash than legacy payloads that lack this key.
- **Legacy overwrite:** When syncing, if Baltimore we select `id, portal_data_hash, portal_data`. If `existingRow.portal_data_hash === newHash` but existing `portal_data.schemaVersion` is missing or &lt; 2, we set `forceOverwrite = true` and do **not** skip the update: we write the new payload and log **"Baltimore: forcing overwrite for row … (legacy schema, corrected Plan Review)"**. So existing wrong portal_data is replaced by the corrected structure even when the new hash would otherwise match (e.g. if we ever compared against a previously stored wrong payload with the same content).

---

## Sections that now extract correctly (when Baltimore DOM matches)

| Section | Change | Result |
|---------|--------|--------|
| **Header** | Unchanged | record_number, record_type, record_status, expiration_date from header extractor. |
| **Record Details** | Table parser + Baltimore div/span fallback (`.pil-subsection-title` / `.pil-subsection-value`) | More fields when Baltimore uses div-based layout. |
| **Processing Status** | Unchanged (navigation already fixed earlier) | departments/tasks under `tabs.status` only. |
| **Plan Review** | **Redesigned for Baltimore:** div/span summary only, scoped to "Plan Review Status" container; no table; `planReviewSummary` + empty comments | Summary fields (Review Type, Time Elapsed, Status, etc.) under `tabs.reports.planReviewSummary`; UI shows summary; no workflow rows in Plan Review. |
| **Related Records** | Unchanged (multi-context nav already in place) | records when submenu/link found. |
| **Attachments** | Unchanged | attachments when submenu/link found. |
| **Inspections** | Unchanged (fallback already added) | upcoming/completed when panel opens and parser matches. |
| **Payments / Fees** | Unchanged | payments when submenu/link found. |

---

## Validation

- After building `portalData`, a single log line reports:
  - `info.fields`, `status.departments`, `relatedRecords`, `attachments`, `inspections`, `payments`
  - For Baltimore with `planReviewSummary`: `planReviewSummary=X fields`.

---

## Remaining limitations

- **Submenu visibility:** If Baltimore renders Record Info or Payments submenus in a different frame or with different timing, "link not found" can still occur; multi-context and waits should cover most cases.
- **Record Details:** Div/span fallback assumes `.pil-subsection-title` / `.pil-subsection-value` (or similar). If Baltimore uses different classes for other panels, only the table path applies there.
- **Plan Review:** Summary extractor assumes a section titled "Plan Review Status" and `.pil-section` / `.pil-subsection-*`. If the portal changes class names or structure, selectors may need updating.
- **Non-Baltimore:** No change to Plan Review or Record Details logic for other Accela portals; they keep table-based behavior and unchanged hash (no schemaVersion).

---

## Summary

- **Plan Review:** Baltimore uses a dedicated div/span summary extractor scoped to the Plan Review container; no table; output in `tabs.reports.planReviewSummary`; UI shows it first.
- **Persistence:** Baltimore payloads use `schemaVersion: 2` and force-overwrite legacy rows so corrected data replaces old wrong portal_data.
- **Record Details:** Baltimore gets an extra pass over div/span label/value pairs to capture more fields.
- **Navigation:** Existing multi-context and submenu waits kept; added panel-load confirmation log for Baltimore.
- **Frontend:** Plan Review panel shows `planReviewSummary.rawFields` when present, then comments, then "No plan review data."
