# Portal Harvest Metrics and Functionality Audit

**Date:** 2026-07-28  
**Scope:** Read-only audit of `/portal-data` (Portal Harvest queue + project detail)  
**Constraints honored:** No code changes, migrations, commits, pushes, or deployments.

**Primary code:**

| Area | Path |
|------|------|
| Route | `src/App.tsx` → `/portal-data` |
| Detail page | `src/pages/PortalDataViewer.tsx` |
| Queue UI | `src/components/portal/PortalHarvestQueue.tsx` |
| Projects list hook | `src/hooks/useProjects.ts` |
| Live files hook | `src/hooks/useScrapeFileResults.ts` |
| Scrape runtime context | `src/contexts/ScrapeContext.tsx`, `src/hooks/useScrapeJob.ts` |
| Project type | `src/types/project.ts` (`portal_data` on type, not selected in list) |
| Scrape sync write path | `scraper-service/app/register-execution-routes.js` (writes `projects.portal_data`, `portal_status`, `last_checked_at`) |

**Verified live row used for report/file math:** project `6321752d-f31a-4c13-8f0e-c1c7db16827b` (permit `B2606607`).

---

## A. Executive findings

### Confirmed inconsistencies

1. **Queue “Synced = 0” / “Awaiting First Sync = 47” contradicts harvested detail for B2606607**  
   Queue treats `synced = !!project.portal_data`, but `useProjects` **never selects** `portal_data`, so every list row has `portal_data === undefined` → always unsynced in the queue UI.

2. **“Connected portals = 47” counts projects with a credential, not portals**  
   Subtitle already says “Projects with a linked credential,” but the label says “Connected portals.” For the audited user: **47** linked projects, only **7** unique `credential_id` values; **41** projects actually have non-null `portal_data` in the database.

3. **Reports metric `10` double-counts the same five logical reports**  
   Formula is `reportEntries.length + pdfs.length`. For B2606607 both arrays hold the same five report names; each logical report already embeds PDF + Excel URLs. Canonical logical report count is **5**, not 10.

4. **“Harvest status” shows jurisdiction permit status (`Approved`), not harvest execution status**  
   Detail card uses `portalData.dashboardStatus ?? portalStatus` (from scrape/dashboard + `projects.portal_status`), not `scrape_jobs.status` or a harvest outcome enum (except while `scrape.isScraping` → `"Live"`).

5. **“Active project = 1” is a binary selected-project flag**  
   Value is `selectedProjectId ? "1" : "0"`, not a count of active harvests/connections.

6. **Force Sync (detail) does not start a scrape**  
   It calls `silentRefetch()` → re-`select`s `projects.portal_data` from Supabase. Operator playbook text implies re-running harvest; button label overclaims.

7. **Queue Force Sync is unwired**  
   `PortalHarvestQueue` only renders Force Sync if `onForceSyncAll` is passed; `PortalDataViewer` queue render omits that prop → button absent/not functional from queue.

8. **Stale (7d+) is suppressed to 0 while synced is falsely false**  
   Stale requires `linked && synced && staleOrPending`. Because `synced` is always false in the queue, stale never increments even when `last_checked_at` is old.

9. **Recent Harvest “Approved/Open” text is portal permit status, not harvest result**  
   Queue cards show `project.portal_status` (fallback copy if empty). Not scrape job status.

10. **Scope mixing without labels**  
    Queue metrics are **current user’s project list** (RLS/`useProjects`). Detail metrics are **selected project** JSON. Operator “Scrape job” is **in-memory ScrapeContext** for the current browser session, not historical `scrape_jobs`.

### Suspected (not fully proven in this audit)

- Whether `useProjects` RLS vs explicit `user_id` filter always matches “workspace/tenant” expectations under multi-tenant membership.
- Whether some Accela detail paths skip the four MetricCards entirely (confirmed early-return structure; Accela UX differs) — metric audit below focuses on ProjectDox path matching the reported UI.

---

## Metric inventory table (visible values)

| UI element | Current displayed value (reported) | Component | Calculation/query | Source table/API | Real / derived / mock / fallback / hardcoded | Correct meaning | Problem | Recommended correction |
|------------|------------------------------------|-----------|-------------------|------------------|-----------------------------------------------|-----------------|---------|------------------------|
| Connected Portals | 47 | `PortalHarvestQueue` MetricCard | `rows.filter(r => r.linked).length`; `linked = !!credential_id` | `projects.credential_id` via `useProjects` | **Derived** (live count, wrong label) | Count of **projects with a linked credential** (user-scoped list) | Label implies unique portals; DB shows 47 projects / 7 credentials | Rename to “Connected projects” or count distinct credentials/portals and label accordingly |
| Synced | 0 | same | `!!project.portal_data` | Intended: `projects.portal_data` | **Broken derived** (always false on queue) | Projects with harvested JSON at least once | Column omitted from `PROJECT_COLUMN_LIST` | Select lightweight harvest signal (`portal_data` presence / `last_successful_harvest_at`) |
| Awaiting First Sync | 47 | same | `linked && !synced` | same | **Broken derived** | Linked projects never successfully harvested | Same root cause → all linked appear pending | Derive from successful harvest signal, not missing list field |
| Stale (7d+) | 0 | same | `linked && synced && (no check or >7d)` | `last_checked_at`, portal_data | **Broken derived** | Linked + previously synced + last **successful** harvest older than N days | Stale gated on false `synced` | Use last successful harvest timestamp; mutual exclusion with never_harvested |
| Projects need attention | 47 | AlertBanner | `staleCount + pendingCount` | same | **Broken derived** | Projects needing operator action | Inflated by pending bug | Sum of canonical attention states only |
| Queue Status “Awaiting first sync” | on B2606607 | `renderQueueStatus` | `!synced` after linked | same | **Broken derived** | Never harvested | Contradicts detail with data | Fix synced signal |
| Queue Last checked | ~4h ago (detail/queue) | table cell | `formatDistanceToNow(last_checked_at)` | `projects.last_checked_at` | **Real** | Last time project row was touched by sync path | Not necessarily last successful full harvest | Prefer “Last successful harvest” + “Last check attempt” |
| Queue Portal status text in Recent Harvest | Approved / Open etc. | Recent harvest `<p>` | `portal_status \|\| fallback` | `projects.portal_status` | **Real portal status** misframed as harvest | Jurisdiction/dashboard status | Looks like harvest outcome | Show harvest result + portal status separately |
| Active Project | 1 | Detail MetricCard | `selectedProjectId ? "1" : "0"` | `SelectedProjectContext` | **Hardcoded binary / UI state** | “A project is selected” | Useless as a count | Replace with “Selected project” + permit/name |
| Harvest Status | Approved | Detail MetricCard | `isScraping ? "Live" : dashboardStatus \|\| portal_status \|\| "Idle"` | `portal_data.dashboardStatus`, `projects.portal_status`, ScrapeContext | **Mislabelled real** | Portal project status (or Live while scraping) | Not harvest execution status | Split cards/fields |
| Reports | 10 | Detail MetricCard | `reportEntries.length + pdfs.length` | `projects.portal_data.tabs.reports` | **Derived incorrect** | Artifact/list double-count | Double counts same logical reports | Count unique logical reports (see §1) |
| Files | 4 | Detail MetricCard | sum `folders[].files.length` | `portal_data.tabs.files` | **Real derived** | Saved file rows in harvested folders | OK for saved files; live scrape uses `…` | Keep; label “Saved files” |
| Last checked (detail hint) | ~4 hours ago | hints / Sync card | `last_checked_at` | `projects.last_checked_at` | **Real** | Last sync write timestamp | Same caveats as queue | Split successful vs attempted |
| Recent harvest report count (detail inbox) | 10 items | Detail Recent harvest panel | same as Reports metric | portal_data reports | **Derived incorrect** | Same double-count | Same as Reports | Use logical count |
| Recent harvest file count | 4 files | same | folder file sum | portal_data files | **Real derived** | Saved files | OK | Keep |
| Operator Force Sync pill | Ready / Active | Operator playbook | `scrape.isScraping` | ScrapeContext | **Session-derived** | Whether a scrape is running in this browser session | Copy implies Force Sync runs harvest | Wire or relabel “Refresh saved data” |
| Credential check pill | Configured via Settings | Operator playbook | `!selectedProjectId ? Blocked : Configured` | UI only | **Fallback / weak** | Selection exists, not credential health | Does not verify `credential_id` or login | Check `credential_id` + last auth error |
| Scrape job pill | Idle / outcome | Operator playbook | `scrape.isScraping / lastScrapeOutcome` | ScrapeContext | **Session-derived** | Current session job | Not historical DB job | Optionally load latest `scrape_jobs` row |

---

## B. Current data-flow map

```text
/portal-data (App.tsx)
  └─ PortalDataViewer
       ├─ view === "queue"
       │    └─ PortalHarvestQueue
       │         ├─ projects ← useProjects()
       │         │    └─ supabase.from('projects').select(PROJECT_SELECT_COLUMNS)
       │         │         ❌ omits portal_data
       │         │         ✅ includes credential_id, portal_status, last_checked_at
       │         ├─ buildQueueRows → linked/synced/stale metrics
       │         ├─ recentHarvest ← projects with last_checked_at
       │         └─ attentionRows ← linked && (staleOrPending || !synced)
       │
       └─ view === "detail" (ProjectDox path)
            ├─ fetchData / silentRefetch
            │    └─ supabase.from('projects')
            │         .select('portal_data, portal_status, last_checked_at, …')
            │         .eq('id', selectedProjectId)
            ├─ MetricCards ← portal_data JSON + selectedProjectId + useScrape()
            ├─ Reports/Files tabs ← portal_data.tabs.*
            ├─ live files banner ← useScrapeFileResults → scrape_file_results
            └─ Operator playbook ← useScrape() session state only
```

**Write path (not from Portal Harvest Force Sync):** scraper `register-execution-routes.js` sync updates `projects.portal_data`, `portal_status` (from dashboard status), `last_checked_at`.

---

## C. Canonical metric contract (recommended)

| Metric | Recommended source | Exact formula |
|--------|-------------------|---------------|
| Connected portal projects | `projects` where `credential_id IS NOT NULL` (scope: current user/tenant) | `COUNT(*)` — label **Connected projects** |
| Unique connected portals/credentials | distinct `credential_id` or normalized portal host | `COUNT(DISTINCT credential_id)` — separate card if needed |
| Successfully synced projects | presence of successful harvest | Prefer `last_successful_harvest_at IS NOT NULL` **or** `(portal_data IS NOT NULL AND last_checked_at IS NOT NULL)` once list selects a cheap signal |
| Awaiting first harvest | linked and never successfully harvested | `credential_id IS NOT NULL AND last_successful_harvest_at IS NULL` |
| Stale projects | linked + has success + success older than N days | `last_successful_harvest_at < now() - interval '7 days'` |
| Projects needing attention | union of never_harvested, completed_stale, failed, blocked_credentials, running stuck | Mutually exclusive state machine (§6) |
| Logical reports | unique report identity in `portal_data.tabs.reports` | Prefer `COUNT(DISTINCT reportEntries[].fileSlug \|\| reportName)`; if only `pdfs[]`, distinct `fileName`; **do not** add `reportEntries.length + pdfs.length` |
| Report artifacts/formats | per logical report | Count of available formats: `pdfUrl/pdfDownloaded`, `excelUrl/excelDownloaded` (display as “5 reports (PDF+Excel)” not “10”) |
| Saved files | `tabs.files.folders[].files` | Sum of file array lengths (current Files metric) |
| Last checked | `projects.last_checked_at` | Any sync touch / check attempt |
| Last successful harvest | new field or derived from latest `scrape_jobs` with `status=completed` + non-empty portal_data write | Use for freshness |
| Portal project status | `projects.portal_status` / `portal_data.dashboardStatus` | Jurisdiction status string |
| Harvest execution status | latest relevant `scrape_jobs.status` (+ session Live) | queued/running/completed/failed/… |

### Canonical mutually exclusive harvest states

| State | Rule (recommended) |
|-------|---------------------|
| `never_harvested` | linked + no successful harvest |
| `queued` | latest job queued |
| `running` | latest job running |
| `completed_fresh` | success within N days |
| `completed_stale` | success older than N days |
| `completed_partial` | success with known partial flags (e.g. reports exported 0) |
| `failed` | latest terminal job failed/error |
| `blocked_credentials` | linked credential missing/invalid / auth failure |

A project **must not** be both `never_harvested` and showing harvested reports.

---

## Required investigations

### 1. Reports count — B2606607 verified

**UI formula** (`PortalDataViewer.tsx` ~3141–3145):

```ts
(reportEntries ?? []).length + (pdfs ?? []).length
```

**Stored data for `B2606607` (`6321752d-…`):**

| Array | Length | Contents |
|-------|--------|----------|
| `tabs.reports.reportEntries` | **5** | Five named reports, each with `pdfUrl` + `excelUrl` true |
| `tabs.reports.pdfs` | **5** | Same five `fileName`s, each with `pdfPublicUrl` + `excelPublicUrl` |
| `tabs.reports.tables[0].rows` | **5** | Same five “Report Name” rows |

**Logical report names (unique):**

1. Current Project - All Uploaded Files with Sheet Sizes  
2. Plan Review - Department Review Status  
3. Plan Review - Review Comments  
4. Plan Review - Review Details  
5. Plan Review - Workflow Routing Slip  

**Grouping key proven:** `reportName` / `fileSlug` / `fileName` align 1:1 across `reportEntries`, `pdfs`, and table rows. Each logical report already stores **both PDF and Excel** artifacts on the same entry.

| Count type | Value |
|------------|-------|
| Logical reports | **5** |
| Report artifact/format representations in metric | **10** (double-counting parallel arrays) |
| Saved general files | **4** (2 in Approved Drawings + 2 in Approved Supporting Documents) |

**Canonical rule:**  
`logicalReports = uniqueBy(reportEntries, fileSlug|reportName)`  
If `reportEntries` empty, fall back to unique `pdfs.fileName` or table “Report Name”.  
Display formats separately: e.g. `5 reports · 5 PDF · 5 Excel`.

### 2. Active Project = 1

```ts
value={selectedProjectId ? "1" : "0"}
hint={portalData.projectNum || "Select a project in the shell"}
```

**Meaning:** selected-project boolean coerced to `"1"`/`"0"`.  
**Not:** active scrape jobs, portal connections, or DB “active” rows.  
**Recommendation:** Replace with label **Selected project** and value = `permit_number` / `portalData.projectNum` / project name (`—` if none).

### 3. Harvest Status = Approved

- `projects.portal_status` for B2606607 = `"Approved"`.
- `portal_data.dashboardStatus` = `"Approved"`.
- Detail card: `displayPortalStatus = normalizeRepeatedStatusLabel(portalData.dashboardStatus ?? portalStatus)` unless scraping → `"Live"`.

**Conclusion:** UI “Harvest status” is **portal project status**, not harvest execution status.

**Recommended separate fields:**

| Field | Source |
|-------|--------|
| Portal project status | `portal_status` / `dashboardStatus` |
| Harvest execution status | `scrape_jobs.status` (latest) / session Live |
| Last successful harvest | timestamp of last completed sync that wrote portal_data |
| Freshness status | fresh/stale/never from that timestamp |

### 4. Awaiting First Sync contradiction — root cause

**Faulty condition (exact):**

1. `PortalHarvestQueue.buildQueueRows`: `synced = !!project.portal_data` (`PortalHarvestQueue.tsx` L43).  
2. `useProjects` `PROJECT_COLUMN_LIST` (`useProjects.ts` L31–81) includes `credential_id`, `portal_status`, `last_checked_at` but **omits `portal_data`**.  
3. Therefore on the queue, `project.portal_data` is always undefined → `synced === false` for every row.  
4. Status pill: linked + `!synced` → **“Awaiting first sync”** (`renderQueueStatus` L60–64).  
5. Detail view separately selects `portal_data` (`PortalDataViewer.tsx` L1089–1093) → shows reports/files/last checked.

**Not caused by:** missing scrape_jobs (B2606607 has multiple `completed` jobs), tenant filter alone, or mock status strings.

**DB cross-check (same user):** 47 linked projects; **41** have non-null `portal_data` — queue should show ~41 synced if signal were loaded, not 0.

### 5. Connected Portals = 47

| Question | Answer |
|----------|--------|
| What is counted? | Projects with `credential_id` set |
| Unique credentials? | **7** (not 47) |
| Unique portals? | Not computed (would need credential `login_url` host) |
| Subtitle accurate? | Yes: “Projects with a linked credential” |
| Label accurate? | **No** — implies portals |

### 6. Synced / Awaiting / Stale rules (current)

```text
linked          = !!credential_id
synced          = !!portal_data          # broken on queue (field not loaded)
pending         = linked && !synced
staleOrPending  = linked && (!synced || daysSinceCheck == null || daysSinceCheck > 7)
staleCount      = linked && synced && staleOrPending
attention       = staleCount + pendingCount
```

`last_checked_at` is used for age; it is updated on sync writes even when content hash matches (scraper can touch `last_checked_at` without changing portal_data). Freshness should prefer **last successful harvest**, not merely last check attempt.

### 7. Recent Harvest

**Queue cards** (`PortalHarvestQueue` L103–114, L290–314):

- Source row: **project** with `last_checked_at`, sorted desc, top 6.  
- Jurisdiction: `jurisdiction || name`.  
- Time: relative `last_checked_at`.  
- Title: project `name`.  
- Body: **`portal_status`** or fallback “Portal data synced.” / “Awaiting harvest.”  

**Not** based on `scrape_jobs` rows. Approved/Open are **portal permit statuses**.

**Detail “Recent harvest”** (`PortalDataViewer` L5013–5060): three static inbox cards (Reports/Files/Sync counts) — not a run history feed.

### 8. Mock / upcoming functionality inventory

| Control | Classification | Evidence |
|---------|----------------|----------|
| Queue Force Sync | **UI only / not wired** | Button only if `onForceSyncAll`; parent does not pass it |
| Detail Force Sync | **Partially functional** | Refetches DB `portal_data`; does **not** call scrape API |
| Force Sync operator playbook card | **UI only (status display)** | Ready/Active from session scrape flag; copy overclaims |
| Add Portal Credential | **Partially functional** | Link to `/projects` (not credential create form) |
| Manage Credentials | **Fully functional (navigation)** | Link to `/settings` → real credentials manager/API |
| Credential check playbook | **UI only / weak** | Does not validate credential health |
| Scrape job live status (playbook) | **Partially functional** | Session `ScrapeContext` only; not DB history |
| Export (queue) | **Fully functional (client-side)** | Builds CSV from in-memory rows |
| Filter | **UI only** | Disabled button |
| Reports tab | **Fully functional (read saved JSON)** | Renders `portal_data.tabs.reports` |
| Files tab | **Fully functional (saved + optional live)** | Saved folders + `scrape_file_results` when job active |
| Portal Queue navigation | **Fully functional** | `setView("queue")` |
| Queue metrics Synced/Awaiting/Stale | **Broken derived** (not mock numbers) | Real code, wrong inputs |
| Active Project `1` | **Hardcoded binary** | Should be relabeled |
| Lovable `reference/lovable-ui/.../PortalHarvest.tsx` | **Mock reference** | Not production route |

**Display policy recommendation:**

- Hardcoded/sample → visible `Mock`, disabled if action.  
- Unfinished action → `Upcoming`, disabled, not styled as primary ready.  
- Broken-but-intended-real metrics → fix data (do not label Mock).  
- Missing real values → `—` / `Not available`.

### 9. Duplicate and historical data

| Factor | Effect on B2606607 Reports=10 |
|--------|-------------------------------|
| PDF + Excel on same report | Already on one `reportEntries` row — **not** the bug |
| Parallel `reportEntries` + `pdfs` arrays | **Primary cause** of 10 |
| Multiple scrape jobs | Several `completed` jobs exist; UI counts **current** `portal_data` snapshot, not job history |
| Storage + metadata double count | Not used in Reports metric (JSON only) |
| Demo/other projects | Second project also named B2606607 exists (`066e453d-…`) without portal_data — separate row |

### 10. Metric scope

| Metric | Scope |
|--------|-------|
| Connected / Synced / Awaiting / Stale / attention | **Current user’s project list** (`useProjects` + RLS) |
| Queue rows / Recent harvest | Same list |
| Detail MetricCards / Reports / Files | **Selected project** `portal_data` |
| Operator scrape job | **Current browser scrape session** |
| Live file banner | Selected project + active `scrape_job_id` → `scrape_file_results` |

---

## D. Mock / upcoming inventory (compact)

| Item | Tag |
|------|-----|
| Queue Force Sync | Upcoming / unwired |
| Detail Force Sync as “harvest” | Mislabelled refresh (partial) |
| Filter button | Upcoming (disabled) |
| Add Portal Credential → `/projects` | Misleading destination |
| Credential check “Configured via Settings” | Weak placeholder status |
| Active Project numeric `1` | Hardcoded binary UI state |
| Lovable PortalHarvest reference page | Mock (non-prod) |

No production queue summary numbers were found to be pure hardcoded fakes; the bad numbers are **broken derivations**.

---

## E. Root-cause findings (code pointers)

| Issue | Exact cause |
|-------|-------------|
| Awaiting first sync / Synced=0 | `useProjects.ts` omits `portal_data`; `PortalHarvestQueue.tsx` L43 `synced = !!project.portal_data` |
| Connected portals wording | `PortalHarvestQueue.tsx` L169–173 label vs L42 linked definition |
| Reports=10 | `PortalDataViewer.tsx` L3143 `reportEntries.length + pdfs.length` |
| Harvest Status=Approved | `PortalDataViewer.tsx` L3085–3087, L3135–3138 uses portal status fields |
| Active Project=1 | `PortalDataViewer.tsx` L3129–3133 |
| Force Sync ≠ scrape | `handleManualRefresh` → `silentRefetch` L1334–1340, L1240–1260 |
| Queue Force Sync missing | `PortalDataViewer.tsx` L1483–1490 omits `onForceSyncAll` |
| Stale stuck at 0 | `staleCount` requires `synced` (`PortalHarvestQueue.tsx` L101) |

---

## F. Fix plan (do not implement in this audit)

**Priority order:**

1. **Data correctness** — Add harvest signal to project list query (`portal_data` null-check via lightweight column, or `last_successful_harvest_at`, or `select('…, portal_data')` with care for payload size).  
2. **Canonical status derivation** — Implement mutually exclusive harvest states; stop using portal status as harvest status.  
3. **Logical report deduplication** — Count unique report identities; show format counts separately.  
4. **Portal vs harvest status separation** — Two fields/cards.  
5. **Mock/upcoming labels** — Disable/wire Force Sync honestly (“Refresh saved data” vs “Run harvest”).  
6. **UI wording** — Connected projects; Selected project; Last successful harvest.

---

## G. Verification plan

| Scenario | Expect after fix |
|----------|------------------|
| **B2606607** | Queue status synced/fresh (not awaiting); Reports logical **5**; Files **4**; Portal status Approved; Harvest execution completed/fresh |
| **15385-2022-0** (PGC) | Counts from that project’s `portal_data` only; no cross-project bleed; report logical vs artifact rules applied |
| **Never-harvested project** | `never_harvested` / Awaiting first harvest; Reports/Files `—` or 0; no Approved harvest framing |
| **Failed project** | `failed` state from latest job; not “Awaiting first sync” if prior success exists |
| **Stale project** | Success older than 7d → `completed_stale`; still not awaiting first |
| **PDF+Excel same reports** | Logical count unchanged when both formats present; UI may show “5 reports (PDF+Excel)” |

Manual checks: compare queue metric to SQL `count(*) filter (credential_id not null)`, `count(*) filter (portal_data is not null)`, and distinct report names in JSON.

---

## Appendix — B2606607 snapshot (audit evidence)

| Field | Value |
|-------|-------|
| Project id | `6321752d-f31a-4c13-8f0e-c1c7db16827b` |
| `portal_status` | `Approved` |
| `dashboardStatus` | `Approved` |
| `last_checked_at` | `2026-07-27T20:11:30.614Z` |
| Logical reports | **5** |
| UI Reports metric inputs | reportEntries=5, pdfs=5 → **10** |
| Saved files | **4** (2 folders × 2) |
| Recent scrape_jobs | Multiple `completed` (+ some stuck `running` historically) |
| User linked projects | 47 |
| User projects with portal_data | 41 |
| Unique credentials among linked | 7 |

---

## Change control

- **Audit file only** created under `docs/audits/`.  
- **No application code, schema, commit, push, or deploy** performed for this audit.
