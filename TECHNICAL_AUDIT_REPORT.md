# Insight|DesignCheck — Technical Audit Report

**Generated:** March 3, 2026  
**Project:** Insight|DesignCheck (PermitPilot / Epermit)  
**Environment:** Replit (Cloud Run deployment target)

---

## 1. Tech Stack

### 1.1 Frontend

| Layer | Technology | Version |
|---|---|---|
| Language | TypeScript | ^5.8.3 |
| Framework | React | ^18.3.1 |
| Build Tool | Vite | ^5.4.19 |
| Routing | React Router DOM | ^6.30.1 |
| UI Components | shadcn/ui (Radix UI primitives) | Multiple @radix-ui/* packages |
| Styling | Tailwind CSS | ^3.4.17 |
| State (Server) | TanStack React Query | ^5.83.0 |
| Forms | React Hook Form + Zod | ^7.61.1 / ^3.25.76 |
| Animations | Framer Motion | ^12.25.0 |
| Charts | Recharts | ^2.15.4 |
| Maps | mapbox-gl | ^3.17.0 |
| PDF Generation | jsPDF + jspdf-autotable | ^4.1.0 / ^5.0.7 |
| PDF Rendering | pdfjs-dist | ^4.8.69 |
| PWA | vite-plugin-pwa | ^1.2.0 |
| Mobile Wrapper | Capacitor (Core + CLI) | ^8.0.1 |
| Icons | lucide-react | ^0.462.0 |
| Date Utilities | date-fns | ^3.6.0 |
| Toasts | sonner | ^1.7.4 |
| Command Palette | cmdk | ^1.1.1 |
| QR Codes | qrcode.react | ^4.2.0 |
| SEO | react-helmet-async | ^2.0.5 |

### 1.2 Backend (Supabase)

| Layer | Technology |
|---|---|
| Database | PostgreSQL (Supabase-hosted) |
| Authentication | Supabase Auth (email/password) |
| Serverless Functions | Supabase Edge Functions (Deno runtime) |
| File Storage | Supabase Storage |
| Row-Level Security | RLS policies on all public tables |
| AI/LLM | OpenAI GPT-4o (via Edge Functions) |
| Email | Resend API |
| Payments | Stripe (Checkout + Webhooks) |
| Text-to-Speech | ElevenLabs API |
| Permit Data | Shovels API |
| Web Scraping (alt) | Firecrawl API |

### 1.3 Scraper Service (Companion Process)

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js (CommonJS) | nodejs-20 |
| Framework | Express | ^5.2.1 |
| Browser Automation | Playwright (Chromium) | ^1.58.2 |
| Excel Export | ExcelJS | ^4.4.0 |
| Supabase Client | @supabase/supabase-js | ^2.95.3 |
| Environment | dotenv | ^16.6.1 |

### 1.4 Development Tooling

| Tool | Version |
|---|---|
| TSX (runtime) | ^4.21.0 |
| ESLint | ^9.32.0 |
| PostCSS | ^8.5.6 |
| Autoprefixer | ^10.4.21 |
| Concurrently | ^9.1.2 |
| lovable-tagger (dev) | ^1.1.13 |

---

## 2. Project Workflow (End-to-End Logic Flow)

### 2.1 User Authentication Flow

```
User visits /auth
  → Supabase Auth (email/password login/signup)
  → On signup: Postgres trigger `handle_new_user` creates `profiles` row
  → AuthProvider context wraps session + subscription status
  → Unauthenticated users redirected to /auth via ProtectedRoute
```

### 2.2 Project Lifecycle Flow

```
1. CREATE PROJECT
   User → Dashboard → "New Project" form
   → POST to Supabase `projects` table
   → Project appears in dashboard with status: "draft"

2. PORTAL SCRAPING (optional)
   User enters portal credentials (ProjectDox/Avolve)
   → Frontend POST directly to http://localhost:3001/api/login (scraper service)
   → Playwright launches Chromium, logs into portal
   → Extracts: project info, report PDFs, status data, tasks
   → Writes results back to Supabase `projects.portal_data` (JSONB)
   → Progress tracked via AgentWorkflowStatus component

3. AI COMMENT PIPELINE
   Portal data or uploaded PDFs trigger the intake pipeline:
   
   Step 1: intake-pipeline-agent (orchestrator)
     → Step 2: comment-parser-agent
         Extracts reviewer comments from PDFs using GPT-4o
         Saves to `parsed_comments` table
     → Step 3: discipline-classifier-agent
         Classifies each comment by discipline (Structural, MEP, Fire, etc.)
     → Step 4: context-reference-engine
         Enriches comments with code references, drafts initial responses
     → Step 5: auto-router-agent
         Assigns comments to team members by discipline mapping
     → Step 6: guardian-quality-agent
         Scores responses (1-10), flags issues, suggests improvements
         Saves QA results to `comment_quality_checks`

4. RESPONSE MATRIX
   User reviews classified comments in ResponseMatrix page
   → Edit/approve AI-drafted responses
   → Export response package via export-response-package Edge Function

5. E-PERMIT SUBMISSION (optional)
   Validated permit data → epermit-submit Edge Function
   → Submits to Accela/CityView systems

6. INSPECTIONS & FIELD WORK
   User schedules inspections → `inspections` table
   → Punch list items tracked in `punch_list_items`
   → Photos uploaded to Supabase Storage → `inspection_photos`
   → PDF checklists generated client-side (jsPDF)
```

### 2.3 Request-Response Architecture

```
Browser (React SPA)
  │
  ├── Supabase Direct (Auth, DB queries, Storage, Edge Functions)
  │     └── supabase-js client → https://eeqxyjrcldivtpikcpvk.supabase.co
  │
  └── Scraper Service (direct connection)
        └── Frontend calls http://localhost:3001/* directly
              └── Express + Playwright (Chromium)
                    └── Writes scraped data back to Supabase DB
```

**Key architectural notes:**
- The frontend communicates *directly* with Supabase for all data operations (no custom backend API in the main app).
- The scraper service is accessed *directly* at `http://localhost:3001` from the frontend (`AgentWorkflowStatus.tsx` defines `SCRAPER_URL = "http://localhost:3001"`).
- In development, Vite serves the frontend on port 5000; in production (Replit Cloud Run), `vite preview` serves on port 8080 while the scraper runs as a background process on the same host.
- The scraper service is only functional in environments where Chromium is available (Replit provides it via Nix).

---

## 3. AI Agents & Tools

### 3.1 Supabase Edge Functions (AI Agents)

| Agent | Purpose | LLM Model | Output Format |
|---|---|---|---|
| `intake-pipeline-agent` | Orchestrator — chains parser → classifier into a single workflow | N/A (orchestrator) | Pipeline status |
| `comment-parser-agent` | Extracts reviewer comments from raw portal PDF text | GPT-4o | JSON (structured comments) |
| `discipline-classifier-agent` | Classifies comments by engineering discipline | GPT-4o | JSON (discipline enum) |
| `auto-router-agent` | Assigns comments to team members by discipline mapping | Rule-based | DB updates |
| `context-reference-engine` | Enriches comments with code references, drafts responses | GPT-4o | JSON (enriched comments) |
| `generate-response` | Drafts professional responses to permit review comments | GPT-4o | JSON (response text) |
| `guardian-quality-agent` | QA scoring (1-10) of drafted responses, flags issues | GPT-4o | JSON (scores + flags) |
| `validate-completeness-agent` | Checks if response package is complete before export | GPT-4o | JSON (validation result) |
| `analyze-drawing` | Multimodal analysis of architectural drawings for code compliance | GPT-4o (Vision) | JSON (violations list) |
| `elevenlabs-tts` | Text-to-speech conversion for accessibility/demos | ElevenLabs API | Audio stream |

### 3.2 Non-AI Automated Edge Functions

| Function | Purpose |
|---|---|
| `export-response-package` | Generates exportable comment response packages |
| `epermit-submit` | Submits permits to Accela/CityView e-permit systems |
| `create-checkout` | Creates Stripe checkout sessions for subscription billing |
| `customer-portal` | Redirects to Stripe customer portal for subscription management |
| `stripe-webhook` | Handles incoming Stripe webhook events |
| `check-subscription` | Validates user subscription status |
| `check-portal-status` | Checks permit portal status via Firecrawl |
| `fetch-permit-data` | Retrieves permit data from external sources |
| `shovels-api` | Integrates with Shovels permit data API |
| `get-mapbox-token` | Securely provides Mapbox token to frontend |
| `validate-url` | URL validation utility |
| `parse-permit-comments` | Alternative comment parsing pathway |

### 3.3 Email & Notification Functions

| Function | Purpose |
|---|---|
| `send-welcome-email` | Welcome email on signup (Resend) |
| `send-contact-email` | Contact form submission handler |
| `send-inspection-reminders` | Automated inspection reminder emails |
| `send-deadline-reminders` | Project deadline notification emails |
| `send-checklist-report` | Sends generated checklist reports via email |
| `send-checklist-signed-notification` | Notification when checklist is signed |
| `send-epermit-status-email` | E-permit status update notifications |
| `send-jurisdiction-notification` | Jurisdiction-related notifications |
| `send-test-scheduled-report` | Test endpoint for scheduled reports |
| `process-scheduled-checklist-reports` | Cron: processes and sends scheduled reports |
| `process-scheduled-notifications` | Cron: processes queued notifications |
| `process-drip-emails` | Cron: marketing/onboarding drip campaigns |
| `retry-failed-report-emails` | Retries failed email deliveries |
| `admin-drip-campaigns` | Admin management of drip campaigns |

### 3.4 Scraper Service Workflows

The scraper service (`scraper-service/server.js`) uses a multi-step Playwright automation:

1. **Login** — Authenticates to DC ProjectDox/Avolve portal
2. **Info Extraction** — Scrapes project metadata
3. **Report Download** — Downloads review report PDFs
4. **Status Check** — Captures current permit status
5. **File Listing** — Enumerates uploaded project files
6. **Task Tracking** — Extracts active tasks/action items

Progress is tracked step-by-step and reported back to the frontend via the `AgentWorkflowStatus` component.

---

## 4. Infrastructure

### 4.1 Database

| Component | Details |
|---|---|
| **Engine** | PostgreSQL (Supabase-hosted) |
| **Project Ref** | `eeqxyjrcldivtpikcpvk` |
| **Schema Management** | Raw SQL migration files in `supabase/migrations/` (30+ migrations) |
| **ORM** | None — direct Supabase client queries (no Drizzle/Prisma) |
| **RLS** | Enforced on all public tables |
| **Access Functions** | `has_project_access(user_id, project_id)`, `has_role(user_id, role)` |

#### Core Tables

| Table | Purpose |
|---|---|
| `profiles` | User data (name, company, subscription tier/status) |
| `user_roles` | Role assignments (admin, moderator, user) |
| `projects` | Core project records with status, jurisdiction, portal_data JSONB |
| `project_team_members` | Project sharing with roles (owner, admin, editor, viewer) |
| `project_invitations` | Email-based project invitations with token + expiry |
| `project_activity` | Audit log for project events |
| `portal_credentials` | Stored portal login credentials per project |
| `parsed_comments` | AI-parsed plan review comments with discipline, status, response |
| `comment_quality_checks` | Guardian QA agent results (scores, flags) |
| `project_documents` | Uploaded documents (Supabase Storage references) |
| `document_annotations` | Visual markups on documents (JSONB data) |
| `document_comments` | Threaded comments on documents |
| `project_chat_messages` | Real-time project chat messages |
| `inspections` | Inspection records per project |
| `punch_list_items` | Deficiencies found during inspections |
| `inspection_photos` | Photo evidence for inspections/punch items |
| `jurisdictions` | Jurisdiction metadata for map and comparison tools |
| `coverage_requests` | User requests for new jurisdiction data |
| `scheduled_reports` | Automated report delivery schedules |

#### Database Views

| View | Purpose |
|---|---|
| `project_analytics` | Aggregated analytics (cycle times, costs, document counts) |

### 4.2 Edge Functions (Supabase)

- **Runtime:** Deno
- **Location:** `supabase/functions/` (36 functions total)
- **Deployment:** `supabase functions deploy <function-name>`
- **JWT Verification:** Disabled for several public endpoints (configured in `supabase/config.toml`)
- **CORS:** Handled per-function with preflight OPTIONS support

### 4.3 File Storage

- **Provider:** Supabase Storage
- **Usage:** Inspection photos, document uploads, exported packages

### 4.4 Background Tasks & Cron Jobs

These Edge Functions are designed for scheduled execution (configured via Supabase cron or external triggers):

| Task | Schedule Type |
|---|---|
| `process-scheduled-checklist-reports` | Periodic (cron) |
| `process-scheduled-notifications` | Periodic (cron) |
| `process-drip-emails` | Periodic (cron) |
| `send-deadline-reminders` | Periodic (cron) |
| `send-inspection-reminders` | Periodic (cron) |
| `retry-failed-report-emails` | Periodic (cron) |

### 4.5 System Dependencies (Nix)

The Replit environment provides these system packages for Playwright/Chromium:

```
chromium, glib, nss, nspr, atk, at-spi2-atk, cups, dbus, expat,
libdrm, libxkbcommon, pango, cairo, alsa-lib, mesa
```

---

## 5. Configuration & Environment Variables

### 5.1 Frontend (Vite — `import.meta.env`)

| Key | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL for client-side connections |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous/public key for client-side auth |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Alternative anon key used for Edge Function authorization headers |
| `DEV` | Built-in Vite flag — `true` in development mode |

### 5.2 Supabase Edge Functions (`Deno.env.get()`)

| Key | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL (auto-injected in deployed functions) |
| `SUPABASE_ANON_KEY` | Supabase anonymous key (auto-injected) |
| `SUPABASE_SERVICE_ROLE_KEY` | High-privilege key for admin operations (bypasses RLS) |
| `OPENAI_API_KEY` | OpenAI API access for GPT-4o agents |
| `RESEND_API_KEY` | Resend email service API key |
| `STRIPE_SECRET_KEY` | Stripe payment processing secret key |
| `STRIPE_WEBHOOK_SIGNING_SECRET` | Stripe webhook signature verification secret |
| `MAPBOX_PUBLIC_TOKEN` | Mapbox access token for interactive maps |
| `SHOVELS_API_KEY` | Shovels permit data API key |
| `SHOVEL_API_KEY` | Alternative reference to Shovels API key |
| `ELEVENLABS_API_KEY` | ElevenLabs text-to-speech API key |
| `ELEVENLABS_API_KEY_1` | Secondary ElevenLabs API key |
| `FIRECRAWL_API_KEY` | Firecrawl web scraping API key |

### 5.3 Scraper Service (`process.env` via dotenv)

| Key | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL for writing scraped data |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for direct DB writes (bypasses RLS) |

### 5.4 Test Scripts (`process.env`)

| Key | Purpose |
|---|---|
| `SUPABASE_TEST_EMAIL` | Test user email for pipeline testing |
| `SUPABASE_TEST_PASSWORD` | Test user password for pipeline testing |

---

## 6. Deployment

### 6.1 Current Deployment Target: Replit Cloud Run

The project is configured for Replit's Cloud Run deployment.

**Build pipeline:**
```bash
bun install --no-frozen-lockfile && \
cd scraper-service && bun install --no-frozen-lockfile && cd .. && \
npx vite build
```

**Runtime command:**
```bash
cd scraper-service && node server.js & npx vite preview --host 0.0.0.0 --port 8080
```

**Port mapping:** Internal port 8080 → External port 80

**Public directory:** `dist/public`

### 6.2 Development Setup

**Workflow:** `Start application` runs `bash dev.sh`

**dev.sh contents:**
```bash
#!/usr/bin/env bash
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm run dev
```

**npm run dev** uses `concurrently` to start:
1. `npm run dev:frontend` → Vite dev server on port 5000 (HMR enabled)
2. `npm run dev:scraper` → `cd scraper-service && node server.js` on port 3001

**Port summary:**
| Mode | Frontend Port | Scraper Port | Notes |
|---|---|---|---|
| Development | 5000 (Vite dev) | 3001 | HMR, hot reload |
| Production (Cloud Run) | 8080 (Vite preview) | 3001 (background) | Static build served |

### 6.3 Vercel Configuration (Legacy/Alternative)

A `vercel.json` is present for potential Vercel deployment:
- **Build command:** `npm run build`
- **Output:** `dist`
- **Framework:** `vite`
- **SPA rewrite:** `/(.*) → /index.html`

### 6.4 Supabase Edge Function Deployment

Edge Functions are deployed separately via the Supabase CLI:
```bash
supabase functions deploy <function-name>
```
- **Project reference:** `eeqxyjrcldivtpikcpvk`
- **Manual deployment docs:** `scripts/DEPLOY_AND_VERIFY.md`

### 6.5 PWA Configuration

- **Plugin:** `vite-plugin-pwa` with `autoUpdate` registration
- **Manifest:** Defined inline in `vite.config.ts`
- **App name:** "Insight|DesignCheck - Permit Intelligence Platform"
- **Workbox caching:** Google Fonts, API responses, Supabase API, images
- **Max cache file size:** 5 MB

### 6.6 Mobile (Capacitor)

- **App ID:** `app.lovable.0664b92985614c0ebe90b14e3fcda8e1`
- **Status:** Configured but not actively built for native deployment
- **Config file:** `capacitor.config.ts`

---

## 7. Project File Structure (Key Directories)

```
/
├── src/                          # Frontend React application
│   ├── App.tsx                   # Root component with routing
│   ├── main.tsx                  # Entry point
│   ├── index.css                 # Global styles + Tailwind + CSS variables
│   ├── pages/                    # 30+ page components
│   ├── components/               # Shared UI components
│   │   ├── dashboard/            # Dashboard widgets (AgentWorkflowStatus, etc.)
│   │   ├── compliance/           # AI compliance tools
│   │   ├── comments/             # Comment review components
│   │   └── ...
│   ├── hooks/                    # Custom hooks (useAuth, useProjects, etc.)
│   ├── contexts/                 # React contexts (Auth, SelectedProject, LeadCapture)
│   ├── lib/                      # Utilities (supabase client, helpers)
│   ├── integrations/             # Supabase types and client config
│   ├── types/                    # TypeScript type definitions
│   └── utils/                    # Utility functions
├── scraper-service/              # Companion Playwright scraper
│   ├── server.js                 # Express server (port 3001)
│   ├── package.json              # Separate dependency tree
│   └── .env.example              # Required env vars template
├── supabase/
│   ├── config.toml               # Supabase project configuration
│   ├── functions/                # 36 Edge Functions (Deno)
│   │   ├── intake-pipeline-agent/
│   │   ├── comment-parser-agent/
│   │   ├── discipline-classifier-agent/
│   │   ├── guardian-quality-agent/
│   │   ├── analyze-drawing/
│   │   ├── create-checkout/
│   │   ├── stripe-webhook/
│   │   └── ... (36 total)
│   └── migrations/               # 30+ SQL migration files
├── scripts/                      # Deployment & test scripts
├── public/                       # Static assets (PWA icons, etc.)
├── vite.config.ts                # Vite build configuration
├── tailwind.config.ts            # Tailwind CSS configuration
├── capacitor.config.ts           # Mobile app configuration
├── vercel.json                   # Vercel deployment config (legacy)
├── dev.sh                        # Development startup script
├── .replit                       # Replit environment configuration
└── package.json                  # Root dependencies & scripts
```

---

## 8. Known Issues & Notes

1. **DeadlineAlertsWidget crash** — `Cannot read properties of null (reading 'split')` — `parseISO` receives null date values from projects with no deadline set.
2. **Project update errors** — "Error updating project" on some update calls; may need investigation.
3. **Data migration** — Portal credentials and old projects exist only in Supabase (not migrated locally); users must re-add them.
4. **Scraper service** — Requires a machine with Chromium available; runs locally only in development, included in Cloud Run deployment.
5. **Supabase shim** — `user_id` filter is silently ignored in the frontend Supabase client shim; server uses session user instead (intentional).

---

*End of Technical Audit Report*
