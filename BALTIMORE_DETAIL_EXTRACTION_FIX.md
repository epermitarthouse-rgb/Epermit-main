# Baltimore Accela Record Detail Extraction – Fix Report

## A. Files changed

- **`scraper-service/accela-scraper.js`** – Only file modified. No changes to `server.js`, login, navigation, or Supabase sync.

## B. Selectors / strategy changed

### Before
- **Global link clicks:** All panels used `clickAccelaLink(ctx, selectors, label)` with document-wide selectors (e.g. `'a:has-text("Record Details")'`). Sub-items under dropdowns (Processing Status, Related Records, Attachments, Inspections) were not visible until the parent dropdown was opened, so many links were “not found”.
- **Record Info:** Clicked “Record Info” then “Record Details” only; other Record Info sub-items were clicked without first re-opening the Record Info dropdown.
- **Payments:** Clicked “Payments” or “Fees” without opening the Payments dropdown first.
- **Record Details extraction:** Only the first matching table was used; extraction stopped after one table, so only one field was captured when the first table had a single row or strict filtering.

### After
- **Scoped nav selectors:** All panel clicks prefer selectors scoped to the record-detail tab bar: `'[id*="TabDataList"] a:has-text("…")'` or `'#ctl00_PlaceHolderMain_TabDataList a:has-text("…")'`, then fall back to frame-level `'a:has-text("…")'` and `'a[id*="…"]'`.
- **Record Info dropdown:** Before every Record Info sub-item we call `expandRecordInfoDropdown(ctx, page)` (clicks “Record Info”, waits 800 ms), then click the sub-item. Used for: Record Details, Processing Status, Related Records, Attachments, Inspections.
- **Payments dropdown:** Before clicking the fees panel we call `expandPaymentsDropdown(ctx, page)` (clicks “Payments”, waits 800 ms), then click “Fees” (selectors try “Fees” first, then “Payments”).
- **Plan Review:** Still a direct tab click; no dropdown. Selectors are scoped to `TabDataList` first.
- **Record Details extraction:** All candidate tables in the frame are processed (not only the first). Additional table hints: “project name”, “applicant”, “contractor”, “fee”, “parcel number”, “lot”, “block”. Label/value pairs from every matching table are merged into a single `fields` object so all available fields are captured.

## C. How dropdown handling now works

1. **Record Info**
   - **Expand:** `expandRecordInfoDropdown(ctx, page)` clicks the “Record Info” link inside the record frame (TabDataList or equivalent), then waits 800 ms so the submenu is visible.
   - **Sub-items:** We then click one of: Record Details, Processing Status, Related Records, Attachments, Inspections. Each extraction runs this sequence: expand Record Info → click the sub-item → wait for load + 1200 ms → optional checkpoint screenshot → extract.
   - **Implementation:** New helper `clickAccelaNavPanel(ctx, page, selectors, label, { expandRecordInfoFirst: true, checkpointLabel: "…" })` centralizes “expand then click” and checkpointing.

2. **Payments**
   - **Expand:** `expandPaymentsDropdown(ctx, page)` clicks the “Payments” link in the tab bar, then waits 800 ms.
   - **Sub-item:** We then click “Fees” (selectors try “Fees” first so we hit the sub-item, not the parent again).
   - **Implementation:** Same `clickAccelaNavPanel` with `{ expandPaymentsFirst: true, checkpointLabel: "after_fees" }`.

3. **Plan Review**
   - No dropdown; direct tab click with scoped selectors and checkpoint `after_plan_review`.

All panel clicks go through `clickAccelaNavPanel` (or the same pattern) so that:
- Clicks are scoped to the record frame’s nav when possible.
- Dropdowns are opened before sub-items.
- After each click we run `waitForAccelaLoad(page)` and a 1200 ms wait before extraction.
- Optional checkpoint screenshots are taken for each panel.

## D. Panels expected to extract correctly after fix

| Panel              | Expected behavior |
|--------------------|--------------------|
| **Record Details** | Record Info opened → Record Details clicked → all key/value tables in the content area merged into one set of fields; checkpoint `after_record_details`. |
| **Processing Status** | Record Info opened → Processing Status clicked → workflow/department tasks extracted; checkpoint `after_processing_status`; “panel empty” if no tasks. |
| **Related Records** | Record Info opened → Related Records clicked → table rows extracted; checkpoint `after_related_records`; “panel empty” if none. |
| **Attachments**    | Record Info opened → Attachments clicked → attachment list (and downloads if implemented); checkpoint `after_attachments`; “panel empty” if none. |
| **Inspections**    | Record Info opened → Inspections clicked → upcoming/completed lists; checkpoint `after_inspections`; “panel empty” if none. |
| **Payments / Fees**| Payments opened → Fees clicked → fee rows extracted; checkpoint `after_fees`; “panel empty” if none. |
| **Plan Review**    | Direct tab click (unchanged); checkpoint `after_plan_review`; “panel empty” if no comments. |

“Link not found” is logged only when the panel link cannot be found after opening the dropdown. “Panel empty (no data)” is logged when the link was found and the panel loaded but the extractor returned zero items.

## E. Still-uncertain areas

- **Accela HTML variation:** Tab and dropdown markup can differ by Accela version or tenant (e.g. class names, `TabDataList` vs other containers). If a different Baltimore or Accela environment uses different IDs/classes, the scoped selectors or the 800 ms dropdown wait may need tuning.
- **Dropdown timing:** 800 ms after opening Record Info / Payments is empirical. Very slow pages might need a longer wait or an explicit wait for a visible submenu selector.
- **Panel visibility:** We rely on `waitForAccelaLoad` and a fixed 1200 ms delay after each panel click. We do not wait on a panel-specific content selector; if some panels load slowly, adding a short wait for a known content container could make extraction more reliable.
- **Fees vs Payments:** If the UI uses only “Payments” with no “Fees” sub-item, the current “Fees”‑first selectors will still fall back to “Payments”; behavior should remain correct but logs will show “Payments / Fees” for that panel.

---

**Summary:** Extraction now follows the real Accela structure: Record Info and Payments are treated as dropdowns, sub-items are clicked only after expanding the parent, selectors are scoped to the record-detail nav where possible, and Record Details aggregates all matching tables. Login, navigation, header, Plan Review, and Supabase sync are unchanged.
