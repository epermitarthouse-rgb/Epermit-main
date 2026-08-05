# Audit: Permit Wizard agents 01–09

Date: 2026-08-04  
Scope: Intended vs current implementation for the 9-agent Permit Filing / Permit Wizard pipeline.  
Sources: `src/pages/PermitWizardFiling.tsx`, `FilingReviewPanel`, `StartFilingDialog`, `permitwizard-preflight`, `permitwizard-execute`, individual agent edge functions, migrations `20260307000003` / `20260307000004` / `20260308000002`.

## Status machine

```
create (StartFilingDialog)
  → permit_filings.filing_status = preflight
  → invoke permitwizard-preflight (agents 01→02∥03→04)

preflight outcomes:
  · license hard_stop          → failed
  · all 01–04 completed/escalated → awaiting_approval (+ approval_package)
  · any agent failed (non hard-stop) → stays preflight
  · otherwise                  → awaiting_approval

awaiting_approval
  → FilingReviewPanel (agent 05, UI)
      · approve → approved (+ agent_runs pre_submission_review)
                 → invoke permitwizard-execute
      · reject  → approval_decision=rejected (status not set to cancelled)

approved | filing | failed (retry)
  → permitwizard-execute sets filing
  → Agent 06 authentication (scraper login)
  → Agent 07 form_filing (scraper file; stops before submit)
  → Agent 08 submission_finalization (scraper submit)
      · scraper (legacy DC path) updates filing_status=submitted + application_id/confirmation_number/submitted_at
  → Agent 09 status_monitor (permit-status-monitor / DC Scout)
  · step failures → failed (checkpoint stored in approval_package)

submitted → Agent 09 can re-poll (portal status → under_review / approved / corrections / denied…)
cancelled — in CHECK constraint; no primary UI path sets it today
```

### DB statuses (`permit_filings.filing_status`)

`preflight` → `awaiting_approval` → `approved` → `filing` → `submitted` (or `failed` / `cancelled`)

### Agent run statuses (`agent_runs.status`)

`pending` | `running` | `completed` | `failed` | `escalated` | `waiting_human`

### Layers (`LAYER_LABELS`)

| Layer | Label | Agents |
|------:|-------|--------|
| 1 | Pre-Flight | 01–05 |
| 2 | Execution | 06–08 |
| 3 | Post-Submission | 09 |

---

## Agents 01–09 comparison

| # | Agent name | Layer | Intended function (exact — what inputs, what checks/actions, what outputs) | Current implementation status | Triggered by | Writes to DB / UI? | Gaps vs intended |
|---|------------|------:|-----------------------------------------------------------------------------|-------------------------------|--------------|--------------------|------------------|
| 01 | Property Intelligence (`property_intelligence`) | 1 Pre-Flight | **Inputs:** `filing_id`, `property_address`, `municipality_key`. **Actions:** Look up parcel/property intelligence by jurisdiction — DC Scout (zoning, overlays, historic, flood, active permits, stop-work); MD SDAT; VA county GIS. Flag advisories (`HISTORIC_DISTRICT`, `FLOOD_HAZARD_ZONE`, `NCPC_ZONE`, stop-work). Escalate when historic/flood/NCPC. **Outputs:** `property_intelligence` object + `escalation_required` / reasons; `agent_runs` row. | **Implemented** edge function `property-intelligence-agent`. DC Scout path is fullest; MD SDAT often HTML-degraded; VA returns stub (`PROPERTY_DATA_NOT_AVAILABLE`). | `permitwizard-preflight` step 1 (after `StartFilingDialog` creates filing + invokes preflight). | **DB:** `agent_runs`, `property_intelligence`. Bundled into `permit_filings.approval_package.property_intelligence`. **UI:** Agent task row + `PropertyIntelligenceCard` in review panel. | VA GIS not wired; MD structured parse limited; unknown municipality → advisory only. Escalation does not block advancing to `awaiting_approval` (treated as success by orchestrator). |
| 02 | License Validation (`license_validation`) | 1 Pre-Flight | **Inputs:** `filing_id`, `municipality_key`, `professionals[]` (name, license_type, license_number, role). **Actions:** Verify each license against jurisdiction source — DC DLCP (`verify.dcra.dc.gov`), MD DLLR, VA DPOR. Parse active/expired/not_found; expiration check. **Hard stop (DC only):** expediter role without `active` license blocks filing. **Outputs:** per-license results, `all_active`, `hard_stop` / reason, warnings; `agent_runs` + `license_validations` rows. | **Implemented** `license-validation-agent`. Source map covers 10 DMV munis. Live verify APIs are assumed JSON endpoints — often unavailable → `not_found` after retries. Empty professionals → **400**. Hard stop returns HTTP 422 + agent status `escalated`. | `permitwizard-preflight` step 2 (parallel with 03), using `filing_professionals` (or body fallback). | **DB:** `agent_runs`, `license_validations`. Package: `approval_package.license_validation`. **UI:** `LicenseValidationCard`. | Real board APIs may not match coded paths. Hard stop sets filing `failed` and skips human gate (panel has override UX that never sees hard-stop packages). Preflight maps HTTP 422 to agent summary `failed` even though agent returns `escalated`. Non-DC sources have no expediter hard stop. |
| 03 | Document Preparation (`document_preparation`) | 1 Pre-Flight | **Inputs:** `filing_id`, documents (`name`, `url`, `size_bytes`, `type`), `scope_of_work`, `property_type`, `review_track`, `municipality_key`. **Actions:** Validate format (PDF preferred; accept jpg/png/tiff/dwg/docx/…), size ≤100MB, naming; classify type (plan/cost_estimate/contract/eif/…). Checklist by residential vs commercial; EIF required if scope hits demolition/raze/excavation/hazardous/etc. ProjectDox → ordered upload manifest. **Outputs:** deficiencies, checklist_results, eif_status, validated document list; persist `filing_documents`. | **Implemented** `document-preparation-agent`. Always status `completed` even with deficiencies/invalids (no escalate/fail on missing required docs). `municipality_key` accepted by orchestrator but **unused** in agent. | `permitwizard-preflight` step 2 (parallel with 02). | **DB:** `agent_runs`; **re-inserts** into `filing_documents` (duplicates rows already inserted by StartFilingDialog). Package: `approval_package.document_preparation`. **UI:** `DocumentChecklistCard`. | No hard gate on missing required docs; checklist is generic (not municipality-specific); StartFilingDialog docs often lack `file_url` so prep validates metadata only; duplicate inserts; enhanced doc types from `20260308000002` not in agent's classify whitelist. |
| 04 | Permit Classifier (`permit_classifier`) | 1 Pre-Flight | **Inputs:** `filing_id`, `municipality_key`, `scope_of_work`, `property_type`, `construction_value`, `property_intelligence`. **Actions:** GPT-4o classifies permit type/subtype, review track, sister-agency reviews, fee estimate + breakdown, recommended description; confidence threshold 0.85 surfaces alternatives; validates against `municipality_configs.permit_types` / review tracks. **Outputs:** `classification` object; updates filing `permit_type`, `permit_subtype`, `review_track`, `estimated_fee`. | **Implemented** `permit-classifier-agent` (requires `OPENAI_API_KEY`). Municipality-aware prompts when config present; DC defaults otherwise. Low confidence does not escalate status. | `permitwizard-preflight` step 3 (after 01–03). | **DB:** `agent_runs`; updates `permit_filings` classification fields. Package: `approval_package.permit_classification`. **UI:** `PermitClassificationCard`. | Fee/sister-agency are LLM estimates, not schedule lookups. Failure defaults to residential/walk_through. Does not block on low confidence. |
| 05 | Human Review Gate (`pre_submission_review`) | 1 Pre-Flight | **Inputs:** Assembled `approval_package` + filing fields. **Actions:** Human reviews property/license/docs/classification; required notes; approve or reject. Approve unlocks Layer 2; reject stops portal work. Optionally acknowledge escalations / override hard stops. **Outputs:** `approval_decision`, `approved_by`, `approved_at`, `approval_notes`; `agent_runs` audit row; on approve → start execute. | **UI-only** in `FilingReviewPanel` (no edge function). Gate: `filing_status === 'awaiting_approval' && !approval_decision`. Approve → status `approved` + invoke `permitwizard-execute`. Reject → decision only (status stays `awaiting_approval`). | User clicks Approve/Reject when status is `awaiting_approval` (banner + Review panel on `PermitWizardFiling`). | **DB:** updates `permit_filings` decision fields; inserts `agent_runs` (`pre_submission_review`, completed). **UI:** full review cards + decision form. | Reject does not set `cancelled`/`failed`. Hard-stop filings never reach this gate (`failed` earlier). No waiting_human agent_run created while awaiting approval (UI banner only). Invoke execute errors are swallowed with toast warning. |
| 06 | Portal Authentication (`authentication`) | 2 Execution | **Inputs:** filing + `credential_id` or user’s `portal_credentials`; municipality portal config (type, base URL, login URL, SSO). **Actions:** Decrypt portal password; call scraper login (`/api/permitwizard/login` for legacy DC Accela, else `/api/filing/login`); handle captcha → wait human; return session token. **Outputs:** session token (prefix logged); `agent_runs` completed / failed / waiting_human. | **Implemented inline** in `permitwizard-execute` (`executeAuthentication`). Not a separate edge function. | `permitwizard-execute` after approve (or resume); allowed filing statuses: `approved`, `filing`, `failed`. | **DB:** `agent_runs`; sets `permit_filings.filing_status=filing` at pipeline start. On captcha/human: status `failed` + checkpoint in `approval_package`. **UI:** Layer 2 task row / AgentRunDetail. | Depends on scraper + stored credentials. Multi-portal login quality varies. Captcha path marks filing `failed` rather than a dedicated waiting state. |
| 07 | Form Filing (`form_filing`) | 2 Execution | **Inputs:** session token; filing fields; `filing_professionals`; `filing_documents`; portal config. **Actions:** Scraper fills portal application forms and uploads docs (`/api/permitwizard/file` or `/api/filing/file`); screenshot audit; stop before final submit; reauth up to 2× on session expiry. **Outputs:** steps_completed, screenshots_count, `stopped_before_submit`; `agent_runs`; optional `filing_screenshots`. | **Implemented inline** in `permitwizard-execute` (`executeFormFiling`). Scraper-side (e.g. `permitwizard-filer.js`) may also touch `permit_filings`. | After successful 06 in execute (or `resume_from=form_filing`). | **DB:** `agent_runs`; failure → `failed` + execution_checkpoint. Screenshots table exists; population depends on scraper. **UI:** agent log / screenshots in detail. | Coverage uneven across Accela/Momentum/ASP.NET/EnerGov. Reauth retry limited. Duplicate/incomplete document URLs from Layer 1 reduce fill quality. |
| 08 | Submission (`submission_finalization`) | 2 Execution | **Inputs:** session token; filing summary; portal config. **Actions:** Scraper clicks final submit (`/api/permitwizard/submit` or `/api/filing/submit`); extract application_id / confirmation_number; set `submitted_at`; logout session after. **Outputs:** confirmation fields; `agent_runs`; filing → `submitted`. | **Implemented inline** in `permitwizard-execute` (`executeSubmission`). Legacy DC scraper (`permitwizard-submit.js`) updates `permit_filings` to `submitted` with IDs. Execute itself returns `status: submitted` but **does not** call `updateFilingStatus(..., "submitted")` — relies on scraper DB write. | After successful 07 (or resume). | **DB:** `agent_runs`; scraper path writes `application_id`, `confirmation_number`, `submitted_at`, `filing_status=submitted`. Execute then SELECTs those fields. **UI:** submitted banner + IDs when present. | If non-legacy `/api/filing/submit` does not persist to Supabase, filing can remain `filing` despite success response. Execute does not write confirmation fields itself. |
| 09 | Status Monitor (`status_monitor`) | 3 Post-Submission | **Inputs:** `filing_id` and/or `project_id`; application_id / confirmation_number. **Actions:** Poll portal (intended per municipality) for review/issued/corrections/denied; detect ProjectDox; notify user on change; update filing/review_track as needed. **Outputs:** portal_status mapping; optional filing_status change; notifications; `agent_runs`. | **Implemented** `permit-status-monitor` (also invoked at end of execute). **DC Scout only** (`scout.dcra.dc.gov`); ignores municipality-specific portals. Queries filings with `filing_status=submitted`. Maps portal text → under_review / approved / corrections_needed / denied / etc.; may set filing to `submitted` or `failed`; may set `review_track=projectdox`. | (1) End of successful execute after 08; (2) direct invoke of `permit-status-monitor`. No cron visible in this audit. | **DB:** `agent_runs` (execute also creates a wrapping run; monitor may insert another); updates `permit_filings`; tries `notifications` insert. **UI:** post-submit section when status is `submitted`. | Non-DC jurisdictions unsupported. No continuous schedule in-repo. “Approved/issued” maps filing_status back to `submitted` (no distinct issued state). Consecutive agent_run rows possible (execute wrapper + monitor insert). |

---

## Orchestration map

| Orchestrator | Agents | Notes |
|--------------|--------|-------|
| `permitwizard-preflight` | 01 → (02 ∥ 03) → 04 | Builds `approval_package`; sets filing status. Does **not** create agent_runs itself (each agent does). |
| `FilingReviewPanel` (FE) | 05 | Human gate; invokes execute on approve. |
| `permitwizard-execute` | 06 → 07 → 08 → 09 | Inline 06–08 via scraper; 09 via edge function. Checkpoints / resume_from supported. |
| `permit-status-monitor` | 09 | Standalone re-check for submitted filings. |

## UI gates (`PermitWizardFiling`)

- Filing queue requires `selectedProjectId` and `filings.length > 0` (see also `docs/audits/permit-filing-preflight-and-jurisdictions.md`).
- Review banner when selected filing is `awaiting_approval`.
- Agent progress = completed `agent_runs` / 9.
- Active polling while status ∈ `preflight` | `filing`.
- Municipality filter over `municipality_configs` (+ hardcoded fallback list).

## Migrations (filing status / approval_package)

| Migration | Relevance |
|-----------|-----------|
| `20260307000003_permit_wizard_tables.sql` | `permit_filings` + status CHECK; `approval_package` JSONB; approval decision fields; `agent_runs` (9 agent names); `property_intelligence`, `license_validations`, `filing_documents`, `filing_screenshots`, `filing_professionals`. |
| `20260307000004_multi_municipality_support.sql` | `municipality` + `credential_id` on filings; `municipality_configs` seed (10 DMV); expanded `review_track`. |
| `20260308000002_filing_form_enhancements.sql` | Owner / sqft / stories columns; expanded `document_type` values. |

## Cross-cutting gaps

1. Preflight invoke failures in StartFilingDialog are swallowed; toast still says pipeline started.
2. License hard stop → `failed`, bypassing agent 05 despite override UI.
3. Agent 03 deficiencies do not block `awaiting_approval`.
4. Execute success path depends on scraper to persist `submitted`; edge function does not.
5. Agent 09 is DC-centric; Layer 1 property/license stubs for VA/MD degrade package quality.
6. No separate edge functions for 05–08 (05 UI; 06–08 execute-inline).
