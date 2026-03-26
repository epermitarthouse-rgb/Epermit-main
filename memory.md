# Project memory — Epermit (PermitPilot)

Long-term memory for work performed on this repository. **Keep this file updated with everything done in sessions:** new features, fixes, audits, refactors, and key decisions. Append new entries; do not overwrite. No secrets or env values.

---

## 2026-03-18 — Repo cleanup audit (no deletions)

**Action:** Safe cleanup audit of the full repository. No files were deleted.

**Scope:**
- Scanned repository tree for suspicious files: debug screenshots, temp exports, test artifacts, duplicate assets, unused images/media, orphan components/pages, dead scripts, unused SQL/docs, backup/empty files.
- Checked references via imports, routes, config (vite, package.json), and grep across frontend and scraper-service.

**Key findings:**
- **Safe to delete (4):** Root file `Untitled` (scratch git instructions), `scraper-service/0_DISK_TEST.txt`, `scraper-service/debug_accela_search.png`, `scraper-service/login_stuck.png` — none referenced.
- **Likely safe / manual review (95+):** 57 `scraper-service/PROBE_*` PNGs (probe/debug screenshots, unreferenced); entire `attached_assets/` folder (78+ files: Screenshots, Pasted-*.txt, videos, docx — not referenced in code); 3 `public/data/*.csv`; `scripts/run_parsed_comments_discipline_nullable.sql` (redundant with migration); `scripts/DISCIPLINE_CLASSIFIER_DEBUG_REPORT.md`; orphan page `src/pages/Index.tsx` (not in router; App uses LandingPage for `/`).
- **Must keep:** All `public/` assets referenced in index.html/vite.config (placeholder.svg, PWA icons, og-image, etc.); supabase/migrations; scripts referenced in docs (test-intake-pipeline.js, DEPLOY_AND_VERIFY.md); root docs (README, PROJECT_KNOWLEDGE_BASE, TECHNICAL_AUDIT_REPORT, ADMIN_PANEL_ANALYSIS, APP_SUMMARY, SPEC_COMPLIANCE_REPORT, replit.md); dev.sh; scraper code that writes debug PNGs (no dependency on existing files).

**Files produced:**
- `REPO_CLEANUP_AUDIT.md` — Full audit with tables, batches, and warnings.

**Risks / warnings:**
- Do not delete supabase/migrations, referenced public assets, or .env.
- attached_assets may contain conversation/design context; review before bulk delete.
- Index.tsx imports many home components; if removed, confirm LandingPage or others still use them.

**Next recommended step:** Await approval for deletion. Then execute in order: Batch 1 (4 items) → Batch 2 (57 PROBE_* PNGs) → Batches 3–4 after manual review of attached_assets, public/data CSV, scripts, and Index.tsx.

---

## 2026-03-18 — Safe deletion Batch 1 completed

**Timestamp:** 2026-03-18

**Action:** Permanently deleted the four files listed as "Safe to delete now" in REPO_CLEANUP_AUDIT.md (Batch 1 only).

**Files deleted:**
- `Untitled` (root scratch file)
- `scraper-service/0_DISK_TEST.txt`
- `scraper-service/debug_accela_search.png`
- `scraper-service/login_stuck.png`

**Verification:** Confirmed all four paths no longer exist (ls returned "No such file or directory" for each). No directories were removed. No other files were modified.

**Confirmation:** No errors occurred during deletion.

**Next recommended step:** If desired, proceed with Batch 2 (delete all 57 `scraper-service/PROBE_1_BEFORE_*.png` and `scraper-service/PROBE_2_AFTER_*.png` files). Otherwise, leave Batches 3–4 for manual review as in the audit.

---

## 2026-03-18 — Baltimore portal view routing and UI

**Action:** Baltimore-specific UI on `/portal-data` when the selected credential is Baltimore Accela; generic Accela UI for other credentials.

**Key changes:**
- **`src/lib/portalView.ts`:** `isBaltimorePortal(cred)` — true when login_url contains `/BALTIMORE` or jurisdiction "Baltimore" + accela.com. `resolvePortalView()` for view selection.
- **`PortalDataViewer.tsx`:** Stores `credentialForView`, derives `isBaltimore` at render; when Accela + Baltimore credential, renders `BaltimorePortalDataView` instead of `AccelaProjectView`.
- **`BaltimorePortalDataView`:** New component; receives `portalData`, optional `projectId`, `permitNumber`, `credentialLoginUrl`; when `projectId` set, uses `showSearchApplicationsLink={false}` (no "Search Applications" on `/portal-data`).
- **BaltimoreNav / BaltimoreLayout:** `showSearchApplicationsLink` (default true) so embedded view can hide Search Applications link.
- **Plan Review mapping fix:** Plan Review panel uses scraper shape: comment from `item.comment ?? item.text`; optional line with reviewer, department, date when present. Removed DEV debug card from UI.

**Docs produced:** `BALTIMORE_PORTAL_VIEW_ROUTING.md`, `BALTIMORE_PORTAL_DATA_BINDING.md`, `BALTIMORE_PORTAL_DATA_DIAGNOSIS.md`, `BALTIMORE_FIXES_IMPLEMENTED.md`.

---

## 2026-03-18 — Baltimore scraper completeness (diagnosis only)

**Action:** Diagnosis-only pass to identify why Baltimore Accela scraper output was sparse for some sections. No code changes.

**Scope:** Sections investigated in `scraper-service/accela-scraper.js`: Record Details, Processing Status, Related Records, Attachments, Inspections, Fees/Payments, Plan Review.

**Findings:**
- **Record Details:** Panel opened but only 1 field — parser table filter too strict (keyword list; Baltimore may use different labels).
- **Processing Status, Related Records, Attachments, Fees/Payments:** "Link not found" — submenu items not found in record frame; dropdown may render in main page/other frame or need longer wait.
- **Inspections:** Panel opened but 0 extracted — parser relies on Upcoming/Completed section IDs or `[id*="Inspection"] tr`; Baltimore may use different structure.
- **Plan Review:** Working (direct tab; frontend mapping fixed separately).

**Doc produced:** `BALTIMORE_SCRAPER_COMPLETENESS_DIAGNOSIS.md` — section-by-section report, extractor names, selectors, likely failure points, top 3 prioritized fixes.

---

## 2026-03-18 — Baltimore scraper completeness (implementation)

**Action:** Implemented Baltimore scraper fixes from diagnosis. **File changed:** `scraper-service/accela-scraper.js` only. No frontend changes.

**1. Record Info & Payments submenu click-flow**
- **Baltimore detection:** `page._isBaltimore = portalUrl.toUpperCase().includes("BALTIMORE")` set in `scrapeAccelaRecord`; log when Baltimore detected.
- **expandRecordInfoDropdown:** Baltimore: 1200 ms wait after click; then `waitForSubmenuVisible()` for submenu links in record frame then main page (up to 3500 ms). Logs: dropdown expanded, submenu visible in record frame / main page / not detected.
- **expandPaymentsDropdown:** Same for Payments → Fees/Payments submenu.
- **clickAccelaNavPanel:** Replaced ctx-only search with `findPanelLinkMultiContext()`: try ctx, then (if Baltimore) main frame, then other frames. Log where link found; click in that frame. New helpers: `findLinkInFrame`, `waitForSubmenuVisible`, `findPanelLinkMultiContext`, `isBaltimorePortal`.

**2. Record Details parser**
- Broader keyword list for candidate tables (e.g. project #, application #, permit #, location, record number, type, status, expiration, issued, submitted, received).
- Fallback: if no keyword table has ≥2 label-value rows, use any table with ≥1 valid label-value row and enough text. Output shape unchanged.

**3. Inspections parser**
- Fallback when Upcoming/Completed and `[id*="Inspection"] tr` yield 0: scan all tables; if header row contains "inspection" or ("type" and "status"/"date"), parse as inspection table. Same output shape.

**4. Baltimore selector fallbacks**
- Processing Status: `a:has-text("Workflow Status")`, `[id*="TabDataList"] a:has-text("Status")`.
- Related Records: `a:has-text("Related Record")`, `a[id*="Related"]`.
- Attachments: `a:has-text("Document")`.
- Payments/Fees: `a[id*="Fee"]`.

**Doc produced:** `BALTIMORE_SCRAPER_FIXES_IMPLEMENTED.md` — functions changed, submenu/context fix, parser fallbacks, validation notes.

**Safety:** Non-Baltimore behavior unchanged; extended waits and multi-context search only when `isBaltimorePortal(page)`. Plan Review extraction not modified.

---

## 2026-03-18 — Baltimore Plan Review extraction & persistence (diagnosis only)

**Action:** Strict diagnosis-only pass for Baltimore Plan Review extraction and persistence. No code or frontend changes.

**Findings:**
- **Extractor:** `extractPlanReview` (accela-scraper.js). Clicks "Plan Review" tab; in ctx.evaluate() selects first **table** whose innerText contains "reviewer"|"department"|"comment"|"review status"; parses every tr with ≥3 td as reviewer/department/comment/date. Output → `portalData.tabs.reports.pdfs[]` entry with `fileName: "Plan Review - Review Comments"`, `comments: planReview.comments`.
- **Baltimore reality:** Plan Review tab is a **summary/status** page (Review Type, Total Number of Files, Time Elapsed, Prescreen Review Comments, Time with Jurisdiction/Applicant, Status, Current Non-Completed Tasks, Download Approved Plans) in **divs/spans** (pil-section, pil-subsection-title, pil-subsection-value), **no table** for that content. Processing Status tab is a **table** (workflow tasks with Due/Status) in the same frame DOM. First table matching "review status" (e.g. "Status" in cells) = Processing Status table → 32 rows parsed as "plan review comments."
- **Root cause:** Wrong scraper model — table-based first-match captures **workflow/task rows** (Processing Status), not Plan Review summary. Real summary fields never extracted. Hash-skip occurs because each run produces the same wrong payload; hash includes full portalData. Frontend correctly reads `reports.pdfs[].comments`; it shows workflow entries because that is what was stored.
- **Doc produced:** `BALTIMORE_PLAN_REVIEW_DIAGNOSIS.md` — extractor logic, Baltimore DOM evidence, portalData shape, hash/persistence flow, single root-cause statement.

---

## 2026-03-18 — Baltimore comprehensive extraction fix (evidence-driven)

**Action:** Implemented full Baltimore Accela extraction fix so all sections reflect actual portal content. No generic Accela assumptions; used BALTIMORE_SCRAPER_COMPLETENESS_DIAGNOSIS.md and BALTIMORE_PLAN_REVIEW_DIAGNOSIS.md.

**Scraper (accela-scraper.js):**
- **Plan Review (Baltimore):** New `extractPlanReviewSummaryBaltimore(ctx)` — finds "Plan Review Status" container (.pil-section), extracts label/value from .pil-subsection-title / .pil-subsection-value and download links; no table; returns planReviewSummary + empty comments. `extractPlanReview` uses this when isBaltimorePortal(page); stores under tabs.reports.planReviewSummary.
- **Record Details:** Baltimore-only div/span fallback after table extraction: .pil-subsection-title / .pil-subsection-value merged into details.fields.
- **portalData:** schemaVersion: 2 for Baltimore; tabs.reports.planReviewSummary when Baltimore; Plan Review pdf entry only when comments.length > 0 (so Baltimore summary-only does not add wrong comments).
- **Persistence:** When Baltimore, select portal_data for existing row; if hash match but existing has no or old schemaVersion (legacy), force overwrite and log "Baltimore: forcing overwrite (legacy schema, corrected Plan Review)".
- **Navigation:** Extra 500 ms wait + "panel load confirmed" log for Baltimore after panel click.
- **Validation:** Single log line with extraction counts (info, status, related, attachments, inspections, payments, planReviewSummary fields).

**Frontend (BaltimorePortalDataView.tsx):** reports.planReviewSummary type and usage; Plan Review panel shows planReviewSummary.rawFields when present, else comments, else "No plan review data."

**Doc produced:** `BALTIMORE_COMPREHENSIVE_FIX_IMPLEMENTATION.md` — files changed, dropdown/Plan Review/persistence summary, sections that now extract, limitations.

---

## 2026-03-18 — Project architecture document

**Action:** Created a single architecture document covering the full project with minor details.

**Doc produced:** `ARCHITECTURE.md` — overview; high-level diagram (client ↔ scraper ↔ Supabase); tech stack; repo structure (src, scraper-service, supabase); frontend (entry, App routes, providers, layout, contexts, portal/Baltimore view, Vite config); scraper (server, API routes table, Accela/Baltimore flow, hash/persistence, other scrapers); database (core tables, migrations, edge functions); data flows (auth, projects, scrape, portal view selection); env and config; PWA/offline; security; deployment; index of related docs.

---

## 2026-03-26 — Baltimore temporary “minimal portal” (Record Details + Attachments only)

**Action:** Temporary mode for the **Baltimore** Accela flow: API returns only record details and attachments; UI shows only those two sections. Other section **code is kept** (backend: skipped/trimmed; frontend: hidden). Attachment download and Supabase upload logic were **not** changed.

**Backend (`scraper-service/accela-scraper.js`):**
- **Flag:** `BALTIMORE_MINIMAL_PORTAL_TABS = true` (near other Baltimore helpers). Set to `false` to restore full tabs payload and extraction runs for Baltimore.
- When Baltimore + flag: skip navigating/extracting Processing Status, Plan Review, Related Records, Inspections, Payments (logged as `(skip) … BALTIMORE_MINIMAL_PORTAL_TABS`). Still run record details and attachments.
- After building `portalData`, if Baltimore + flag: `portalData.tabs = { info: …, attachments: … }` only. Tab keys remain **`info`** (Record Details) and **`attachments`** — not `recordInfo`.
- **Log:** `console.log("[PortalData] sections returned:", Object.keys(portalData.tabs), "(info = Record Details)");` — expect `["info","attachments"]` for Baltimore minimal.

**Frontend:**
- **Flag:** `BALTIMORE_MINIMAL_SECTIONS_UI = true` in `src/components/baltimore/BaltimoreRecordTabBar.tsx`. Set to `false` to restore Record Info / Payments / Plan Review chrome.
- **`BaltimoreRecordTabBar`:** In minimal mode, two inline buttons (Record Details, Attachments) instead of dropdowns + Plan Review.
- **`BaltimorePortalDataView.tsx`:** `showFullSections = !BALTIMORE_MINIMAL_SECTIONS_UI`; hidden panels wrapped with `showFullSections &&` (Processing Status, Related Records, Inspections, Fees, Plan Review); derived data for those sections only read when `showFullSections`; `useEffect` resets `activePanel` to `record_details` if it is not allowed in minimal mode.
- **`BaltimoreRecordDetailPage.tsx`:** Same `minimalSections` prop, `showFullSections` gates, and panel reset `useEffect` (mock `/baltimore/records/:id` stays consistent with portal-data UI).

**Revert:** `BALTIMORE_MINIMAL_PORTAL_TABS = false` in scraper; `BALTIMORE_MINIMAL_SECTIONS_UI = false` in `BaltimoreRecordTabBar.tsx`.

---
