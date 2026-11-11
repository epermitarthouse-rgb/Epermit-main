# Portal Harvest and the Permit Repository: recommendation (Priority 2)

Status: **Recommendation. No code changed.** Written 2026-11-06 from a read-only survey of `src/`, `supabase/functions/`, `supabase/migrations/` and `scraper-service/`. Decision D-034.

## 1. What each feature is today

| | Portal Harvest (`/portal-data`) | Permit Repository (`/permits`, `/permits/:id`) |
|---|---|---|
| Storage | One JSON blob per `projects` row: `projects.portal_data` (latest snapshot, tab-level merge) and `portal_data_hash` | Normalized tables: `permits`, `permit_review_comments`, `permit_review_responses`, `permit_tasks`, `permit_documents`, `permit_reports`, `permit_changes`, `permit_snapshots`, `permit_source_links` |
| Scope | The user's project row (lookup by `supabaseProjectId` or `permit_number` + `user_id`) | One row per portal permit, shared; access by grant (RLS, D-021 to D-027) |
| History | None. Overwrites; the UI says "not cumulative history" | Change rows with before/after values, snapshots, soft removal |
| Written by | Manual/interactive scrapes in `register-execution-routes.js` (DC, PGC, Montgomery, Howard), `accela-scraper.js` (Arlington, Baltimore, Fairfax), Arlington durable worker, legacy `check-portal-status` | `permit-sync` worker, DC adapter only, never run live (A-3) |
| Jurisdictions | 7 | 1 (DC) |
| Flag | `module.portal_harvest`, default ON | `module.central_permits`, default OFF |
| Unique to it | Harvest queue and metrics, scrape trigger, failed-artifact retry, jurisdiction-specific views (Accela, Baltimore, Fairfax), Arlington live refresh | Cross-project search, access grants, history, freshness, section health, sources, admin sync |

Hard dependencies on `portal_data` (the product breaks without it):
- `comment-parser-agent` reads `tabs.reports.pdfs` (Review Comments text or structured rows) and `tabs.review.workflowBuckets`, and writes `meta.comment_parse_cursor`. This feeds the Response Matrix and Comment Review through `intake-pipeline-agent` (hash-gated).
- `AgentWorkflowStatus` and `portalMonitorScrapeOptions` (scrape menu, Arlington detection), `ActiveProjectControl` (clears the blob on credential mismatch), the Accela, Fairfax and Baltimore views, PGC retry, Arlington live refresh.

Facts that shape the recommendation:
- The two features overlap only in **what a permit looks like** (status, comments, tasks, files, reports). They differ in **job**. Portal Harvest is the per-project ingestion and response workflow. The Repository is the shared, history-tracked permit record.
- `project_permits` and `admin_link_project_permit` exist, but no UI uses them (P3.5 deferred). Nothing connects a project to its permit record today.
- `permit-sync` does not write `portal_data`. For DC, the comment pipeline still depends on the legacy scrape.
- Navigation already has four permit-like names: "Permit Repository", "Permit Queue" and "Portal Harvest" in the sidebar, plus "Permit Intelligence" in the command palette. Mobile shows "Harvest" only. The command palette has no Repository entry.
- `projects.portal_data` has no defining migration (D-02 tech debt). `useProjectPortalData` has no callers. `Projects.tsx` reads `portal_data` from a list query that does not select it.

## 2. Options considered

| Option | Result | Verdict |
|---|---|---|
| A. Merge into one page now | Rewrites about 60 files, including the Accela views and the comment pipeline, for 7 jurisdictions. Only DC has a Repository adapter | Rejected: large risk, no data for 6 jurisdictions |
| B. Have `permit-sync` also write `portal_data` | Two copies of the same permit, one without history or access control. Reintroduces the blob the Repository replaces | Rejected: duplicate storage |
| C. Retire Portal Harvest | Breaks the Response Matrix pipeline and 6 jurisdictions | Rejected |
| D. Keep both, give each one job, and link them (recommended) | Small changes, no duplicate dashboard, a clear path to converge per jurisdiction | **Recommended** |

## 3. Recommendation (option D)

One user-facing idea: **a permit has one record (Repository), and a project's harvest page is where you gather and respond.** No second dashboard is built.

1. **Roles.** The Repository is the system of record for permit data wherever an adapter exists (DC now). Portal Harvest stays the operational view: queue, scrape, retry, response pipeline. It stays the data view for jurisdictions without an adapter.
2. **Link, don't copy.** Ship the deferred P3.5 linking: an admin links a project to a permit (`admin_link_project_permit`). Then add two cross-links. The Portal Harvest detail shows "Permit record →" (`/permits/:id`) when a link exists and the flag is on. The permit Overview lists linked projects. A link grants no data access by itself (as designed).
3. **No duplicate DC detail.** When a DC project is linked and its permit is fresh, the Portal Harvest DC detail shows a short summary and the link, instead of re-rendering Reviews, Tasks and Files from the blob. Other jurisdictions are unchanged.
4. **Converge the pipeline per jurisdiction, later.** Give `comment-parser-agent` a second input: structured `permit_review_comments` for a linked permit. DC comes first, because the DC JSON is already structured. Only after that is verified live should the legacy DC scrape stop running on the same credential. Until then, the two DC readers must not run concurrently on one login (see D-018).
5. **Naming.** Keep "Portal Harvest" (gather) and rename the sidebar label "Permit Repository" to "Permits" (records) when the flag is enabled for users. Add it to the command palette and, if space allows, to mobile. "Permit Queue" and "Permit Intelligence" are separate features and stay, but the descriptions should say what they do. This is a label-only change; routes stay.
6. **Housekeeping (separate, small).** Add a migration that formally defines `projects.portal_data` (idempotent `ADD COLUMN IF NOT EXISTS`). Remove or use `useProjectPortalData`. Fix `Projects.tsx` to use `portal_status` instead of a field the query never loads.

## 4. Sequence and gates

| Step | Change | Gate |
|---|---|---|
| R-1 | P3.5 linking UI plus the two cross-links (items 2 and 5) | Flag `module.central_permits` stays OFF in production (A-6) |
| R-2 | DC detail summary instead of duplicate tabs (item 3) | A-3 live run verified; DC permit fresh |
| R-3 | Comment parser reads Repository comments for linked DC permits (item 4) | R-2 plus a side-by-side parse comparison on one DC project |
| R-4 | Stop the legacy DC scrape for linked permits | R-3 verified; user approval |
| R-5 | Repeat R-2 to R-4 per jurisdiction as adapters land (Phase 4 onward) | Per adapter |

**Status (2026-11-06):** R-1 is implemented and locally tested. Scope as built:
- `src/lib/centralPermits.ts`: link lookup, linked-project list, and admin link/unlink through `admin_link_project_permit` and `admin_unlink_project_permit` (both re-check platform admin and write `permit.link_project` / unlink audit events).
- Portal Harvest project detail: a "Permit record" panel (`ProjectPermitLinkPanel`). It shows the link with "Permit record →" when one exists. Admins get a permit search (`search_permits`) and link/unlink. The panel renders nothing while `module.central_permits` is off.
- Permit Overview: a "Linked projects" panel (`PermitProjectLinksPanel`). Project names appear only when RLS lets the viewer read that project. "Open in Portal Harvest" selects the project and opens the queue.
- No second dashboard. No change to Portal Harvest data, scrape jobs, or comment parsing. Routes and sidebar label are unchanged.

Not done: no migration applied anywhere, the flag stays OFF in production (A-6), no live run. Two-user RLS behaviour for project names is covered only by the reasoning above, not by a live Supabase test.

R-2 to R-5 are not started.
