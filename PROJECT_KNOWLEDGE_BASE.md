# Project Knowledge Base — Epermit (PermitPilot)

**Last updated:** From repo scan. Treat as source of truth for backend, database, and integrations.

---

## A) One-line app description

**PermitPilot (Epermit)** is a permit-management and expediting web app for architects, contractors, and project owners: it tracks projects, jurisdictions, inspections, comment review, e-permit submissions (Accela/CityView), portal scraping (DC ProjectDox/Avolve), AI-generated comment responses, compliance analysis, ROI/consolidation calculators, scheduled reports, and Stripe subscriptions. Frontend is a Vite/React SPA; backend is Supabase (Postgres + Auth + Edge Functions + Storage).

---

## B) System architecture

- **Frontend:** Vite 5, React 18, TypeScript, React Router 6, shadcn/ui, Tailwind, TanStack Query, Capacitor (mobile). Entry: `src/main.tsx` → `src/App.tsx`.
- **Backend:** No Node API in repo. Backend = **Supabase** (Postgres, Auth, Edge Functions, Storage). Supabase project id: `eeqxyjrcldivtpikcpvk` (in `supabase/config.toml` and `src/lib/supabase.ts`).
- **Scraper service:** Standalone Node/Express + Playwright app in `scraper-service/` (port 3001). Runs with `npm run dev:scraper`; used for DC ProjectDox portal scraping (login, tabs, reports, sync to Supabase). Not Deno; no Prisma/Drizzle in repo.
- **Hosting:** README references Lovable deploy; frontend can be deployed anywhere (e.g. Vercel). Edge functions run on Supabase.
- **Major modules:** Auth (Supabase Auth + profiles/subscription); Projects & team sharing; Portal credentials + scraper + Portal Data viewer; E-permit submit/validate (edge); Comment parsing & response matrix (AI); Inspections & reminders; Scheduled notifications & checklist reports (cron-triggered); Stripe checkout/webhook; Jurisdiction admin & notifications; Drip emails; Mapbox (get-mapbox-token); Firecrawl (check-portal-status); Shovels/Shovel APIs (fetch-permit-data, shovels-api).

---

## C) Auth + Roles

- **Auth provider:** Supabase Auth (email/password). Client: `src/lib/supabase.ts` (anon key hardcoded); `src/hooks/useAuth.tsx` wraps session, signUp, signIn, signOut, and subscription state.
- **User identity:** `auth.users` (Supabase). App user data in `public.profiles` (user_id → auth.users.id). Trigger `handle_new_user` creates a profile row on signup (migration `20260112060817`).
- **Roles:** `public.app_role` enum: `admin`, `moderator`, `user`. Stored in `public.user_roles` (user_id, role). `public.has_role(_user_id, _role)` (SECURITY DEFINER) checks `user_roles`. Admin-only tables/policies use `has_role(auth.uid(), 'admin')` or `'admin'::app_role`.
- **Project access:** `public.has_project_access(_user_id, _project_id)` returns true if user is project owner (`projects.user_id`) or in `project_team_members`. `has_project_admin_access` adds owner or team role in (owner, admin).
- **RLS:** Enforced on almost all public tables. Typical patterns: (1) own rows by `auth.uid() = user_id`, (2) project-scoped via `has_project_access(auth.uid(), project_id)`, (3) admin-only via `has_role(auth.uid(), 'admin')`.
- **Frontend guards:** `src/components/auth/ProtectedRoute.tsx` — requires authenticated user (useAuth), else redirects to `/auth`; wraps content in `DashboardLayout`. `src/components/auth/PublicOnlyRoute.tsx` — redirects logged-in users to `/dashboard`. Routes in `src/App.tsx`: public (/, /auth, /demos, /pricing, etc.) vs `<ProtectedRoute>` (e.g. /dashboard, /projects, /analytics, /admin, /settings, /portal-data, etc.).

---

## D) Database (detailed)

**Supabase Postgres.** Migrations in `supabase/migrations/` (chronological). No Prisma/Drizzle; schema is migration-only.

### Core identity & roles
- **profiles** — id (PK), user_id (UNIQUE, FK auth.users), full_name, company_name, job_title, phone, created_at, updated_at. Used by useAuth for **subscription_tier**, **subscription_status**, **subscription_end** (and stripe webhook: **stripe_customer_id**). RLS: own row by user_id. Trigger: update_updated_at.
- **user_roles** — id (PK), user_id (FK auth.users), role (app_role), created_at. UNIQUE(user_id, role). RLS: users see own roles; admins manage all. Used by has_role().

### Projects & sharing
- **projects** — id (PK), user_id (NOT NULL), name, address, city, state, zip_code, jurisdiction, project_type (enum), status (project_status enum), description, estimated_value, square_footage, permit_number, submitted_at, approved_at, deadline, notes, created_at, updated_at. Later migrations add: portal_status, last_checked_at, **portal_data** (JSONB), **project_url** (used by check-portal-status and frontend). RLS: user_id = auth.uid(). Indexes: user_id, status, created_at. Trigger: update_updated_at.
- **project_team_members** — id (PK), project_id (FK projects), user_id, role (team_role: owner, admin, editor, viewer), added_by, created_at, updated_at. UNIQUE(project_id, user_id). RLS: has_project_access. Trigger: update_updated_at.
- **project_invitations** — id (PK), project_id (FK projects), email, role (team_role), invited_by, token, status (pending/accepted/declined/expired), expires_at, created_at, accepted_at. RLS: has_project_access. Used by has_project_access (invitation flow).

### Portal & scraper
- **portal_credentials** — id (PK), user_id (FK auth.users), jurisdiction, portal_username, portal_password, permit_number, project_address, created_at. Later: login_url (default DC), **project_id** (FK projects, nullable). RLS: user_id = auth.uid(). Index: user_id, project_id.
- **projects.portal_data** — JSONB written by scraper (and by check-portal-status for report data). Contains tabs (info, reports), projectInfo, tables, pdfs, etc. Consumed by PortalDataViewer.

### E-permit
- **epermit_submissions** — id (PK), project_id (FK projects), user_id, system (accela | cityview), environment (sandbox/production), tracking_number, record_id, permit_type, status (epermit_status enum), status_message, applicant_name, applicant_email, submitted_at, last_status_check, status_history (JSONB), response_data (JSONB), created_at, updated_at. RLS: user or has_project_access. Realtime enabled. Trigger: update_updated_at.

### Comments & response matrix
- **parsed_comments** — id (PK), project_id (FK projects), original_text, discipline, code_reference, status (check: Pending Review, Pending, Approved, Rejected, Draft, Ready for Review), page_number, created_at. Later: response_text, assigned_to, sheet_reference. RLS: has_project_access on project_id. Indexes: project_id, status.
- **parsed_comments_response_matrix** — (migration `20260210200000`) response/assignment fields and status constraint.

### Inspections, documents, collaboration
- **inspections** — project_id (FK), status (inspection_status enum), scheduled_date, etc. RLS: has_project_access.
- **project_documents** — project_id (FK), storage refs, etc. Storage bucket `project-documents` allows PDF and images (migration `20260201000000`).
- **document_comments**, **document_annotations**, **project_chat_messages**, **mention_notifications** — project-scoped; RLS via has_project_access / has_project_admin_access.

### Jurisdictions & notifications
- **jurisdictions** — id (PK), name, state, city, county, website_url, phone, email, address, reviewer_contacts (JSONB), fee fields, SLA fields, submission_methods, accepted_file_formats, is_active, etc. UNIQUE(name, state). RLS: active visible to all; admins CRUD.
- **jurisdiction_subscriptions** — user_id, jurisdiction_id, jurisdiction_name, jurisdiction_state. UNIQUE(user_id, jurisdiction_id). RLS: own rows.
- **jurisdiction_notifications** — user_id, jurisdiction_id, jurisdiction_name, title, message, is_read, created_at. RLS: own rows; admins can insert.

### Scheduled jobs & email
- **scheduled_notifications** — admin-created; status, scheduled_for; processed by edge function. RLS: admin.
- **scheduled_checklist_reports** — user_id, schedule config, timezone, include_pdf_attachment, etc. RLS: own rows. Processed by process-scheduled-checklist-reports.
- **scheduled_report_delivery_logs** — report_id (FK scheduled_checklist_reports), user_id, sent_at, etc. RLS: user.
- **user_drip_campaigns** — user_id, email, campaign_type, enrolled_at, emails_sent, last_email_sent_at, is_active, completed_at. UNIQUE(user_id, campaign_type). RLS: own row; no global “service role” policy (dropped in later migration).

### Other
- **saved_calculations** — user_id, name, calculation_type (roi | consolidation), input_data, results_data. RLS: own row.
- **admin_activity_log** — admin_user_id, action_type, jurisdiction_id, notification fields, delivery_status, etc. RLS: admin only.
- **email_branding_settings** — logo_url, primary_color, header_text, footer_text, etc. RLS: admin only. Default row inserted.

### Views
- **project_analytics** — view over projects with computed analytics (draft_to_submit_days, submit_to_approval_days, inspection_count, etc.). security_invoker = on.

### Triggers / functions
- **update_updated_at_column()** — sets NEW.updated_at = now(). Used on profiles, saved_calculations, projects, epermit_submissions, jurisdictions, and many others.
- **handle_new_user()** — AFTER INSERT on auth.users; inserts into profiles (user_id, full_name, company_name, job_title, phone from raw_user_meta_data).
- **has_role(_user_id, _role)**, **has_project_access(_user_id, _project_id)**, **has_project_admin_access(_user_id, _project_id)** — SECURITY DEFINER, used in RLS.

### Seed data
- Jurisdiction seed data in migrations (e.g. Midwest, Texas, CA, etc.) via INSERT into `jurisdictions`.
- email_branding_settings: one default row.

---

## E) API surface

**Frontend:** No Next.js; no `/api` or `/app/api` in repo. Data access via Supabase client from browser and from Edge Functions with service role.

**Scraper (Node):** `scraper-service/server.js`
- `GET /` — serves static public/index.html.
- `GET /api/progress/:sessionId` — SSE progress for scrape session.
- `POST /api/login` — Playwright login to DC portal; returns session id for scraper.
- `POST /api/scrape` — body: projectIds?, tabs?, projectId (Supabase project id), userId. Starts scrapeAll(); stores result in session; syncs to Supabase (projects.portal_data, portal_status, last_checked_at, portal_credentials.project_id).
- `GET /api/data/:sessionId` — returns session status and data.
- `POST /api/logout/:sessionId` — cleanup session.
- `GET /api/export/:sessionId` — Excel export of session data.

**Supabase Edge Functions** (Deno; under `supabase/functions/`; all have verify_jwt = false in config.toml unless noted):
- **generate-response** — POST. Body: comment_text, code_reference?, discipline?. Uses OPENAI_API_KEY; returns suggested_response (GPT-4o). For comment response drafting.
- **parse-permit-comments** — POST. Body: imageBase64, imageType?, pageNumber?. Uses OPENAI_API_KEY; returns comments[] (original_text, discipline, code_reference). Vision extraction from comment letter image.
- **analyze-drawing** — POST. Body: image (base64), jurisdictionKey. Uses OPENAI_API_KEY; returns compliance issues and summary. Jurisdiction-specific amendments (e.g. DC, NYC) in code.
- **check-portal-status** — POST. Auth: Bearer (Supabase user). Body: project_id. Uses FIRECRAWL_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Logs in via Firecrawl scrape, infers portal status, optionally discovers ProjectID and report JSON; updates projects (portal_status, last_checked_at, project_url, portal_data).
- **epermit-submit** — POST. Body: action (validate | submit), system (accela | cityview), environment, credentials, applicationData, documents?. Validate checks credentials; submit creates submission. No JWT required.
- **validate-url** — (validate URL; minimal).
- **get-mapbox-token** — Returns MAPBOX_PUBLIC_TOKEN for client map.
- **create-checkout** — Stripe checkout session creation. Uses STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_ANON_KEY.
- **stripe-webhook** — Stripe webhook. Uses STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SIGNING_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. On checkout complete: updates profiles (subscription_tier, subscription_status, stripe_customer_id, subscription_end).
- **check-subscription** — Reads subscription from DB/Stripe; uses SUPABASE_*, STRIPE_SECRET_KEY.
- **customer-portal** — Stripe customer portal session; STRIPE_SECRET_KEY, Supabase.
- **send-welcome-email**, **send-contact-email**, **send-epermit-status-email**, **send-checklist-signed-notification**, **send-checklist-report**, **send-inspection-reminders**, **send-deadline-reminders**, **send-jurisdiction-notification** — RESEND_API_KEY; various Supabase reads for templates/recipients.
- **process-scheduled-notifications** — Runs over scheduled_notifications (due), sends via Resend, logs to admin_activity_log. Uses SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
- **process-scheduled-checklist-reports** — Runs over scheduled_checklist_reports (due), builds report, sends email, logs to scheduled_report_delivery_logs. Uses RESEND_API_KEY, SUPABASE_*.
- **send-test-scheduled-report** — Test run for scheduled report. RESEND_API_KEY, SUPABASE_*.
- **retry-failed-report-emails** — Retries failed delivery logs. RESEND_API_KEY, SUPABASE_*.
- **process-drip-emails** — Drip campaign sends. RESEND_API_KEY, SUPABASE_*.
- **admin-drip-campaigns** — Admin drip management. SUPABASE_*, RESEND_API_KEY.
- **fetch-permit-data** — SHOVEL_API_KEY (permit data).
- **shovels-api** — SHOVELS_API_KEY; proxy or wrapper for Shovels API.
- **elevenlabs-tts** — ELEVENLABS_API_KEY_1 or ELEVENLABS_API_KEY; TTS.
- **send-checklist-signed-notification** — RESEND_API_KEY.

Cron/scheduling: `supabase/config.toml` references `[functions.process-scheduled-notifications]`, `[functions.process-scheduled-checklist-reports]`, `[functions.send-test-scheduled-report]` (scheduling is external/pg_cron or Supabase dashboard; pg_cron enabled in migration for scheduled_notifications).

---

## F) Business logic & workflows

- **Onboarding:** Sign up → handle_new_user creates profile. Optional drip (user_drip_campaigns) and welcome email (send-welcome-email).
- **Subscription:** Stripe checkout (create-checkout) → stripe-webhook updates profiles.subscription_*. useAuth reads profiles for subscription state; check-subscription used for portal/API.
- **Projects:** CRUD by owner; project_team_members and project_invitations for sharing; has_project_access used for RLS and UI.
- **Portal flow:** User stores portal_credentials (permit_number, portal_username, portal_password). Scraper (Playwright) logs in, opens tab URLs (status, files, tasks, info, reports), extractPageData + extractPDFsFromPage; syncs to projects.portal_data and portal_status/last_checked_at; portal_credentials.project_id linked. check-portal-status (Firecrawl) alternative path: robot login + scrape, updates project_url and portal_data.
- **Comment review:** Upload/image → parse-permit-comments (OpenAI vision) → parsed_comments rows. generate-response (OpenAI) suggests response text. Response matrix UI and parsed_comments response_text/assigned_to/sheet_reference.
- **E-permit:** Frontend calls epermit-submit (validate or submit); epermit_submissions table; status tracking and optional send-epermit-status-email.
- **Scheduled reports:** User creates scheduled_checklist_reports; process-scheduled-checklist-reports runs on schedule, sends email, logs to scheduled_report_delivery_logs. send-test-scheduled-report for preview; retry-failed-report-emails for retries.
- **Scheduled notifications:** Admin creates scheduled_notifications; process-scheduled-notifications sends and marks done.
- **Inspections:** inspections table; send-inspection-reminders for upcoming scheduled_date.
- **Jurisdiction admin:** Admins manage jurisdictions and send send-jurisdiction-notification; subscribers in jurisdiction_subscriptions; notifications in jurisdiction_notifications.

---

## G) Integrations

| Integration    | Config (env) | Where used |
|----------------|-------------|------------|
| **Supabase**   | SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (and frontend hardcoded in src/lib/supabase.ts) | All edge functions; frontend; scraper-service (.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) |
| **OpenAI**     | OPENAI_API_KEY | generate-response, parse-permit-comments, analyze-drawing |
| **Stripe**     | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SIGNING_SECRET | create-checkout, stripe-webhook, check-subscription, customer-portal |
| **Resend**     | RESEND_API_KEY | All email-sending edge functions (welcome, contact, checklist, inspection reminders, deadline reminders, jurisdiction notification, drip, scheduled reports) |
| **Firecrawl**  | FIRECRAWL_API_KEY | check-portal-status (v0 scrape API) |
| **Mapbox**     | MAPBOX_PUBLIC_TOKEN | get-mapbox-token (returns token to client) |
| **ElevenLabs** | ELEVENLABS_API_KEY_1, ELEVENLABS_API_KEY | elevenlabs-tts |
| **Shovels**    | SHOVEL_API_KEY, SHOVELS_API_KEY | fetch-permit-data, shovels-api |

Webhooks: Stripe webhook endpoint (stripe-webhook); payload handling for checkout.session.completed, subscription updates. No other webhook payloads documented in scan.

Rate limits: Not specified in repo.

---

## H) Known issues / TODOs from code

- ROICalculator.tsx contains placeholder copy "$XX,XXX" / "$X,XXX" in UI (lines 718–730).
- README has placeholder "REPLACE_WITH_PROJECT_ID" for Lovable URL.
- Supabase URL and anon key are hardcoded in `src/lib/supabase.ts` (comment: "Single source of truth" for Vercel stability); no .env for frontend Supabase in repo (scraper has .env.example only).
- check-portal-status has comment "[ROBOT v25]" and Firecrawl v0 scrape; DC-specific login URL and flow.
- Several edge functions have verify_jwt = false; auth is sometimes done manually (e.g. check-portal-status gets user from Bearer).

---

## PHASE 3 — Questions (only if needed)

1. **Production Supabase:** Is the live app using the same project `eeqxyjrcldivtpikcpvk` or a different one? (If different, SUPABASE_URL/keys and project_id in config.toml would need to be confirmed.)
2. **Secrets:** Where are OPENAI_API_KEY, RESEND_API_KEY, STRIPE_*, FIRECRAWL_API_KEY, MAPBOX_PUBLIC_TOKEN, ELEVENLABS_*, SHOVEL_* / SHOVELS_* set for production (Supabase secrets vs CI/env)?
3. **Cron:** How are process-scheduled-notifications and process-scheduled-checklist-reports invoked on a schedule (Supabase cron, external cron, or dashboard)?

If these are already defined in your deployment or env docs, no need to answer here.

---

## PHASE 4 — Operating mode for future prompts

I will treat this summary as the source of truth. When you ask future questions, I’ll reference it and only ask for clarifications if the codebase doesn’t contain the answer.
