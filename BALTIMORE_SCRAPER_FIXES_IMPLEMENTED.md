# Baltimore Scraper Completeness — Implementation Summary

**Based on:** `BALTIMORE_SCRAPER_COMPLETENESS_DIAGNOSIS.md`  
**Scope:** `scraper-service/accela-scraper.js` only. No frontend changes.

---

## 1. Exact functions changed

| Function | Change |
|----------|--------|
| **expandRecordInfoDropdown(ctx, page)** | Baltimore: wait 1200 ms (was 800 ms); after wait, call `waitForSubmenuVisible()` for submenu indicators (Record Details, Processing Status, etc.) in record frame then main page; log "dropdown: clicking expand", "submenu: visible in record frame/main page/not detected". |
| **expandPaymentsDropdown(ctx, page)** | Same pattern: 1200 ms for Baltimore, wait for Fees/Payments submenu visibility, same logging. |
| **clickAccelaNavPanel(ctx, page, selectors, label, options)** | Replaced per-selector loop in `ctx` with `findPanelLinkMultiContext()`. For Baltimore, if link not in `ctx`, search main frame then other frames; log where link was found; click in the frame where found; fallback click via `frame.evaluate` only when selector is CSS-safe (no `:has-text`). |
| **extractRecordDetails(page)** | Parser: expanded keyword list for candidate tables; added fallback when no keyword-matched table has ≥2 label-value rows — use any table with ≥1 label-value row and enough text; preserve output shape `{ fields, tables }`. |
| **extractInspections(page)** | Parser: when Upcoming/Completed sections and `[id*="Inspection"] tr` yield 0, added fallback: scan all tables for header row containing "inspection" or ("type" and "status"/"date"), parse data rows into same shape; preserve `{ inspections, upcoming, completed, screenshot }`. |
| **scrapeAccelaRecord(session, ...)** | Set `page._isBaltimore = portalUrl.toUpperCase().includes("BALTIMORE")` and log when Baltimore detected. |
| **extractProcessingStatus / extractRelatedRecords / extractAttachments / extractPayments** | Added Baltimore-friendly selector fallbacks (see below). |

**New helpers (same file):**

- **isBaltimorePortal(page)** — returns `page._isBaltimore`.
- **findLinkInFrame(frame, selectors)** — returns `{ el, sel }` for first visible match in frame.
- **waitForSubmenuVisible(page, ctx, submenuSelectors, waitMs)** — polls ctx then main frame for submenu link visibility.
- **findPanelLinkMultiContext(ctx, page, selectors, label)** — finds link in ctx, then (if Baltimore) main page, then other frames; returns `{ link, frame, selectorUsed }`.

---

## 2. Exact file changed

- **scraper-service/accela-scraper.js** — all edits above; no other files modified.

---

## 3. Submenu / context issue fixed

- **Issue:** Record Info and Payments dropdowns were expanded in the record frame (`ctx`) with 800 ms wait; submenu links (Processing Status, Related Records, Attachments, Fees) were only searched in `ctx`. On Baltimore, the submenu can render in the main page or another frame, so "link not found" occurred.
- **Fix:**
  - After expanding Record Info or Payments, Baltimore gets 1200 ms wait and an explicit wait for submenu visibility (up to 3500 ms) in record frame then main page.
  - When finding the panel link, we first try `ctx`; if not found and Baltimore, we try main frame then all other frames. Click is performed in the frame where the link was found.
  - Logging makes it clear: "dropdown: clicking expand", "submenu: visible in record frame / main page / not detected", "link found in record frame / main page / frame &lt;url&gt;", "link not found in any context".

---

## 4. Parser heuristics / fallbacks added

**Record Details**

- **Broader keywords:** In addition to existing keywords, candidate tables now include text matching: "project #", "application #", "permit #", "location", "project number", "permit number", "record number", "type", "status", "expiration", "issued", "submitted", "received".
- **Fallback tables:** If no keyword-matched table has at least 2 label-value rows, use any table with total text length ≥ 20, at least 2 rows, and at least 1 valid label-value row (label &lt; 80 chars, value &lt; 400 chars). Same row filtering (badLabels, length, etc.) applied.

**Inspections**

- **Generic table fallback:** When `upcomingSection`/`completedSection` and `[id*="Inspection"] tr` yield 0 rows, scan all tables in the main container. If a table has a header row whose text includes "inspection" or both "type" and ("status" or "date"), treat it as an inspection table and parse data rows (skip first row). Same cell mapping (type, status, date, inspector, result) and category inference (completed vs upcoming from status text). Output shape unchanged.

---

## 5. Baltimore-specific selector fallbacks added

- **Processing Status:** `'a:has-text("Workflow Status")'`, `'[id*="TabDataList"] a:has-text("Status")'`.
- **Related Records:** `'a:has-text("Related Record")'`, `'a[id*="Related"]'`.
- **Attachments:** `'a:has-text("Document")'` (in addition to existing Documents/Attachment selectors).
- **Payments / Fees:** `'a[id*="Fee"]'`.

---

## 6. Sections: expected improvement source

| Section | Improvement expected from | Notes |
|---------|----------------------------|--------|
| **Record Details** | Parser fallback | More tables/rows included when Baltimore uses different labels or structure. |
| **Processing Status** | Submenu click-flow (+ selector fallback) | Link can be found in main page/other frame; Workflow Status/Status fallback. |
| **Related Records** | Submenu click-flow (+ selector fallback) | Same multi-context + Related fallback. |
| **Attachments** | Submenu click-flow (+ selector fallback) | Same multi-context + Document fallback. |
| **Inspections** | Parser fallback (and existing click) | Click was already working; generic table fallback when section IDs missing. |
| **Fees / Payments** | Submenu click-flow (+ selector fallback) | Wait for submenu + multi-context + Fee ID fallback. |
| **Plan Review** | Unchanged | No code change per task. |

---

## 7. Validation (post-implementation)

- **To validate:** Run a Baltimore Accela scrape and inspect logs and `portal_data` for the project.
- **Logs to check:**  
  - `[Baltimore] portal detected — using extended submenu wait and multi-context link search`  
  - For each panel: `Record Info dropdown: clicking expand`, `Record Info submenu: visible in record frame` (or main page / not detected).  
  - `"Processing Status": link found in record frame` (or main page / frame …).  
  - `[panel] Record Details: N fields extracted`, `Processing Status: M departments`, etc.
- **Sections that may still need portal-specific work:**  
  - If Baltimore uses non-standard markup (e.g. no tables, custom components), Record Details or Inspections may still need Baltimore-specific selectors or structure handling.  
  - If the submenu never appears in any frame within the wait window, further timing or DOM investigation may be needed (e.g. longer wait or portal-specific expand trigger).

---

## 8. Safety

- **Non-Baltimore:** `_isBaltimore` is only set when `portalUrl` contains "BALTIMORE". All extended waits and multi-context search run only when `isBaltimorePortal(page)` is true. Selector fallbacks are additive and do not replace existing selectors.
- **Plan Review:** Not modified.
- **Output shape:** Record Details, Inspections, and all other extractors preserve the existing persisted shape expected by the frontend.
- **No fake data:** Only DOM-derived data; no synthetic rows or placeholder content.
