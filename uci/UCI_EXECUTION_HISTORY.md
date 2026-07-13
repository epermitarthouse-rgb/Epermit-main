# UCI Execution History

**Status:** Historical archive — superseded for active planning.  
**Active roadmap:** `UCI_DELIVERY_ROADMAP.md`

This document condenses `uci_execution_sprints_and_phases.md` with honest completion markers against the codebase as of the documentation merge.

---

## Sprint Overview

| Sprint | Planned focus | Actual status | Notes |
|--------|---------------|---------------|-------|
| Sprint 1 | Safety + schema (Phases 0–1) | **Largely complete** | Encryption, UCI migration, RLS via `has_project_access` |
| Sprint 2 | Backend + settings (Phases 2–3, 5) | **Mostly complete** | Routes partial vs plan; init + transitions work |
| Sprint 3 | UCI dashboard (Phase 4, partial 9) | **Partial** | Basic UI; not full dashboard spec (no stage summary, action queue) |
| Sprint 4 | Portal discovery (Phase 6) | **PEPCO read-only only** | BGE not started |
| Sprint 5 | Application + submit (Phases 7–8) | **Not started** | |
| Sprint 6 | Hardening + demo (Phases 9–10) | **Not started** | |

---

## Sprint 1 — Safety + Schema

### Planned (Phase 0)

- Audit `/api/uci` auth → **Done** (`uci-access.service.js`)
- Encrypt `portal_credentials` → **Done** (per sprint prompts)
- Stop password echo in Settings UI → **Done**
- Reusable auth helper → **Done**

### Planned (Phase 1)

- Full UCI migration `20260509120000_uci_foundation.sql` → **Done**
- Seven tables + RLS → **Done**
- `tenant_id` nullable, project-scoped RLS → **Done as planned then**; tenant propagation deferred (now target in D1)

### Outdated assumptions from original plan

- "Full UCI schema does not exist yet" — **false today**
- "`/api/uci` auth is unknown" — **false today**

---

## Sprint 2 — Backend + Settings

### Planned

- Utility credential placeholders in Settings → **Done** (`PortalCredentialsManager.tsx`)
- `createUciRouter` + mount `/api/uci` → **Done**
- Provider list, project coordination, init, transition APIs → **Done**
- Application draft/review/submit routes → **Not implemented** (only `GET .../applications`)

### Route plan vs actual

| Planned route | Actual |
|---------------|--------|
| `GET /api/uci/providers` | ✅ |
| `GET /api/uci/projects/:id/coordination` | ✅ |
| `POST /api/uci/projects/:id/coordination/init` | ✅ |
| `GET /api/uci/coordination/:id` | ✅ |
| `POST /api/uci/coordination/:id/transition` | ✅ |
| `POST .../applications/draft` | ❌ |
| `POST .../applications/:id/review` | ❌ |
| `POST .../applications/:id/submit` | ❌ |
| `POST /api/uci/providers/:slug/discover` | ❌ (PEPCO-specific routes instead) |

### Provider seed

- 10 priority utilities in `utility_providers` → **Done** (`automation_status: placeholder`)

---

## Sprint 3 — UCI Dashboard

### Planned UI sections

| Section | Status |
|---------|--------|
| Header | ✅ |
| Provider setup status | ✅ (catalog cards) |
| Project coordination table | ✅ |
| Stage summary counts | ❌ |
| Risk summary (blocked/escalated) | ❌ |
| Action queue (draft/review/submit) | ❌ |
| Portfolio cards (P50/P90) | ❌ placeholder only |

### Planned lifecycle UI

| Feature | Status |
|---------|--------|
| Stage timeline | ❌ (stage number in table only) |
| Current state badge | ✅ |
| Transition history | ✅ (detail sheet) |
| Manual transition | ✅ |
| Block/escalate buttons | ❌ |

### Outdated UI banner

Original plan implied portal automation "not enabled." Code now has PEPCO read-only automation; banner text in `UciDashboard.tsx` is **stale** (fix planned in D1).

---

## Sprint 4 — Portal Discovery

### Planned

- Folder `scraper-service/uci/portals/pepco/` → **Never created**
- Actual: `scraper-service/scrapers/pepco/` + `app/services/uci/uci-pepco-*`
- PEPCO login + MFA → **Partial/working**
- BGE login + discovery → **Not started**
- Generic `POST /providers/:slug/discover` → **Not implemented**

### PEPCO capabilities delivered (beyond original Sprint 4 scope)

- Dashboard discovery (list API + DOM)
- Application detail scrape (overview, status, messages, documents)
- MFA code modal + Microsoft Graph auto-fetch
- Document download to Supabase `project-documents` (D1B) + optional dev local copy
- Normalized portal sync (D1A) — applications, communications, milestones
- `document_storage` reporting on scrape responses
- Metadata persistence

### BGE

**Not started.** Remains a future utility adapter unless client reprioritizes.

---

## Post-Sprint Delivery — D1A + D1B (2026-07)

| Milestone | Status | Key deliverables |
|-----------|--------|------------------|
| D1A — Normalized read-only | **Complete** | Adapters, `POST .../sync`, child table writes, `normalized_sync` visibility |
| D1B — Document storage | **Complete** | `uci-document-storage.service.js`; Supabase production path; idempotency; `document_storage` API field |
| D1C — Lifecycle mapping | **Complete** | `uci-lifecycle-mapping.service.js`; PEPCO adapter mapping; proposals + audit; UI visibility |
| D1D — Durable jobs | **Complete** | `uci_portal_sync` jobs, worker, sync-runs API, MFA job link |
| D2.0 — Human-assisted provider setup | **Complete** | `uci-provider-setup.service.js`; guided init UI; mapping metadata on coordination records |
| D2.1 — Load profile foundation | **Complete** (scoped) | `uci-load-profile.service.js`; `POST .../load-profile/analyze`; no-guess `load_summary`; drawer UI |
| D3 — Application preparation | **Complete** (scoped) | `uci-application-builder.service.js`; PEPCO template; review workflow; `ApplicationPrepSection` |
| D4 — Submission foundation | **Partial** | `uci-application-submit.service.js`; email_intent path; PEPCO adapter blocked (501) |

---

## Sprint 5 — Application + Real Submit

### Planned

- Application draft API → **Not started**
- Review/needs-changes API → **Not started**
- Submit API with safety gates → **Not started**
- PEPCO/BGE submission automation → **Not started**

---

## Sprint 6 — Hardening + Demo Readiness

### Planned demo flow

Steps 1–7 largely possible today (settings, `/uci`, init, PEPCO discovery).  
Steps 8–12 (draft, review, submit, confirmation, lifecycle from submission) → **Not possible** — not implemented.

### Planned tests

| Test area | Status |
|-----------|--------|
| Credential encryption | Partial (no dedicated UCI CI suite) |
| Auth / project access | Partial (manual verification) |
| PEPCO discovery | Partial (unit tests for parsing/session only) |
| D1A normalized sync | ✅ (unit + route tests) |
| D1B document storage | ✅ (`uci-document-storage.service.test.js`, PEPCO document tests) |
| D1C lifecycle mapping | ✅ (`uci-lifecycle-mapping.test.js`) |
| D1D durable portal sync jobs | ✅ (`uci-durable-jobs.test.js`) |
| D2.0 human-assisted provider setup | ✅ (`uci-provider-setup.test.js`) |
| D2.1 load profile foundation | ✅ (`uci-load-profile.test.js`, `uciLoadProfile.test.ts`) |
| D3 application preparation | ✅ (`uci-application-builder.test.js`, `uciApplicationPrep.test.ts`) |
| D4 submission foundation | ✅ (`uci-application-submit.test.js`) — PEPCO portal adapter not implemented |
| D5 communication classifier | ✅ (`uci-communication-classifier.test.js`) — keyword only |
| D6–D12 foundations | ✅ (`uci-d6-d12-foundation.test.js`) |
| Submission idempotency | ⚠️ Partial | `submitted_at` gate on D4 submit |
| Cross-tenant | ❌ |
| County scraper regression | Not UCI-specific |

---

## Non-Blocking Backlog Process

From 2026-07-14, every UCI milestone maintains a persistent non-blocking backlog in `UCI_DELIVERY_ROADMAP.md` §17. Post–D5–D12 review: 56 active backlog items, 3 client-deferred tracked, 2 resolved (NB-DOC-001, NB-DOC-002).

---

## Historical Build Order (Original)

```
security → schema → API → dashboard → discovery → submission → lifecycle hardening
```

**Actual progress stopped at:** dashboard + PEPCO read-only discovery (mid–Sprint 4 equivalent).

---

## Non-Negotiable Rules (Still Valid)

From original execution plan — still apply:

1. Do not submit without human review.
2. Do not allow duplicate submissions.
3. Do not log or return plaintext credentials.
4. Every stage change must create a transition audit row.
5. Do not refactor county scrapers as part of UCI.
6. Do not claim inbound email, QuickBooks CIAC, or ML prediction complete unless built.

---

## Files Referenced in Historical Plan

| Planned | Actual |
|---------|--------|
| `scraper-service/uci/portals/*` | `scraper-service/scrapers/pepco/` |
| `src/hooks/useUci.ts` | Not created; logic in `UciDashboard.tsx` + `uciApi.ts` |
| Application services beyond list | Not created |

---

*For forward planning, use `UCI_DELIVERY_ROADMAP.md` milestones D1–D13 and §17 non-blocking backlog.*
