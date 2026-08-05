# Jurisdiction scraping UI test map

**Branch audited:** `feat/lovable-ui-replication`  
**Audit date:** 2026-07-27  
**Scope:** Documentation / architecture mapping only — no UI implementation, route, nav, scraper, or backend changes in this task (except checklist JSON correction notes listed in §12 / Final Report).

**Workflow under test:**

1. Select project → 2. Select jurisdiction/portal → 3. Start scrape → 4. Monitor status → 5. View scraped records & documents → 6. Open document / review output → 7. Parse comments → 8. Classify → 9. Enrich / grounded processing → 10. Review comment data → 11. Response Matrix → 12. Review / edit / approve / export

---

## 1. Executive summary

PermitPilot already has a **complete, real** jurisdiction-scrape → comments → Response Matrix pipeline on this branch. Lovable UI replication has restyled several surfaces (Dashboard, Portal Harvest chrome, Response Matrix shell) but **did not relocate scrape initiation onto Lovable’s Portal Harvest “Force Sync” metaphor**.

| Finding | Detail |
|---|---|
| **Where scrape starts today** | `/dashboard` → **Workflow Tools** panel → **Intake Pipeline** tab → `AgentWorkflowStatus` → `POST {SCRAPER_URL}/api/login` then `/api/scrape` |
| **Where results are viewed** | `/portal-data` (Portal Harvest) — queue + Accela/ProjectDox detail, Files tab |
| **Where comments are reviewed** | `/comment-review` (PP-only; no Lovable row) |
| **Where classification is reviewed** | `/classified-comments` (PP-only) |
| **Where responses are edited/exported** | `/response-matrix` |
| **Largest journey risk** | Portal Harvest **Force Sync** only reloads `projects.portal_data` (`silentRefetch`). Copy on that page still implies it “re-runs harvest.” Operators who only open Portal Harvest will **not** start a scrape. |
| **Project selection** | Header `ActiveProjectControl` (not sidebar). Some empty-state copy still says “sidebar.” |
| **Preferred E2E jurisdiction** | **Arlington Accela** — durable `scrape_jobs` worker, attachments-only tabs, `partial_external_blocker`, continue/resume Plan Review. Other Accela (Baltimore/Fairfax) and ProjectDox (DC/PGC/Montgomery/Howard) remain in scope for regression. |
| **Recommended first checklist unit** | **L024 + L027 + PP012 + PP013 + L023 + PP022** (harvest view + intake scrape/chain + comment surfaces + matrix + grounded), with **L008/L009/L078** as prerequisites and **PP019/PP021** as preserve-backend. |

**Real vs mock rule (for later UI work):** keep Lovable mock harvest/matrix chrome visible with **Mock/Demo** badges; keep PP-only Comment Review / Classified Comments / Intake Pipeline visible as **Real/Live**; never wire Lovable Force Sync to pretend it scrapes; never replace `parsed_comments` with Lovable sample rows.

---

## 2. Relevant architecture checklist rows

Grouped by workflow stage. Implementation/verification statuses below are **matrix defaults** (`Audited` / `Not tested`) unless an admin overlay exists in Supabase.

### A. Project and jurisdiction selection

| Row ID | Lovable | Lovable route | PermitPilot | PP route | Match | UI status | Backend | Why in workflow | Reality |
|---|---|---|---|---|---|---|---|---|---|
| **L008** | Projects | `/projects` | Projects | `/projects` | Strong | Partial card chrome | Fully working | Create/select projects; permit # | **Real** |
| **L009** | New Project (Portal Credentials) | `/projects/new` | Credential capture (dialog) + Settings portals | Modal + `/settings` | Same purpose / different arch | Partial | Fully working | Portal credential + jurisdiction URL | **Real** (Settings primary) |
| **L078** | Settings | `/settings` | Settings | `/settings` | Strong | Partial | Fully working | **Portal Credentials** tab CRUD | **Real** |
| **L005** | Dashboard (layout) | `/dashboard` | Dashboard | `/dashboard` | Strong | Partial | Fully working | Shell that hosts Intake Pipeline | **Real** (Lovable mock KPIs not imported) |
| **L006** | Dashboard · Operations | `/dashboard` index | Same page | `/dashboard` | Partial | Partial | Fully working | Folded into L005; hosts Workflow Tools | **Real** |

### B. Scrape initiation

| Row ID | Lovable | Lovable route | PermitPilot | PP route | Match | UI status | Backend | Why | Reality |
|---|---|---|---|---|---|---|---|---|---|
| **L027** | AI Workflow | `/matrix/ai-workflow` | **Intake Pipeline / AgentWorkflowStatus** | `/dashboard` (Workflow Tools → Intake Pipeline) | Same purpose / different arch *(corrected 2026-07-27)* | Partial — real scrape+chain UI on Dashboard | Fully working | **Only live scrape start UI** + chain trigger | **Real** |
| **L024** | Portal Harvest | `/portals/harvest` | Portal Data Viewer | `/portal-data` | Strong | Partial; Force Sync ≠ scrape | Fully working | View/monitor harvested data; **not** primary start | **Real** view; Lovable Force Sync is **mock-intent** if copied |
| **PP019** | — | — | scraper-service (jurisdiction + UCI) | Railway HTTP API | N/A | Working | Working | Playwright engine for all portal scrapes | **Real** |
| **PP018** | — | — | Baltimore Accela clone | `/baltimore/*` | N/A | Mock labelled | None | UI reference only — **not** harvest path | **Mock** |

### C. Job monitoring

| Row ID | Surface | Route / UI | Reality |
|---|---|---|---|
| **L027** / shell | `ScrapeProgressPanel`, `ScrapeHeaderIndicator`, Intake step status | Global under `DashboardLayout` + `/dashboard` | **Real** (`scrape_jobs` / `scrape_events`) |
| **L024** | “Harvesting…” banner while scrape active | `/portal-data` | **Real** (observes scrape context; does not own job) |
| **L015** (related) | Permit Queue placeholder | `/permit-queue` | **Coming soon** — no scrape_jobs history UI |

### D. Scraped-data review

| Row ID | Lovable | PP | Route | Reality |
|---|---|---|---|---|
| **L024** | Portal Harvest queue/detail | PortalDataViewer + Accela/ProjectDox views | `/portal-data` | **Real** `projects.portal_data` |

### E. Documents and ingestion

| Row ID | Lovable | PP | Route | Reality |
|---|---|---|---|---|
| **L024** | Harvest files | Files / Reports tabs | `/portal-data` | **Real** storage URLs in `project-drawings` |
| **L034** | Document Vault `/documents` | Contextual docs (no vault page) | `/portal-data`, UCI docs drawer | **Partial / weak** vault UX; backend **Real** |
| **PP021** | — | Document ingestion worker | worker + `ingest-project-document` | **Real** |

### F. Comment parsing

| Row ID | Lovable | PP | Route | Reality |
|---|---|---|---|---|
| **PP012** | No Lovable equivalent | Comment Review | `/comment-review` | **Real** (manual + auto via chain) |
| **L027** | AI Workflow | Chain stage `comment_parser` | Dashboard Intake | **Real** auto after scrape |
| **L023** | Assumes comments exist | Response Matrix consumes `parsed_comments` | `/response-matrix` | **Real** |

### G. Comment classification

| Row ID | PP | Route | Reality |
|---|---|---|---|
| **PP013** | Classified Comments | `/classified-comments` | **Real** |
| **L027** | Chain stage `discipline_classifier` | Dashboard Intake | **Real** auto |

### H. Automatic enrichment / grounded processing

| Row ID | PP | Where | Reality |
|---|---|---|---|
| **L027** | `intake-pipeline-agent` enrichment + auto_routing | Dashboard / Matrix Actions | **Real** |
| **PP022** | `generate-grounded-response` | Response Matrix Grounded / Auto-Draft | **Real** |
| **PP021** | Chunk ingest for grounding | document ingestion | **Real** |

### I. Response Matrix

| Row ID | Lovable | PP | Route | Reality |
|---|---|---|---|---|
| **L023** | `/matrix/response` (Mock) | Response Matrix | `/response-matrix` | **Real** data; **Partial** Lovable chrome |
| **L025/L026** | Master / Unified Matrix | — | — | **Missing / do not build** for this journey |

### J. Approval and export

| Row ID | Surface | Reality |
|---|---|---|
| **L023** | Row approve + package export | **Real** (`parsed_comments` approval trigger; `export-response-package`) |
| **PP022** | Grounded drafts feeding approval | **Real** |

### Explicitly out of this workflow unit

Mission Control (L013), Command Center (L014), Master/Unified Matrix (L025/L026), UCI-only rows except incidental links, Baltimore mock clone as a substitute for live harvest (PP018).

---

## 3. Current user journey

Answers verified against `feat/lovable-ui-replication` code.

### Q1–Q4 — Project & jurisdiction

| # | Question | Answer |
|---|---|---|
| 1 | Where select project? | **Header** `ActiveProjectControl` on every `DashboardLayout` page. Also `/projects` list selection sets active workspace. |
| 2 | Still in sidebar? | **No.** |
| 3 | If moved? | Header popover (`data-testid="header-active-project"`). Persisted via `SelectedProjectContext` → `localStorage` `epermit:selectedProjectId:{userId}` + optional `?projectId=`. |
| 4 | Where select jurisdiction? | **No dedicated scrape jurisdiction picker.** Jurisdiction comes from (a) optional free-text on project create in header, (b) **credential jurisdiction** when adding a portal in Settings (`JURISDICTION_PORTALS` presets), (c) displayed on Portal Harvest queue from project/credential. |

**Files:** `src/components/layout/ActiveProjectControl.tsx`, `src/contexts/SelectedProjectContext.tsx`, `src/hooks/useProjects.ts`  
**Status:** Real

### Q5–Q8 — Portal, credentials, start, modes

| # | Question | Answer |
|---|---|---|
| 5 | Select portal? | `/settings` → tab **Portal Credentials** → pick preset from `JURISDICTION_PORTALS` or custom URL. |
| 6 | Credentials? | Same Settings tab (`PortalCredentialsManager` + `portalCredentialsApi`). Link credential to project in header **Portal Credential** select (`projects.credential_id`). Passwords never returned to browser after save. |
| 7 | Start scrape? | `/dashboard` → **Workflow Tools** → **Intake Pipeline** → **Quick Scrape** / mode dropdown (`AgentWorkflowStatus`). |
| 8 | Modes? | Credential-detected. Examples: Arlington — Scrape All / Quick (Record Info Only) / **Attachments Only** / Plan Review scopes; Baltimore/Fairfax — Info / Attachments; ProjectDox — Quick / Full (with files) / Files Only / Comments Only / Supporting Docs; PGC/Montgomery/Howard — portal-specific `scrape_*` / `*_files_only` / `*_all`. |

**API:** `POST /api/login` → `POST /api/scrape` (`src/lib/scraperBaseUrl.ts`)  
**Status:** Real. **Not** started from Portal Harvest.

### Q9–Q14 — Monitor, history, records, documents

| # | Question | Answer |
|---|---|---|
| 9 | Monitor progress? | Floating `ScrapeProgressPanel`; header `ScrapeHeaderIndicator`; Intake Pipeline step UI; Portal Harvest shows harvesting state. |
| 10 | Completed runs? | **No scrape_jobs history page.** Closest: Portal Harvest queue “Recent harvest” via `last_checked_at`. `/permit-queue` is Coming soon. |
| 11 | Scraped permit records? | `/portal-data` detail (Accela views / ProjectDox tabs: Info, Status, Tasks, Review, Reports, Files). |
| 12 | Downloaded documents? | `/portal-data` → **Files** (+ Reports). Storage: `project-drawings` bucket paths under `drawings/{projectId}/…`. |
| 13 | Folders / attachment categories? | Files tab folder groups; Accela attachments / Plan Review structures; live `useScrapeFileResults` during job. |
| 14 | Open document? | File name links (`publicUrl` \|\| `viewUrl` \|\| `downloadUrl`) open in new tab when URL present. |

### Q15–Q22 — Parse, classify, enrich

| # | Question | Answer |
|---|---|---|
| 15 | Parsing begins? | Auto: scrape complete → `runChainedPipeline` → edge `intake-pipeline-agent` (`comment_parser`). Manual: `/comment-review` **Load comments from portal** / **Parse comments**. |
| 16 | Auto or manual? | **Both.** Auto after successful scrape when Intake Pipeline is mounted; manual always available on Comment Review. |
| 17 | Parsed comments displayed? | `/comment-review` extracted/approve panels; after approve → `parsed_comments`; also `/response-matrix`. |
| 18 | Classification performed? | Auto in chain (`discipline_classifier`); manual **Refresh classifications** on `/classified-comments` → `discipline-classifier-agent`. |
| 19 | Classified display? | `/classified-comments` (grouped by discipline). |
| 20 | Enrichment / grounded? | Enrichment: chain phase or **Run Enrichment** (Intake / Matrix Actions) via `intake-pipeline-agent`. Grounded drafts: Matrix **Grounded** / **Auto-Draft** → `generate-grounded-response`. |
| 21 | What triggers it? | Post-scrape chain; explicit Run Enrichment / Auto-Draft / Grounded buttons. |
| 22 | Enrichment results shown? | Comment enrichment fields on matrix/classified rows; grounded text in response cells with citations. |

### Q23–Q30 — Matrix, gaps, mock, PP-only

| # | Question | Answer |
|---|---|---|
| 23 | Reach Response Matrix? | Sidebar **Delivery → Response Matrix** `/response-matrix`; also Dashboard links / command palette. |
| 24 | Required context? | Selected project (`useResolvedProjectId`); rows from live `parsed_comments`. |
| 25 | Review/edit/approve/export? | Same page: edit cells, approve (owner/admin), Actions → Export Response Package, CSV/XLSX export menu. |
| 26 | Steps no longer reachable via new UI? | **Needs verification** for any pre-replication sidebar “scrape from portal” control — current code has **no** scrape start on `/portal-data`. If operators only use Harvest Force Sync, scrape is effectively unreachable. |
| 27 | Direct-URL-only routes? | `/baltimore/*` mock clone; deep `?projectId=` links; Arlington continue/resume APIs have no first-class nav. Main Delivery routes **are** in sidebar. |
| 28 | Old sidebar actions disappeared/replaced? | Project/credential selection moved to **header**. Scrape start lives under Dashboard Workflow Tools (secondary fold), not as a top-level “Scrape” nav item. |
| 29 | Visible Lovable mock-only? | Lovable reference `/portals/harvest` Force Sync / fabricated runs (reference app). In PP, Baltimore Accela clone (`PP018`). Lovable Master/Unified Matrix routes not shipped. |
| 30 | Real PP not in Lovable? | Comment Review, Classified Comments, Intake Pipeline scrape modes, Arlington durable statuses (`partial_external_blocker`), grounded generation, document ingestion worker, scrape progress chrome. |

---

## 4. Previous vs current entry-point comparison

| Workflow action | Previous PermitPilot entry (pre–Lovable chrome) | Current feature-branch entry | Still accessible? | Route | Real or mock | Problem |
|---|---|---|---|---|---|---|
| Select project | Sidebar / project picker (historical copy still says sidebar) | Header `ActiveProjectControl` | Yes | Global header | Real | Stale “sidebar” copy on Comment Review / Classified empty states |
| Select jurisdiction | Credential jurisdiction field | Settings portal presets + project text | Yes | `/settings` | Real | No explicit scrape-time jurisdiction step |
| Select portal | Settings Portal Credentials | Same | Yes | `/settings` | Real | Secondary CTAs from Harvest → Settings/Projects |
| Choose credentials | Sidebar credential dropdown (copy remnant) | Header Portal Credential select | Yes | Header | Real | Error strings may still say “sidebar dropdown” |
| Start scrape | Agent / dashboard monitor controls | Dashboard → Intake Pipeline → Quick Scrape | Yes | `/dashboard` | Real | Easy to miss under secondary Workflow Tools; **not** on Harvest |
| Monitor scrape | Progress panel / agent status | Same + header chip | Yes | Global + `/dashboard` | Real | — |
| View scraped data | Portal Data Viewer | Portal Harvest `/portal-data` | Yes | `/portal-data` | Real | — |
| View documents | Portal Files tab | Same | Yes | `/portal-data` Files | Real | No cross-project Document Vault (L034) |
| Parse comments | Comment Review + chain | Same | Yes | `/comment-review` + chain | Real | PP-only nav — Lovable omits it |
| Classify comments | Classified Comments + chain | Same | Yes | `/classified-comments` | Real | PP-only |
| Enrich comments | Chain / Matrix Actions | Same | Yes | `/dashboard`, `/response-matrix` | Real | — |
| Open Response Matrix | Sidebar | Delivery → Response Matrix | Yes | `/response-matrix` | Real | Lovable route `/matrix/response` not used (correct) |
| Approve / export | Matrix | Same | Yes | `/response-matrix` | Real | — |
| “Force Sync” = scrape | N/A / ambiguous | Harvest Force Sync = `silentRefetch` only | Misleading | `/portal-data` | Real refresh, **not** scrape | **Copy implies re-harvest; does not call scraper** |

---

## 5. Route and component map

| Stage | Route | Entry point | Component | Context |
|---|---|---|---|---|
| Shell | `*` authenticated | App sidebar + header | `DashboardLayout`, `AppSidebar`, `hybridNav.ts` | Auth |
| Project | Global | Header “Select project” | `ActiveProjectControl` | `SelectedProjectContext` |
| Credentials | `/settings` | Help → Settings → Portal Credentials | `PortalCredentialsManager` | Auth |
| Start scrape | `/dashboard` | Workflow Tools → Intake Pipeline | `AgentWorkflowStatus` | Project + credential + permit # |
| Progress | Global | Header scrape chip / floating panel | `ScrapeHeaderIndicator`, `ScrapeProgressPanel`, `ScrapeContext`, `useScrapeJob` | Active job |
| Harvest queue/detail | `/portal-data` | Delivery → Portal Harvest | `PortalDataViewer`, `PortalHarvestQueue`, Accela/ProjectDox views | Project / portal_data |
| Comment parse | `/comment-review` | Delivery → Comment Review | `CommentReview`, batch process libs | Project |
| Classify | `/classified-comments` | Delivery → Classified Comments | `ClassifiedComments` | Project |
| Matrix | `/response-matrix` | Delivery → Response Matrix | `ResponseMatrix`, export menus | Project + `parsed_comments` |
| Mock Accela UI | `/baltimore/*` | Direct / demos | Baltimore pages | **Mock** |
| Queue placeholder | `/permit-queue` | Delivery → Permit Queue | `PermitQueuePlaceholder` | Coming soon |

**Nav group:** `hybridNav.ts` → **Delivery**: Response Matrix, Portal Harvest, Comment Review, Classified Comments (+ Permit Queue placeholder).

---

## 6. Backend / service map

### Scraper-service (Railway)

| Endpoint | Role |
|---|---|
| `POST /api/login` | Playwright login via `credentialId` |
| `POST /api/scrape` | Start scrape; Arlington may enqueue durable job |
| `GET /api/progress/:sessionId` | SSE |
| `GET /api/data/:sessionId` | Snapshot |
| `POST /api/scrape/cancel/:sessionId` | Cancel session |
| `POST /api/scrape-jobs/:jobId/cancel` | Cancel durable job |
| Accela Plan Review continue/resume | Arlington download continuation |
| `/api/portal-credentials` | Credential CRUD (no password out) |

**Jurisdictions (detection by URL):** Washington DC ProjectDox (default), PGC ePlan, Montgomery, Howard, Baltimore Accela, Fairfax Accela, **Arlington Accela (durable worker)**, Accela generic.

**Modes:** Tab / `scrapeMode` based — not a single global `attachments_only` enum. Arlington attachments-only ≈ `tabs: ["attachments"]`.

**Statuses (`scrape_jobs`):** `queued`, `running`, `resuming`, `partial`, `rate_limited`, `waiting_user`, `completed`, `completed_with_warnings`, `partial_external_blocker`, `failed`, `failed_unrecoverable`, `cancelled`.

**Arlington durable:** `arlington-durable-worker-loop.js`, RPCs `claim_arlington_scrape_job`, heartbeats, `cancel_arlington_scrape_job`, completion evaluator → `partial_external_blocker` when incomplete with no retryable work.

### Supabase tables / storage

`scrape_jobs`, `scrape_events`, `scrape_file_results`, `projects.portal_data`, `portal_credentials`, `project_documents`, `document_ingestion_jobs`, `parsed_comments`, `project_pipeline_runs`, `response_package_drafts`  
Buckets: `project-drawings`, `project-documents`

### Edge / AI

| Function | Stage |
|---|---|
| `intake-pipeline-agent` | comment_parser → discipline_classifier → enrichment → auto_routing |
| `comment-parser-agent` / `parse-manual-comment-letter` / `parse-permit-comments` | Parse |
| `discipline-classifier-agent` | Classify |
| `context-reference-engine` | Enrich |
| `generate-grounded-response` / `generate-response` | Drafts |
| `ingest-project-document` | Grounding corpus |
| `export-response-package` | PDF package export |

Approval: DB trigger on `parsed_comments` (`enforce_parsed_comment_response_approval`).

---

## 7. Real vs mock classification

| Surface | Class | Badge guidance |
|---|---|---|
| Header project + credential | **REAL** | Live / Connected |
| Settings Portal Credentials | **REAL** | Live |
| Dashboard Intake Pipeline scrape | **REAL** | Live |
| Scrape progress chrome | **REAL** | Live |
| Portal Harvest queue/detail/files | **REAL** | Live |
| Harvest Force Sync | **PARTIAL** | Limited — “Refresh saved portal data only” |
| Comment Review / Classified | **REAL** (PP-only) | Live — keep visible though Lovable omits |
| Response Matrix data/actions | **REAL** | Live |
| Lovable reference Portal Harvest Force Sync / fake runs | **MOCK** | Demo / Preview — do not copy behavior |
| `/baltimore/*` | **MOCK** | Demo |
| `/permit-queue` | **FUTURE** | Coming soon |
| Lovable `/matrix/ai-workflow` | **MOCK** | Do not ship localStorage workflow |
| Document Vault L034 page | **FUTURE / UNAVAILABLE** as vault; docs **REAL** in context | Coming soon vs Live on Files tab |

---

## 8. Missing or broken entry points

| Issue | Root cause | Severity |
|---|---|---|
| Scrape start not on Portal Harvest | Journey split: Lovable metaphor vs PP Intake Pipeline | High for operator discovery |
| Force Sync copy implies re-harvest | `handleManualRefresh` → `silentRefetch` only; playbook text wrong | High (false affordance) |
| No scrape_jobs history UI | `/permit-queue` placeholder; never built | Medium |
| Stale “sidebar” project copy | Selection moved to header; strings not updated | Low |
| L027 matrix previously said “no workflow UI” | Audit drift — Intake Pipeline exists | Docs (corrected in JSON) |
| Document Vault missing | L034 deferred; files live under Harvest | Medium for Lovable parity only |
| Auto-chain depends on Dashboard mount | `onScrapeCompleteRef` wired in `AgentWorkflowStatus` | Medium — leaving Dashboard mid-scrape may delay chain (**Needs verification** of pendingCompletion recovery) |

---

## 9. End-to-end test plan

### Preferred jurisdiction: Arlington Accela

**Why:** Durable background worker, explicit Attachments Only mode, Plan Review continue/resume, `partial_external_blocker`, richest failure taxonomy. Baltimore/Fairfax Accela are good secondary Accela cases; PGC/Montgomery/Howard/DC for ProjectDox regression — not required for the first controlled pass.

### Prerequisites

- Branch Preview or local frontend on `feat/lovable-ui-replication` pointed at **development** backend.
- Demo admin/staff account only (shared prod Supabase — no destructive live filings).
- Existing project with valid **Arlington** permit number **or** create one.
- Portal credential: Arlington County VA → `https://aca-prod.accela.com/ARLINGTONCO/Login.aspx` with valid demo credentials.
- Project linked to that credential; permit # set in header.
- Confirm scraper-service healthy (`/api/health/playwright` if available).

### Exact starting path

1. Sign in → land `/dashboard`.
2. Header → select project → set permit # → select Portal Credential.
3. Optional: `/settings` → Portal Credentials → verify Arlington row.
4. `/dashboard` → scroll to **Workflow Tools** → tab **Intake Pipeline**.
5. Open scrape mode dropdown → choose mode (see cases).
6. Click **Quick Scrape** / mode action → expect login+scrape network calls.
7. Watch header scrape chip + floating progress → terminal status.
8. Open `/portal-data` → queue → open project → Info / Files / Plan Review as applicable.
9. Open a document link (if URLs present).
10. Confirm chain ran (Intake phases) **or** `/comment-review` → Load/Parse → Approve All.
11. `/classified-comments` → verify disciplines (optional Refresh).
12. `/response-matrix` → edit, Grounded draft, approve (if role allows), export package.

### Expected artifacts per stage

| Stage | UI | API | DB/Storage |
|---|---|---|---|
| Start | Intake buttons enabled | `/api/login`, `/api/scrape` | `scrape_jobs` row (Arlington durable) |
| Monitor | Progress events | Realtime `scrape_events` | status transitions |
| Data | Portal detail populated | — | `projects.portal_data` updated |
| Files | Files tab entries | — | `project-drawings/...`; `scrape_file_results` |
| Parse | Comment Review / Matrix rows | `intake-pipeline-agent` | `parsed_comments` |
| Classify | Classified page | classifier agent | `parsed_comments.discipline` |
| Enrich | Matrix enrichment fields | enrichment stage | enriched columns |
| Grounded | Draft text + citations | `generate-grounded-response` | response fields |
| Export | Package download | `export-response-package` | draft row / file |

### Test cases

| ID | Case | Expect |
|---|---|---|
| T1 | Normal successful scrape (Scrape All or Quick+Attachments) | `completed` or `completed_with_warnings`; portal_data present; chain progresses |
| T2 | Attachments Only | Attachments section progresses; info may stay sparse; files metadata/uploads |
| T3 | Missing credentials | Intake error; no `/api/scrape` |
| T4 | Invalid credentials | Login failure; job/session error; no silent success |
| T5 | Unsupported / wrong portal URL | Detection fallback or failure — record actual message (**Needs verification** per URL) |
| T6 | Retry / rate_limited | Arlington stays non-terminal; worker retries via `next_attempt_at` |
| T7 | Partial success / warnings | `completed_with_warnings` or section `partial` |
| T8 | External portal blocker | Terminal `partial_external_blocker` when incomplete & non-retryable |
| T9 | No documents found | Completes with empty attachments; UI empty state |
| T10 | Duplicate document handling | Re-scrape does not corrupt storage keys (**Needs verification** of overwrite/skip rules) |
| T11 | Duplicate comment prevention | Re-parse / re-chain does not duplicate `parsed_comments` keys |
| T12 | Stale/orphan comments | Credential/portal_data mismatch guards in PortalDataViewer; comment project scoping |
| T13 | Failed parsing | Chain phase error visible; manual Comment Review still usable |
| T14 | Failed enrichment | Matrix Run Enrichment error toast; rows remain |
| T15 | Export with grounded sources | Package includes grounded text / stamps non-approved per export rules |
| T16 | Force Sync control | Confirms **DB refresh only** — does not create new scrape_jobs |

### Regression checks

- Baltimore/Fairfax attachments-only menu still present.
- PGC/Montgomery quick vs files-only modes still listed when those credentials selected.
- UCI `/uci` still role-gated; no `/dashboard/uci`.
- Response Matrix never shows Lovable mock portfolio comments.
- `/baltimore/*` remains labelled mock and does not write scrape_jobs.

### Evidence to collect

Screenshots of: header project/credential; Intake mode menu; progress panel; Portal Harvest Files; Comment Review; Classified; Matrix grounded row; export.  
Network: login/scrape payloads (redact secrets).  
DB: `scrape_jobs.id/status`, count of `parsed_comments`, sample storage path.  
Note Preview URL + commit SHA.

---

## 10. Root-cause findings

1. **Split-brain start vs view:** Lovable Portal Harvest presents Force Sync as the harvest action; PP implemented real scrape on Dashboard Intake Pipeline and reused Harvest as a **viewer**. UI replication restyled Harvest without relocating start → discovery gap.
2. **False affordance:** Force Sync label + operator playbook claim “re-run harvest” but code only `silentRefetch`s JSON.
3. **Checklist drift:** L027 previously “no workflow UI” while `AgentWorkflowStatus` is the production scrape console — corrected in `architectureReplicationMatrix.json`.
4. **PP-only middle of funnel:** Comment Review & Classified Comments are essential and Lovable-invisible — must stay nav-visible with Real badges.
5. **Arlington complexity is backend-real:** durable jobs and `partial_external_blocker` have weak first-class UI explanation beyond status strings — **Needs verification** of operator clarity, not missing engine.

---

## 11. Recommended first implementation unit

**Checklist row IDs (grouped — do not implement yet):**

`L078` + `L009` (prereq credentials) → **`L027`** (scrape + chain entry) → **`L024`** (harvest viewer honesty) → **`PP012`** + **`PP013`** (parse/classify surfaces) → **`L023`** + **`PP022`** (matrix + grounded)  

**Preserve backends:** `PP019`, `PP021` (no scraper/ingestion code changes).

| Item | Detail |
|---|---|
| **Routes** | `/settings`, `/dashboard`, `/portal-data`, `/comment-review`, `/classified-comments`, `/response-matrix` |
| **Why grouped** | Single Arlington demo cannot succeed if any link in start→view→parse→matrix is missing or falsely labelled |
| **Preserve** | `/api/login`+`/api/scrape`, durable Arlington worker, `intake-pipeline-agent`, `parsed_comments` approval, grounded + export edges, header project context |
| **Mock surfaces** | Do not adopt Lovable fabricated harvest runs; keep `/baltimore/*` mock-labelled; do not ship `/matrix/ai-workflow` |
| **UI work (later)** | Clarify Intake Pipeline as scrape start; fix Force Sync copy/badge to “Refresh saved data”; Real/Mock/Partial badges; optional deep-link from Harvest → Intake; stale sidebar copy |
| **Backend work** | **None** for this unit |
| **Test sequence** | §9 T1–T16 with Arlington |
| **Stop condition** | Demo account completes Attachments Only + one full scrape → comments on Matrix → grounded draft → export, **without** using Harvest Force Sync as scrape; no scraper/API contract changes |

Smallest **visual-only** sub-slice if needed: **L024 honesty pass** (Force Sync labelling) + **L027 discoverability** (badge/link), still without scraper changes.

---

## 12. Open questions requiring a decision

1. Should Portal Harvest gain a **real** “Start scrape” CTA that deep-links to Intake Pipeline (or invokes the same start API), or remain view-only with corrected copy?
2. Should `/permit-queue` be built next as scrape_jobs history, or stay Coming soon?
3. Is auto-chain reliable if the user navigates away from `/dashboard` during scrape? (pendingCompletion path — **Needs verification**)
4. Which demo Arlington credential/permit is approved for shared-Supabase testing?
5. Should Comment Review / Classified move under a Lovable-named Delivery subgroup with Real badges, or stay as today?
6. For Real vs Mock badges: reuse existing `StatusPill` / `ServicePill` or add a dedicated `CapabilityBadge`?

---

## Checklist data updates made in this audit

| Row | Change | Marked Implemented/Verified? |
|---|---|---|
| **L024** | `auditNotes` + `derived.uiStatus` — scrape start not on Harvest; Force Sync = refresh only | **No** |
| **L027** | Match/feature/route/UI/backend/preserve/requiredFrontend/auditNotes — Intake Pipeline is real workflow UI | **No** |
| **PP019** | Preserve/auditNotes — jurisdiction harvest uses scraper-service, not UCI-only | **No** |
| **L009** | auditNotes — Settings is primary credential CRUD | **No** |

File: `src/data/architectureReplicationMatrix.json` only. CSV/MD matrix sources **not** regenerated in this pass (report explicitly).

---

## Confirmation

- **No** scraper code, routes, navigation, page redesigns, migrations, commits, pushes, or deploys were performed for implementation.
- **Only** documentation file `reference/lovable-ui/jurisdiction-scraping-ui-test-map.md` created and checklist JSON audit corrections above.
