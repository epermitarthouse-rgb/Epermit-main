# UCI merge-readiness — main ↔ feat side-by-side test plan

**Purpose:** Decide whether `feat/lovable-ui-replication` is **safe to merge into `main`** for Utility Coordination by proving **main functions still work in the same way** on feat (not merely that “something similar exists somewhere”).

**Date:** 2026-08-05  
**Repo:** `epermitarthouse-rgb/Epermit-main`  
**Branches / SHAs:** `main` @ `df541d0` · `feat/lovable-ui-replication` @ `2aea795`  
**Pass rule:** For every **Parity** row, Main and Feat produce the **same functional result** (data, API outcome, persistence). UI location may differ — see **Moved/renamed**.

---

## How to run the comparison

1. Open **two browsers** (or two profiles / windows): **Window A = Main**, **Window B = Feat**.
2. Sign in with the **same demo account** on both.
3. Select the **same project** on both (use the Pepco projects below).
4. Walk the checklist **row by row**. For each row:
   - Do the **Main** steps → record actual result.
   - Do the **Feat** steps → expect the **same result**.
   - Mark Pass / Fail / Blocked.
5. Do **not** treat Lovable sidebar labels (Submissions, CIAC, Energization, etc.) as new products — they are deep-links into existing drawer tabs.
6. **Stop and fail the merge** if any Parity row fails functionally (wrong data, missing action, broken API, lost control). Visual/chrome differences alone are not blockers.

### Environments (true comparison)

| Window | Frontend | Backend API (`VITE_API_BASE_URL`) |
|--------|----------|----------------------------------|
| **Main** | Vercel **Production** (`main`) — `https://epermit-main-nine.vercel.app` **or** local checkout of `main` | Railway **production** — `https://epermit-main-production.up.railway.app` |
| **Feat** | Vercel **Preview** of `feat/lovable-ui-replication` **or** local checkout of feat | Preview should point at Railway **development** — `https://epermit-main-development.up.railway.app` |

**Accuracy notes:**

- Prefer **Production FE + Production BE** for Main, and **Preview FE + Development BE** for Feat (branch Preview env mapping).
- If you run Feat FE against Railway **production** instead, note that in the results — UI parity can still be judged, but BE deltas (portal-sync cancel polish) may differ.
- **Shared Supabase:** development currently mirrors production data. Use **demo accounts only**. No destructive deletes. **No live Pepco portal submit** (dry-run only unless explicitly approved + env-enabled).

### Shared test data

| Project | Why |
|---------|-----|
| **CTBO24-02589-RA1** | Best real Pepco data — Wonder 3/3 + Aspen Hill 19/19 **stored** downloads (View/Download works without re-scrape) |
| **COM-00317-2026** | Same Aspen Hill UUID **listed-only** (19 listed, 0 stored) — download-checkbox / “Listed only” UX |

---

## UI map cheat sheet (so you don’t look in the wrong place)

| Main location | Feat equivalent |
|---------------|-----------------|
| Sidebar: single **Utility Coordination** → `/uci` | Sidebar: expandable **Utility Coordination** → Overview / Partial / Soon children + `/uci` |
| Hub: setup workflow **primary** (top), then portfolio summary, then records table | Hub: KPI tiles + module tiles first; **Setup** is a hub tile (expand to same `UciSetupWorkflow`) |
| Portfolio summary card on hub | KPI row (records / needs attention / furthest stage) + stage rail + attention queue |
| Open record → **Coordination detail** Sheet (scrollable **stacked** sections) | Open record → same Sheet, but **tabbed** (`UCI_DRAWER_TABS`) |
| Pepco portal block near top of sheet | Tab **Portal sync** |
| Document coverage panel (stacked) | Tab **Documents** |
| Load profile (stacked) | Tab **Load profile** (also sidebar **Load Profile**) |
| Application preparation (stacked) | Tab **Application prep** (sidebar **Submissions** only sets preferred tab — **does not auto-open drawer**) |
| Lifecycle (stacked) | Tab **Lifecycle** |
| COS analyze (stacked) | Tab **Class of Service** (sidebar **Class of Service**) |
| Normalized apps / portal messages (stacked) | Tabs **Applications** + **Communications** |
| Costs / equipment / meter-set / closeout (stacked) | Tab **Costs & equipment** (sidebar **CIAC & Refunds**, **Energization**, **Meter Set** all land here) |
| Download-documents checkbox (in Pepco portal header) | Same checkbox — still on **Portal sync** tab (**not** Documents) |
| Durable sync runs (near lifecycle / portal area) | **Overview** and/or **Portal sync** |
| *(not on main)* | `/uci/application-builder` + sidebar **Application Builder** |
| Jurisdiction Map via main nav | Sidebar **Provider Map** → `/jurisdictions/map` (same map; not a UCI territory product) |
| Settings → Portal Credentials | Same `/settings` (unchanged) |

**Feat nav trap:** clicking Partial items (Submissions, Communications/Inbox, COS, CIAC, Energization, Meter Set) with the drawer closed only sets preferred tab / scrolls hub — you must still **View** a record (or use `?coordination=<id>`).

---

## Classification (merge decision inputs)

### Parity items (must match behavior)

Must produce the same outcome on Feat as on Main:

1. Enter UCI from sidebar / route `/uci`
2. Project selection → load coordination records
3. Empty / no-project / load-error states (honest messaging)
4. Setup: address ack → provider pick → utility-type filter → Initialize (`POST …/coordination/init`)
5. Territory resolve / confirm / override
6. Open coordination detail (Sheet)
7. Pepco: check connection, discover dashboard, MFA / submit code, scrape / refresh details
8. Download-documents checkbox default **off**; scrape with it on stores files
9. View / Download for **stored** Pepco docs
10. Normalized portal sync + durable sync runs visibility
11. Applications / messages / milestones from portal data
12. Communications classify / reclassify
13. Document coverage / processing
14. Load profile analyze / candidates / verified values
15. Application prep: build package, map docs, review, **dry-run** submit
16. Lifecycle stage/state transition + proposal apply/reject
17. COS analyze
18. Costs / equipment / check-in / meter-set prepare / closeout prepare
19. Provider mapping banner when present
20. Portal credentials via Settings (same path)
21. Permissions: JWT + project access (no silent cross-project leak)

### Moved / renamed (same function, new place)

| Function | Main | Feat |
|----------|------|------|
| Setup workflow | Top of `/uci` (primary) | Hub **Setup** tile → expand same form |
| Portfolio / stage rollups | `PortfolioSummarySection` card | KPI row + stage rail + attention queue |
| Pepco portal + download checkbox | Stacked near top of detail Sheet | **Portal sync** tab |
| Document coverage | Stacked in Sheet | **Documents** tab |
| Load profile | Stacked in Sheet | **Load profile** tab (+ sidebar Active) |
| Application prep / submit | Stacked in Sheet | **Application prep** tab (+ Partial **Submissions** label) |
| Communications | Stacked “Communications” card | **Communications** tab (+ Partial **Communications / Inbox**) |
| Lifecycle | Stacked section | **Lifecycle** tab |
| COS | Stacked analyze panel | **Class of Service** tab (+ Partial sidebar) |
| Costs / equipment / meter / closeout | Stacked panel | **Costs & equipment** tab (+ Partial **CIAC**, **Energization**, **Meter Set**) |
| Normalized applications | Stacked “Normalized portal data” | **Applications** tab |
| PEPCO read-only banner | Prominent on hub | Present but hub redesign may soften placement — dry-run behavior unchanged |

### Feat-only (extra; not required for “main copied”)

- Expandable UCI sidebar (`UciSidebarNav` / `uciNavSections`)
- Hub module tiles, KPI row, stage rail, attention queue chrome
- Tabbed drawer IA
- `/uci/application-builder` (wired package/load/review/submit; Owner/billing & Agent QA = Coming Soon)
- Coming Soon panels: Miss Utility, Knowledge Graph, Conflict Hunter, Easement/ROW, Portfolio/Quarter
- Small BE portal-sync cancel / durable-job polish (if Preview→dev BE)

### Main-only gaps (blockers if missing on feat)

| Gap | Severity |
|-----|----------|
| Lost Initialize / provider setup | **Blocker** |
| Lost Pepco connect / discover / scrape / MFA | **Blocker** |
| Lost download checkbox or View/Download for stored files | **Blocker** |
| Lost load profile / application prep / dry-run submit | **Blocker** |
| Lost lifecycle / COS / costs / communications actions that work on main | **Blocker** |
| Setup-first editorial layout / stacked (non-tabbed) sheet | **Not a blocker** (IA change by design) |
| Cross-project Submissions hub / firm Inbox / portfolio COS / CIAC refund tracker | **N/A** — never on main |

*As of SHAs above: no known Main-only functional gap on Feat for wired UCI paths; re-verify with the checklist.*

### Out of scope (do not fail merge for these)

- Portal Harvest jurisdiction scrape (`/portal-data`) unless opened from UCI on main (it is **not** a UCI sub-route)
- Response Matrix
- Lovable mock products (Miss Utility, Knowledge Graph, Conflict Hunter, Easement, Portfolio Quarter) — Coming Soon is correct
- Live Pepco filing (disabled by default on both)
- Non-UCI Lovable visual work elsewhere in the app

---

## Side-by-side checklist

Mark each row: **Pass** / **Fail** / **Blocked**. Fail = Feat does not match Main’s functional result.

### 0. Entry & navigation

**0.1 Enter UCI**

- **Main:** open app → sidebar **Utility Coordination** → land on `/uci` → expect UCI hub (setup + records).
- **Feat:** open app → sidebar **Utility Coordination** (expand) → **Overview** or parent click → land on `/uci` → expect hub (KPIs/tiles + records). Same auth gate.

**0.2 Command palette / deep route**

- **Main:** open `/uci` directly (or palette “Utility Coordination”) → expect same hub.
- **Feat:** open `/uci` (or palette) → expect same hub. Extra: `/uci/application-builder` is Feat-only (not required for parity).

**0.3 Renamed nav awareness (Feat)**

- **Main:** N/A (no child nav).
- **Feat:** open sidebar children **Submissions / Communications / COS / CIAC / Energization / Meter Set** with drawer closed → expect preferred-tab / scroll only, **not** an auto-opened record. Then open a record → correct tab preferred.

---

### 1. Hub: project, list, filters, KPIs

**1.1 No project selected**

- **Main:** open `/uci` with no project → expect “Select a project to load records” (or equivalent empty).
- **Feat:** open `/uci` with no project → expect empty/no-project state (hub empty card + records empty). Same: no fabricated records.

**1.2 Select project → records load**

- **Main:** select **CTBO24-02589-RA1** → expect Coordination records table with Pepco (and any other) rows; stage/state badges.
- **Feat:** select same project → expect same record set / stages / providers (same Supabase).

**1.3 Portfolio / KPI rollups**

- **Main:** on hub, find **portfolio summary** → expect counts/stages consistent with records.
- **Feat:** on hub, find **KPI row** (Coordination records, Needs attention, Furthest stage) + **Stage progress** rail → expect rollups consistent with same records (presentation differs; numbers must agree).

**1.4 Records empty state**

- **Main:** project with no coordination → expect “No utility coordination records yet. Initialize providers…”.
- **Feat:** same project → expect empty copy pointing at **Setup** tile. Same: Initialize still available.

**1.5 Refresh records**

- **Main:** click refresh on records card → expect reload without error.
- **Feat:** same refresh control on records panel → same.

**1.6 Load / permission error**

- **Main:** (if possible) project without access or forced API failure → expect toast/error, not silent fake data.
- **Feat:** same → same honest error.

---

### 2. Create / setup coordination / initialize providers

**2.1 Open setup**

- **Main:** on `/uci`, use setup workflow at **top** of page.
- **Feat:** on `/uci`, click hub tile **Setup** → expand same workflow (`UciSetupWorkflow`).

**2.2 Address acknowledgment**

- **Main:** review address / source → acknowledge recommended source → expect setup can proceed.
- **Feat:** same steps in Setup tile → same.

**2.3 Provider pick + utility filter**

- **Main:** filter providers by utility type if shown → select provider(s) not yet initialized → expect selection count updates.
- **Feat:** same controls in Setup tile → same.

**2.4 Territory resolve / confirm / override**

- **Main:** run resolve → Confirm or Override with reason → expect mapping state updates / banner later in detail.
- **Feat:** same in Setup → same persistence.

**2.5 Initialize**

- **Main:** Confirm setup → **Initialize** → expect new row(s) in Coordination records; persists after refresh.
- **Feat:** same → same new `coordination_records` (shared DB — prefer a demo project if creating new rows).

---

### 3. Open project detail (sheet vs drawer tabs)

**3.1 Open detail**

- **Main:** in records table click **View** → expect **Coordination detail** Sheet with status fields (stage, state, dates).
- **Feat:** click **View** (or attention-queue open) → expect same Sheet + status; tabs visible instead of one long stack.

**3.2 Deep link**

- **Main:** open `/uci` and View (main has no `?tab=` vocabulary).
- **Feat:** open `/uci?coordination=<id>&tab=portal-sync` → expect drawer opens on Portal sync for that id.

**3.3 Section map (smoke)**

- **Main:** scroll Sheet — confirm blocks exist: Pepco portal (if Pepco), documents coverage, load profile, application prep, lifecycle, COS, normalized data/comms, costs/equipment.
- **Feat:** click each tab — **Overview, Portal sync, Applications, Communications, Documents, Load profile, Application prep, Lifecycle, Class of Service, Costs & equipment** — expect same capabilities (Portal sync Pepco-only).

---

### 4. Pepco portal: connect, discover, scrape, refresh, MFA, sync runs

*Use Pepco coordination on CTBO or COM.*

**4.1 Check portal connection**

- **Main:** open detail → Pepco portal section → **Check portal connection** → expect connected / needs credentials / error (honest).
- **Feat:** open detail → tab **Portal sync** → same button → same result.

**4.2 Discover dashboard**

- **Main:** **Discover dashboard projects** → expect project cards **or** MFA challenge.
- **Feat:** **Portal sync** → same → same list / MFA.

**4.3 MFA / submit code**

- **Main:** if MFA → use auto-fetch email MFA (if mailbox configured) or enter code → expect discovery resumes.
- **Feat:** **Portal sync** → MFA & recovery UI → same resume behavior.

**4.4 Scrape Details (metadata only)**

- **Main:** leave **Download documents during next project scrape** **unchecked** → **Scrape Details** / **Refresh Details** → expect Overview/Status/Messages/Documents populate; docs **Listed only**.
- **Feat:** **Portal sync** → same checkbox off → scrape → same listed-only result.  
  *Best project for listed-only observation: **COM-00317-2026**.*

**4.5 Refresh Details**

- **Main:** Refresh Details on an already-scraped row → expect updated metadata without requiring a different UI path.
- **Feat:** **Portal sync** → same.

**4.6 Normalized sync + sync runs**

- **Main:** trigger normalized / portal sync → expect apps/comms/milestones update; **Durable sync runs** panel shows progress/history.
- **Feat:** **Portal sync** (and/or Overview sync runs) → same job outcome and persistence.

---

### 5. Download documents checkbox + verify downloads

**5.1 Checkbox location & default**

- **Main:** in Pepco portal header, checkbox **Download documents during next project scrape** defaults **off**.
- **Feat:** same checkbox on **Portal sync** (not Documents tab) defaults **off**.

**5.2 Scrape with downloads (optional / slow)**

- **Main:** enable checkbox → Scrape Details → expect stored files (`storageStatus: stored`); badges leave “Listed only”.
- **Feat:** **Portal sync** → same. MFA/long-running — only if needed.

**5.3 Verify without re-download**

- **Main:** on **CTBO24-02589-RA1**, open scraped app Documents → **View** / **Download** enabled for Wonder 3/3 and Aspen Hill 19/19.
- **Feat:** **Applications** (Pepco detail Documents) or equivalent → same openable files.

**5.4 Listed-only contrast**

- **Main:** on **COM-00317-2026**, confirm listed docs without View/Download for stored bytes.
- **Feat:** same project → same listed-only behavior.

---

### 6. Documents view / coverage / processing

**6.1 Document coverage panel**

- **Main:** in detail Sheet, find document coverage / processing panel → load manifest / run processing → expect findings (vision/OCR may need env).
- **Feat:** tab **Documents** → same panel / same API outcomes.

**6.2 Portal docs vs project docs**

- **Main:** confirm portal-listed vs stored distinction remains clear after scrape states above.
- **Feat:** **Documents** + **Applications** detail → same distinction (do not confuse with download checkbox placement).

---

### 7. Application prep / package / dry-run submit

**7.1 Load profile prerequisite**

- **Main:** in Sheet → Load profile → Analyze → resolve candidates / verified values → expect draft readiness.
- **Feat:** tab **Load profile** (or sidebar Load Profile **then open record**) → same.

**7.2 Build package**

- **Main:** Application preparation → Build/rebuild package → expect agent_draft / slot mapping UI.
- **Feat:** tab **Application prep** → same.

**7.3 Map documents (human confirm)**

- **Main:** map package document slots → confirm → expect persistence after refresh.
- **Feat:** **Application prep** → same.

**7.4 Review**

- **Main:** Mark reviewed / review notes → expect review status via API.
- **Feat:** **Application prep** → same.

**7.5 Dry-run submit**

- **Main:** Submit → expect **dry-run / not live filed** messaging (default env).
- **Feat:** **Application prep** → same dry-run honesty. **Do not** enable live submit.

**7.6 Feat-only Builder (optional; not required for merge parity)**

- **Main:** N/A.
- **Feat:** `/uci/application-builder` → wired steps match drawer package/review/dry-run; Coming Soon fields stay non-persisting.

---

### 8. Communications, lifecycle, load profile, COS, costs

**8.1 Communications list + classify**

- **Main:** in Sheet Communications → list messages; Classify / Reclassify if shown → expect DB update / badges.
- **Feat:** tab **Communications** → same. (Sidebar “Inbox” is label only — per-record.)

**8.2 Lifecycle transition**

- **Main:** Lifecycle section → change stage/state + reason → expect transition history + hub stage counts update.
- **Feat:** tab **Lifecycle** → same.

**8.3 Lifecycle proposals**

- **Main:** if proposal shown → Apply / Reject → expect applied/rejected state.
- **Feat:** **Overview** / **Lifecycle** proposal actions → same.

**8.4 COS analyze**

- **Main:** Class of service analyze → expect analysis panel from metadata.
- **Feat:** tab **Class of Service** → same.

**8.5 Costs**

- **Main:** Costs/equipment → add/save cost → expect row persists.
- **Feat:** tab **Costs & equipment** → same. (Sidebar **CIAC & Refunds** = this tab.)

**8.6 Equipment + check-in**

- **Main:** add equipment → check-in → expect persistence.
- **Feat:** **Costs & equipment** → same.

**8.7 Meter-set / closeout / energization dates**

- **Main:** prepare meter-set / closeout; observe energization-related dates on status fields.
- **Feat:** **Costs & equipment** (+ Overview dates); sidebar **Energization** / **Meter Set** only deep-link here — same prepare actions.

**8.8 Milestones (read)**

- **Main:** after sync, milestones visible in normalized / Pepco system data.
- **Feat:** **Applications** / Overview after sync → same milestone data.

**8.9 Provider mapping banner**

- **Main:** with mapping metadata → banner visible in detail.
- **Feat:** **Overview** (and setup resolution) → same mapping truth.

---

### 9. UCI-related settings, credentials, provider map

**9.1 Portal credentials**

- **Main:** open **Settings → Portal Credentials** → confirm Pepco creds exist for test project (view/edit as demo allows).
- **Feat:** same `/settings` path → same credentials (shared DB).

**9.2 Sidebar credential picker (if used for portals)**

- **Main:** if project credential selector in shell is used for Pepco linkage → changing it should not break UCI access unexpectedly.
- **Feat:** same shell behavior.

**9.3 Provider Map / Jurisdiction Map**

- **Main:** sidebar **Jurisdiction Map** → `/jurisdictions/map` (outside UCI).
- **Feat:** UCI sidebar **Provider Map** → same `/jurisdictions/map`. Expect real map — **not** UCI territory resolver. Territory resolve remains under Setup (row 2.4).

---

### 10. Permissions / empty states / errors

**10.1 Unauthenticated**

- **Main:** open `/uci` logged out → expect auth redirect/gate.
- **Feat:** same.

**10.2 Project without UCI data**

- **Main:** empty records + Initialize CTA (setup).
- **Feat:** empty + Setup tile CTA.

**10.3 Pepco credentials missing**

- **Main:** Check portal connection without creds → expect clear failure, not fake connected.
- **Feat:** **Portal sync** → same.

**10.4 API / scrape failure**

- **Main:** failed scrape/sync → toast/error; prior data not silently replaced with mocks.
- **Feat:** same.

**10.5 Coming Soon (Feat only — must not fake success)**

- **Main:** N/A.
- **Feat:** Miss Utility / Knowledge Graph / Conflict Hunter / Easement / Portfolio → Coming Soon panel; no mock CRUD success.

---

## Numbered quick-run matrix (print / spreadsheet)

| # | Capability | Main (where) | Feat (where) | Expect |
|---|------------|--------------|--------------|--------|
| 1 | Enter UCI | Sidebar → `/uci` | Sidebar Overview → `/uci` | Same hub data access |
| 2 | Select project | Hub project context | Same | Same records |
| 3 | KPIs / portfolio | Portfolio summary | KPI + stage rail + attention | Same counts |
| 4 | Setup / Initialize | Top setup workflow | Hub **Setup** tile | New coordination rows |
| 5 | Territory resolve | Setup workflow | Setup tile | Same mapping |
| 6 | Open detail | View → stacked Sheet | View → tabbed Sheet | Same record detail |
| 7 | Pepco connect | Portal block | **Portal sync** | Same connection state |
| 8 | Discover + MFA | Portal block | **Portal sync** | Same projects / MFA |
| 9 | Scrape no download | Portal; checkbox off | **Portal sync**; checkbox off | Listed only |
| 10 | Download checkbox | Portal header | **Portal sync** (not Documents) | Default off; opt-in stores |
| 11 | View/Download stored | Pepco docs UI | **Applications** docs | Openable on CTBO |
| 12 | Normalized sync / runs | Portal + Sync runs | **Portal sync** / Overview | Same jobs/rows |
| 13 | Communications | Stacked comms | **Communications** tab | List + classify |
| 14 | Documents coverage | Stacked panel | **Documents** tab | Same processing |
| 15 | Load profile | Stacked workspace | **Load profile** tab | Same draft |
| 16 | App prep + dry-run | Stacked prep | **Application prep** | Dry-run only |
| 17 | Lifecycle + proposals | Stacked lifecycle | **Lifecycle** / Overview | Same transitions |
| 18 | COS | Stacked COS | **Class of Service** | Same analyze |
| 19 | Costs / equip / meter | Stacked costs | **Costs & equipment** | Same CRUD |
| 20 | Credentials | Settings | Settings | Same |
| 21 | Provider Map | Jurisdiction Map nav | UCI **Provider Map** | `/jurisdictions/map` |
| 22 | Empty / errors | Hub + toasts | Hub + toasts | Honest, no mocks |
| 23 | *(Feat-only)* Builder | — | `/uci/application-builder` | Extra; Coming Soon OK |
| 24 | *(Feat-only)* Soon nav | — | Mock sidebar items | Coming Soon only |

---

## Merge verdict template

After completing Parity rows:

| Result | Meaning |
|--------|---------|
| **Safe to merge (UCI)** | All Parity rows Pass; Moved/renamed only confuse navigation (documented); Feat-only extras do not break main paths |
| **Not safe** | Any Parity Fail/Blocked (lost control, wrong data, broken Pepco/docs/prep/lifecycle) |
| **Safe with follow-ups** | Parity Pass, but document UX risks (Partial nav not auto-opening drawer; download checkbox away from Documents) as release notes — not functional gaps |

**Tester:** _______________  
**Date:** _______________  
**Main URL:** _______________  
**Feat URL:** _______________  
**Projects used:** CTBO24-02589-RA1 / COM-00317-2026 / other: _______________  
**Verdict:** Safe / Not safe / Safe with follow-ups  
**Failed rows:** _______________

---

## Related docs

- `docs/audits/uci-pepco-document-download-audit.md` — listed vs stored evidence  
- `docs/uci-builder-backend-capability-audit.md` — Builder Coming Soon vs live  
- `docs/uci-navigation-and-workspace-replication-plan.md` — feat IA map  
- `docs/lovable-ui-development-environment.md` — Vercel Preview + Railway development URLs  

---

*Checklist only. No commit, push, deploy, or merge performed by this update.*
