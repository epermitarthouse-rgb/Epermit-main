# PermitPilot — Current Workflow Diagrams

> Audit date: 2026-07-21  
> Status tags: **implemented** · **partial** · **mocked** · **blocked**

---

## 1. Application architecture

```mermaid
flowchart TB
  subgraph browser [Browser]
    SPA[React SPA Vite]
  end

  subgraph vercel [Vercel]
    FE[Static dist SPA]
  end

  subgraph supabase [Supabase]
    AUTH[Auth JWT]
    DB[(Postgres + RLS)]
    ST[Storage project-documents]
    EF[Edge Functions ~51]
  end

  subgraph railway [Railway scraper-service]
    API[Express server.js]
    PW[Playwright scrapers]
    UCIAPI["/api/uci"]
    AW[Arlington durable worker]
    UW[UCI portal sync worker]
    DL[downloads /view-file]
  end

  subgraph optional [Optional local]
    DIW[document-ingestion-worker]
  end

  subgraph external [External]
    MP[Municipal portals Accela ProjectDox ePlan]
    UP[Utility portals PEPCO]
    STRIPE[Stripe]
    MAPBOX[Mapbox]
    OPENAI[OpenAI]
    MS[Microsoft Graph mailbox]
    QB[QuickBooks]
  end

  SPA --> FE
  SPA -->|supabase-js| AUTH
  SPA -->|queries/realtime| DB
  SPA -->|functions.invoke| EF
  SPA -->|Bearer JWT /api| API
  API --> DB
  API --> ST
  API --> PW
  PW --> MP
  UCIAPI --> UP
  UCIAPI --> MS
  AW --> DB
  UW --> DB
  EF --> DB
  EF --> ST
  EF --> STRIPE
  EF --> OPENAI
  DIW --> DB
  DIW --> ST
  DIW --> OPENAI
  SPA --> MAPBOX
  API --> QB
```

---

## 2. Authentication workflow

```mermaid
sequenceDiagram
  participant U as User
  participant FE as Auth.tsx / useAuth
  participant SB as Supabase Auth
  participant RLS as Postgres RLS
  participant SC as Scraper UCI/creds APIs

  U->>FE: signUp / signIn
  FE->>SB: signUp / signInWithPassword
  SB-->>FE: session JWT
  FE->>FE: onAuthStateChange + getSession
  FE->>FE: ProtectedLayoutRoute gates routes
  FE->>RLS: queries with user JWT
  FE->>SC: Authorization Bearer JWT
  SC->>SB: auth.getUser(token)
  SC->>RLS: service role + RPC has_project_access / tenant
  Note over FE: Admin: useRequireAdmin queries user_roles
  Note over FE,SC: UCI refreshes session via coordinatedRefreshSession on 401 JWT
  U->>FE: signOut
  FE->>SB: signOut
  FE->>FE: ScrapeContext clear Accela session
```

**Access decision locations:**

| Decision | Where |
|----------|-------|
| Must be logged in | `ProtectedRoute.tsx` / `ProtectedLayoutRoute` |
| Must be admin | `AdminLayout` + `useRequireAdmin.ts` (FE); Edge admin functions (BE) |
| Project read/write | RLS helpers; UCI `uci-access.service.js` |
| Credential list/mutate | JWT + `user_id` ownership on portal-credentials routes |
| Scrape session data | **sessionId possession only** (`session-api.routes.js`) |

---

## 3. Project workflow

```mermaid
flowchart LR
  A[Create project Projects page] --> B[Optional team invite]
  B --> C[Attach portal credential]
  C --> D[Select as active project SelectedProjectContext]
  D --> E{Workflow branch}
  E --> F[Portal Harvest scrape]
  E --> G[Comment Review / Response]
  E --> H[Permit Wizard Filing]
  E --> I[UCI Utility Coordination]
  E --> J[Documents + AI ingestion]
  F --> K[projects.portal_data + files]
  G --> L[parsed_comments + packages]
  H --> M[permit_filings + agent_runs]
  I --> N[coordination_records lifecycle]
  J --> O[project_documents + chunks]
```

**Statuses (`projects.status`):** `draft` → `submitted` → `in_review` → `corrections` → `approved` (**implemented** enum).

---

## 4. Scraper workflow

```mermaid
flowchart TB
  START[User starts login/scrape from AgentWorkflowStatus or Portal flows] --> LOGIN["POST /api/login"]
  LOGIN --> SESS[In-memory sessionId]
  SESS --> SCRAPE["POST /api/scrape"]
  SCRAPE --> EPHEM{Ephemeral vs Durable}
  EPHEM -->|ephemeral| MEM[sessions map + SSE progress]
  EPHEM -->|durable| JOB[Insert scrape_jobs]
  JOB --> WORKER{Worker type}
  WORKER -->|Arlington| AW[arlington-durable-worker-loop]
  WORKER -->|UCI sync| UW[uci-durable-worker-loop env gated]
  MEM --> POLL["GET /api/data/:sessionId"]
  AW --> EV[scrape_events + heartbeats]
  UW --> EV
  POLL --> FILES[downloads + scrape_file_results]
  EV --> FILES
  FILES --> STORE[Supabase Storage / portal_data]
  STORE --> TERM[completed / failed / cancelled]
```

| Stage | Status |
|-------|--------|
| Login + Playwright session | **implemented** |
| Multi-jurisdiction scrapers (DC, Montgomery, Howard, PGC, Arlington, Fairfax, Baltimore modules) | **implemented** (coverage varies by portal) |
| Progress SSE / poll | **implemented** |
| Durable Arlington jobs | **implemented** (worker default on) |
| Durable UCI portal sync jobs | **partial** (requires `UCI_DURABLE_JOBS_ENABLED`) |
| Session API JWT | **blocked** / not present — sessionId only |
| Baltimore UI routes | **mocked** (UI clone; separate from scraper modules) |

---

## 5. Utility coordination (UCI) workflow

```mermaid
flowchart TB
  P[Select project on /uci] --> S1[Stage 1 Provider mapping]
  S1 --> S2[Stage 2 Load profile]
  S2 --> S3[Stage 3 Application prep]
  S3 --> S4[Stage 4 Submission]
  S4 --> S5[Stage 5 Acknowledgment]
  S5 --> S6[Stage 6 COS / design review]
  S6 --> S7[Stage 7 Costs CIAC]
  S7 --> S8[Stage 8 Equipment]
  S8 --> S9[Stage 9 Meter set]
  S9 --> S10[Stage 10 Closeout]

  S1 -.->|manual + resolution APIs| OK1[partial]
  S1 -.->|auto territory D2.2| BL1[blocked/partial]
  S2 -.-> OK2[partial inventory + candidates]
  S3 -.-> OK3[partial PEPCO package]
  S4 -.->|email fallback| OK4[partial]
  S4 -.->|PEPCO live portal| BL4[blocked unless UCI_PEPCO_LIVE_SUBMISSION_ENABLED]
  S5 -.-> OK5[partial via portal sync]
  S6 -.-> OK6[partial COS API]
  S7 -.-> OK7[partial API only]
  S8 -.-> OK8[partial API only]
  S9 -.-> OK9[partial prepare API]
  S10 -.-> OK10[partial prepare API]
```

| Stage | Name | Implementation |
|-------|------|----------------|
| 1 | Provider mapping | **partial** — D2.0 setup + resolve/confirm/override APIs; auto territory not production-ready |
| 2 | Load profile | **partial** — analyze, candidates, doc findings bridge; no auto stage advance |
| 3 | Application prep | **partial** — package build/review/doc mapping |
| 4 | Submission | **partial** email fallback; **blocked** live PEPCO portal (`uci-application-submit.service.js`, `uci-pepco-submission.service.js`) |
| 5 | Acknowledgment | **partial** — sync → applications/comms/milestones |
| 6 | COS / design | **partial** — `uci-cos-analyst.service.js` |
| 7 | Costs | **partial** — API CRUD; limited FE drawer |
| 8 | Equipment | **partial** — API; limited FE |
| 9 | Meter set | **partial** — prepare API |
| 10 | Closeout | **partial** — prepare API |

**Cross-cutting PEPCO:**

| Capability | Status |
|------------|--------|
| Login / MFA / resume | **partial** |
| Dashboard + app detail discovery | **partial** |
| Document download to Storage | **partial** |
| Portal sync + lifecycle proposals | **partial** |
| Adapter registry (pepco + generic-readonly) | **implemented** |

---

## 6. Comment / response workflow

```mermaid
flowchart LR
  A[Scrape or upload comments] --> B[Edge parsers / intake-pipeline]
  B --> C[parsed_comments]
  C --> D[Comment Review]
  C --> E[Classified Comments]
  C --> F[Response Matrix]
  F --> G[generate-response / grounded]
  G --> H[response_status approval]
  H --> I[Export package]
```

Approval of `response_status = Approved` enforced by DB trigger requiring project admin (**implemented**).

---

## 7. Document ingestion workflow

```mermaid
sequenceDiagram
  participant FE as useProjectDocuments
  participant EF as Edge ingest-project-document
  participant DB as document_ingestion_jobs
  participant W as document-ingestion-worker
  participant ST as Storage
  participant CH as project_document_chunks

  FE->>EF: invoke
  EF->>DB: insert pending
  W->>DB: claim processing
  W->>ST: download
  W->>CH: chunks + embeddings
  W->>DB: completed / partial / failed
```

---

## 8. Page / nav relationship diagram

See also `docs/current-page-architecture.md`. Condensed:

```mermaid
flowchart TB
  subgraph nav [AppSidebar groups]
    MAIN[Home Dashboard]
    INTAKE[Filing UCI Portal Baltimore Comments Compliance]
    RESP[Response Matrix]
    PROJ[Projects]
    INTEL[Permit Intel Code Library]
    RES[Calculators Analytics Jurisdictions Checklists]
    ADM[Admin four pages]
    HELP[Design preview API docs FAQ Contact]
  end

  MAIN --> INTAKE
  INTAKE --> RESP
  RESP --> PROJ
  PROJ --> INTEL
  INTEL --> RES
  RES --> ADM
  RES --> HELP
```

**Marked routes:**

- **legacy-alias:** `/jurisdiction-comparison`
- **mock:** `/baltimore*`
- **dev/internal:** `/design-system-preview`
- **incomplete:** `/uci` (later stages FE thin)
- **unrouted:** `pages/Index.tsx`
- **token-public:** `/portal/:token`, `/embed/:token`, `/invite/:token`
