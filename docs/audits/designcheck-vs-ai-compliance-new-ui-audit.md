# DesignCheck vs AI Compliance Analyzer — New UI Audit

**Date:** 2026-08-05  
**Repo:** `/Users/javerianaveed/epermit/Epermit-main`  
**Feat branch:** `feat/lovable-ui-replication` @ `f882f1d`  
**Main:** `main` @ `5199937`  
**Lovable reference:** `reference/lovable-ui`  
**Constraints:** Read-only audit. No code changes, migrations, deploy, push, merge, or analyzer replacement.

**Classification legend**

| Tag | Meaning |
|-----|---------|
| **Live** | Real query/API → real result; action works end-to-end |
| **Partial** | Real wiring with gaps (UX, persistence, scope, or dual backends) |
| **Mock** | Fabricated values presented as product data |
| **Static** | Hardcoded chrome/copy with no data path |
| **Broken** | Intended path fails or dead-ends |
| **Misleading** | Label/visual implies capability the data path does not support |
| **Unreachable** | Route/page exists in Lovable reference only; not mounted in PermitPilot |

---

## Executive verdict

**Stronger product to preserve: PermitPilot AI Compliance Analyzer (`/code-compliance` + Railway `POST /api/analyze-drawing` + `document_annotations` / `project_documents`).**

Lovable DesignCheck is a **visual/IA reference** with one partially connected analyzer and three fully mock companion pages. It must **not** replace the PermitPilot analyzer, findings persistence, project document upload, dual IBC/local analysis, or batch pipeline. Phase-0 already locked **PD-7: do not ship the fake 8-agent DesignCheck matrix**.

---

## Evidence sources

| Source | Path / ref |
|--------|------------|
| PP page (feat) | `src/pages/CodeCompliance.tsx` → `AIComplianceAnalyzer` |
| PP analyzer | `src/components/compliance/AIComplianceAnalyzer.tsx` |
| PP batch / limits | `src/lib/complianceBatchProcessor.ts`, `src/lib/complianceUploadLimits.ts` |
| PP PDF prep | `src/utils/pdfToImage.ts` |
| PP export | `src/lib/complianceReportPDF.ts` |
| PP Railway API | `scraper-service/app/register-execution-routes.js` (`POST /api/analyze-drawing`) |
| PP analysis service | `scraper-service/app/services/compliance/analyze-drawing.service.js` |
| PP edge (legacy/parallel) | `supabase/functions/analyze-drawing/index.ts` + `supabase/config.toml` (`verify_jwt = false`) |
| PP nav (feat) | `src/components/layout/hybridNav.ts` → Intelligence › Code Compliance Analyzer |
| PP nav (main) | `git show main:src/components/layout/AppSidebar.tsx` → “AI Compliance” → `/code-compliance` |
| PP routes | `src/App.tsx` — only `/code-compliance` |
| Tables / storage | `document_annotations`, `project_documents`, bucket `project-documents` |
| Lovable overview | `reference/lovable-ui/src/pages/Compliance.tsx` |
| Lovable analyzer | `reference/lovable-ui/src/pages/ComplianceAnalyzer.tsx` |
| Lovable intelligence | `reference/lovable-ui/src/pages/ComplianceIntelligence.tsx` |
| Lovable prescreen | `reference/lovable-ui/src/pages/InternalPrescreen.tsx` |
| Lovable edge | `reference/lovable-ui/supabase/functions/analyze-compliance-drawings/index.ts` |
| Prior matrix | `reference/lovable-ui/lovable-permitpilot-architecture-matrix.md` L029–L032 |
| Phase-0 lock | `docs/lovable-ui-phase0-baseline.md` PD-7 |
| Demo-route badges | `src/components/permitpilot/demo-routes.ts` (lists Lovable paths; PP does not mount them) |

---

## 1. Inventory — DesignCheck / Compliance on feat + main

### 1.1 Reachability matrix

| Surface | Lovable route | Lovable status | Feat PP | Main PP | Reachable in PP? |
|---------|---------------|----------------|---------|---------|------------------|
| DesignCheck overview (8-agent matrix) | `/compliance` | **Mock** | Not mounted | Not mounted | **No** (`Unreachable`) |
| Code Analyzer | `/compliance/analyzer` | **Partial** (edge AI + local presets; seed findings on load) | Not mounted as route; functional equivalent is `/code-compliance` | Same | Lovable path **No**; PP analyzer **Yes** at `/code-compliance` |
| Compliance Intelligence scoring | `/compliance/intelligence` | **Mock** | Not mounted | Not mounted | **No** |
| Internal Prescreen | `/compliance/prescreen` | **Mock** | Not mounted | Not mounted | **No** |
| AI Code Compliance Analyzer | — | — | `/code-compliance` **Live** (assist path) | `/code-compliance` **Live** | **Yes** (auth-gated shell) |

**Feat vs main for the live surface**

| Aspect | Main | Feat (`feat/lovable-ui-replication`) |
|--------|------|--------------------------------------|
| Route | `/code-compliance` | Same |
| Page shell | `EditorialPageHeader`, cream canvas | `PageHeader` + `ServicePill` (Lovable chrome tokens) |
| Core component | `AIComplianceAnalyzer` | Same component (evolved; batch/upload limits + ProductPrimitives) |
| Sidebar label | “AI Compliance” (`AppSidebar`) | “Code Compliance Analyzer” (`hybridNav` Intelligence group) |
| Backend path | Railway `/api/analyze-drawing` (+ edge exists) | Same |
| Functional replacement by Lovable pages? | No | No — Lovable `/compliance*` routes are **not** registered in `src/App.tsx` |

**Note:** `demo-routes.ts` treats `/compliance/analyzer` and `/code-compliance` as real/reference (no demo badge) and `/compliance` prefix as fabricated. That is a **badge taxonomy** for future/demo surfaces, not proof that `/compliance*` is mounted in PermitPilot.

### 1.2 Frontend (PermitPilot)

| Asset | Role |
|-------|------|
| `src/pages/CodeCompliance.tsx` | Route page; Getting Started `check_compliance`; ErrorBoundary around analyzer |
| `src/components/compliance/AIComplianceAnalyzer.tsx` | Upload, project select/create, document upload, batch analyze, dual IBC/local, accept/modify/reject UI, load prior analysis, PDF/JSON export, links to Code Reference + Response Matrix |
| `src/lib/complianceBatchProcessor.ts` | Sequential per-file prepare → upload → analyze |
| `src/lib/complianceUploadLimits.ts` | Max **8** files/batch |
| `src/types/document.ts` | `MAX_FILE_SIZE_MB = 250` (storage/project-doc limit used by analyzer toasts) |
| Command palette / header / recently used | All deep-link `/code-compliance` |

### 1.3 Backend / edge

| Endpoint | Location | Auth | Used by live FE? |
|----------|----------|------|------------------|
| `POST /api/analyze-drawing` | Railway scraper (`register-execution-routes.js`) | Requires `Authorization: Bearer <JWT>`; validates via `supabase.auth.getUser(token)` | **Yes** (`getScraperBaseUrl()` + session token) |
| Analysis implementation | `analyze-drawing.service.js` | N/A (service) | Yes |
| `POST /functions/v1/analyze-drawing` | `supabase/functions/analyze-drawing` | Gateway `verify_jwt = false`; **no in-function JWT check** | **Not** called by current `AIComplianceAnalyzer` (legacy/parallel risk) |
| Lovable `analyze-compliance-drawings` | Reference-only edge | No JWT verification in function body; uses `LOVABLE_API_KEY` → Lovable AI gateway (Gemini) | Not in PP runtime |

Related PP agents (prescreen-adjacent, **not** wired to a DesignCheck UI):

- `supabase/functions/validate-completeness-agent`
- `supabase/functions/guardian-quality-agent`
- `supabase/functions/license-validation-agent`
- Document ingestion: `ingest-project-document` / `document-ingestion-worker` (broader docs pipeline)

### 1.4 Tables / storage

| Object | Role in compliance |
|--------|--------------------|
| `project_documents` | Uploaded drawings when a project is selected; RLS via project access |
| Storage bucket `project-documents` | File bytes (limit raised to 250MB in migrations) |
| `document_annotations` | Persists AI findings as `annotation_type: "text"` rows with JSONB `data` flags `compliance_issue` / `compliance_metadata`; RLS via `has_project_access` |
| `projects` | Optional project linkage + create-from-analyzer |
| No dedicated `compliance_runs` / `compliance_findings` tables | Findings piggyback on annotations |

### 1.5 What’s reachable today (feat)

1. Sidebar / command palette / Getting Started → **`/code-compliance`**.
2. Authenticated user can upload PNG/JPEG/WebP/PDF, batch up to 8, analyze via Railway, optionally bind to project + persist findings, export PDF/JSON, accept/modify/reject in-session.
3. Lovable `/compliance`, `/compliance/analyzer`, `/compliance/intelligence`, `/compliance/prescreen` → **not reachable** in PermitPilot App routes.
4. Direct URLs to those Lovable paths in PP would 404 / fall through (not registered).

---

## 2. Field / action comparison matrix

### 2.1 Inputs & configuration

| Field / action | Lovable DesignCheck / Analyzer | PermitPilot AI Compliance | Stronger to preserve |
|----------------|--------------------------------|---------------------------|----------------------|
| Route / IA | Split: overview + analyzer + intelligence + prescreen | Single primary `/code-compliance` | **PP** (one primary feature; PD-7 / L029–L031) |
| File types | PNG / JPEG / WebP / PDF | Same | Tie (same set) |
| Max files | **6** | **8** (`COMPLIANCE_MAX_BATCH_FILES`) | **PP** (higher batch) |
| Max size | **15MB**/file | **250MB**/file (project-doc limit; practical API payload still constrained by base64/gateway) | **PP** for storage path; both need payload realism |
| Project select | Active-project state + localStorage; **not** DB analysis bind | Real `useProjects` select/create; optional save to project | **PP** |
| Jurisdiction | Grouped taxonomy combobox (`compliance-taxonomy.ts`) | Select list + local-amendment jurisdictions | Lovable UX nicer; **PP** data path + amendment prompts stronger |
| Project type | Grouped taxonomy | Select list (commercial/industrial/specialty, etc.) | Lovable UX; **PP** wired to API |
| Code year | Taxonomy + default-by-jurisdiction | Select years | Tie / Lovable UX polish |
| HVHZ flag | Yes (Florida HVHZ) | Implicit via FL / Miami-Dade amendment prompts | Lovable explicit toggle is a **UI borrow candidate** |
| Discipline per file | No | Yes (`DocumentDiscipline`) | **PP** |
| Analysis mode | Single multi-file invoke | `both` / `ibc` / `local` dual-pass | **PP** |
| Local presets | **localStorage** presets + notes (≤500) | None (session form state) | Do **not** copy localStorage as source of truth; optional later DB presets |
| Seed / demo findings | **SEED_FINDINGS** shown before run | Empty until analyze / load existing | **PP** (no fake findings) |

### 2.2 Analysis & results

| Field / action | Lovable | PermitPilot | Stronger |
|----------------|---------|-------------|----------|
| AI backend | `analyze-compliance-drawings` → Lovable gateway / Gemini | Railway OpenAI via `analyzeDrawingWithOpenAI` + jurisdiction amendment prompts | **PP** (production path, richer jurisdiction context) |
| PDF handling | Send PDF data URL to gateway | Convert **first page → image** client-side, then analyze | Different strategies; **PP** path is known-working assist |
| Findings model | severity / code / title / page / suggestion | category, title, description, severity, codeReference, location, suggestedFix, summary scores, jurisdictionNotes | **PP** (richer) |
| Overall score | Mock Intelligence page only | Computed `overallScore` on live results | **PP** (live, finding-derived) |
| Persist findings | **No DB** | `document_annotations` + `project_documents` | **PP** |
| Load prior analysis | No | Yes (docs with compliance annotations) | **PP** |
| Accept / modify / reject | Edit notes locally; no formal workflow | In-session Accept / Reject / Modify dialog | **PP** (still session-only for responses — see gaps) |
| Export | PDF + **CSV** | PDF + **JSON** | Borrow CSV from Lovable; keep PP PDF |
| Annotations (spatial) | No | Uses annotation table but as finding JSON, not canvas redlines | **PP** persistence model; canvas markup is separate domain |
| Document versioning | No | `project_documents.version` / parent_document_id exist | **PP** (doc versioning available; analyzer doesn’t expose full version UI) |
| RM / Filing handoff | None | Soft links to `/response-matrix` + `/code-reference` only | **PP** slightly ahead; **neither** has finding→RM/Filing structured handoff |
| 8-agent matrix | Mock overview | Not shipped (PD-7) | **PP** (correctly omitted) |
| Intelligence scoring dashboard | Mock gauge / confidence | No separate page; summary metrics on analyzer | Defer mock; **PP** summary is honest |
| Internal prescreen UI | Mock checklist | No UI; validation agents exist backend-only | Defer UI; preserve agents |

### 2.3 What PermitPilot must preserve (non-negotiable)

1. `AIComplianceAnalyzer` → Railway `POST /api/analyze-drawing` with user JWT.
2. Optional project linkage, `uploadDocument` → `project-documents` / `project_documents`.
3. Persist/load via `document_annotations` compliance JSON shapes.
4. Dual IBC / local amendment analysis mode.
5. Batch processor + upload limits/tests.
6. ErrorBoundary on `/code-compliance`.
7. Getting Started / nav / command-palette entry points.
8. No replacement by Lovable mock overview, intelligence, or prescreen pages.
9. No swap of OpenAI/Railway path for Lovable Gemini gateway in production without an explicit product/security decision.

### 2.4 What Lovable can contribute (visual / UX only)

- Cleaner upload dropzone / results list chrome.
- Grouped jurisdiction / project-type comboboxes + HVHZ affordance.
- CSV export pattern (`exportFindingsCsv`).
- Preset *UX* (if later persisted in Supabase — not localStorage).
- Optional overview **band** fed only by real counts (L029) — never fake agent matrix.

---

## 3. New UI status classification & answers

### 3.1 Classification by surface

| Surface | Classification | Notes |
|---------|----------------|-------|
| Feat `/code-compliance` shell | **Live** chrome + **Live** analyzer | Header restyled; analyzer functional |
| Feat analyzer upload/analyze | **Live** | Railway path |
| Feat project save / load prior | **Live** / **Partial** | Live when project selected; responses not DB-persisted |
| Feat accept/modify/reject | **Partial** | Session state; exportable; not reloaded from DB |
| Feat RM/Filing handoff | **Partial** / weak | Navigate links only |
| Feat `/compliance*` Lovable pages | **Unreachable** | Not in `App.tsx` |
| Lovable `/compliance` | **Mock** | Hardcoded agents + “37 comments reconciled” |
| Lovable `/compliance/analyzer` | **Partial** | Real edge invoke possible; seeds + localStorage presets; no DB |
| Lovable `/compliance/intelligence` | **Mock** | Hardcoded score 91.5 / findings |
| Lovable `/compliance/prescreen` | **Mock** | Hardcoded checklist |
| Legacy PP edge `analyze-drawing` | **Live capability** / **security Partial–Broken** | Exists with JWT gateway disabled |

### 3.2 Clear answers to product questions

| Question | Answer |
|----------|--------|
| Is Lovable DesignCheck the product we should ship? | **No.** Use it as visual reference only. |
| Is PermitPilot’s analyzer stronger? | **Yes** — project linkage, persistence, dual-code analysis, batch pipeline, JWT-gated Railway API, richer finding model. |
| Should we mount `/compliance`, `/intelligence`, `/prescreen` on feat? | **No** until real backends exist. PD-7 forbids fake 8-agent matrix. Intelligence/prescreen need models (L030/L032). |
| Should `/compliance/analyzer` replace `/code-compliance`? | **No.** Fold any desired UX into `/code-compliance` (L031). Keep PP path; optional alias later only after parity. |
| Can we adopt Lovable’s edge function? | **No** for production replacement. Different model/gateway, no JWT in function body, no PP persistence contract. |
| Is the New UI already “DesignCheck”? | **No.** Feat only restyles the PP analyzer page; DesignCheck brand/matrix is not a live feature. |
| Are demo-route entries for `/compliance` evidence of a shipped feature? | **No.** Badge taxonomy only; routes not mounted. |
| First safe UI work after approval? | Visual alignment on `/code-compliance` **around** `AIComplianceAnalyzer` — no route split, no mock matrix, no backend swap. |

---

## 4. Recommended product structure

### 4.1 One primary feature

**Primary:** **Code Compliance Analyzer** at `/code-compliance`  
**Nav label (feat):** “Code Compliance Analyzer” (Intelligence group)  
**Optional marketing alias:** “DesignCheck” only if client insists — **do not** imply an 8-agent live matrix (PD-7).

### 4.2 Preserve PermitPilot backend

| Keep | Do not adopt as production truth |
|------|----------------------------------|
| Railway `/api/analyze-drawing` + `analyze-drawing.service.js` | Lovable `analyze-compliance-drawings` / Gemini gateway |
| `document_annotations` + `project_documents` + `project-documents` bucket | localStorage presets as system of record |
| Dual IBC/local + batch processor | Seed findings / mock Intelligence scores |
| Validation agents (backend) | Mock Internal Prescreen checklist UI |

### 4.3 Companion surfaces (deferred)

| Surface | Decision |
|---------|----------|
| DesignCheck overview (`/compliance`) | **Do not ship mock.** Optional future summary band on `/code-compliance` using real annotation aggregates. |
| Compliance Intelligence | **Defer** until scoring methodology + schema exist. |
| Internal Prescreen | **Defer** UI; optionally later surface real validation-agent outputs. |
| Route aliases (`/compliance/analyzer` → `/code-compliance`) | Only after UX parity; low priority (PD-12). |

### 4.4 Label guidance

- Default product name in app: **Code Compliance Analyzer** / **AI Code Compliance**.
- Avoid sidebar badge “8” (Lovable fake agent count).
- “DesignCheck™” may appear in marketing copy; must not imply live multi-agent orchestration.

---

## 5. Phased plan (A–E)

### Phase A — Lock & harden (no UX expansion)

- Confirm single primary route remains `/code-compliance`.
- Document dual-backend risk: Railway (used) vs edge `analyze-drawing` (`verify_jwt = false`).
- Security follow-ups (see §6): enable JWT on edge or disable/remove public edge path; never ship Lovable JWT-less analyzer into PP.
- Smoke: upload → analyze → optional project save → load prior → export.
- **No** mounting of Lovable mock pages.

### Phase B — Visual alignment only (approved New UI work)

- Restyle upload / results / metric cards using Lovable analyzer patterns.
- Optionally adopt grouped jurisdiction/project-type combobox + HVHZ toggle **wired to existing PP request body**.
- Add CSV export alongside PDF/JSON.
- Keep `AIComplianceAnalyzer` logic, hooks, and API contract intact.
- Acceptance: E2E assist path unchanged; no mock findings.

### Phase C — Workflow depth (product decision required)

- Persist accept/modify/reject responses (extend annotation JSON or dedicated columns — **migration only if explicitly approved**).
- Stronger handoff: selected findings → Response Matrix / Comment Review (structured, not just a link).
- Optional Supabase-backed presets (replace localStorage idea).

### Phase D — Overview honesty (optional)

- If an “overview” band is desired: aggregate critical/warning/advisory counts from `document_annotations` for selected/portfolio projects.
- Still **no** fake 8-agent matrix.

### Phase E — Deferred domains

- Compliance Intelligence scoring model + UI.
- Internal Prescreen review queue (assignment, state) over existing validation agents.
- Full multi-page PDF page-by-page analysis (PP currently first-page image).
- Finding-level Filing / RM packet generation.

**Do not start Phase E or mock Phases D–E without backend design approval.**

---

## 6. Security audit

### 6.1 Findings

| ID | Severity | Finding | Evidence | Recommendation |
|----|----------|---------|----------|----------------|
| S1 | **High** | PP Supabase edge `analyze-drawing` has `verify_jwt = false` and **no** `auth.getUser` in the function | `supabase/config.toml`; `supabase/functions/analyze-drawing/index.ts` | Turn `verify_jwt` on **or** add explicit JWT validation + rate limits; or unpublish/disable the edge if Railway is sole path |
| S2 | **High** (reference) | Lovable `analyze-compliance-drawings` has **no JWT check** in body; anyone who can invoke the function can spend AI credits | `reference/lovable-ui/supabase/functions/analyze-compliance-drawings/index.ts` | Do **not** port as-is; if ever used, require JWT + per-user quotas |
| S3 | **Medium** | FE attaches Bearer only when session exists; missing token → Railway 401 (good), but edge path remains a bypass if discoverable | `AIComplianceAnalyzer` `requestDrawingAnalysis` | Ensure production FE never points at JWT-less edge; lock CORS/gateway |
| S4 | **Medium** | Large base64 image payloads → cost/DoS on OpenAI; batch amplifies | Batch up to 8; 250MB file picker vs 15MB Lovable | Align client size limits with API reality; server-side payload caps |
| S5 | **Low–Med** | CORS on edge `Access-Control-Allow-Origin: *` with JWT off increases abuse surface | edge `corsHeaders` | Restrict origin when tightening auth |
| S6 | **Low** | Analysis results stored in `document_annotations` under generic `text` type; RLS relies on project access | migration + analyzer inserts | Acceptable; avoid service-role client writes from browser |
| S7 | **Info** | Railway path validates JWT when Supabase env present (process exits if URL/key missing) | `register-execution-routes.js` | Keep Railway as authenticated production path |
| S8 | **Info** | Shared Railway `development` → production Supabase (workspace rule) | env reality | Demo accounts only; no destructive live submissions |

### 6.2 JWT-less endpoint risk (explicit)

**Yes — a JWT-less (or JWT-disabled) analyze endpoint is a real risk in this repo.**

1. **PermitPilot edge:** `analyze-drawing` is configured with `verify_jwt = false` and performs no bearer validation before calling OpenAI. A caller with the project URL + anon key (public in the SPA) can potentially burn `OPENAI_API_KEY` credits.
2. **Lovable reference edge:** `analyze-compliance-drawings` likewise lacks in-function auth; it only checks `LOVABLE_API_KEY` server-side for the upstream gateway.
3. **Live FE path is better:** current analyzer uses Railway `/api/analyze-drawing`, which **requires** a Bearer token and validates it with `supabase.auth.getUser`.
4. **Audit implication:** New UI work must **not** reintroduce a JWT-less public analyze call. Security hardening of the edge function is a Phase A item, independent of Lovable visual alignment.

---

## 7. Full required output sections

### 7.1 Scope & constraints (restated)

- Audit only; write path: `docs/audits/designcheck-vs-ai-compliance-new-ui-audit.md`.
- No code changes, migrations, deploy, push, merge, or analyzer replacement.
- Lovable = visual/UX reference; PermitPilot = functional source of truth.

### 7.2 Lovable product reference (as provided / verified)

| Route | Status (user + code) | Notes |
|-------|---------------------|-------|
| `/compliance` | Fully mock overview | 8-agent matrix, fake progress, fake comment reconciliation |
| `/compliance/analyzer` | Partial — only real analyzer | PNG/JPEG/WebP/PDF, max 6, 15MB, jurisdiction/type/year, AI findings, PDF/CSV, local presets; **no** DB persistence, project linkage, finding workflow, annotations, versioning, RM/Filing handoff |
| `/compliance/intelligence` | Fully mock scoring | Hardcoded readiness score / findings |
| `/compliance/prescreen` | Fully mock internal prescreen | Hardcoded checklist |

### 7.3 PermitPilot product reference (verified)

| Item | Value |
|------|-------|
| Route | `/code-compliance` |
| Component | `AIComplianceAnalyzer` |
| API | `POST {scraper}/api/analyze-drawing` |
| Persistence | `project_documents` + `document_annotations` |
| Limits | 8 files; types PNG/JPEG/WebP/PDF; size gated by 250MB project-doc constant |
| Workflow | Dual IBC/local; accept/modify/reject (session); PDF/JSON export; load prior |
| Handoff | Links to Response Matrix / Code Reference only |

### 7.4 Gap summary (Lovable → PP)

| Lovable claim | PP gap / reality |
|---------------|------------------|
| DesignCheck 8 agents | Intentionally **not** shipped (PD-7) |
| Intelligence scoring | No dedicated model/UI |
| Internal prescreen UI | Agents exist; no staff review UI |
| CSV export | PP has PDF/JSON only |
| Local presets | PP has none (prefer future DB) |
| Multi-file native PDF to model | PP rasterizes first page |
| Split IA routes | PP correctly consolidates |

| PP strength | Lovable gap |
|-------------|-------------|
| DB persistence + project docs | None |
| JWT-gated Railway analyze | Edge/reference JWT-less |
| Dual code analysis | Single pass |
| Batch 8 + discipline | Max 6, no discipline |
| Load existing analysis | None |
| Finding response workflow (session) | Notes/presets only |

### 7.5 Fake-backend / Misleading risks if naïvely replicated

- Shipping `/compliance` agent matrix → **Misleading** live product (PD-7 violation).
- Shipping Intelligence gauge with hardcoded 91.5 → **Mock** presented as readiness.
- Mounting Lovable analyzer with SEED_FINDINGS → users see fake violations before any upload.
- localStorage presets implying org-wide standards → **Misleading** multi-user behavior.
- Replacing Railway analyze with Lovable gateway → auth/cost/contract regression.

### 7.6 Acceptance criteria (for any future approved UI phase)

1. `/code-compliance` remains the only primary compliance nav target.
2. Analyze still calls Railway with user JWT; 401 without auth.
3. With project selected: upload creates `project_documents`; findings land in `document_annotations`; reload works.
4. No seed/mock findings in the default empty state.
5. No 8-agent fake matrix.
6. Export still works; CSV optional add-on must use real findings.
7. Tests for upload limits / batch processor remain green.
8. No new migrations unless explicitly approved.

### 7.7 Test / smoke checklist (manual, demo account)

- [ ] Open `/code-compliance` from Intelligence sidebar.
- [ ] Upload 1 PNG and 1 PDF; confirm batch statuses.
- [ ] Run IBC-only and both modes on a jurisdiction with amendments (e.g. DC).
- [ ] Select project → analyze → confirm document + annotations rows.
- [ ] Load existing analysis for that document.
- [ ] Accept / modify one finding; export PDF + JSON; confirm session responses in export.
- [ ] Confirm `/compliance`, `/compliance/intelligence`, `/compliance/prescreen` are not linked in PP nav.
- [ ] Confirm unauthenticated analyze call fails (401).

### 7.8 Out of scope / non-goals

- Replacing OpenAI Railway analyzer with Lovable Gemini function.
- Implementing Compliance Intelligence scoring.
- Building Internal Prescreen queue UI.
- Migrations / RLS redesign.
- Deploy, push, merge to `main`.
- Adopting “DesignCheck” as a second parallel product surface.

### 7.9 Decision log (recommended)

| Decision | Recommendation | Owner |
|----------|----------------|-------|
| Primary route | Keep `/code-compliance` | Product (locked by matrix L029/L031) |
| Mock DesignCheck matrix | Never ship | PD-7 |
| Lovable edge port | Reject | Eng + Security |
| Edge JWT hardening | Phase A | Eng |
| CSV + combobox UX | Phase B | Eng |
| Persist finding responses | Phase C | Product |
| Intelligence / Prescreen | Phase E / backlog | Product |

### 7.10 First task after approval

**Phase B kickoff (visual only):** Align `/code-compliance` upload panel + findings list chrome with Lovable `ComplianceAnalyzer` styling **without** changing the analyze API, persistence, or mounting any `/compliance*` mock routes. Optionally add CSV export and HVHZ/grouped taxonomy controls bound to the existing Railway request body.

---

## Appendix A — File index (absolute)

| Role | Path |
|------|------|
| Audit (this file) | `/Users/javerianaveed/epermit/Epermit-main/docs/audits/designcheck-vs-ai-compliance-new-ui-audit.md` |
| PP page | `/Users/javerianaveed/epermit/Epermit-main/src/pages/CodeCompliance.tsx` |
| PP analyzer | `/Users/javerianaveed/epermit/Epermit-main/src/components/compliance/AIComplianceAnalyzer.tsx` |
| Railway route | `/Users/javerianaveed/epermit/Epermit-main/scraper-service/app/register-execution-routes.js` |
| Analysis service | `/Users/javerianaveed/epermit/Epermit-main/scraper-service/app/services/compliance/analyze-drawing.service.js` |
| Edge (JWT-off) | `/Users/javerianaveed/epermit/Epermit-main/supabase/functions/analyze-drawing/index.ts` |
| Lovable analyzer | `/Users/javerianaveed/epermit/Epermit-main/reference/lovable-ui/src/pages/ComplianceAnalyzer.tsx` |
| Lovable overview | `/Users/javerianaveed/epermit/Epermit-main/reference/lovable-ui/src/pages/Compliance.tsx` |
| Lovable edge | `/Users/javerianaveed/epermit/Epermit-main/reference/lovable-ui/supabase/functions/analyze-compliance-drawings/index.ts` |

## Appendix B — Commit refs

| Branch | Short SHA |
|--------|-----------|
| `feat/lovable-ui-replication` | `f882f1d` |
| `main` | `5199937` |
