# REPO CLEANUP AUDIT

**Date:** 2026-03-18  
**Scope:** Full repository. No deletions performed; audit only.  
**Rules:** Verified references via grep/imports/routes/config; conservative categorization.

---

## 1. Summary

| Category | Count |
|----------|--------|
| **Total suspicious / audited items** | 120+ (files + folder patterns) |
| **Safe to delete now** | 4 |
| **Likely safe but needs manual review** | 95+ |
| **Must keep** | 25+ (referenced or critical) |

---

## 2. Safe to delete now

| Path | Type | Why suspicious | Referenced? | Confidence |
|------|------|----------------|-------------|------------|
| `Untitled` | Root text file | Loose file; contains git push instructions (scratch). | No imports or refs. | **High** |
| `scraper-service/0_DISK_TEST.txt` | Text | Name suggests temp/disk test artifact. | No references in codebase. | **High** |
| `scraper-service/debug_accela_search.png` | PNG | Debug screenshot. | Not referenced in scraper-service code. | **High** |
| `scraper-service/login_stuck.png` | PNG | Likely one-off login debug screenshot. | Not referenced in code. | **High** |

---

## 3. Likely safe but needs manual review

### 3.1 Scraper-service debug / probe screenshots (69 PNGs)

All under `scraper-service/`. Code **writes** `debug_dashboard.png`, `debug_report_popup.png`, `grid_not_found.png`, `login_failed.png`, `record_not_loaded.png` at runtime; it does **not** read existing PNGs. The following are **not** referenced anywhere and appear to be one-off artifacts:

| Path pattern | Count | Notes |
|--------------|--------|------|
| `scraper-service/PROBE_1_BEFORE_*.png` | 27 | Probe/debug screenshots; not referenced. |
| `scraper-service/PROBE_2_AFTER_*.png` | 30 | Same. |
| `scraper-service/grid_not_found.png` | 1 | **Generated** by accela-scraper when grid not found; optional to keep one or delete and let it regenerate. |
| `scraper-service/debug_dashboard.png` | 1 | **Generated** by server.js; optional to delete and let it regenerate. |
| `scraper-service/debug_report_popup.png` | 1 | **Generated** by server.js; optional to delete and let it regenerate. |

**Recommendation:** Safe to delete all `PROBE_*` PNGs (57 files). For `grid_not_found.png`, `debug_dashboard.png`, `debug_report_popup.png`: either keep (they may be opened manually) or delete and allow scraper to recreate on next run. **Manual review:** Confirm no external docs or runbooks reference these filenames.

### 3.2 attached_assets/ (78+ files)

| Type | Count | Notes |
|------|--------|------|
| `Screenshot_*.png` | 30+ | IDE/conversation screenshots; not referenced in code. |
| `targeted_element_*.png` | 3 | Likely dev/selector screenshots. |
| `Pasted-*.txt` | 40+ | Pasted prompts/instructions; not referenced in code. |
| `image_*.png` | 1 | Unreferenced. |
| `*.mov` | 1 | Screen recording; unreferenced. |
| `*.docx` | 1 | Architecture doc; unreferenced. |
| `generated_videos/*.mp4` | 3 | Demo videos; not referenced in app code (may be linked from docs or used manually). |

**Recommendation:** None of these are imported or referenced in source. They look like Cursor/IDE or conversation attachments. **Manual review:** If you rely on them for context or docs, keep or archive elsewhere; otherwise removable in bulk.

### 3.3 public/data/*.csv (3 files)

| Path | Referenced? |
|------|-------------|
| `public/data/top10_residential_eastcoast_all_places_2024.csv` | No |
| `public/data/top10_residential_eastcoast_cities_only_2024.csv` | No |
| `public/data/bps_2024_eastcoast_places_residential_units.csv` | No |

**Recommendation:** No code references. Could be for future features, demos, or manual analysis. **Manual review** before deletion.

### 3.4 scripts/

| Path | Notes |
|------|--------|
| `scripts/run_parsed_comments_discipline_nullable.sql` | One-off SQL; same change exists in `supabase/migrations/20260221000000_parsed_comments_discipline_nullable.sql`. Redundant; could delete or keep as “run in SQL Editor” helper. |
| `scripts/test-intake-pipeline.js` | Referenced in `scripts/DEPLOY_AND_VERIFY.md` as a manual test command. Dev utility; **keep** unless deprecating that doc. |
| `scripts/DEPLOY_AND_VERIFY.md` | Referenced in `TECHNICAL_AUDIT_REPORT.md`. **Keep.** |
| `scripts/DISCIPLINE_CLASSIFIER_DEBUG_REPORT.md` | Debug report; not referenced. **Manual review** (archive or delete). |

### 3.5 Orphan page

| Path | Notes |
|------|--------|
| `src/pages/Index.tsx` | Full landing-style page using `Layout` and home sections. **Not used in routes;** `App.tsx` uses `LandingPage` for `/`. Orphan. **Manual review:** Remove if truly unused, or wire to a route if it’s an alternate landing. |

---

## 4. Must keep

| Path / pattern | Reason |
|----------------|--------|
| `public/placeholder.svg` | Referenced in `vite.config.ts` (PWA assets). |
| `public/favicon.ico`, `public/apple-touch-icon.png`, `public/pwa-*.png`, `public/og-image.png` | Referenced in `index.html` / `vite.config.ts` (PWA, og:image). |
| `public/robots.txt`, `public/sitemap.xml` | Standard SEO; may be referenced by deployment. |
| `scraper-service/server.js`, `scraper-service/accela-scraper.js` | Write `debug_dashboard.png`, `debug_report_popup.png`, `grid_not_found.png`, `login_failed.png`, `record_not_loaded.png`; do not depend on pre-existing files. |
| `src/components/home/TestimonialsSection.tsx` | Used by `Index.tsx`; if Index is removed, verify whether LandingPage or others use it. |
| `scripts/test-intake-pipeline.js` | Documented in `DEPLOY_AND_VERIFY.md`. |
| `scripts/DEPLOY_AND_VERIFY.md` | Referenced in TECHNICAL_AUDIT_REPORT. |
| All `supabase/migrations/*.sql` | Required for schema; do not delete. |
| Root docs: `README.md`, `PROJECT_KNOWLEDGE_BASE.md`, `TECHNICAL_AUDIT_REPORT.md`, `ADMIN_PANEL_ANALYSIS.md`, `APP_SUMMARY.md`, `SPEC_COMPLIANCE_REPORT.md`, `replit.md` | Project/docs; keep. |
| `dev.sh` | Referenced in TECHNICAL_AUDIT_REPORT. |
| `package.json`, `vite.config.ts`, configs | Build/runtime. |
| `.env` (if present) | Contains secrets; do not commit/delete carelessly. |
| `dist/` | Build output; in `.gitignore`. Do not delete as “cleanup”; regenerate with build. |
| `server.log` | In `.gitignore` (*.log). Ignored; no need to list for deletion. |

---

## 5. Folder-level cleanup opportunities

| Folder | Opportunity |
|--------|-------------|
| **scraper-service/** | Remove all `PROBE_1_BEFORE_*.png` and `PROBE_2_AFTER_*.png` (57 files). Optionally remove `debug_accela_search.png`, `login_stuck.png`, and optionally `grid_not_found.png`, `debug_dashboard.png`, `debug_report_popup.png` (regenerated by code). |
| **attached_assets/** | No code references. Consider archiving or deleting entire folder after manual review; or add to `.gitignore` if used only for local IDE context. |
| **Root** | Remove `Untitled` (scratch file). |
| **scripts/** | Consider removing `run_parsed_comments_discipline_nullable.sql` (duplicate of migration) and optionally `DISCIPLINE_CLASSIFIER_DEBUG_REPORT.md` after review. |
| **src/pages/** | Decide fate of `Index.tsx`: delete if unused or add route. |
| **dist/** | Already gitignored; do not treat as repo clutter; regenerate with `npm run build`. |
| **.config, .local, .vercel, .lovable** | Config/deploy; `.config` in `.gitignore`. Do not delete without checking deployment. |

---

## 6. Safe deletion plan (recommended order)

**Batch 1 — Lowest risk (4 items)**  
- `Untitled`  
- `scraper-service/0_DISK_TEST.txt`  
- `scraper-service/debug_accela_search.png`  
- `scraper-service/login_stuck.png`  

**Batch 2 — Scraper probe artifacts (57 files)**  
- All `scraper-service/PROBE_1_BEFORE_*.png`  
- All `scraper-service/PROBE_2_AFTER_*.png`  

**Batch 3 — Optional scraper-generated (after confirming no external dependency)**  
- `scraper-service/grid_not_found.png`  
- `scraper-service/debug_dashboard.png`  
- `scraper-service/debug_report_popup.png`  

**Batch 4 — Manual review first**  
- `attached_assets/` (entire folder or selected files)  
- `public/data/*.csv`  
- `scripts/run_parsed_comments_discipline_nullable.sql`  
- `scripts/DISCIPLINE_CLASSIFIER_DEBUG_REPORT.md`  
- `src/pages/Index.tsx` (or wire to route)  

---

## 7. Important warnings

- **Do not delete** `supabase/migrations/` files. They are required for schema and deploy.
- **Do not delete** `public/` assets that are referenced in `index.html`, `vite.config.ts`, or app code (see §4).
- **Do not delete** `.env` or commit it; it contains secrets.
- **Scraper:** Code **writes** `debug_dashboard.png`, `debug_report_popup.png`, `grid_not_found.png`, `login_failed.png`, `record_not_loaded.png`. Deleting them is safe; they will be recreated when the scraper runs and hits those code paths.
- **dist/** is build output and gitignored; omit from “cleanup” or only run `rm -rf dist` before a fresh build.
- **attached_assets/** may hold conversation or design context; review before bulk delete.
- **Index.tsx** imports many home components; if you delete it, ensure no route or link points to it and that `TestimonialsSection` (and others) are still used elsewhere (e.g. `LandingPage`).

---

*End of audit. No files were deleted. Proceed with deletion only after approval and optional backup.*
