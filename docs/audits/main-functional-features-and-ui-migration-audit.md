# Main Functional Features & UI Migration Audit

**Date:** 2026-08-05  
**Repo:** `/Users/javerianaveed/epermit/Epermit-main`  
**Branches compared:** `main` @ `5199937` vs `feat/lovable-ui-replication` @ `7be2588`  
**Constraints:** Read-only audit. No code changes, push, deploy, merge, or migrations.

**Classification rule:** A feature is **functional** only when UI → API/service → DB/worker → persistence → usable result is connected. Page/route/button/mock/API existence alone does **not** qualify.

**Excluded from “ready for testing” focus (per request):**
- Portal Harvest / jurisdiction scraping core (already tested)
- AI Compliance Analyzer (already tested)
- UCI (deferred)

**Environment honesty:** Railway `development` shares production Supabase. Use **demo accounts only**. Live Supabase may lack applied migrations for some tables (notably `permit_filings` / Permit Wizard — see prior audits). Document ingestion worker is local-dev oriented (`document-ingestion-worker/`); RAG grounding fails closed when chunks are empty.

---

## Evidence sources

| Source | Path / ref |
|--------|------------|
| Main routes | `git show main:src/App.tsx` |
| Main nav | `git show main:src/components/layout/AppSidebar.tsx` |
| Feat nav | `src/components/layout/hybridNav.ts`, `src/components/layout/AppSidebar.tsx` |
| Architecture | `docs/current-system-architecture.md`, `docs/current-page-architecture.md` |
| Prior audits | `docs/audits/portal-harvest-*.md`, `scraper-cancellation-audit.md`, `permit-filing-*.md`, `permit-wizard-agents-01-09.md`, `operations-board-*.md`, `response-matrix-*.md` |
| Strategy maturity | `docs/strategy/microsoft-permitting-vs-permitpilot-report.md` §4.2–4.5 |

---

## Classification legend

| Tag | Meaning |
|-----|---------|
| **Working E2E** | Connected UI → backend → persistence → usable result for the primary happy path |
| **Partial** | Real wiring exists but gaps (env, migrations, cancel bugs, incomplete portals, worker missing) |
| **UI only** | Renders UI; action does not complete a real backend write/read cycle |
| **Mock** | Fabricated / fixture data presented as product surface |
| **Stub** | Route/API placeholder with no usable product path |
| **Broken** | Intended real path that fails or mis-signals (not merely unfinished) |
| **Not implemented** | Declared upcoming; no production persistence path |

**Migrate recommendation:**
- **Migrate now** — keep/adapt UI on feat; backend already real
- **Coming Soon** — label + disable; do not fake
- **Mock Data** — keep only with `DemoDataBadge` / explicit disclosure
- **Hide obsolete** — remove from nav or leave unlinked

---

## A. Already tested (out of scope for next test wave)

| Feature | Route | Classification | Notes |
|---------|-------|----------------|-------|
| Portal Harvest core (login/scrape/view) | `/portal-data` | Working E2E (jurisdiction-dependent) | `PortalDataViewer.tsx`, `ScrapeContext`, `/api/login`, `/api/scrape`, `projects.portal_data`, `scrape_jobs` |
| AI Compliance Analyzer | `/code-compliance` | Working E2E (assist path) | `AIComplianceAnalyzer.tsx` → `POST /api/analyze-drawing`; annotations → `document_annotations` |
| UCI | `/uci` (+ `?section=`) | Partial / deferred | Real `/api/uci/*` + mocks in sidebar sections; **do not test now** |

---

## B–E feature inventory (main), with feat comparison

Each feature below includes verification flags and a migrate recommendation.

---

### 1. Authentication (sign in / sign up / session)

| Field | Detail |
|-------|--------|
| **Name** | Auth |
| **Route / nav** | `/auth` (feat also `/login`, `/signup` → `/auth`) |
| **FE** | `src/pages/Auth.tsx`, `src/hooks/useAuth.tsx` |
| **BE / edge** | Supabase Auth |
| **Tables** | `auth.users`, `profiles` |
| **External** | Supabase |
| **Classification** | **Working E2E** |
| **Evidence** | `useAuth` session + profile; `Auth.tsx` `signIn`/`signUp` |
| **Gaps** | Subscription fields on profile; Stripe sync separate |
| **Safe to test?** | Yes (demo accounts) |
| **Test steps** | Sign in → land dashboard; sign out; sign up (if allowed) |
| **Expected** | Session persists; protected routes gate |
| **Verify** | reads✓ writes✓ persists✓ project n/a · tenant: user · loading/error✓ · permissions: session · tests: limited · env: Supabase URL/anon |
| **vs feat** | Exists; HomeRoute replaces PublicOnly landing; backend same |
| **Migrate** | **Migrate now** (visual shell only) |

---

### 2. Projects — list / create / edit / delete / status

| Field | Detail |
|-------|--------|
| **Name** | Projects CRUD |
| **Route / nav** | `/projects` (feat also `/projects/new`) · sidebar Projects |
| **FE** | `src/pages/Projects.tsx`, `ProjectFormDialog.tsx`, `useProjects.ts` |
| **BE** | Supabase RLS on `projects` |
| **Tables** | `projects` (+ billing fields migration) |
| **External** | None required |
| **Classification** | **Working E2E** |
| **Evidence** | `useProjects` insert/update/delete; Projects page create/edit/delete dialogs |
| **Gaps** | Kanban status vs portal status semantics can confuse; credential/permit fields optional |
| **Safe to test?** | Yes |
| **Test steps** | Create project → edit → change status → delete (or Settings cleanup) · confirm list refresh |
| **Expected** | Row persists; selected project can bind |
| **Verify** | reads✓ writes✓ persists✓ selected project✓ · tenant RLS✓ · loading/empty✓ · permissions: owner/team · tests: light · env: none special |
| **vs feat** | Exists; Lovable chrome; `useProjects` unchanged (no hook diff) |
| **Migrate** | **Migrate now** |

---

### 3. Project team invitations & membership

| Field | Detail |
|-------|--------|
| **Name** | Project team |
| **Route / nav** | Inside Project detail dialog (Projects) · invite accept `/invite/:token` |
| **FE** | `ProjectTeamSection.tsx`, `InviteTeamMemberDialog.tsx`, `InviteAccept.tsx`, `useProjectTeam.ts` |
| **BE / edge** | `send-project-team-invitation`; RPCs `revoke_project_team_invitation` / accept-decline |
| **Tables** | `project_team_members`, `project_invitations`, `profiles` |
| **External** | Email provider for invite mail |
| **Classification** | **Working E2E** (email delivery env-dependent) |
| **Evidence** | `useProjectTeam` invoke + member CRUD; migration `20260715130000_project_team_invitation_flow.sql` |
| **Gaps** | Invite email may fail if edge secrets missing; Response Matrix uses team for approval roles |
| **Safe to test?** | Yes with demo emails |
| **Test steps** | Invite member → open invite link → accept → see member list; revoke |
| **Expected** | Membership + pending invite persist |
| **Verify** | reads✓ writes✓ persists✓ selected project✓ · tenant/team RLS✓ · loading/error✓ · permissions: owner/admin · tests: `projectTeamInvitationLogic.test.ts` · env: edge email |
| **vs feat** | Exists (same hooks); still nested in project detail, not top-level Lovable Admin Members |
| **Migrate** | **Migrate now** |

---

### 4. Portal credentials (create / update / delete / bind to project)

| Field | Detail |
|-------|--------|
| **Name** | Portal credentials |
| **Route / nav** | `/settings` → Portals tab; sidebar credential selector on main |
| **FE** | `PortalCredentialsManager.tsx`, `portalCredentialsApi.ts`, `AppSidebar` credential bind |
| **BE** | Scraper `GET/POST/PATCH/DELETE /api/portal-credentials` (JWT); encrypted password |
| **Tables** | `portal_credentials` |
| **External** | Railway scraper |
| **Classification** | **Working E2E** |
| **Evidence** | `portalCredentialsApi.ts`; Settings mounts manager; sidebar reads `portal_credentials` + updates project `credential_id` |
| **Gaps** | Portal Harvest “Add Credential” link historically mis-routes to `/projects` (prior audit); password never returned to FE |
| **Safe to test?** | Yes — use **demo portal sandboxes only**; never production agency credentials in shared DB unless approved |
| **Test steps** | Settings → create credential → bind on project/sidebar → list shows `password_configured` |
| **Expected** | Credential persists; scrape can use `credentialId` |
| **Verify** | reads✓ writes✓ persists✓ selected project bind✓ · auth JWT✓ · loading/error✓ · permissions: user-owned · tests: scraper routes · env: scraper + crypto keys |
| **vs feat** | Exists in Settings; hybridNav includes Settings; backend same |
| **Migrate** | **Migrate now** |

---

### 5. Portal Harvest dependents (subfeatures)

Core harvest already tested. Subfeatures:

#### 5a. Cancel scrape

| Field | Detail |
|-------|--------|
| **Classification** | **Partial / Broken** (signal split) |
| **Evidence** | `ScrapeContext.cancelScrape` prefers `/api/scrape-jobs/:id/cancel`; most workers only honor `session._cancelRequested` via `/api/scrape/cancel/:sessionId` — `docs/audits/scraper-cancellation-audit.md` |
| **Gaps** | UI toast “cancelled” while Railway may continue file work |
| **Safe to test?** | Yes to **reproduce defect**; do not assume stop is durable |
| **Test steps** | Start harvest → Cancel → watch Railway logs for new file units |
| **Expected (desired)** | No new units after cancel; job `cancelled` |
| **vs feat** | Same cancel plumbing; harvest UI more Lovable-styled |
| **Migrate** | **Migrate now** UI; **fix before claiming ready** |

#### 5b. Retry / continue failed items

| Field | Detail |
|-------|--------|
| **Classification** | **Partial** |
| **Evidence** | Arlington continue panel `ArlingtonPlanReviewContinuePanel.tsx`; Accela download status retry flags; feat adds `PgcRetryFailedItemsDialog.tsx` (not on main tree) |
| **Gaps** | Not a universal “Retry harvest” for all jurisdictions; Force Sync queue button unwired on main (`portal-harvest-metrics` audit) |
| **Safe to test?** | Yes for Arlington/PGC paths that expose continue/retry |
| **vs feat** | PGC retry dialog is feat-only enhancement |
| **Migrate** | **Migrate now** where wired; label Force Sync **Coming Soon** until wired |

#### 5c. Attachments / files

| Field | Detail |
|-------|--------|
| **Classification** | **Working E2E** (read of saved harvest + live `scrape_file_results` during job) |
| **Evidence** | `portal_data.tabs` files/attachments; `useScrapeFileResults.ts` → `scrape_file_results`; `/view-file` |
| **Gaps** | Live download completeness jurisdiction-dependent; failed_non_retryable rows |
| **Safe to test?** | Yes (read-only of harvested files preferred) |
| **Migrate** | **Migrate now** |

#### 5d. Reports tab

| Field | Detail |
|-------|--------|
| **Classification** | **Working E2E** (renders saved `portal_data.tabs.reports` / reportEntries / pdfs) |
| **Evidence** | `PortalDataViewer.tsx` reports tab; prior metrics audit |
| **Gaps** | Metric double-count / Force Sync mislabel (prior audit); not a separate report scheduler |
| **Safe to test?** | Yes |
| **Migrate** | **Migrate now** |

#### 5e. Queue Force Sync / Filter

| Field | Detail |
|-------|--------|
| **Classification** | **UI only** / unwired |
| **Evidence** | `portal-harvest-metrics-and-functionality-audit.md` §8 |
| **Migrate** | **Coming Soon** |

---

### 6. Comment Review

| Field | Detail |
|-------|--------|
| **Name** | Comment Review |
| **Route / nav** | `/comment-review` · main sidebar Intake; **feat: not in hybridNav** (CommandPalette + direct URL) |
| **FE** | `CommentReview.tsx` |
| **BE / edge** | `parse-manual-comment-letter`, `intake-pipeline-agent`; Storage + `project_documents` |
| **Tables** | `parsed_comments`, `project_documents` |
| **External** | OpenAI (agents); scraper for portal-sourced comments |
| **Classification** | **Working E2E** |
| **Evidence** | Upload letter → parse edge → insert `parsed_comments`; pipeline refresh |
| **Gaps** | Requires selected project; AI keys; portal path depends on harvest |
| **Safe to test?** | Yes |
| **Test steps** | Select project → upload comment letter → parse → rows appear → open Response Matrix |
| **Expected** | Persisted comments with disciplines/source |
| **Verify** | reads✓ writes✓ persists✓ selected project✓ · team access migration ✓ · loading/empty/error✓ · permissions: project · tests: parse selftests · env: OpenAI + edge |
| **vs feat** | Route exists; **nav regression risk** (removed from primary sidebar groups) — restore nav item or keep CommandPalette discoverability |
| **Migrate** | **Migrate now** + restore nav visibility |

---

### 7. Classified Comments

| Field | Detail |
|-------|--------|
| **Name** | Classified Comments |
| **Route / nav** | `/classified-comments` · main sidebar; feat: routed but title maps to “Response Matrix”; not in hybridNav |
| **FE** | `ClassifiedComments.tsx` |
| **BE** | `discipline-classifier-agent` |
| **Tables** | `parsed_comments` |
| **Classification** | **Working E2E** (subset of comment workflow) |
| **Evidence** | Invokes classifier; refetches rows |
| **Gaps** | Overlaps Response Matrix classify action; easy to treat as obsolete duplicate |
| **Safe to test?** | Yes |
| **vs feat** | Exists; IA suggests consolidation into Response Matrix |
| **Migrate** | Prefer fold into Response Matrix; else keep route; **do not Mock** |

---

### 8. Response Matrix + comment approval / export

| Field | Detail |
|-------|--------|
| **Name** | Response Matrix |
| **Route / nav** | `/response-matrix` · main Response group; feat Delivery group |
| **FE** | `ResponseMatrix.tsx`, export dialogs, approval helpers |
| **BE / edge** | `generate-response`, `generate-grounded-response`, `validate-completeness-agent`, `guardian-quality-agent`, `intake-pipeline-agent`, `export-response-package` |
| **Tables** | `parsed_comments` (+ approval fields), `plan_markups`, `company_branding`, exports bucket |
| **External** | OpenAI; optional embeddings for grounded path |
| **Classification** | **Working E2E** (grounded path **Partial** — see RAG) |
| **Evidence** | Generate → update `parsed_comments`; approval statuses `responseApproval.ts`; export edge |
| **Gaps** | Grounded needs chunks; team approval roles; Lovable “AI scoring / reconciliation” story incomplete (`response-matrix-lovable-audit.md`) |
| **Safe to test?** | Yes (demo data; AI costs) |
| **Test steps** | Comments present → generate → edit → request approval → approve → export package |
| **Expected** | Status transitions persist; export artifact produced |
| **Verify** | reads✓ writes✓ persists✓ selected project✓ · permissions owner/admin · loading/error✓ · tests: `responseApproval.selftest.ts` · env: OpenAI + edge |
| **vs feat** | Exists + visual/compact work; backend still real (supabase invokes present) |
| **Migrate** | **Migrate now** |

---

### 9. Document library (upload / list / download / versions)

| Field | Detail |
|-------|--------|
| **Name** | Project document library |
| **Route / nav** | Project detail dialog → Documents (not top-level `/documents`) |
| **FE** | `ProjectDocumentsSection.tsx`, `useProjectDocuments.ts` |
| **BE / edge** | Storage `project-documents`; `ingest-project-document` enqueue |
| **Tables** | `project_documents`, `document_ingestion_jobs` |
| **External** | Supabase Storage; optional ingestion worker |
| **Classification** | **Working E2E** for upload/list/download; ingestion **Partial** |
| **Evidence** | Storage upload + DB row; signed URL download; job insert via edge |
| **Gaps** | No dedicated Documents nav on main/feat hybrid; Lovable `/documents` is reference mock |
| **Safe to test?** | Yes |
| **Test steps** | Project detail → upload PDF/DOCX → list → download |
| **Expected** | File in storage + row; AI status may stay pending without worker |
| **vs feat** | Same mount point; ensure Project detail still exposes section after UI polish |
| **Migrate** | **Migrate now** |

---

### 10. RAG / grounded document responses

| Field | Detail |
|-------|--------|
| **Name** | Document RAG (grounded responses) |
| **Route / nav** | Via Response Matrix grounded generate (not standalone page) |
| **FE** | Response Matrix grounded invoke |
| **BE** | `ingest-project-document` → `document-ingestion-worker` → `project_document_chunks`; `generate-grounded-response` + `match_document_chunks` RPC |
| **Tables** | `document_ingestion_jobs`, `project_document_chunks`, `project_documents.ai_*` |
| **External** | OpenAI embeddings; worker process |
| **Classification** | **Partial** |
| **Evidence** | Edge retrieves chunks; returns low confidence / empty evidence when `chunkCount === 0`; worker in `document-ingestion-worker/` (npm `dev` trio) — not clearly Railway-productionized |
| **Gaps** | Without worker + OPENAI, grounding is hollow; users may think RAG is on when it is not |
| **Safe to test?** | Yes if worker running locally/dev; otherwise expect empty evidence |
| **Test steps** | Upload doc → confirm job completes → grounded generate → evidence cited |
| **Expected** | Chunks + similarity; otherwise explicit weak-evidence behavior |
| **vs feat** | Same backend |
| **Migrate** | **Migrate now** UI; treat as Partial until worker confirmed in target env |

---

### 11. Permit Filing / Wizard

| Field | Detail |
|-------|--------|
| **Name** | Permit Filing Wizard |
| **Route / nav** | `/permit-wizard-filing` · Intake/Delivery |
| **FE** | `PermitWizardFiling.tsx`, `StartFilingDialog`, `FilingReviewPanel`, agent cards |
| **BE / edge** | `permitwizard-preflight`, `permitwizard-execute`, `permit-status-monitor`; scraper `/api/permitwizard/*`, `/api/filing/*` |
| **Tables** | `permit_filings`, `agent_runs`, `municipality_configs`, related filing_* tables (migrations `20260307000003/004`) |
| **External** | Municipality portals; OpenAI; scraper |
| **Classification** | **Partial** |
| **Evidence** | Full agent chain documented in `permit-wizard-agents-01-09.md`; create inserts `permit_filings` then preflight; human gate UI |
| **Gaps** | **Live Supabase may lack `permit_filings` (PGRST205)** — `permit-filing-preflight-and-jurisdictions.md`; list UI gated on `selectedProjectId`; portal execute uneven; status monitor DC Scout-centric; reject leaves status quirks |
| **Safe to test?** | Preflight/list **only after schema confirmed**; **no live portal submit** without approval |
| **Test steps** | Confirm table exists → select project → Start Filing → preflight agents → awaiting_approval package; stop before execute unless approved |
| **Expected** | Filing row + agent_runs; or clear “storage not set up” error |
| **vs feat** | Route + large UI diff; still real backend; not Lovable `/matrix/guided` mock |
| **Migrate** | **Migrate now** chrome; mark execute portals Partial; **do not** ship as fully validated |

---

### 12. QuickBooks / project billing

| Field | Detail |
|-------|--------|
| **Name** | QuickBooks billing / invoices |
| **Route / nav** | Project detail → BillingInvoicePanel (no Settings OAuth UI found) |
| **FE** | `BillingInvoicePanel.tsx`, billing fields on `ProjectFormDialog` / detail |
| **BE** | Scraper `/api/quickbooks/*` (oauth start/callback, invoice/trigger, status) |
| **Tables** | `quickbooks_*` migrations; `projects` billing fields |
| **External** | Intuit QuickBooks |
| **Classification** | **Partial** |
| **Evidence** | Trigger API + dry-run messaging; OAuth routes exist server-side; FE grep found **no** `/api/quickbooks/oauth` connect UI |
| **Gaps** | Connect flow operator-driven/dev; draft create requires connection; shared Supabase risk |
| **Safe to test?** | Dry-run yes; live QB draft only with connected sandbox + approval |
| **Test steps** | Open project billing → dry-run preview → observe `quickbooks_not_connected` if unset |
| **Expected** | Dry-run payload; clear not-connected error |
| **vs feat** | Same panel expected in project detail |
| **Migrate** | **Migrate now** panel; OAuth UX **Coming Soon** unless connect UI added |

---

### 13. Stripe subscription / Pricing

| Field | Detail |
|-------|--------|
| **Name** | Pricing / Stripe checkout |
| **Route / nav** | `/pricing` |
| **FE** | `Pricing.tsx`, `useAuth` subscription fields, `create-checkout` invoke |
| **BE / edge** | `create-checkout`, `stripe-webhook`, `customer-portal`, `check-subscription` |
| **Tables** | `profiles.subscription_*` |
| **External** | Stripe |
| **Classification** | **Partial** |
| **Evidence** | Checkout edge creates Stripe session; auth reads subscription from `profiles` |
| **Gaps** | Requires `STRIPE_SECRET_KEY` + price IDs; webhook must update profiles; do not charge real cards in shared demo casually |
| **Safe to test?** | Only Stripe test mode |
| **vs feat** | Exists in Resources nav |
| **Migrate** | **Migrate now** (test mode) |

---

### 14. Analytics & exports

| Field | Detail |
|-------|--------|
| **Name** | Analytics & Reporting |
| **Route / nav** | `/analytics` |
| **FE** | `Analytics.tsx`, `useAnalytics.ts`, `AnalyticsExport.tsx` |
| **BE** | View `project_analytics` (security_invoker) |
| **Tables** | View over projects + related aggregates |
| **Classification** | **Working E2E** (read/aggregate); quality **Partial** if project date/cost fields sparse |
| **Evidence** | Hook selects view; charts client-side; CSV export client |
| **Gaps** | Not a separate warehouse; empty metrics if projects lack submitted/approved timestamps |
| **Safe to test?** | Yes |
| **Test steps** | Ensure projects with statuses/dates → open Analytics → filter → export |
| **Expected** | Cards/charts from real projects; not hardcoded |
| **vs feat** | Exists; UI restyle |
| **Migrate** | **Migrate now** |

---

### 15. Dashboard hub

| Field | Detail |
|-------|--------|
| **Name** | Dashboard |
| **Route / nav** | `/dashboard` |
| **FE** | `Dashboard.tsx`, widgets (deadlines, inspections, checklists, agent workflow, project health) |
| **BE** | Supabase reads on projects/inspections/checklists/portal_data |
| **Classification** | **Working E2E** (hub) / widgets **Partial** depth |
| **Evidence** | Real queries in `DeadlineAlertsWidget`, `InspectionsPunchListWidget`, `ProjectHealthCard`, `saved_calculations` |
| **Gaps** | Getting-started local; subscription tier display |
| **Safe to test?** | Yes |
| **vs feat** | Large visual rewrite; verify widgets still mounted and querying |
| **Migrate** | **Migrate now** with widget smoke |

---

### 16. Notifications

| Field | Detail |
|-------|--------|
| **Name** | In-app notification bell + Settings prefs |
| **Route / nav** | Header bell; Settings → Notifications |
| **FE** | `NotificationBell.tsx`, Settings notification tab |
| **BE** | Reads `jurisdiction_notifications`, `inspections`, `punch_list_items`; mark read writes |
| **Tables** | above + scheduled notification tables (admin) |
| **Classification** | **Partial** |
| **Evidence** | Bell queries real tables; Settings prefs saved to **localStorage** only (`notification_prefs_${userId}`) — not server email preference store |
| **Gaps** | Deadline/inspection email edges exist but prefs UI does not drive them end-to-end |
| **Safe to test?** | Yes for bell read/mark; prefs are local only |
| **vs feat** | Same Settings pattern |
| **Migrate** | Bell **Migrate now**; prefs label as local / **Coming Soon** for server-driven email |

---

### 17. Inspections & punch list

| Field | Detail |
|-------|--------|
| **Name** | Inspections / punch list |
| **Route / nav** | Dashboard widgets; Project detail `ProjectInspectionsSection` |
| **FE** | `useInspections.ts`, widgets, section component |
| **BE** | Supabase CRUD |
| **Tables** | `inspections`, `punch_list_items` |
| **Classification** | **Working E2E** |
| **Evidence** | Hook insert/update/delete + activity |
| **Safe to test?** | Yes |
| **vs feat** | Should remain via dashboard/project detail |
| **Migrate** | **Migrate now** |

---

### 18. Checklists & report email

| Field | Detail |
|-------|--------|
| **Name** | Saved inspection checklists |
| **Route / nav** | `/checklist-history` (feat alias `/checklists`) |
| **FE** | `ChecklistHistory.tsx`, `useSavedChecklists.ts` |
| **BE / edge** | `send-checklist-report`, scheduled report processors |
| **Tables** | `saved_inspection_checklists` (+ delivery logs) |
| **Classification** | **Working E2E** (CRUD); email **Partial** (edge secrets) |
| **Evidence** | Hook CRUD; invoke send report |
| **Safe to test?** | Yes; email optional |
| **vs feat** | In Resources |
| **Migrate** | **Migrate now** |

---

### 19. Client share portal & embed

| Field | Detail |
|-------|--------|
| **Name** | Project share links / Client Portal / Embed |
| **Route / nav** | Token: `/portal/:token`, `/embed/:token`; create via project share hooks |
| **FE** | `ClientPortal.tsx`, `EmbedWidget.tsx`, `useProjectShareLinks.ts` |
| **BE** | RLS-friendly share link validation |
| **Tables** | `project_share_links`, `projects`, `inspections`, `project_activity` |
| **Classification** | **Working E2E** |
| **Evidence** | Token validate → project fetch → view_count++; realtime on embed |
| **Safe to test?** | Yes |
| **vs feat** | Routes preserved |
| **Migrate** | **Migrate now** |

---

### 20. Settings (profile, password, cleanup, branding, architect, mailbox)

| Field | Detail |
|-------|--------|
| **Name** | Settings suite |
| **Route / nav** | `/settings` (feat Help group; main often header) |
| **FE** | `Settings.tsx` + managers |
| **BE** | profiles update; auth password; credentials API; `company_branding` + storage `exports`; `architect_profiles`; Microsoft `/api/microsoft/*` |
| **Classification** | Profile/password/cleanup/branding/architect **Working E2E**; Microsoft mailbox **Partial** (OAuth env); notification prefs **Partial** (localStorage) |
| **Evidence** | Settings tabs; ExportBrandingManager storage; ArchitectProfileManager; MicrosoftMailboxConnector |
| **Gaps** | Cleanup deletes projects/comments — dangerous on shared DB |
| **Safe to test?** | Profile/creds yes; cleanup only on disposable demo projects |
| **vs feat** | Present; same managers |
| **Migrate** | **Migrate now** |

---

### 21. Admin panel, roles, feature flags, shadow mode

| Field | Detail |
|-------|--------|
| **Name** | Admin |
| **Route / nav** | `/admin`, `/admin/jurisdictions`, `/admin/feature-flags`, `/admin/shadow-mode` |
| **FE** | `AdminPanel`, `JurisdictionAdmin`, `FeatureFlagsAdmin`, `ShadowModeDashboard`, `useRequireAdmin` |
| **BE** | `user_roles.role = 'admin'` (FE gate); admin tables; drip edges; shadow edges |
| **Tables** | `user_roles`, `jurisdictions`, `jurisdiction_subscriptions`, `email_branding_settings`, `admin_activity_log`, `scheduled_notifications`, shadow tables |
| **Classification** | Admin overview / jurisdiction CRUD / notifications **Working E2E** (admin-only); Feature flags **UI only** (localStorage `permitpulse_feature_flags`); Shadow mode **Partial** (needs evaluator data) |
| **Evidence** | `useRequireAdmin`; AdminPanel supabase writes; `useFeatureFlags` local only |
| **Gaps** | FE admin gate is not sufficient alone — RLS must enforce; feat adds Coming Soon admin placeholders |
| **Safe to test?** | Only with admin demo role |
| **vs feat** | Real admin routes kept; Authorizations/Members/Audit = Coming Soon placeholders |
| **Migrate** | Real admin **Migrate now**; placeholders stay **Coming Soon** |

---

### 22. Roles model

| Field | Detail |
|-------|--------|
| **Name** | App roles |
| **Classification** | **Working E2E** for `admin` check; project roles via team |
| **Evidence** | `user_roles`; project team roles in invitations; Response Matrix owner/admin |
| **Gaps** | Lovable `admin/staff/client` model **not** adopted (`docs/ui-replication-plan.md` PD-2 keep current) |
| **Migrate** | Keep PP roles; map labels in UI only |

---

### 23. Demo accounts / executive demo

| Field | Detail |
|-------|--------|
| **Name** | Demo surfaces |
| **Route / nav** | `/demos` (main); feat `/demo/mcdonalds` + `/demos` |
| **FE** | `Demos.tsx`, interactive demo components; feat `DemoMcDonalds.tsx` + `DemoDataBadge` |
| **Classification** | **Mock** / marketing demos; McDonald’s executive page is disclosed demo |
| **Evidence** | DemoDataBadge; local/demo state; lead capture gating |
| **Gaps** | Shared Supabase — demo accounts only for real data paths |
| **Safe to test?** | Demo UIs yes; do not confuse with production features |
| **Migrate** | **Mock Data** (keep labeled) |

---

### 24. LOA / Client Authorization

| Field | Detail |
|-------|--------|
| **Name** | Client Authorization (LOA) |
| **Route / nav** | feat `/onboarding/authorization` (+ `/delivery/authorization` redirect) — **not on main** |
| **FE** | `OnboardingAuthorization.tsx` |
| **Classification** | **UI only / Not implemented** persistence |
| **Evidence** | File header: requires `client_authorizations` + signatures storage (PD-4); submit shows Upcoming toast; only reads `profiles` for prefills |
| **Migrate** | **Coming Soon** (already labeled) |

---

### 25. Operations Board

| Field | Detail |
|-------|--------|
| **Name** | Operations Board |
| **Route / nav** | feat `/operations` — **not on main** |
| **FE** | `OperationsBoard.tsx`, `operations-real-data` helpers |
| **Classification** | **Partial** (some live project finance) + **Mock** (scope/workflow fixtures) |
| **Evidence** | DemoDataBadge; real reimbursable/utility cost sections vs mock scope/workflow; prior feasibility audit |
| **Migrate** | Keep with Mock Data badges; do not merge as “fully live finance” |

---

### 26. Jurisdictions (map, compare, state, admin)

| Field | Detail |
|-------|--------|
| **Name** | Jurisdiction intelligence |
| **Routes** | `/jurisdictions/map`, `/jurisdictions/compare`, `/jurisdictions/:stateCode`, admin CRUD |
| **FE** | Map/compare pages, `useJurisdictions.ts` |
| **BE** | `jurisdictions` table; `get-mapbox-token` |
| **Classification** | Catalog CRUD/compare **Working E2E**; map **Partial** (Mapbox token) |
| **Evidence** | Hook CRUD; map invokes edge or manual `pk.` token |
| **Migrate** | **Migrate now** |

---

### 27. Permit Intelligence (Shovels)

| Field | Detail |
|-------|--------|
| **Name** | Permit Intelligence |
| **Route** | `/permit-intelligence` |
| **FE** | `ShovelsPermitSearch` |
| **BE** | Edge `shovels-api` |
| **External** | `SHOVELS_API_KEY` |
| **Classification** | **Partial** |
| **Evidence** | Edge errors if key missing |
| **Migrate** | **Migrate now** if key present; else Coming Soon banner |

---

### 28. Code Reference Library / ROI / Consolidation

| Field | Detail |
|-------|--------|
| **Classification** | Code library mostly **UI only**/static reference; ROI & Consolidation calculators **Working E2E** for save to `saved_calculations` when authed |
| **Evidence** | ROI insert into `saved_calculations`; CodeReferenceLibrary static matrix |
| **Migrate** | Calculators **Migrate now**; library fine as reference |

---

### 29. Contact / FAQ / API docs / MVP docs / Design preview

| Field | Detail |
|-------|--------|
| **Contact** | **Working E2E** via `send-contact-email` |
| **FAQ / API docs / MVP docs** | Static **UI only** content (docs useful, not transactional) |
| **Design preview** | **UI only** / internal |
| **Migrate** | Contact **Migrate now**; previews keep internal |

---

### 30. Baltimore Accela clone

| Field | Detail |
|-------|--------|
| **Routes** | `/baltimore*` |
| **Classification** | **Mock** (`baltimorePortalMock.ts`; App comment “UI only”) |
| **vs feat** | Still routed; **removed from hybridNav** (good) |
| **Migrate** | **Hide obsolete** from product nav (keep unlinked if needed for design) |

---

### 31. Placeholders (feat additions)

| Item | Route | Classification | Migrate |
|------|-------|----------------|---------|
| Permit Queue | `/permit-queue` | Stub / Coming Soon | **Coming Soon** |
| Glossary | `/reference/glossary` | Stub / Coming Soon | **Coming Soon** |
| Admin Authorizations / Members / Audit | `/admin/*` | Stub / Coming Soon | **Coming Soon** |
| Architecture Replication checklist | `/admin/architecture-replication` | Internal checklist | Keep admin-only |

---

### 32. Project chat / annotations / collaboration

| Field | Detail |
|-------|--------|
| **Name** | Project chat & document comments |
| **FE** | `useProjectChat.ts`, `ProjectChatSidebar`, annotation hooks |
| **Tables** | `project_chat_messages`, `mention_notifications`, annotation tables |
| **Classification** | **Working E2E** where mounted in project UI |
| **Gaps** | Discoverability depends on project detail chrome surviving Lovable restyle |
| **Migrate** | **Migrate now** if still mounted |

---

### 33. Microsoft mailbox connector

| Field | Detail |
|-------|--------|
| **Route** | Settings |
| **BE** | `/api/microsoft/oauth/*`, mailbox status/test-read |
| **Tables** | `microsoft_mailbox_connections` |
| **Classification** | **Partial** (OAuth + Graph secrets) |
| **Safe to test?** | Only with approved mailbox sandbox |
| **Migrate** | **Migrate now** UI; env-gated |

---

## Branch comparison summary (`main` → `feat/lovable-ui-replication`)

| Main feature | Exists on feat? | Renamed / nav? | Backend connected? | Replaced with mock? | Visual-only adapt? | Needs functional restore? | Missing? |
|--------------|-----------------|----------------|--------------------|---------------------|--------------------|---------------------------|----------|
| Auth | Yes | login/signup aliases | Yes | No | Shell | No | — |
| Projects CRUD | Yes | `/projects/new` | Yes | No | Yes | Ensure dialogs intact | — |
| Team invite | Yes | Still in project detail | Yes | No | Yes | Keep entry point | — |
| Credentials | Yes | Settings | Yes | No | Yes | No | — |
| Portal Harvest | Yes | Same `/portal-data` | Yes | No (queue chrome) | Heavy UI | Cancel/Force Sync gaps | — |
| Comment Review | Yes route | **Dropped from hybridNav** | Yes | No | Yes | **Restore nav** | Nav |
| Classified Comments | Yes route | De-emphasized | Yes | No | — | Decide fold vs nav | Nav |
| Response Matrix | Yes | Delivery group | Yes | No | Yes | No | — |
| Documents | Yes (nested) | No `/documents` page | Yes | No | — | Keep in project detail | Top-level Lovable page unsupported |
| RAG | Same | — | Partial | No | — | Worker/env | — |
| Permit Filing | Yes | Same href | Partial | No | Heavy UI | Schema + list gates | — |
| AI Compliance | Yes | Intelligence group | Yes | No | Yes | Already tested | — |
| UCI | Yes | Expandable sections | Partial | Mock sections Coming Soon | Yes | Deferred | — |
| Analytics | Yes | Resources | Yes | No | Yes | No | — |
| Dashboard | Yes | Command | Yes | No | Heavy | Widget smoke | — |
| Checklists | Yes | + `/checklists` alias | Yes | No | Yes | No | — |
| Settings | Yes | Help group | Yes | No | Yes | No | — |
| Admin real | Yes | + Coming Soon items | Yes | Placeholders labeled | Yes | No | — |
| Baltimore | Yes route | Hidden from hybridNav | Mock | Was mock | — | Prefer hide | Product nav |
| Pricing/Stripe | Yes | Resources | Partial | No | Yes | Test mode | — |
| QuickBooks | Nested | Same | Partial | No | — | OAuth UX | Connect UI |
| LOA | **Feat only** | Onboarding | No persist | Explicit Upcoming | New | Do not fake save | Persistence |
| Operations Board | **Feat only** | Delivery | Mixed | Mock sections labeled | New | Keep badges | Full schema |
| Permit Queue / Glossary | Feat placeholders | Soon badges | No | Stub | New | — | Backend |
| McDonald’s demo | Feat | Command Demo | Mock | DemoDataBadge | New | Keep labeled | — |
| Marketing landing | Changed | HomeRoute vs CommunET landing | n/a | — | — | Confirm marketing intent | LandingPage deleted on feat |

**Lovable-only reference routes** under `reference/lovable-ui/` (Mission Control, Document Vault, Matrix Guided, UCI subroutes, etc.) are **not** production backends — do not migrate as functional.

---

## Verification flags cheat sheet (genuinely functional cores)

| Feature | Real R/W | Persists | Selected project | Tenant/access | L/E/E states | Permissions | Tests | Env / workers |
|---------|----------|----------|------------------|---------------|--------------|-------------|-------|---------------|
| Projects | ✓ | ✓ | ✓ | RLS | ✓ | Owner/team | Light | Supabase |
| Credentials | ✓ | ✓ | Bind ✓ | JWT user | ✓ | Owner | Scraper | Railway crypto |
| Comment Review | ✓ | ✓ | Required | Team RLS | ✓ | Project | Selftests | OpenAI edge |
| Response Matrix | ✓ | ✓ | Required | Team | ✓ | Approve roles | Selftests | OpenAI; RAG worker optional |
| Documents upload | ✓ | ✓ | Required | Project | ✓ | Project | — | Storage; worker optional |
| Checklists | ✓ | ✓ | Filter | User | ✓ | User | — | Email edge optional |
| Share portal | ✓ | ✓ | Via token | Link policy | ✓ | Token | — | — |
| Analytics | Read view | n/a | Portfolio | RLS view | ✓ | User | — | Data completeness |
| Permit Filing | ✓ if schema | ✓ | Required for queue UI | user_id | Error mapped | User | Agent docs | Migrations + scraper + OpenAI |
| Cancel scrape | Intent ✓ | Job row | Session/job | — | Misleading | — | Audit | **Broken signal** |
| QB dry-run | ✓ | Preview | Project | JWT | Errors | User | — | QB connect |
| Notifications prefs | Local only | localStorage | — | — | — | — | — | Not server |
| LOA | Prefill read | **No** | — | — | Upcoming toast | Auth | — | Missing tables |

---

## Final trackers

### A. Already tested

1. Portal Harvest / jurisdiction scraping (core)
2. AI Compliance Analyzer
3. UCI — **deferred** (not in next wave)

### B. Functional and ready for testing (next)

| Priority | Feature | Deps | Test journey | Expected | New-UI adaptation | Merge readiness |
|----------|---------|------|--------------|----------|-------------------|-----------------|
| P0 | Projects CRUD + selected project | Auth | Create/edit/status/delete; sidebar select | Persists; selection drives other pages | Keep dialogs/Kanban behaviors | Ready after smoke |
| P0 | Portal credentials | Scraper JWT | Settings CRUD + bind | Password configured; bind sticks | Settings tab chrome | Ready |
| P0 | Comment Review → Matrix handoff | Project, OpenAI | Upload/parse → open Matrix | Rows shared | **Restore Comment Review nav** | Ready after nav fix |
| P0 | Response Matrix draft/approve/export | Comments, OpenAI | Generate → approve → export | Status + package | Visual adapt OK | Ready |
| P1 | Document upload/download | Storage | Upload PDF → download | Storage + row | Keep in project detail | Ready |
| P1 | Team invite + `/invite/:token` | Email edge | Invite → accept | Member list | Nested UI OK | Ready if email works |
| P1 | Dashboard widgets | Projects data | Deadlines/inspections/health | Real counts | Confirm widgets after Dashboard restyle | Ready after smoke |
| P1 | Analytics + CSV export | Projects with dates | Filter/export | Non-mock charts | Chrome OK | Ready |
| P1 | Checklists CRUD (+ optional email) | — | Save/copy/send | Persists | Alias `/checklists` OK | Ready |
| P1 | Client portal / embed / share links | Share create UI | Create link → open token routes | Project view | — | Ready |
| P2 | Settings profile/password/branding/architect | — | Update each | Persists | Tabs OK | Ready |
| P2 | Inspections/punch CRUD | Project | Create/update | Persists | — | Ready |
| P2 | Contact form | Edge | Submit | Email/success | — | Ready |
| P2 | Jurisdiction compare + admin CRUD | Admin role | Compare; admin edit | DB changes | — | Ready (admin) |

### C. Partially functional

| Priority | Feature | Deps / blocker | Test journey | Expected | Adaptation | Merge readiness |
|----------|---------|----------------|--------------|----------|------------|-----------------|
| P0 | Permit Filing preflight/list | **`permit_filings` migration applied?**; project selected | Start filing → agents | Row or clear schema error | Lovable chrome OK | **Not merge-ready as “complete filing”** |
| P0 | Scrape cancel | Job vs session signal | Cancel mid-harvest | Today: often continues — document | Keep UI; fix later | Defect known |
| P1 | RAG grounded responses | Ingestion worker + embeddings | Upload → wait job → grounded gen | Evidence or weak | — | Partial OK if labeled |
| P1 | QuickBooks | OAuth connect + sandbox | Dry-run vs draft | Clear errors | — | Partial |
| P1 | Stripe checkout | Test keys | Pricing CTA | Checkout URL | — | Partial |
| P1 | Microsoft mailbox | Graph OAuth | Connect/test-read | Status | — | Partial |
| P1 | Map / Shovels | Mapbox / SHOVELS keys | Load map; search | Token or data | — | Partial |
| P1 | Notification prefs → email | Server prefs missing | Toggle prefs | localStorage only | Label honestly | Partial |
| P2 | Operations Board | Live vs mock split | Select project; switch tabs | Badges; no mock in real CSV | Keep DemoDataBadge | OK as mixed |
| P2 | Portal retry/Force Sync | Wiring gaps | PGC retry (feat); Force Sync | Retry where dialog exists; Force Sync no-op | Coming Soon labels | Partial |
| P2 | Feature flags admin | localStorage | Toggle | Client-only | Don’t overclaim | Partial |
| P2 | Shadow mode | Evaluator data | Open dashboard | Metrics if present | — | Partial |

### D. Mock / stub / not implemented → Coming Soon or Mock Data

| Item | Tag | Action |
|------|-----|--------|
| Baltimore Accela UI | Mock | Hide from product nav |
| LOA persistence | Not implemented | Coming Soon |
| Permit Queue | Stub | Coming Soon |
| Glossary | Stub | Coming Soon |
| Admin Authorizations / Members / Audit | Stub | Coming Soon (admin preview) |
| McDonald’s / Demos interactive | Mock Data | Keep labeled |
| Operations scope/workflow fixtures | Mock Data | Keep DemoDataBadge |
| UCI mock sections (Miss Utility, KG, etc.) | Coming Soon | Deferred with UCI |
| Lovable reference pages (Mission Control, Vault, Guided mock, etc.) | Mock | Do not ship as live |
| Queue Force Sync / Filter | UI only | Coming Soon |
| Settings notification → server email | Not implemented | Coming Soon |

### E. Obsolete or duplicate

| Item | Recommendation |
|------|----------------|
| `/classified-comments` as separate primary nav | Fold into Response Matrix / CommandPalette; avoid dual IA |
| `/jurisdiction-comparison` alias | Keep legacy alias or redirect |
| Baltimore product nav (main) | Obsolete for customers; hide |
| CommunET marketing landing removed on feat | Confirm intentional HomeRoute behavior before merge |
| Fairfax portal components unrouted | Leave unlinked |
| Feature flag “showDemoVideo” localStorage | Not a product admin system |
| Lovable `/matrix/guided` vs PP `/permit-wizard-filing` | Do not replace wizard with Lovable mock |

---

## Recommended safest order

1. **Test remaining real B-list** on feat Preview + Railway **development** (demo accounts): Projects → Credentials → Comment Review → Response Matrix → Documents → Team → Dashboard/Analytics/Checklists/Share.
2. **Fix defects that block trust:** scrape cancel signal; Comment Review nav restore; confirm `permit_filings` schema before filing demos; Force Sync labeling.
3. **Adapt to Lovable visually without replacing backends** — preserve hooks (`useProjects`, credentials API, Matrix/Comment supabase invokes, PortalDataViewer scrape).
4. **Mark unsupported** (LOA persist, Permit Queue, Glossary, admin previews, Baltimore, Lovable-only routes) as Coming Soon / Mock Data / hide.
5. **Regression** checklist (auth, selected project, harvest smoke already done, Matrix export, Settings credentials).
6. **Merge** only after explicit human approval; do not merge UI work to `main` without that approval (workspace rule).

---

## Environment & migration warnings (carry forward)

- Shared Supabase between Railway development and production credentials — **demo accounts only**; avoid destructive cleanup and live utility/portal submits.
- `permit_filings` / municipality seed migrations may be **unapplied** in live DB despite existing in repo (`20260307000003`, `20260307000004`, related).
- Document ingestion worker is required for real RAG; do not market grounded responses as always-on without worker health.
- Stripe / QuickBooks / Microsoft / Mapbox / Shovels / OpenAI keys gate Partial features.

---

## Document control

| | |
|--|--|
| Author | Cursor audit agent (read-only) |
| Output | `docs/audits/main-functional-features-and-ui-migration-audit.md` |
| Related | `docs/current-page-architecture.md`, `docs/audits/*`, `docs/lovable-ui-frontend-implementation-plan.md` |
