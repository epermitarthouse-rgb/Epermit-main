# Engineering handbook — Epermit (PermitPilot / DesignCheck)

Long-term technical memory for this repository. **No secrets or env values** — document names only. Update when scraper or contract behavior changes.

---

## 1. What this product is

**Permit intelligence / permit-management web app** for architects, contractors, and owners: projects and team sharing, **portal scraping** (ProjectDox/Avolve, PGC ePlans, Accela), **portal_data** viewing, AI comment parsing and response drafting (Supabase Edge Functions), e-permit flows, inspections, checklists, subscriptions (Stripe), and jurisdiction tooling.

- **Frontend:** Vite 5 + React 18 + TypeScript, `src/main.tsx` → `src/App.tsx`, React Router, TanStack Query, shadcn/ui, Supabase JS client.
- **Backend:** **Supabase only** for app API (Postgres, Auth, RLS, Storage, Edge Functions). There is no separate Node “app server” besides the scraper.
- **Scraper:** Node **Express** + Playwright in `scraper-service/server.js` (default port **3001**, `process.env.PORT`). The Vite dev server (**5000**) proxies `/api` and `/view-file` to 3001 (`vite.config.ts`). **Parallel dev:** `npm run dev:parallel` uses Vite **5001** → proxy **3002** (`parallel-dev-server.js` loads the same `server.js` Express `app` and mounts `/__future`; set `VITE_API_BASE_URL` to `http://localhost:5001` or `http://127.0.0.1:3002`).

**Supabase project ref** (from `supabase/config.toml`): `eeqxyjrcldivtpikcpvk`.

---

## 2. Database and auth (summary)

Schema is **migration-only** under `supabase/migrations/`. No Prisma/Drizzle.

- **Auth:** Supabase Auth; profiles in `public.profiles` (trigger on `auth.users` creates profile).
- **Roles:** `app_role` enum (`admin`, `moderator`, `user`); `user_roles`; `has_role(uid, role)` (SECURITY DEFINER).
- **Projects:** `projects` includes **`portal_data` JSONB** (scraper + optional `check-portal-status` updates), `portal_status`, `last_checked_at`, `project_url`, etc. RLS: owner `user_id = auth.uid()` unless extended via team access.
- **Access:** `has_project_access(uid, project_id)` / `has_project_admin_access` for team rows (`project_team_members`, invitations).
- **Portal credentials:** `portal_credentials` — username/password, `login_url`, optional **`project_id`** link to `projects` (used so scrapes can target the right Supabase project and enforce Baltimore rules).
- **Comments:** `parsed_comments` (+ response matrix columns in later migrations); consumed by UI and **intake-pipeline-agent** style flows.

Frontend route guards: `ProtectedRoute`, `PublicOnlyRoute` (`src/components/auth/`).

---

## 3. Portal type detection (`scraper-service/server.js`)

`detectPortalType(url)`:

- **`projectdox`** if URL contains `avolvecloud.com`, `projectdox`, or **`eplans.princegeorgescountymd.gov`** (PGC host string).
- **`accela`** if URL contains `accela.com`.
- Otherwise **`unknown`** (login returns 400 with supported types message).

Default dashboard if `portalUrl` omitted on login: **`https://washington-dc-us.avolvecloud.com`** (DC Avolve).

---

## 4. Scraper-by-scraper reference

### 4.1 Washington, DC — ProjectDox (generic Avolve)

- **Portal type:** `projectdox` (not the PGC ePlan subtype).
- **Login:** `POST /api/login` with `portalUrl` (or default DC URL), username/password. Playwright session stores `webUiBase` from `deriveWebUiBase(dashboardUrl)`, project list, browser/context/page.
- **Flow:** Standard ProjectDox scrape path in `server.js` (tabs, extraction, sync to Supabase). Session idle timeout and cleanup are defined in the same file (`SESSION_IDLE_TIMEOUT_MS`, etc.).
- **Export:** `GET /api/export/:sessionId` can build an Excel export (temp file under `scraper-service`, then download).
- **Files:** Downloaded attachments land under `scraper-service/downloads/`; served to the UI via **`/view-file`** static mount.

**Recreation notes:** Use an Avolve ProjectDox dashboard URL; ensure `webUiBase` derivation matches the host. Montgomery and PGC branch *before* or *instead of* this path when their hosts match first.

---

### 4.2 Prince George’s County (PGC) — ePlans / ProjectDox subtype

- **Detection:** `portalType === "projectdox"` **and** `pgcEplan.isPgcEplanHost(dashboardUrl)` in `server.js`.
- **Login:** `pgcEplan.performPgcLogin`, `waitForProjectGrid`, `collectAllProjects`, `resolvePgcWebUiBases`. Session gets **`portalSubtype: "pgc-eplan"`** and `pgcWebUiBases`.
- **Critical credential rule:** PGC scrape requires **saved portal credentials on the linked Supabase project** (server returns **`pgc_saved_portal_credentials_missing`** if not). Same error can surface from login path when credentials are missing.
- **Scrape orchestration:** `scrapePgcAll` in `server.js` drives the pipeline in `pgc-eplan-scraper.js` (large module): project detail, files grid, SSRS-style reports, uploads to Supabase storage, mapping to `portal_data`.
- **Local directories (gitignored):** `scraper-service/pgc-downloads/<safePid>/`, `scraper-service/pgc-reports/<safePid>/`, `scraper-service/pgc-markups/`. Failure screenshots follow patterns like `pgc-*-failed-*.png` (see `.gitignore`).
- **Progress logging (non-functional):** `pgc-progress-logger.js` appends **`pgc-progress-events.jsonl`**, writes **`pgc-run-summary.json`**, and may write **`pgc-debug-detail.log`**. These are **runtime diagnostics only** — must not be committed (see `.gitignore`).

**Recreation notes:** Implement host detection in one place (`isPgcEplanHost`), keep login URL resolution (`resolvePgcLoginUrl`) and WebUI base resolution aligned with PGC’s Avolve + ePlans topology. Do not strip “saved credentials” checks without understanding DB writes and permit integrity.

---

### 4.3 Montgomery County, MD — ProjectDox subtype

- **Detection:** `montgomeryProjectDox.isMontgomeryProjectDoxHost(dashboardUrl)` before generic ProjectDox project collection.
- **Login:** Montgomery-specific dashboard discovery and project collection (`scrapers/montgomery/dashboard-discovery.js`, `scrapers/montgomery/portal-login.js` via `register-execution-routes.js`). Session sets **`portalSubtype: "montgomery-projectdox"`** and may store **`montgomeryWebUiBases`** from `resolveMontgomeryWebUiBases`.
- **Scrape:** `scrapeMontgomeryAll` calls **`montgomeryProjectDox.runMontgomeryProductionPipeline`** (module header states it **clones the PGC pipeline shell** and reuses PGC SSRS helpers). Optional lightweight files harvest via `extractMontgomeryFilesTabLightweight`. Results mapped with **`mapMontgomeryPipelineToPortalData`**.
- **Credential rule:** Montgomery path can return **`montgomery_saved_portal_credentials_missing`** if username/password empty when required.
- **Report specs:** `scrapers/montgomery/projectdox-scraper.js` defines **`MONTGOMERY_REPORT_SPECS`** (SSRS paths under `/MontgomeryCountyProd/ProjectDox/...`). Names must match grid labels.

**Recreation notes:** Keep host marker and WebUI base resolution in sync with Avolve URLs; changing report names/paths without checking the live grid will break Task 8-style exports.

---

### 4.4 Baltimore (and generic Accela)

- **Portal type:** `accela` (`accela-scraper.js` + `accelaLogin`).
- **Baltimore detection:** `portalUrl.toUpperCase().includes("BALTIMORE")` in `server.js` and `page._isBaltimore` in `accela-scraper.js`.
- **Critical API rule:** For Baltimore Accela, **`projectId` (Supabase `projects.id`) is required** on scrape — server returns 400 explaining Baltimore needs it for **permit integrity and DB write**. Non-Baltimore Accela may omit `projectId` in some flows.
- **Behavior:** Baltimore uses **extended submenu waits and multi-context link search** (see log line in `scrapeAccelaRecord`). Many extractors are shared with other Accela tenants; Baltimore UI quirks drove wait/link-search hardening.
- **Login artifact:** On successful Accela login, `server.js` saves **`debug_dashboard.png`** (full-page) under `scraper-service/` — useful for debugging; **gitignored**.

**Recreation notes:** Do not remove Baltimore `projectId` guard without a replacement integrity strategy. Treat `page._isBaltimore` branches as production requirements, not dead code.

---

## 5. `portal_data` contract (high level)

Shape varies by **`portalType`** / **`portalSubtype`** and scraper version. Consumers include:

- **Generic / ProjectDox viewers** — tabs with key-values, tables, PDFs.
- **`AccelaProjectView`** (`src/components/portal/AccelaProjectView.tsx`) when `portalData.portalType === "accela"` — expects structures such as `tabs.status`, `tabs.attachments`, `tabs.inspections`, `tabs.relatedRecords`, `tabs.payments`, `tabs.reports.pdfs`, etc. (see component for exact keys).
- **Baltimore** — `PortalDataViewer` may route to **`BaltimorePortalDataView`** when credential resolves as Baltimore (`src/lib/portalView.ts`).

**Hashing:** `server.js` uses `hashPortalData` (stable stringify + SHA-256) when merging/updating stored JSON to avoid blind overwrites.

When extending scrapers, **update the viewer mapping** or document new keys here; the DB column is JSONB and the UI will not auto-discover fields.

---

## 6. Scraper HTTP API (essentials)

From `server.js` (not exhaustive):

- **`POST /api/login`** — body: `username`, `password`, `portalUrl?`; returns `sessionId`, `portalType`, optional `portalSubtype`, project list.
- **`POST /api/scrape`** — starts scrape for selected projects / permit number; behavior branches on `portalType` and `portalSubtype` (PGC, Montgomery, Accela).
- **`GET /api/data/:sessionId`** — session status and accumulated data (frontend polls via `ScrapeContext`).
- **`GET /api/progress/:sessionId`** — progress stream (SSE).
- **`POST /api/logout/:sessionId`** — cleanup.
- **`GET /view-file/...`** — static files from `scraper-service/downloads/`.

---

## 7. Runtime artifacts and cleanup (do not commit)

Under **`scraper-service/`**:

| Artifact | Purpose |
|----------|---------|
| `downloads/` | Session downloads; served via `/view-file` |
| `debug/` | Accela checkpoint screenshots (`accela-scraper.js` `getAccelaDebugDir`) |
| `debug_dashboard.png` | Post-Accela-login screenshot |
| `PROBE_*.png`, `grid_not_found.png`, `pgc-*-failed-*.png` | Debug / failure captures |
| `pgc-downloads/`, `pgc-reports/`, `pgc-markups/` | PGC/Montgomery pipeline local cache |
| `latest-run.log` | Created by root `package.json` `dev:scraper` (`tee`) |
| `pgc-progress-events.jsonl`, `pgc-run-summary.json`, `pgc-debug-detail.log` | PGC progress logger output |

**Gitignore** in `.gitignore` must stay aligned with these paths. Deleting folders **during an active scrape** can break sessions or downloads.

---

## 8. Edge Functions — deploy and agent pipeline (operations)

**Link project** (Supabase CLI):

```bash
supabase link --project-ref eeqxyjrcldivtpikcpvk
```

**Deploy example (intake / comment / discipline agents):**

```bash
supabase functions deploy intake-pipeline-agent
supabase functions deploy comment-parser-agent
supabase functions deploy discipline-classifier-agent
```

**Secrets (typical):** `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — set via `supabase secrets set ...`. List with `supabase secrets list`.

**Smoke test:** Invoke `intake-pipeline-agent` with `{ project_id }` for a project that already has report PDFs in `portal_data`; confirm `parsed_comments` rows. See `scripts/test-intake-pipeline.js` for a scripted option.

**Classifier debugging:** If `discipline` counts stay at zero, inspect `discipline-classifier-agent` and `comment-parser-agent` in `supabase/functions/`, and whether `parsed_comments.discipline` nullable migration matches agent expectations (historical issue documented in former `scripts/DISCIPLINE_CLASSIFIER_DEBUG_REPORT.md`).

---

## 9. Known codebase caveats (from prior audits)

- Frontend Supabase URL/anon key live in `src/lib/supabase.ts` (intentional for deployment stability per comments — still a concentration risk).
- `README.md` was historically Lovable boilerplate; replaced by project-specific docs.
- ROI calculator and other UI copy may still contain placeholders — verify before marketing use.

---

## 10. Changelog (high level)

- **2026-04:** Repo documentation consolidated into this file + `README.md`. Removed duplicate markdown guides; PGC progress JSON/JSONL removed from version control and gitignored. Prior session notes that lived only in `memory.md` append-only format are superseded by sections above — recover old detail via git history if needed.
