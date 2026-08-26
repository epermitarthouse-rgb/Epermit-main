# In-Flight Status — PermitPilot and UCI

**Audit date:** 2026-08-26  
**Evidence sources:** Git branches, uncommitted changes, `docs/uci-action-items-status.md`, codebase inspection, Railway deploy metadata.

Verified facts and unresolved questions are separated in §10.

---

## 1. Work currently in progress

| Area | Evidence | Status |
|------|----------|--------|
| **Code Mod / AI Code Analyzer hardening** | Uncommitted changes on `main` in `src/lib/codeModification/*`, `scraper-service/.../code-mod-*.js`; recent commits through `da66200` | Active on `main`; local WIP not pushed |
| **Code Analyzer async v2** | Local branch `feat/code-analyzer-async-v2` (~10 commits, **not on remote**) | In progress; isolated from production `main` |
| **UCI Track A/B lifecycle** | Branches `feat/uci-track-ab-*` synced with remote; migrations through `20260820180000_uci_track_a_lifecycle.sql` | Feature branches merged or in review state; verify merge status vs `main` |
| **Lovable UI replication** | Branch `feat/lovable-ui-replication` (last activity 2026-08-05) | Stalled or parallel track; not on production path by default |
| **Remote branch `feat/stage2-load-profile-readiness`** | On origin only | Gas load / Stage 2 readiness work may not be on local checkout |

---

## 2. Features deployed but not yet documented

| Feature | Deployed evidence | Documentation gap |
|---------|-------------------|-------------------|
| Code Analyzer drawing upload + evidence pipeline | On `main`, Railway `da66200` | `docs/current-system-architecture.md` dated 2026-07-21 |
| Code Mod multi-document review | Migrations + services on `main` | No operator runbook |
| UCI operational snapshot API | Migrations `20260817100000_uci_operational_snapshot.sql` | Partial in action-items only |
| UCI Graph inbound poller | `uci-graph-inbound-poller.service.js`, starts with scraper | Not in README |
| QuickBooks production OAuth | `/api/quickbooks/status` → connected, production | No prior walkthrough doc (added in diligence bundle) |
| Scheduled checklist reports cron | Migration `20260805040000_scheduled_reports_cron_and_claim.sql` | Feature checklist in `docs/audits/` only |

---

## 3. Incomplete, prototype, or manually gated functionality

| Area | Gate / limitation | Reference |
|------|-------------------|-----------|
| UCI live PEPCO portal submission | `UCI_PEPCO_LIVE_SUBMISSION_ENABLED` default off | `.env.example`, action-items Stage 4 |
| UCI live email send | `UCI_EMAIL_LIVE_SUBMISSION_ENABLED` + allowlists | action-items Stage 4 |
| Dominion production package | No authoritative manifest; synthetic only | action-items Stage 3 |
| Engineering calculations (Stage 2) | Blocked on client QSR standards | action-items |
| Generated provider application PDF | Not implemented | action-items Stage 3 |
| Miss Utility 811 / Conflicts routes | UI shows "Not enabled" | action-items |
| PermitWizard / Pre-Flight | Implemented but jurisdiction-specific; live portal credentials required | `memory.md`, audits |
| Baltimore mock Accela UI | Mock only (`App.tsx` comment) | architecture audit |
| QB OAuth CSRF | TODO on state validation | `quickbooks.routes.js` |
| Feature flags | localStorage only | `useFeatureFlags.ts` |

---

## 4. What breaks or stalls first if development stopped

**Priority order (evidence-based):**

1. **Scraper/Playwright maintenance** — Portal UI changes break DC, PGC, Montgomery, Accela pipelines (`memory.md`, large scraper modules).
2. **Railway + Vercel env drift** — Wrong `VITE_API_BASE_URL` breaks all `/api/*` from frontend (`scraperBaseUrl.ts` dead-host guard).
3. **OAuth token refresh** — QuickBooks, Microsoft Graph, Stripe webhooks require living credentials and encryption keys.
4. **Supabase migrations not applied to production** — UCI submission tables noted as pending remote apply in action-items.
5. **UCI live submission gates** — Without ongoing work, system stays dry-run/synthetic; production utility coordination cannot complete end-to-end.
6. **Unpushed `feat/code-analyzer-async-v2`** — Async analyzer v2 work would be lost from org remote if local disk fails.

---

## 5. UCI prototype (explicit)

UCI (Utility Coordination Intelligence) is a **parallel lifecycle module** within PermitPilot for utility providers (electric, gas, water, telecom), distinct from municipal permit filing.

- **UI entry:** `/uci`, `src/pages/UciDashboard.tsx`
- **API:** `/api/uci/*` via `scraper-service/app/routes/uci.routes.js`
- **Stages:** 1–10 lifecycle (provider confirmation → closeout)
- **Production maturity:** Mixed — Stages 1–6 have substantial code; live external submission remains gated; Dominion production blocked

Authoritative status tracker: `docs/uci-action-items-status.md` (2026-08-19).

---

## 6. UCI mock-data pipeline location

| Asset / path | Role |
|--------------|------|
| `demo-assets/uci/dominion-electric-full-demo-v2.json` | Demo fixture data |
| `uci/application-templates/dominion/electric-new-service.synthetic-test.json` | Synthetic Dominion checklist template |
| `uci/load-templates/generic-qsr.json` | Load template (not production authority) |
| `scraper-service/fixtures/stage6-cos/` | Stage 6 COS test fixtures |
| `scraper-service/app/services/uci/uci-synthetic-checklist.service.js` | Synthetic checklist logic |
| `scraper-service/app/services/uci/uci-application-builder.service.js` | Loads `*.synthetic-test.json` when synthetic mode |
| `scraper-service/app/services/uci/uci-submission-validation.service.js` | `synthetic_test` flag handling |
| `scraper-service/app/services/uci/uci-document-fallback-processors.service.js` | Fallback processors for test docs |

**Highland Springs synthetic exercise:** Documented in action-items as test-only synthetic PDF set for Stage 2/3 UAT — not client-issued evidence.

---

## 7. UCI paths using mock, synthetic, seeded, or hardcoded data

| Path / feature | Data type |
|----------------|-----------|
| Dominion synthetic checklist (`checklist_mode=synthetic_test`) | Synthetic template + operator approval gate |
| `uci-submission-validation.service.js` — Dominion synthetic dry run | Validation-only; no external submit |
| `uci-graph-attachment-persist.service.js` | Synthetic banner on test attachments |
| `uci-equipment-tracker.service.js` | COS seed for equipment rows (`cos_seed`) |
| `uci-cos-analyst.service.js` / accepted values | Seeded accepted fields from COS |
| `uci-load-engine.service.js` / load templates | Template-driven calculations (blocked for production authority) |
| `uci-gas-document-parser.service.js` | Parses "Synthetic requested value" patterns in test PDFs |
| `uci-utility-contact.service.js` | Blocks `synthetic-utility.test` domains |
| `UciComingSoonPanel.tsx` | UI placeholder for unavailable features |
| PEPCO portal sync | Real portal path when credentials exist; otherwise blocked |

---

## 8. Impact if UCI development paused

| Still works | Degrades or stops |
|-------------|-------------------|
| Read-only project/coordination views with existing DB rows | New provider adapters (Dominion portal, etc.) |
| Synthetic/test UAT flows | Production live submission (already gated) |
| Graph poller for connected mailboxes (if scraper running) | Classifier accuracy certification without labeled samples |
| Manual cost/equipment entry (partial) | CIAC/QB passthrough automation maturity |
| PEPCO read-only harvest (with credentials) | Portal change resilience without maintenance |

---

## 9. Dependencies before UCI hardening with real client documents

1. **Authoritative Dominion** application requirements (forms, signatures, delivery channel)
2. **Approved QSR / load calculation standards** (diversity, kVA/kW rules)
3. **Signature / LOA policy** with verification method
4. **Live submission authorization** (operators, channels, rollback policy)
5. **Utility email routing** and Mail.Send consent per tenant
6. **Production Supabase migrations applied** (submission/transmission tables)
7. **OCR/Vision opt-in** (`UCI_DOCUMENT_VISION_ENABLED`, etc.) for scanned docs
8. **Territory datasets in Storage** (`UCI_TERRITORY_STORAGE_*`) for production geospatial resolution
9. **Labeled communication samples** for Stage 5 classifier certification
10. **Retention/backup policy** for utility documents (client ops)

---

## 10. UCI environment for document processing and storage

| Layer | Environment | Verified? |
|-------|-------------|-----------|
| Document upload (UI) | Supabase Storage bucket `project-documents` | **Inferred** from code |
| Document processing | Railway scraper (`uci-document-processing.service.js`) | **Verified** architecture |
| Database records | Supabase Postgres (`coordination_*`, `project_documents`, etc.) | **Verified** migrations |
| Graph attachments | Microsoft Graph → scraper persist → Storage | **Implemented**; requires connected mailbox |
| Production vs local | Production scraper on Railway; Supabase cloud project `eeqxyjrcldivtpikcpvk` | **Inferred** from config |

**Unresolved:** Whether all UCI migrations are applied on production Supabase (action-items notes pending migrations for transmission attempts).

---

## 11. Verified facts vs unresolved questions

### Verified

- UCI source code and docs are in `epermitarthouse-rgb/Epermit-main`
- Production Railway runs UCI API routes on `main` at commit `da66200`
- Synthetic and production paths are explicitly separated in code and action-items
- Live external submission flags default to **off**

### Unresolved (manual confirmation)

- Production Supabase migration lag vs repository
- Which UCI features are enabled via Railway production env vars (live flags)
- Client document ingestion workflow for replacing Highland Springs synthetic set
- Dominion vs PEPCO production operator sign-off status
