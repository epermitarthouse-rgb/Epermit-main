# Epermit (PermitPilot) — App & Tech Stack Summary

**Last updated:** From current codebase. Use as reference for stack, edge functions, and features.

---

## 1. App overview

**Epermit (PermitPilot)** is a permit-management and expediting web app for architects, contractors, and project owners. It supports:

- **Projects & team sharing** — Create projects, invite team members, track by jurisdiction and permit number.
- **Portal integration** — DC ProjectDox/Avolve-style portals: store credentials, run a local scraper (Playwright) or Firecrawl-based check to sync report PDFs and status into the app.
- **Comment pipeline** — Load “Plan Review - Review Comments” from the portal; parse and dedupe comments; classify by discipline (Structural, Architectural, MEP, Fire, etc.); manage responses in a Response Matrix.
- **AI assistance** — Auto-draft responses for comments (OpenAI); parse comment letters from images/PDFs; analyze drawings for compliance.
- **E-permit** — Validate and submit to Accela/CityView; track status and history.
- **Inspections & reminders** — Inspections per project; deadline and inspection reminders via email.
- **Scheduled reports** — Checklist reports on a schedule; drip campaigns and welcome/contact emails (Resend).
- **Billing** — Stripe checkout, webhooks, subscription tier on profile; customer portal.
- **Jurisdictions** — Jurisdiction data, comparisons, map (Mapbox), admin notifications; state landing pages.
- **Calculators & tools** — ROI calculator, consolidation calculator, code compliance, code reference library.
- **Mobile** — Capacitor for potential native builds; PWA (Vite PWA plugin).

All backend logic and persistence live in **Supabase** (Postgres, Auth, Edge Functions, Storage). A separate **Node/Express + Playwright** scraper runs locally for portal scraping.

---

## 2. Tech stack

### Frontend

| Layer | Technology |
|-------|------------|
| **Build** | Vite 5 |
| **Framework** | React 18 |
| **Language** | TypeScript |
| **Routing** | React Router 6 |
| **UI** | shadcn/ui (Radix primitives), Tailwind CSS, Tailwind Animate, class-variance-authority, tailwind-merge |
| **State / server state** | TanStack React Query v5 |
| **Forms** | React Hook Form, Zod, @hookform/resolvers |
| **Icons** | Lucide React |
| **Charts** | Recharts |
| **Maps** | Mapbox GL |
| **PDF** | jsPDF, jspdf-autotable, pdfjs-dist |
| **PWA** | vite-plugin-pwa |
| **Mobile** | Capacitor 8 (cli + core) |
| **Other** | Framer Motion, date-fns, cmdk (command palette), sonner (toasts), next-themes |

- **Entry:** `src/main.tsx` → `src/App.tsx`.
- **Auth:** Supabase Auth (email/password). `useAuth` and `ProtectedRoute` / `PublicOnlyRoute`; selected project from `SelectedProjectContext` (localStorage-backed).

### Backend

| Layer | Technology |
|-------|------------|
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Supabase Auth |
| **Serverless** | Supabase Edge Functions (Deno) |
| **Storage** | Supabase Storage (e.g. project-documents bucket) |
| **Realtime** | Supabase Realtime (e.g. epermit_submissions) |

- **Project ID:** `eeqxyjrcldivtpikcpvk` (in config and client).
- **Migrations:** `supabase/migrations/` (chronological SQL); no ORM (no Prisma/Drizzle).

### Scraper service

| Layer | Technology |
|-------|------------|
| **Runtime** | Node.js |
| **Server** | Express 5 |
| **Browser automation** | Playwright |
| **Excel** | ExcelJS |
| **Env** | dotenv |

- **Location:** `scraper-service/`.
- **Port:** 3001.
- **Scripts:** `npm run dev` runs frontend + scraper concurrently; `npm run dev:scraper` runs only the scraper.

### Integrations (env / secrets)

| Service | Typical env / Supabase secret | Usage |
|---------|-------------------------------|--------|
| **Supabase** | SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY | Frontend, edge functions, scraper |
| **OpenAI** | OPENAI_API_KEY | generate-response, parse-permit-comments, analyze-drawing, comment-parser-agent, discipline-classifier-agent |
| **Stripe** | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SIGNING_SECRET | create-checkout, stripe-webhook, check-subscription, customer-portal |
| **Resend** | RESEND_API_KEY | All email edge functions |
| **Firecrawl** | FIRECRAWL_API_KEY | check-portal-status |
| **Mapbox** | MAPBOX_PUBLIC_TOKEN | get-mapbox-token |
| **ElevenLabs** | ELEVENLABS_API_KEY / ELEVENLABS_API_KEY_1 | elevenlabs-tts |
| **Shovels** | SHOVEL_API_KEY, SHOVELS_API_KEY | fetch-permit-data, shovels-api |

---

## 3. Supabase Edge Functions (complete list)

All run on Deno; JWT verification is disabled at the project level for many functions; auth is often done inside the function (e.g. Bearer token + `getUser()` or anon key + global headers).

### Comment & AI pipeline (intake workflow)

| Function | Purpose |
|----------|---------|
| **intake-pipeline-agent** | Orchestrator: calls comment-parser-agent (with timeout/cursor), then discipline-classifier-agent when parser is done. Returns 200 with partial results on parser timeout. Uses user JWT; forwards Authorization to child functions. |
| **comment-parser-agent** | Reads portal_data.tabs.reports.pdfs; prioritizes PDF whose fileName includes “Plan Review - Review Comments” (parses only that one when present). Splits text into blocks, filters noise (report titles, metadata, table headers), dedupes by project; incremental parsing with cursor in portal_data.meta; inserts into parsed_comments. If that PDF is empty or “No data found.”, returns `reason: "no_comments_in_portal"`. Uses OpenAI to extract comments (original_text, discipline, code_reference). |
| **discipline-classifier-agent** | Selects parsed_comments where discipline IS NULL or ‘General’ or ‘‘ and status = ‘Pending’; sends to OpenAI to classify into Architectural, Structural, Mechanical, Electrical, Plumbing, Fire, Civil, Energy, Zoning, Environmental, Administrative, Other; updates discipline. Logs if >50% classified as Other. Uses user JWT and anon key. |
| **generate-response** | Given comment_text (and optional code_reference, discipline), returns suggested_response via GPT-4o for response drafting. |
| **parse-permit-comments** | Image/PDF (base64) of a comment letter → OpenAI vision → returns comments[] (original_text, discipline, code_reference). Used by optional “upload document” flow on Comment Review. |
| **analyze-drawing** | Image (base64) + jurisdictionKey → OpenAI; returns compliance issues and summary (jurisdiction-specific). |

### Portal & e-permit

| Function | Purpose |
|----------|---------|
| **check-portal-status** | Project_id + Bearer; uses Firecrawl (and/or robot flow) to check portal; updates project portal_status, last_checked_at, project_url, portal_data. |
| **epermit-submit** | Validate or submit to Accela/CityView; body: action, system, environment, credentials, applicationData, documents. |
| **validate-url** | URL validation helper. |

### Billing & Stripe

| Function | Purpose |
|----------|---------|
| **create-checkout** | Creates Stripe checkout session; uses Stripe secret and Supabase. |
| **stripe-webhook** | Handles Stripe webhooks; on checkout.session.completed updates profiles (subscription_tier, subscription_status, stripe_customer_id, subscription_end). |
| **check-subscription** | Reads subscription from DB/Stripe. |
| **customer-portal** | Stripe customer portal session. |

### Email (Resend)

| Function | Purpose |
|----------|---------|
| **send-welcome-email** | Welcome email on signup/onboarding. |
| **send-contact-email** | Contact form / support email. |
| **send-epermit-status-email** | E-permit status change notification. |
| **send-checklist-signed-notification** | Notification when checklist is signed. |
| **send-checklist-report** | Sends checklist report email. |
| **send-inspection-reminders** | Upcoming inspection reminders. |
| **send-deadline-reminders** | Deadline reminders. |
| **send-jurisdiction-notification** | Admin-sent jurisdiction notification to subscribers. |
| **process-scheduled-notifications** | Processes due scheduled_notifications; sends via Resend; logs to admin_activity_log. |
| **process-scheduled-checklist-reports** | Processes due scheduled_checklist_reports; builds report; sends email; logs to scheduled_report_delivery_logs. |
| **send-test-scheduled-report** | Test run for scheduled report. |
| **retry-failed-report-emails** | Retries failed report delivery logs. |
| **process-drip-emails** | Sends drip campaign emails. |
| **admin-drip-campaigns** | Admin management of drip campaigns. |

### Other

| Function | Purpose |
|----------|---------|
| **get-mapbox-token** | Returns Mapbox public token for client maps. |
| **fetch-permit-data** | Shovel API permit data. |
| **shovels-api** | Shovels API proxy/wrapper. |
| **elevenlabs-tts** | Text-to-speech via ElevenLabs. |

---

## 4. Main features (by area)

### Auth & identity

- Sign up / sign in with Supabase Auth (email/password).
- Profile in `public.profiles` (full_name, company_name, job_title, phone, subscription fields, stripe_customer_id).
- Roles in `user_roles` (admin, moderator, user); `has_role()` used in RLS and admin UI.
- Protected vs public routes; selected project persisted in localStorage per user.

### Projects & team

- CRUD projects (name, address, jurisdiction, permit_number, status, portal_data, etc.).
- `project_team_members` and `project_invitations`; access via `has_project_access()` / `has_project_admin_access()`.
- RLS on projects and related tables scoped by ownership or team access.

### Portal & scraping

- **Portal credentials** stored per user (optional project_id, permit_number, portal_username, portal_password).
- **Scraper (Node/Playwright):** login, scrape tabs (info, reports, etc.), extract PDFs/text, sync to `projects.portal_data` and portal_status.
- **check-portal-status:** Alternative path using Firecrawl; updates project URL and portal_data.
- **Portal Data viewer:** UI to inspect portal_data (tabs, reports, PDFs) for the selected project.
- **Dashboard “Run Manual Check”:** Triggers scraper flow; when scrape completes, invokes intake-pipeline-agent (poll until comment parser done), then shows Comment Parser and Discipline Classifier status.

### Comment review & response matrix (portal-driven)

- **Comment Review page (`/comment-review`):** Uses **selectedProjectId** only. Loads `parsed_comments` from DB. If none, “Load comments from portal” runs intake-pipeline-agent (polling); if backend returns `reason: "no_comments_in_portal"`, shows empty state. Optional accordion: upload document → parse-permit-comments → approve to insert into parsed_comments.
- **Response Matrix (`/response-matrix`):** Select project; lists parsed_comments with status, discipline, city comment, response text, assigned_to, sheet_reference; edit and save; “Auto-Draft” calls generate-response.
- **Classified Comments (`/classified-comments`):** Same selectedProjectId; shows parsed_comments grouped by discipline (null → “Unclassified”) with counts; “Run classifier” invokes discipline-classifier-agent and refreshes.

### E-permit

- **epermit_submissions** table; validate/submit via epermit-submit (Accela/CityView).
- Status tracking and optional email on status change.

### Inspections & reminders

- Inspections linked to projects; send-inspection-reminders and send-deadline-reminders (Resend).

### Scheduled reports & notifications

- **scheduled_checklist_reports:** User-defined schedule, timezone, include_pdf; process-scheduled-checklist-reports sends emails and logs to scheduled_report_delivery_logs.
- **scheduled_notifications:** Admin-created; process-scheduled-notifications sends and marks done.
- Drip campaigns (user_drip_campaigns, process-drip-emails, admin-drip-campaigns).

### Jurisdictions & map

- **jurisdictions** table; jurisdiction_subscriptions, jurisdiction_notifications.
- Jurisdiction comparison, map (Mapbox), state landing pages; admin sends jurisdiction notifications.

### Calculators & code tools

- ROI calculator, consolidation calculator (saved_calculations).
- Code compliance (analyze-drawing), code reference library.

### Admin

- Admin panel, jurisdiction admin, feature flags admin; admin activity log for notifications.

### Billing

- Stripe checkout (create-checkout); webhook updates profile subscription fields; check-subscription and customer-portal for managing subscription.

---

## 5. Key frontend routes (protected unless noted)

| Path | Page | Note |
|------|------|------|
| `/` | Landing | Public |
| `/auth` | Auth | Public |
| `/dashboard` | Dashboard | Agent workflow status, links to Comment Review / Classified Comments / Portal Data |
| `/projects` | Projects | |
| `/analytics` | Analytics | |
| `/comment-review` | Comment Review | Portal-driven; optional upload |
| `/response-matrix` | Response Matrix | Parsed comments with responses |
| `/classified-comments` | Classified Comments | By discipline; run classifier |
| `/portal-data` | Portal Data Viewer | |
| `/code-compliance` | Code Compliance | |
| `/code-reference` | Code Reference Library | |
| `/roi-calculator` | ROI Calculator | |
| `/consolidation-calculator` | Consolidation Calculator | |
| `/permit-intelligence` | Permit Intelligence | |
| `/jurisdictions/map` | Jurisdiction Map | |
| `/jurisdictions/compare` | Jurisdiction Comparison | |
| `/checklist-history` | Checklist History | |
| `/settings` | Settings | |
| `/admin` | Admin Panel | |
| `/admin/jurisdictions` | Jurisdiction Admin | |
| `/admin/feature-flags` | Feature Flags | |
| `/api-docs` | API Documentation | |
| `/mvp-documentation` | MVP Documentation | |
| `/install` | Install | |
| `/portal/:token` | Client Portal | Public |
| `/embed/:token` | Embed Widget | Public |

---

## 6. Database (high level)

- **Identity:** auth.users, profiles, user_roles.
- **Projects:** projects (with portal_data JSONB), project_team_members, project_invitations.
- **Portal:** portal_credentials.
- **Comments:** parsed_comments (original_text, discipline, code_reference, status, response_text, assigned_to, sheet_reference, etc.).
- **E-permit:** epermit_submissions.
- **Inspections:** inspections.
- **Documents:** project_documents; Storage bucket project-documents.
- **Jurisdictions:** jurisdictions, jurisdiction_subscriptions, jurisdiction_notifications.
- **Scheduling:** scheduled_notifications, scheduled_checklist_reports, scheduled_report_delivery_logs, user_drip_campaigns.
- **Other:** saved_calculations, admin_activity_log, email_branding_settings.
- **Views:** project_analytics.
- **Functions:** has_role(), has_project_access(), has_project_admin_access(); triggers for updated_at and handle_new_user.

---

## 7. Scraper API (Node, port 3001)

- `GET /` — Static page.
- `POST /api/login` — Playwright login to portal; returns sessionId.
- `POST /api/scrape` — projectId, userId, tabs, etc.; runs scrape; syncs to Supabase (portal_data, portal_status).
- `GET /api/data/:sessionId` — Session status and data.
- `GET /api/progress/:sessionId` — SSE progress.
- `POST /api/logout/:sessionId` — Cleanup.
- `GET /api/export/:sessionId` — Excel export.

This summary reflects the current app and tech stack, all Supabase Edge Functions, and the main features and routes.
