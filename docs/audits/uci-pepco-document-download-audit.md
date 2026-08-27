# UCI / PEPCO Document Download Audit

**Date:** 2026-08-05  
**Repo:** `epermitarthouse-rgb/Epermit-main`  
**Branches reviewed:** `main` (behavior source of truth via `git show main:…`) and current `feat/lovable-ui-replication` (UI placement differences only)  
**Constraints:** Read-only audit. No implementation, deploy, or push. Supabase project `eeqxyjrcldivtpikcpvk` was queried with service-role credentials from local `scraper-service/.env`.

---

## Executive summary

| Item | Finding |
|------|---------|
| **Root cause** | Document *listing* always runs (`includeDocuments=true`). File bytes download only when `download_documents: true` / `downloadDocuments === true`. UI checkbox defaults to **`false`**, so normal **Scrape Details / Refresh Details** produces **Listed only** metadata. |
| **Current testable project (listed-only)** | PermitPilot project **COM-00317-2026** → coordination `b960d823-1dbd-4891-bb47-b629ae2a4808` → PEPCO **Aspen Hill MD - Commercial & Industrial - 001** (`PEPCO-NB-0067752`, app UUID `f704555e-9f4b-4822-b6af-8c9d4a980226`). Last scrape **2026-08-04T21:36:23Z**: **19 listed, 0 downloadedFiles**. |
| **Recommended UI action (no behavior change to default sync)** | Keep default sync list-only. Add an explicit primary/secondary action **“Scrape with document downloads”** next to row **Scrape Details / Refresh Details** (or a clearly labeled toggle beside that menu) that sends `download_documents: true` for that run only. |
| **Status UX recommendation** | Surface mapped milestones outside collapsed Developer tools while busy; label whether downloads are enabled; later add streamed/polled progress so the long HTTP scrape is not a silent spinner. |

**Synced ≠ downloaded.** Portal sync / scrape completion with document counts only means metadata was listed unless `downloadedFiles[].storageStatus === "stored"` (or local saved) exists.

---

## 1. Where PEPCO / UCI project scrape is triggered

### Frontend (`main` and feat — same handlers)

| Trigger | Location | API |
|---------|----------|-----|
| Row **Scrape Details** / **Refresh Details** | `PepcoProjectList` → `onScrapeProject` → `handleScrapePepcoProject` → `handlePepcoRowDetailScrape` in `src/pages/UciDashboard.tsx` | `POST /api/uci/coordination/:id/discovery/pepco/application-details` via `postPepcoApplicationDetailDiscovery` (`src/lib/uciApi.ts`) |
| MFA resume / code submit | Same page handlers | `POST …/application-details/resume` via `resumePepcoApplicationDetailDiscovery` |
| Dashboard discovery (project cards only) | `PepcoPortalHeaderSection` → Discover dashboard | `POST …/discovery/pepco/dashboard` — **no document download** |
| Login check | Header → Check portal connection | `POST …/discovery/pepco` — **no document download** |
| Re-sync normalized data | Header menu | Normalized portal sync from already-scraped detail — **does not download files** |

### Backend / scraper chain

1. **Route:** `scraper-service/app/routes/uci.routes.js`  
   - `POST /coordination/:id/discovery/pepco/application-details`  
   - Reads `body.download_documents === true` (opt-in; anything else → false).
2. **Service:** `uci-pepco-application-detail-discovery.service.js`  
   - `buildAppDetailRunOptions` / `downloadDocumentsOpt === true`  
   - Logs `"Document downloads enabled for this run"` or `"Documents will be listed only"`.
3. **Scraper:** `scraper-service/scrapers/pepco/application-detail-discovery.js` → `scrapePepcoApplicationDetails`  
   - Always lists docs: `GET …/applications/:uuid?includeDocuments=true`  
   - Downloads only if `options.downloadDocuments === true` → `downloadPepcoDocuments` → PEPCO `POST …/files/download` → `storeUciPortalDocument`.
4. **Persistence:** results written into `coordination_records.metadata.pepco_application_detail_discovery.applications[]` (`documents` + optional `downloadedFiles`).
5. **Serve stored files:**  
   - `GET …/application-details/:applicationUuid/documents/:documentIndex/download`  
   - `GET …/application-details/:applicationUuid/documents/:documentIndex/view`  
   - Implemented in `uci-pepco-document-download.service.js` (requires a matching **saved** `downloadedFiles` entry).

---

## 2. Does `downloadDocuments` / `includeDocuments` exist?

| Flag | Layer | Semantics |
|------|-------|-----------|
| `includeDocuments=true` | PEPCO portal API query param | Always used when fetching the document **list**. Not a UI flag. |
| `downloadDocuments` | Scraper / session options | Internal boolean; **must be strictly `true`**. |
| `download_documents` | HTTP body (snake_case) | API contract from UI/clients; same opt-in. |
| `pepcoDownloadDocuments` | React state | Checkbox state; **`useState(false)`** on both branches. |

There is no separate “includeDocuments” UI control. Listing always happens; downloading is gated.

---

## 3. Is the flag exposed in UI, hidden, hardcoded, or API-only?

| Aspect | `main` | `feat/lovable-ui-replication` |
|--------|--------|-------------------------------|
| Exposed? | Yes — checkbox in `PepcoPortalHeaderSection` | Same component |
| Label | “Download documents during next project scrape” | Same |
| Default | **Unchecked (`false`)** | Same |
| Placement | Inline in coordination drawer with project list / scrape actions | Moved under drawer tab **Portal sync** (`UCI_DRAWER_TABS` / `TabsContent value="portal-sync"`) |
| Easy to miss? | Moderately — small checkbox under PEPCO Portal header; scrape action is a per-row menu item with different wording | Higher — users on **Documents** tab see coverage panel / “Listed only” helper text but **not** the checkbox (checkbox lives on **Portal sync**) |
| Hardcoded false in API? | No — UI can send `true` | No |
| Progress for downloads | Technical progress log lives under **Developer tools** (collapsed by default) | Same |

Empty-state copy in `PepcoApplicationDetailsPanel` says: *“Run a project scrape with document download enabled.”* — but the control is not named that way and is not next to the Documents table.

---

## 4. Exact route / service / storage for document downloads

```
UI checkbox (optional) + Scrape Details
  → POST /api/uci/.../discovery/pepco/application-details
       body: { application_uuids, download_documents: true|false, … }
  → runPepcoApplicationDetailDiscovery
  → scrapePepcoApplicationDetails(..., { downloadDocuments })
       → list:  GET  /applications/:uuid?includeDocuments=true
       → files: POST /applications/:uuid/files/download  (only if downloadDocuments)
       → storeUciPortalDocument → Supabase Storage bucket `project-documents`
            path: uci/<tenantNamespace>/<projectId>/<coordinationId>/pepco/<applicationUuid>/<fileName>
  → persist metadata.pepco_application_detail_discovery
  → UI View/Download:
       GET .../documents/:documentIndex/view|download
```

**Canonical metadata (not `project_documents` rows for portal PEPCO files):**  
`coordination_records.metadata.pepco_application_detail_discovery.applications[].downloadedFiles[]`

Verified file entry shape (successful download):

- `status: "saved"`
- `storageStatus: "stored"`
- `storageBucket: "project-documents"`
- `storagePath: "uci/unconfigured/.../pepco/.../File.pdf"`

UI openability (`resolvePepcoDocumentCopyStatus`): View/Download enabled only for `stored` | `local_only` | `storage_failed`. **Listed only** → no open/download actions.

---

## 5. Why the selected project only has listed document metadata

For coordination **COM-00317-2026** / app `f704555e-…` (scraped 2026-08-04):

- `documents.length === 19`
- `downloadedFiles` **missing / empty**
- `scrapeStatus === "completed"`

That is exactly the path when `downloadDocuments` is false: scraper logs “Documents will be listed only”, still marks scrape completed if overview/status/messages/list succeed.

Same PEPCO application UUID **was** fully downloaded earlier on a **different** coordination (see §7), proving the download pipeline works when the flag is true — the recent COM-00317 run simply did not enable it.

---

## 6. Smallest fix to expose “Scrape with document downloads” without changing normal sync

**Do not** flip the default checkbox to always-on (downloads are slow, MFA-bound, and heavier).

**Minimal UX (recommended):**

1. Keep `pepcoDownloadDocuments` default `false` for ordinary **Scrape Details / Refresh Details**.
2. Add a second row-menu (or button) action: **“Scrape with document downloads”** that calls the same handler with `download_documents: true` for that run only (bypass / override checkbox).
3. Optionally keep the existing checkbox as an advanced sticky preference.
4. On feat: also surface a one-line CTA on the Documents tab empty/listed-only state that switches to Portal sync or directly invokes the download scrape — so the Documents helper text is actionable.
5. In the busy banner, show mode: `Syncing … (metadata only)` vs `Syncing … (with document downloads)`.

No API/schema change required; flag and routes already exist.

---

## 7. Live Supabase evidence (verified file records / paths)

Queried `coordination_records` (7 rows total in this environment) and Storage `project-documents` under `uci/…`.

### A. Successful document downloads (`downloadedFiles` + Storage objects exist)

#### 1) Wonder — Tenant Fit Out

| Field | Value |
|-------|--------|
| PermitPilot project | **CTBO24-02589-RA1** (`8d2a45ad-bca8-4858-a2c7-fbe84fd0e307`) |
| Coordination id | `0de0938f-9ede-4e36-a0f9-bbc6113a2296` |
| PEPCO project name | Wonder - Tenant Fit Out - Modification & Relocation - 001 |
| PEPCO job / number | **PEPCO-NB-0064620** |
| Application UUID | `05f5038f-0edd-4151-b575-60569a55e827` |
| Last scrape | 2026-07-08T17:56:09.397Z |
| Documents listed | **3** |
| Documents downloaded / stored | **3 / 3** (`storageStatus: stored`) |
| Storage | Bucket `project-documents`; prefix `uci/unconfigured/8d2a45ad-…/0de0938f-…/pepco/05f5038f-…/` (3 objects verified via Storage list API) |
| Metadata table | `coordination_records.metadata.pepco_application_detail_discovery` |
| Open from UI? | **Yes**, if this coordination is opened in UCI — View/Download use stored `downloadedFiles` + stream routes |

#### 2) Aspen Hill (downloaded on CTBO coordination)

| Field | Value |
|-------|--------|
| PermitPilot project | **CTBO24-02589-RA1** (same as above) |
| Coordination id | `0de0938f-9ede-4e36-a0f9-bbc6113a2296` |
| PEPCO project name | Aspen Hill MD - Commercial & Industrial - 001 |
| PEPCO job / number | **PEPCO-NB-0067752** |
| Application UUID | `f704555e-9f4b-4822-b6af-8c9d4a980226` |
| Last scrape | 2026-07-08T17:40:33.653Z |
| Documents listed | **19** |
| Documents downloaded / stored | **19 / 19** |
| Storage | Same bucket; prefix `…/pepco/f704555e-…/` (**19 objects verified**) |
| Open from UI? | **Yes** on this coordination |

### B. Listed-only (current issue pattern — do not treat as downloaded)

| Field | Value |
|-------|--------|
| PermitPilot project | **COM-00317-2026** (`33241a79-9cb8-4498-9f79-c1c0638e8521`) |
| Coordination id | `b960d823-1dbd-4891-bb47-b629ae2a4808` |
| PEPCO project name | Aspen Hill MD - Commercial & Industrial - 001 |
| PEPCO job / number | **PEPCO-NB-0067752** |
| Application UUID | `f704555e-9f4b-4822-b6af-8c9d4a980226` (same PEPCO app as A2) |
| Last scrape | **2026-08-04T21:36:23.629Z** |
| Documents listed | **19** |
| `downloadedFiles` | **0** |
| Storage for this coordination | No download metadata → UI cannot open via PEPCO document routes |
| Open from UI? | **No** — badges show **Listed only**; helper points at scrape-with-download |

### C. Other scraped app (no docs)

| Field | Value |
|-------|--------|
| PermitPilot project | CTBO24-02589-RA1 |
| Coordination | `0de0938f-…` |
| PEPCO job | PEPCO-NB-0000347 |
| Application UUID | `19dfedad-8829-4d35-96b9-2baf6797cc8e` |
| Last scrape | 2026-07-13T20:12:09.749Z |
| Listed / downloaded | 0 / 0 |

**Note:** PEPCO portal files are **not** primarily tracked as `project_documents` table rows; durable bytes live in Storage + `downloadedFiles` metadata. Do not use normalized sync counts or `pepco_document_count` alone as proof of file download.

---

## 8. Scrape status UX gaps (plan only)

### What exists today

| Surface | Behavior |
|---------|----------|
| `PepcoSelectedProjectProgress` | While busy: spinner + “Syncing {title}…”. No phase, no download mode, no doc counters mid-run. |
| `PepcoApplicationDetailProgressLog` | Maps backend lines via `mapPepcoAppDetailProgressLine` (login → MFA → overview → documents → downloading → completed). |
| Placement | Progress log is inside **Developer tools**, **collapsed by default**. |
| Transport | Long-running **single HTTP request**; `progress[]` returned on response (and intermediate `human_required`). **No continuous poll/SSE** while the scrape holds the connection. |
| Toasts | Start/MFA/complete/fail toasts; not a live phase timeline. |

### Gaps

1. Users see a static busy chip for minutes with no milestone updates until the request returns.  
2. Continuous status that *does* exist is hidden under Developer tools.  
3. No indication whether the in-flight run includes document downloads.  
4. Completion summary counts “documents” from **listed** metadata, not stored files.  
5. Feat **Documents** tab is disconnected from the download opt-in control on **Portal sync**.

### Recommended continuous status UI (plan — do not implement in this audit)

**Phase A (frontend-only, smallest):**

- While `pepcoAppDetailBusy` / row busy: always show `PepcoApplicationDetailProgressLog` (or a compact milestone strip) **above** the project detail tabs — not inside Developer tools.  
- Busy copy: include `(metadata only)` vs `(downloading documents)`.  
- On complete: show `listed N · stored M` from `documents` vs `downloadedFiles` with `storageStatus === "stored"`.

**Phase B (real continuous status):**

- Persist scrape job / progress on a durable row (or reuse UCI portal-sync job progress patterns) and poll from the UI, **or** stream progress events.  
- Map the same milestones already defined in `mapPepcoAppDetailProgressLine`.  
- Keep Accela global scrape widget out of scope unless intentionally unified later (`docs/audits/scraper-progress-widget-audit.md` is a different Accela path).

---

## 9. Feat vs main (relevant differences only)

| Topic | main | feat |
|-------|------|------|
| Download flag semantics | Identical opt-in | Identical |
| Checkbox + scrape wiring | Present | Present |
| Layout | Single drawer stack | Split into tabs; PEPCO scrape + checkbox under **Portal sync**; separate **Documents** tab for coverage panel |
| Risk | Checkbox easy to overlook | Users reading **Listed only** on Documents / detail may never see the Portal sync checkbox |

Backend download behavior is not a feat-only regression; the opt-in default false is shared with `main`.

---

## 10. Report card (requested)

| Question | Answer |
|----------|--------|
| **Root cause** | Opt-in `download_documents` defaults off; UI scrape path usually runs list-only. “Listed only” is expected, not a storage bug. |
| **Exact current testable project** | **COM-00317-2026** / coordination `b960d823-1dbd-4891-bb47-b629ae2a4808` / PEPCO Aspen Hill `PEPCO-NB-0067752` / UUID `f704555e-9f4b-4822-b6af-8c9d4a980226` — 19 listed, 0 stored (scraped 2026-08-04). |
| **Recommended UI action** | Add explicit **“Scrape with document downloads”** next to Scrape Details; keep normal scrape metadata-only. On feat, make Documents tab CTA jump to that action. |
| **Status UX recommendation** | Unhide milestone progress while busy; show download mode; later add polled/streamed progress so status updates continuously during the long scrape. |
| **Proven successful downloads** | CTBO24-02589-RA1 coordination `0de0938f-…`: Wonder (3/3) and Aspen Hill (19/19) stored under `project-documents` `uci/unconfigured/…/pepco/…` and openable via UCI view/download routes when that coordination is selected. |

---

## 11. Key file index

| Path | Role |
|------|------|
| `src/pages/UciDashboard.tsx` | State `pepcoDownloadDocuments`; scrape/resume handlers |
| `src/components/uci/PepcoPortalDrawerSection.tsx` | Checkbox + Developer tools (progress) |
| `src/components/uci/PepcoProjectList.tsx` | Scrape Details / Refresh Details |
| `src/components/uci/PepcoApplicationDetailsPanel.tsx` | Listed only badges; View/Download |
| `src/lib/pepcoApplicationDetailUi.ts` | Copy status + progress line mapping |
| `src/lib/uciApi.ts` | Client API + document view/download URLs |
| `scraper-service/app/routes/uci.routes.js` | HTTP routes |
| `scraper-service/app/services/uci/uci-pepco-application-detail-discovery.service.js` | Orchestration + flag |
| `scraper-service/scrapers/pepco/application-detail-discovery.js` | List + download implementation |
| `scraper-service/app/services/uci/uci-document-storage.service.js` | Storage path + upload |
| `scraper-service/app/services/uci/uci-pepco-document-download.service.js` | Stream stored files to UI |

---

*End of audit. No code changes were made beyond writing this document.*
