# UCI Module — Complete Audit Checklist

This checklist is based on the **Utility Coordination Intelligence (UCI) Module — Integration Specification**. Use it later to verify whether the implementation meets the client’s requirements, what is complete, what is partial, what is missing, and what is deferred.

---

## 0. Audit Legend

| Status | Meaning |
|---|---|
| ✅ Pass | Requirement fully implemented and tested |
| ⚠️ Partial | Some work done, but not complete |
| ❌ Missing | Not implemented |
| 🚫 Deferred | Document says Phase 4/5 or not required for pilot |
| 🔍 Verify | Need codebase/client confirmation |
| 🧪 Needs Test | Built but not properly tested |

---

# 1. Product Vision / Scope Alignment Checklist

| # | Requirement | Audit Question | Evidence Needed | Status |
|---|---|---|---|---|
| 1.1 | UCI exists as a separate PermitPilot module | Is there a clear UCI module/route/service area separate from municipal permit scrapers? | `/uci` backend routes/services, DB tables, feature entry point |  |
| 1.2 | UCI is not treated as normal county scraper | Does implementation distinguish utility portals from permit portals? | Utility-specific models, naming, provider records |  |
| 1.3 | UCI supports utility coordination lifecycle | Does system track provider → load → application → submission → acknowledgment → COS → cost → equipment → meter → energization? | Lifecycle records/stages in DB/UI/API |  |
| 1.4 | Human coordinator is still in loop | Are human review/escalation points present instead of fully autonomous dangerous actions? | Review status, manual transition, human attention queues |  |
| 1.5 | Routine work automated | Does UCI reduce manual tracking of portals, emails, deadlines, documents? | Agents, cron jobs, communication parser, portal workers |  |
| 1.6 | Strategic decisions remain human | Are risky states surfaced instead of auto-decided? | `needs_human_attention`, escalated states, review screens |  |
| 1.7 | UCI integrates into existing PermitPilot | Does it reuse existing auth, tenants, projects, workers, storage, settings, logs? | Code references existing infra, no duplicate platform architecture |  |
| 1.8 | McDonald’s pilot alignment | Is the pilot scope focused on Phase 1–3, not Phase 4–5 sophistication? | Roadmap, tickets, implemented features tagged by phase |  |

---

# 2. Architecture Checklist

| # | Requirement | Audit Question | Evidence Needed | Status |
|---|---|---|---|---|
| 2.1 | Uses existing PermitPilot backend conventions | Were current route/service patterns reused? | Files placed under current backend structure |  |
| 2.2 | Uses existing project model | Are UCI records linked to existing `projects` table? | `project_id` FK or equivalent |  |
| 2.3 | Uses existing tenant model | Does every UCI record carry tenant ownership? | `tenant_id` fields and RLS policies |  |
| 2.4 | Uses existing user model | Are reviewed/submitted actions linked to existing users? | `submitted_by`, `reviewed_by`, audit user IDs |  |
| 2.5 | Uses shared agent runtime | Are agents queued/executed through existing worker system? | BullMQ/Inngest/Temporal/etc. integration |  |
| 2.6 | Does not create separate new runtime unnecessarily | No isolated custom queue/event system unless existing app uses it | Code audit |  |
| 2.7 | Stateless agents | Agents read DB → act → write DB → exit | No persistent in-memory workflow state |  |
| 2.8 | State stored in Postgres | Lifecycle state is persisted in tables, not local cache | DB records |  |
| 2.9 | Redis/queue state used only for jobs | Runtime queue does not become source of truth | Worker/job design |  |
| 2.10 | Object storage used for documents/artifacts | Application docs, screenshots, closeout packages stored properly | Supabase/storage bucket/object refs |  |
| 2.11 | Existing Playwright infra reused | UCI portal scripts follow current scraper worker patterns | Playwright worker code |  |
| 2.12 | Existing outbound email service reused | UCI emails use current transactional email mechanism | Email service references |  |
| 2.13 | Existing inbound email pattern reused/extended | UCI inbound messages do not duplicate email infra unnecessarily | Webhook/email route audit |  |
| 2.14 | Existing QuickBooks integration reused | Agent 8 extends current QB OAuth/token patterns | QB service code reuse |  |
| 2.15 | Existing observability/logging reused | Logs/metrics match current PermitPilot style | Structured logs and metrics |  |

---

# 3. Multi-Tenancy / Security Checklist

| # | Requirement | Audit Question | Evidence Needed | Status |
|---|---|---|---|---|
| 3.1 | Every UCI table has `tenant_id` | Do all UCI tables include tenant ownership? | DB schema |  |
| 3.2 | RLS enabled on every UCI table | Is RLS enabled, not just app-level filtering? | SQL migrations |  |
| 3.3 | RLS matches existing PermitPilot pattern | Does it use same session variable/current tenant convention? | Existing RLS comparison |  |
| 3.4 | Tenant A cannot read Tenant B data | Cross-tenant test exists and passes | Automated test result |  |
| 3.5 | Tenant A cannot write Tenant B data | Insert/update/delete blocked by RLS | Automated test result |  |
| 3.6 | McDonald’s data isolated | Pilot tenant data is physically/logically isolated | Tenant-scoped records |  |
| 3.7 | All APIs enforce tenant scope | APIs cannot fetch by raw ID across tenants | API tests |  |
| 3.8 | Agents enforce tenant scope | Agent job payload includes tenant_id and verifies ownership | Worker code/tests |  |
| 3.9 | Prompts do not leak cross-tenant data | Claude prompts only include current tenant context | Prompt construction audit |  |
| 3.10 | Credentials not exposed to frontend after save | UI only shows configured/missing status | Settings UI/backend response |  |
| 3.11 | No secrets in code | No usernames/passwords/tokens committed | Repo grep |  |
| 3.12 | No secrets in `.env.example` | Example env has placeholders only | Env files audit |  |
| 3.13 | No secrets in logs | Logs sanitize credentials, cookies, tokens, form values | Log sample audit |  |
| 3.14 | Portal credential reference only | Provider row references credential key, not password | `portal_credentials_ref` or app equivalent |  |
| 3.15 | QuickBooks tokens secure | QB OAuth tokens stored using existing secure pattern | QB token store audit |  |
| 3.16 | Anthropic key secure | API key stored in env/secret manager, not DB/code | Config audit |  |

---

# 4. Idempotency Checklist

| # | Requirement | Audit Question | Evidence Needed | Status |
|---|---|---|---|---|
| 4.1 | Agent rerun safe | Can each agent rerun on same input without duplicate side effects? | Idempotency tests |  |
| 4.2 | Submission idempotency | If application already submitted, Agent 4 does not resubmit | `submitted_at` check, test |  |
| 4.3 | Email idempotency | Outbound emails not duplicated on retries | message ID/idempotency key |  |
| 4.4 | QuickBooks idempotency | Duplicate QB invoice not created | RequestId = `coordination_costs.id` or equivalent |  |
| 4.5 | Claude idempotency | Repeated LLM calls use input record/content hash | metadata/idempotency key |  |
| 4.6 | Stage transition idempotency | Duplicate transition logs avoided or clearly handled | transition logic/test |  |
| 4.7 | Equipment ETA update idempotency | Same ETA response not repeatedly appended incorrectly | ETA history dedupe |  |
| 4.8 | Closeout package idempotency | Closeout package not regenerated endlessly unless versioned | document versioning |  |
| 4.9 | Retry-safe portal automation | Failed portal job retry does not create duplicate utility application | portal checks before submit |  |
| 4.10 | Cron safe | Daily/weekly jobs do not repeatedly trigger same action incorrectly | cron job tests |  |

---

# 5. 10-Stage Lifecycle Checklist

## 5.1 Stage Model

| # | Requirement | Audit Question | Evidence Needed | Status |
|---|---|---|---|---|
| 5.1.1 | Stages 1–10 represented | Are all 10 lifecycle stages available in code/DB? | constants/enums/schema |  |
| 5.1.2 | Stage names match spec | Provider Mapping, Load Profile, Application Prep, etc. | UI/API constants |  |
| 5.1.3 | Stage completion meaning respected | Does each stage complete only when spec condition is met? | agent logic/tests |  |
| 5.1.4 | Multiple coordination records per project | Can one project have electric, gas, water/sewer, telecom records? | DB sample |  |
| 5.1.5 | Multiple scopes per utility supported | Can electric have service drop + transformer/meter etc.? | `scope_description`, records |  |
| 5.1.6 | Flexible milestones supported | Easement/ROW/inspection/etc. tracked as milestones | `coordination_milestones` |  |

## 5.2 Stage States

| # | Requirement | Audit Question | Evidence Needed | Status |
|---|---|---|---|---|
| 5.2.1 | `NOT_STARTED` supported | Can stage exist before work begins? | enum/constraint/UI |  |
| 5.2.2 | `IN_PROGRESS` supported | Can Commun-ET active work be tracked? | state transition |  |
| 5.2.3 | `AWAITING_UTILITY` supported | Can utility-side waiting with SLA be tracked? | state/SLA fields |  |
| 5.2.4 | `BLOCKED` supported | Can dependency blockers be represented? | blocker fields/reason |  |
| 5.2.5 | `ESCALATED` supported | Can overdue/risk states be escalated? | escalation endpoint/alerts |  |
| 5.2.6 | `COMPLETED` supported | Can completed stages unlock downstream stage? | transition logic |  |
| 5.2.7 | State transitions explicit | No silent state changes without audit log | `coordination_stage_transitions` |  |
| 5.2.8 | Human and agent transitions supported | `triggered_by_type` includes agent/user/cron | schema + API |  |
| 5.2.9 | Transition reason captured | Every transition has reason/metadata | audit rows |  |
| 5.2.10 | Revert/manual correction supported | Human can advance/revert safely | transition API |  |

## 5.3 Stage-by-Stage Acceptance

| Stage | Complete When | Audit Checks | Status |
|---|---|---|---|
| 1 Provider Mapping | Provider company, account/territory, contact resolved | provider lookup works; ambiguous provider flagged; missing provider blocked; transition logged |  |
| 2 Load Profile / Service Sizing | Load schedule + service size created | electric kW/A; gas BTU/h; water gpm/DFU; prototype fallback; verification flags |  |
| 3 Application Preparation | Utility-specific package drafted | forms populated; load calcs; site plan refs; equipment specs; human review required |  |
| 4 Submission | Submitted via portal/email and confirmation/ticket captured | submitted_at; method; ticket/message ID; no duplicate submission |  |
| 5 Acknowledgment | Utility confirms receipt and PM/coordinator assigned | ack date; utility account/ticket; PM contact captured; SLA timer stops |  |
| 6 COS / Design Review | Utility design document received/reviewed | COS parsed; discrepancies flagged; matching submission can complete |  |
| 7 CIAC / Cost Confirmed | Cost known, approval/payment/billing tracked | estimated/actual cost; variance; paid_at; QB invoice ID |  |
| 8 Equipment / Long-Lead | Equipment ETA/status tracked | equipment rows; ETA history; slips detected; check-in schedule |  |
| 9 Pre-Energization | Inspection release, meter set, site readiness coordinated | milestones; scheduled meter set; checklist emails; readiness state |  |
| 10 Energization / Closeout | Service energized and closeout package archived | actual date; artifacts verified; closeout PDF/doc archived; project rollup updated |  |

---

# 6. Database Schema Checklist

## 6.1 `utility_providers`

| # | Field/Feature | Audit Question | Status |
|---|---|---|---|
| 6.1.1 | `id` | UUID primary key exists |  |
| 6.1.2 | `tenant_id` | Tenant scoped |  |
| 6.1.3 | `name` | Utility name stored, e.g. PEPCO/BGE |  |
| 6.1.4 | `utility_type` | electric/gas/water/sewer/telecom supported |  |
| 6.1.5 | `ownership_type` | investor_owned/cooperative/municipal supported |  |
| 6.1.6 | `service_territory` | Territory stored as JSON/Geo/zip/county |  |
| 6.1.7 | `primary_portal_type` | portal/email/manual supported |  |
| 6.1.8 | `portal_url` | Portal URL stored safely |  |
| 6.1.9 | `portal_credentials_ref` | Reference only, no secret |  |
| 6.1.10 | `primary_contact` | JSON contact support |  |
| 6.1.11 | SLA fields | acknowledgment/COS/CIAC business-day SLAs |  |
| 6.1.12 | `is_active` | Can disable provider |  |
| 6.1.13 | indexes | tenant/type indexes exist |  |
| 6.1.14 | RLS | tenant isolation active |  |

## 6.2 `coordination_records`

| # | Field/Feature | Audit Question | Status |
|---|---|---|---|
| 6.2.1 | `tenant_id` | Required |  |
| 6.2.2 | `project_id` | Links to existing project |  |
| 6.2.3 | `utility_provider_id` | Links to provider; nullable only if blocked/missing provider is intentionally supported |  |
| 6.2.4 | `utility_type` | Denormalized for filtering |  |
| 6.2.5 | `scope_description` | Service scope captured |  |
| 6.2.6 | `current_stage` | 1–10 enforced |  |
| 6.2.7 | `current_stage_state` | State enum supported |  |
| 6.2.8 | utility account fields | account number and PM contact captured |  |
| 6.2.9 | submission timestamps | submitted/ack/COS dates captured |  |
| 6.2.10 | energization dates | target and actual date supported |  |
| 6.2.11 | predicted dates | P50/P90 fields exist |  |
| 6.2.12 | `agent_monitored` | Can toggle automation monitoring |  |
| 6.2.13 | indexes | project/stage indexes exist |  |
| 6.2.14 | RLS | tenant isolation active |  |

## 6.3 `coordination_stage_transitions`

| # | Field/Feature | Audit Question | Status |
|---|---|---|---|
| 6.3.1 | transition row created for every stage/state change | No silent lifecycle changes |  |
| 6.3.2 | `from_stage`, `to_stage` | Captured correctly |  |
| 6.3.3 | `from_state`, `to_state` | Captured correctly |  |
| 6.3.4 | `triggered_by_type` | agent/user/cron supported |  |
| 6.3.5 | `triggered_by_id` | agent name/user ID/cron ID stored |  |
| 6.3.6 | `reason` | Human-readable reason captured |  |
| 6.3.7 | `metadata` | Extra context stored |  |
| 6.3.8 | descending index | Recent history fast to query |  |
| 6.3.9 | RLS | tenant isolation active |  |

## 6.4 `coordination_applications`

| # | Field/Feature | Audit Question | Status |
|---|---|---|---|
| 6.4.1 | `application_type` | new_service/service_upgrade/temp_power etc. |  |
| 6.4.2 | `package_documents` | Document refs array supported |  |
| 6.4.3 | `load_summary` | Structured load schedule JSON |  |
| 6.4.4 | `submission_method` | portal/email/manual |  |
| 6.4.5 | `utility_ticket_number` | Confirmation/ticket captured |  |
| 6.4.6 | `submitted_at` | Timestamp captured |  |
| 6.4.7 | `submitted_by` | User reference captured |  |
| 6.4.8 | `draft_status` | draft/reviewed/submitted supported |  |
| 6.4.9 | `agent_draft_metadata` | model/version/source metadata |  |
| 6.4.10 | idempotency | submitted application cannot resubmit |  |
| 6.4.11 | RLS | tenant isolation active |  |

## 6.5 `coordination_communications`

| # | Field/Feature | Audit Question | Status |
|---|---|---|---|
| 6.5.1 | inbound/outbound direction | Both supported |  |
| 6.5.2 | channel | email/portal_message/phone_log/document supported |  |
| 6.5.3 | classification | 11 categories supported |  |
| 6.5.4 | confidence | numeric confidence stored |  |
| 6.5.5 | raw subject/body | stored safely |  |
| 6.5.6 | attachments | raw attachment refs stored |  |
| 6.5.7 | parsed summary | generated summary stored |  |
| 6.5.8 | action items | structured JSON action items |  |
| 6.5.9 | thread ID | related messages grouped |  |
| 6.5.10 | human attention flag | triage queue supported |  |
| 6.5.11 | review metadata | reviewed_by/reviewed_at |  |
| 6.5.12 | agent metadata | model/version/cost/retry info |  |
| 6.5.13 | needs-attention index | fast triage query |  |
| 6.5.14 | RLS | tenant isolation active |  |

## 6.6 `coordination_costs`

| # | Field/Feature | Audit Question | Status |
|---|---|---|---|
| 6.6.1 | cost type | CIAC/application/design/meter/recording/courier |  |
| 6.6.2 | estimated amount/date | estimate captured |  |
| 6.6.3 | actual amount/date | invoice actual captured |  |
| 6.6.4 | variance percent | computed/stored correctly |  |
| 6.6.5 | invoice doc ref | utility invoice linked |  |
| 6.6.6 | paid_at | utility payment captured |  |
| 6.6.7 | payment method | payment tracking |  |
| 6.6.8 | client_billed_at | client billing captured |  |
| 6.6.9 | QuickBooks invoice ID | QB link stored |  |
| 6.6.10 | variance alerts | >5%, >15%, >20% behavior implemented according to severity |  |
| 6.6.11 | duplicate QB prevention | cost ID used as idempotency key |  |
| 6.6.12 | RLS | tenant isolation active |  |

## 6.7 `coordination_equipment`

| # | Field/Feature | Audit Question | Status |
|---|---|---|---|
| 6.7.1 | equipment type | transformer/switchgear/meter/regulator/service cable/other |  |
| 6.7.2 | equipment size | size captured |  |
| 6.7.3 | initial ETA | baseline stored |  |
| 6.7.4 | current ETA | latest ETA stored |  |
| 6.7.5 | ETA history | append-only history JSON |  |
| 6.7.6 | status | pending/on_order/shipped/delivered/installed |  |
| 6.7.7 | last/next check-in | cron scheduling fields |  |
| 6.7.8 | weeks_of_slip | computed correctly |  |
| 6.7.9 | check-in index | due equipment quickly queryable |  |
| 6.7.10 | RLS | tenant isolation active |  |

## 6.8 `coordination_milestones`

| # | Field/Feature | Audit Question | Status |
|---|---|---|---|
| 6.8.1 | milestone type | inspection_release/easement_filed/meter_set/energization/closeout/other |  |
| 6.8.2 | parent stage | milestone can link to stage 1–10 |  |
| 6.8.3 | target date | planned date stored |  |
| 6.8.4 | actual date | completion date stored |  |
| 6.8.5 | status | pending/scheduled/completed/missed |  |
| 6.8.6 | notes | human notes supported |  |
| 6.8.7 | status index | dashboard/alert query optimized |  |
| 6.8.8 | RLS | tenant isolation active |  |

---

# 7. Agent-by-Agent Audit Checklist

## Agent 1 — Utility Provider Mapper

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A1.1 | Triggered by project intake completion | `project.intake_completed` or equivalent triggers it |  |
| A1.2 | Runs only when project has utility scope | No unnecessary records for non-utility projects |  |
| A1.3 | Uses project address/lat-lng | Address/geocode input available |  |
| A1.4 | Queries tenant utility providers | Service territory matching works |  |
| A1.5 | Creates one record per utility/scope | Electric/gas/water/sewer/telecom records created as needed |  |
| A1.6 | Handles multiple providers | Ambiguous provider flagged for human selection |  |
| A1.7 | Handles missing provider | Creates blocked state or surfaces missing setup |  |
| A1.8 | Logs stage transition | Provider mapping transition recorded |  |
| A1.9 | Error handling for geocode failure | Project marked provider_mapping_blocked/human alert |  |
| A1.10 | Idempotent | Rerun does not duplicate coordination records |  |

## Agent 2 — Load Profile Analyzer

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A2.1 | Triggered after provider mapping complete | Correct stage/state dependency |  |
| A2.2 | Supports McDonald’s prototype templates | Known restaurant prototype loads available |  |
| A2.3 | Supports generic QSR fallback | Unknown prototype still handled |  |
| A2.4 | Electric load summary | kW/A/voltage/service size calculated |  |
| A2.5 | Gas load summary | BTU/h/service size calculated |  |
| A2.6 | Water/sewer load summary | gpm/DFU/meter size captured |  |
| A2.7 | Missing equipment handled | Defaults used with needs-verification flag |  |
| A2.8 | Oversized load flagged | e.g. >800A surfaced to human |  |
| A2.9 | Writes `load_summary` | Saved in application row |  |
| A2.10 | Advances stage 2 completed | Transition logged |  |
| A2.11 | Idempotent | Rerun updates/keeps existing draft safely |  |

## Agent 3 — Application Builder

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A3.1 | Triggered after stage 2 complete | Correct dependency |  |
| A3.2 | Uses utility-specific templates | PEPCO/BGE/etc. forms supported when built |  |
| A3.3 | Populates forms from project/load data | Field mapping correct |  |
| A3.4 | Generates load calculation worksheet | Worksheet attached/ref stored |  |
| A3.5 | Includes single-line diagram if available | Document bundle includes it |  |
| A3.6 | Includes site plan reference | Document ref included |  |
| A3.7 | Includes equipment cut sheets | Required docs included |  |
| A3.8 | Missing docs cause blocked state | Missing list shown to human |  |
| A3.9 | Unknown utility template fallback | Generic template + template gap logged |  |
| A3.10 | Letter of authorization flagged | Human action required where applicable |  |
| A3.11 | Draft status set to `draft` | Not auto-reviewed/submitted |  |
| A3.12 | Human review required | Submit button disabled until reviewed |  |
| A3.13 | Agent metadata saved | model/version/template used |  |
| A3.14 | Idempotent | Rebuild does not duplicate docs unnecessarily |  |

## Agent 4 — Submission & Confirmation Tracker

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A4.1 | Triggered by human submit | No automatic submission before review |  |
| A4.2 | Supports portal submission | Playwright job path exists |  |
| A4.3 | Supports email submission | Email fallback path exists |  |
| A4.4 | Fetches credentials securely | Uses existing Settings/credential store; no hardcoded creds |  |
| A4.5 | Navigates submission flow | Portal steps mapped per utility |  |
| A4.6 | Uploads documents | Correct files uploaded |  |
| A4.7 | Captures confirmation/ticket | `utility_ticket_number` stored |  |
| A4.8 | Captures submitted_at | Timestamp stored |  |
| A4.9 | Captures submission_method | portal/email/manual |  |
| A4.10 | Advances stage 4 completed | transition logged |  |
| A4.11 | Starts stage 5 awaiting utility | SLA timer begins |  |
| A4.12 | Portal failure retry | 3 attempts/exponential backoff or project convention |  |
| A4.13 | Fallback/surface on failure | email fallback or human attention |  |
| A4.14 | Captures screenshot/HTML on failure | Debug artifact stored sanitized |  |
| A4.15 | Prevents duplicate submission | Checks submitted_at/idempotency key |  |
| A4.16 | Smoke tests avoid real submissions | Staging tests safe |  |

## Agent 5 — Communication Parser & Thread Manager

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A5.1 | Triggered on inbound unclassified communication | `classification = NULL` starts job |  |
| A5.2 | Supports all 11 categories | acknowledgment, class_of_service, design_review_response, ciac_invoice, equipment_eta_update, inspection_release_request, meter_set_scheduling, energization_confirmation, escalation_or_problem, request_for_information, unclassified |  |
| A5.3 | Uses Claude classifier | Model call with structured JSON |  |
| A5.4 | Keyword fallback exists | Used on Anthropic failure |  |
| A5.5 | Matches by ticket number | Subject/body ticket matching |  |
| A5.6 | Matches by account number | Utility account matching |  |
| A5.7 | Matches by project address | Address heuristic |  |
| A5.8 | Matches by sender PM/contact | Utility PM email matching |  |
| A5.9 | Generates parsed summary | 1–2 sentence summary |  |
| A5.10 | Generates action items | Structured action JSON |  |
| A5.11 | Confidence threshold implemented | <0.75 → human attention |  |
| A5.12 | Unclassified surfaced | Human triage queue |  |
| A5.13 | No matching record handled | unmatched-message queue |  |
| A5.14 | High-confidence downstream triggers | ack/COS/etc. triggers stage/agents |  |
| A5.15 | Accuracy measured | validation set with ≥85% pilot target |  |
| A5.16 | Human reclassification supported | Override feeds improvement |  |

## Agent 6 — COS / Design Review Analyst

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A6.1 | Triggered by COS/design review communication | Correct classifier integration |  |
| A6.2 | Extracts electric structured data | voltage, service capacity, meter location, transformer specs |  |
| A6.3 | Extracts gas structured data | pressure class, line size, regulator |  |
| A6.4 | Extracts water/sewer equivalent data | if applicable |  |
| A6.5 | Compares against submitted load | discrepancy engine exists |  |
| A6.6 | Flags smaller service | human attention |  |
| A6.7 | Flags transformer/location mismatch | human attention |  |
| A6.8 | Flags CIAC implications | cost record if needed |  |
| A6.9 | Creates discrepancy report JSON | stored and linked |  |
| A6.10 | Completes stage if no discrepancy | transition logged |  |
| A6.11 | OCR fallback for scanned PDFs | OCR + low confidence flag |  |
| A6.12 | Unrecognized docs surfaced | raw document stored + human attention |  |

## Agent 7 — Easement & ROW Coordinator

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A7.1 | Deferred for pilot | Marked Phase 4, not required for Phase 1–3 |  |
| A7.2 | Manual handling acceptable | Human workaround documented |  |
| A7.3 | If implemented, tracks easement drafting | Evidence if built |  |
| A7.4 | If implemented, tracks recording/survey coordination | Evidence if built |  |

## Agent 8 — CIAC & Cost Tracker

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A8.1 | Triggered by new/updated cost row | estimate or actual amount starts workflow |  |
| A8.2 | On estimate, stage 7 in progress | transition logged |  |
| A8.3 | Computes total costs | across cost rows per record |  |
| A8.4 | Generates client approval request | human/client approval flow |  |
| A8.5 | Captures actual invoice amount | utility invoice parsed or manual entry |  |
| A8.6 | Computes variance | variance_pct correct |  |
| A8.7 | Variance >5% surfaced | human review |  |
| A8.8 | Variance >20% escalated/no auto-bill | hard safety check |  |
| A8.9 | Captures utility payment | paid_at/method stored |  |
| A8.10 | Creates QuickBooks invoice | existing QB integration extended |  |
| A8.11 | Attaches utility invoice reference | QB/document link |  |
| A8.12 | Prevents duplicate QB invoice | coordination_costs.id idempotency |  |
| A8.13 | QB failure retry | exponential retry + manual queue |  |
| A8.14 | Stage 7 completes only after costs paid/billed | correct stage logic |  |

## Agent 9 — Long-Lead Equipment Tracker

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A9.1 | Daily cron exists | eligible equipment queried |  |
| A9.2 | Filters pending/on_order/shipped | correct status filter |  |
| A9.3 | Uses `next_check_in_at <= now` | no unnecessary check-ins |  |
| A9.4 | Email check-in supported | templated email to utility |  |
| A9.5 | Portal lookup supported where available | Playwright job path |  |
| A9.6 | Schedules next check-in | 7 days out by default |  |
| A9.7 | Appends ETA history | source + observed_at + ETA |  |
| A9.8 | Updates current ETA | latest ETA stored |  |
| A9.9 | Computes weeks of slip | accurate calculation |  |
| A9.10 | Slip >2 weeks surfaced | human schedule impact alert |  |
| A9.11 | No response in 2 weeks escalates | alert path |  |
| A9.12 | Portal lookup failure fallback | email fallback + maintenance log |  |

## Agent 10 — Inspection Release Coordinator

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A10.1 | Deferred for pilot | Phase 4, not required for Phase 1–3 |  |
| A10.2 | Manual handling acceptable | documented manual process |  |
| A10.3 | If built, tracks inspection release | evidence if implemented |  |

## Agent 11 — Meter Set Choreographer

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A11.1 | Triggered at stage 9 with inspection release | correct dependency |  |
| A11.2 | Sends meter set request to utility PM | outbound email/template |  |
| A11.3 | Captures scheduled meter set date | milestone row |  |
| A11.4 | Creates `meter_set` milestone | status scheduled/completed/missed |  |
| A11.5 | Sends 48-hour checklist | site contact notification |  |
| A11.6 | Monitors day-of confirmation | communication parser integration |  |
| A11.7 | Captures actual meter set date | milestone actual_date |  |
| A11.8 | Handles failed meter set | missed + human alert |  |
| A11.9 | Multiple reschedules escalated | failed meter set KPI/risk |  |

## Agent 12 — Energization & Closeout

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| A12.1 | Triggered by energization confirmation or human mark | classifier/manual action |  |
| A12.2 | Captures energization actual date | record updated |  |
| A12.3 | Verifies required artifacts | energization confirmation, final meter reading, commissioning sign-off |  |
| A12.4 | Missing artifacts block closeout | human attention |  |
| A12.5 | Handles date inconsistency | human review |  |
| A12.6 | Generates closeout package | PDF/doc summary |  |
| A12.7 | Includes stage history | transition log included |  |
| A12.8 | Includes communications log | all relevant messages included |  |
| A12.9 | Includes costs/receipts | paid receipts included |  |
| A12.10 | Archives package | stored in project documents |  |
| A12.11 | Marks record stage 10 complete | transition logged |  |
| A12.12 | Project-level rollup | project utility coordination complete only when all records complete |  |

---

# 8. Predictive Energization Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| 8.1 | Prediction is function, not separate agent | No unnecessary extra agent |  |
| 8.2 | Recomputes on every record update | Hook/service present |  |
| 8.3 | Computes `predicted_p50_date` | based on current stage/history/provider data |  |
| 8.4 | Computes `predicted_p90_date` | P50 × 1.4 heuristic |  |
| 8.5 | Uses utility/provider historical baseline | available or fallback documented |  |
| 8.6 | Accounts for current delays | AWAITING/BLOCKED elapsed time included |  |
| 8.7 | ML prediction deferred | not falsely claimed as ML |  |
| 8.8 | Prediction shown in portfolio/project APIs | frontend/dashboard can consume |  |

---

# 9. REST API Checklist

| # | Endpoint / Capability | Audit Question | Status |
|---|---|---|---|
| API.1 | List project coordination records | `GET /uci/projects/{project_id}/coordination` or app equivalent exists |  |
| API.2 | Get single coordination record | includes stage, latest costs/equipment/comms |  |
| API.3 | Manual transition endpoint | can advance/revert with reason |  |
| API.4 | Get communication log | paginated, newest first |  |
| API.5 | Trigger application draft | starts Agent 3 |  |
| API.6 | Review application | reviewed/needs_changes + notes |  |
| API.7 | Submit application | starts Agent 4 only after reviewed |  |
| API.8 | Portfolio view | stage counts, risks, predicted dates, financial rollup |  |
| API.9 | Utility provider directory | tenant-scoped list |  |
| API.10 | Manual escalation | reason/severity captured |  |
| API.11 | Needs-attention queue | tenant-level triage communications |  |
| API.12 | Reclassify communication | human override saved |  |
| API.13 | Auth required | no public access |  |
| API.14 | Tenant enforced | cannot fetch other tenant records |  |
| API.15 | API audit logging | every write/manual action logged |  |
| API.16 | Validation | invalid stages/states rejected |  |
| API.17 | Error shape consistent | follows existing PermitPilot API conventions |  |

---

# 10. Event Bus Checklist

| # | Event | Audit Question | Status |
|---|---|---|---|
| E1 | `uci.coordination_record.created` | emitted on new record |  |
| E2 | `uci.coordination_record.stage_changed` | emitted on transition |  |
| E3 | `uci.coordination_record.escalated` | emitted on escalation |  |
| E4 | `uci.application.drafted` | emitted after Agent 3 |  |
| E5 | `uci.application.submitted` | emitted after Agent 4 |  |
| E6 | `uci.communication.received` | emitted on inbound message |  |
| E7 | `uci.communication.classified` | emitted after Agent 5 |  |
| E8 | `uci.communication.needs_attention` | emitted when human triage needed |  |
| E9 | `uci.cost.estimated` | emitted on estimate |  |
| E10 | `uci.cost.actual_received` | emitted on actual invoice |  |
| E11 | `uci.cost.variance_flagged` | emitted on variance threshold |  |
| E12 | `uci.equipment.eta_changed` | emitted on ETA update |  |
| E13 | `uci.equipment.eta_slipped` | emitted on significant slip |  |
| E14 | `uci.milestone.completed` | emitted on milestone completion |  |
| E15 | `uci.milestone.missed` | emitted on missed milestone |  |
| E16 | `uci.energization.confirmed` | emitted on energization |  |
| E17 | Payload includes tenant_id | every event tenant-scoped |  |
| E18 | Payload includes coordination_record_id | downstream modules can consume |  |
| E19 | Uses existing event bus | no duplicate custom event system |  |

---

# 11. Inbound Email Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| 11.1 | Tenant-scoped inbound address | e.g. `uci-inbound+{tenant_slug}@...` or equivalent |  |
| 11.2 | Webhook route exists | `/webhooks/uci/email-inbound` or app equivalent |  |
| 11.3 | Tenant identified from subaddress | correct tenant mapping |  |
| 11.4 | Raw email persisted | subject/body/attachments saved |  |
| 11.5 | Classification starts null | Agent 5 can process |  |
| 11.6 | Attachments stored in object storage | refs saved, not huge blobs |  |
| 11.7 | Agent 5 enqueued | parser job starts after persist |  |
| 11.8 | Existing inbound pattern reused | does not duplicate permit filing email infra unnecessarily |  |
| 11.9 | Failure handling | webhook retry/queue/dead-letter documented |  |
| 11.10 | Security | validates provider webhook signatures if supported |  |

---

# 12. Outbound Email Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| 12.1 | Uses existing transactional email service | no duplicate email provider wrapper unless needed |  |
| 12.2 | UCI from address configured | e.g. `uci-outbound@permitpilot.com` or approved equivalent |  |
| 12.3 | Reply-to routes inbound | replies return to UCI inbound pipeline |  |
| 12.4 | Every outbound email logged | `coordination_communications` row direction outbound |  |
| 12.5 | Templates in registry | application submission, ETA check-in, meter checklist, escalation etc. |  |
| 12.6 | Attachments supported | email submissions include package docs |  |
| 12.7 | Bounce handling | failed email marks submission failed/human attention |  |
| 12.8 | Idempotent sends | retry does not duplicate emails |  |

---

# 13. Portal Automation Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| 13.1 | Playwright workers run on existing infra | follows current scraper deployment |  |
| 13.2 | Per-utility scripts versioned | `/uci/portals/{utility_slug}` or equivalent |  |
| 13.3 | Credentials fetched at runtime | from Settings/credential system or approved secret manager |  |
| 13.4 | Credentials never logged | username/password/cookies/tokens sanitized |  |
| 13.5 | Login flow implemented per utility | tested safely |  |
| 13.6 | Submission flow mapped per utility | pages/forms/upload/confirmation documented |  |
| 13.7 | Script checks existing submission | avoids duplicate submission |  |
| 13.8 | Captures confirmation/ticket | reliable extraction |  |
| 13.9 | Captures screenshots on failure | stored for debugging |  |
| 13.10 | Captures sanitized HTML on failure | no secrets/cookies |  |
| 13.11 | Structured logs emitted | utility, attempt, outcome |  |
| 13.12 | Auto-retry once/defined attempts | consistent with spec/project standard |  |
| 13.13 | Fallback to email/human | after persistent failure |  |
| 13.14 | Mock portal tests exist | synthetic HTML tests for each priority utility |  |
| 13.15 | Staging smoke tests weekly | no production test submissions |  |
| 13.16 | Production safe mode | discovery/login tests do not submit |  |

## 13.1 Priority Utility Coverage

| Utility | Portal Automation | Email Fallback | Smoke Test | Notes |
|---|---|---|---|---|
| PEPCO |  |  |  |  |
| BGE |  |  |  |  |
| Washington Gas |  |  |  |  |
| Dominion |  |  |  |  |
| FPL |  |  |  |  |
| Con Edison |  |  |  |  |
| PSE&G |  |  |  |  |
| Eversource |  |  |  |  |
| Duke Energy |  |  |  |  |
| Georgia Power |  |  |  |  |

---

# 14. Claude / Anthropic Integration Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| 14.1 | Agents 3, 5, 6, 12 use Claude where needed | drafting/classification/discrepancy/closeout |  |
| 14.2 | Model selection follows existing convention | Sonnet/Opus or existing app config |  |
| 14.3 | Prompt includes tenant context only | no cross-tenant leakage |  |
| 14.4 | Structured JSON output required | schema defined |  |
| 14.5 | Output parse validated | invalid JSON rejected/retried |  |
| 14.6 | Retry once with stricter prompt | parse failure behavior |  |
| 14.7 | Human attention on repeated failure | not silently swallowed |  |
| 14.8 | Token budget enforced | max tokens per agent |  |
| 14.9 | Metadata logged | model, tokens, cost, version |  |
| 14.10 | Idempotency key used | record ID + content hash |  |
| 14.11 | Prompt/version stored | traceability without long-term sensitive retention |  |
| 14.12 | Fallback classifier exists for Agent 5 | keyword fallback on API failure |  |

---

# 15. QuickBooks / CIAC Billing Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| 15.1 | Uses existing QB OAuth per tenant | no duplicate auth flow |  |
| 15.2 | Token refresh handled | follows current QB integration |  |
| 15.3 | Invoice line item per cost row | cost maps to invoice line |  |
| 15.4 | Utility invoice doc attached/referenced | document ref included |  |
| 15.5 | Memo includes project + coordination summary | invoice context clear |  |
| 15.6 | RequestId/idempotency key used | prevents duplicate invoices |  |
| 15.7 | Payment webhook handled | updates `client_billed_at`/status |  |
| 15.8 | QB failure retry | exponential backoff |  |
| 15.9 | Persistent failure manual queue | human can replay |  |
| 15.10 | Variance safety gate | high variance blocks auto-bill |  |
| 15.11 | Tenant-specific QB connection | no cross-client billing |  |

---

# 16. Dashboard / Reporting Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| 16.1 | Basic UCI dashboards exist for Phase 1 | stage/risk overview |  |
| 16.2 | Portfolio view API exists | McDonald’s portfolio dashboard data |  |
| 16.3 | Stage counts shown | by project/tenant/portfolio |  |
| 16.4 | Risk flags shown | blocked/escalated/overdue/slipped |  |
| 16.5 | Predicted energization dates shown | P50/P90 visible |  |
| 16.6 | Financial rollup shown | CIAC/fees/paid/billed |  |
| 16.7 | Needs-attention queue shown | communication triage |  |
| 16.8 | Equipment ETA slips shown | long-lead risks |  |
| 16.9 | Quarterly reporting templates | Phase 3 requirement |  |
| 16.10 | McDonald’s tenant config | Phase 3 requirement |  |
| 16.11 | Dashboard data tenant-scoped | no cross-tenant leakage |  |

---

# 17. Testing Checklist

## 17.1 Unit Tests

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| T1.1 | Every agent has happy path test | input → expected output |  |
| T1.2 | Every documented error mode tested | not just happy path |  |
| T1.3 | Idempotency tests per agent | rerun produces no duplicates |  |
| T1.4 | Tenant isolation tests per agent | cannot read/write other tenant |  |
| T1.5 | Stage transition tests | correct audit row written |  |
| T1.6 | Validation tests | invalid state/stage rejected |  |

## 17.2 Integration Tests

| # | Critical Path | Audit Question | Status |
|---|---|---|---|
| T2.1 | Intake → Provider Mapping → Load Profile → Application Draft | Agents 1–3 end-to-end |  |
| T2.2 | Submit → Acknowledgment → COS → CIAC → Equipment Order | Agents 4–9 end-to-end |  |
| T2.3 | Inspection Release → Meter Set → Energization → Closeout | Agents 11–12 end-to-end |  |
| T2.4 | Inbound Communication → Classification → Threading → Stage Transition | Agent 5 end-to-end |  |
| T2.5 | Cost → QuickBooks invoice | Agent 8 + QB integration |  |
| T2.6 | Equipment ETA slip → alert | Agent 9 + alert |  |

## 17.3 Security Tests

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| T3.1 | Tenant A cannot read Tenant B via API | CI blocking test |  |
| T3.2 | Tenant A cannot write Tenant B via API | CI blocking test |  |
| T3.3 | Tenant A agent cannot process Tenant B records | worker-level test |  |
| T3.4 | Cross-tenant failure blocks deployment | CI configured to fail hard |  |

## 17.4 Portal Tests

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| T4.1 | Mock portal tests per priority utility | synthetic HTML tests |  |
| T4.2 | Login failure test | screenshot/artifact captured |  |
| T4.3 | HTML changed test | fails safely |  |
| T4.4 | Session timeout test | retry/fallback |  |
| T4.5 | Duplicate submission prevention test | no second submission |  |
| T4.6 | Weekly staging smoke tests | safe, no production submissions |  |

## 17.5 Classifier Tests

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| T5.1 | Labeled validation set exists | synthetic + real samples |  |
| T5.2 | 11 categories represented | balanced enough |  |
| T5.3 | Accuracy ≥85% pilot target | measured |  |
| T5.4 | Rolling accuracy monitored | alerts below threshold |  |
| T5.5 | Human overrides captured | improvement data saved |  |

---

# 18. Observability / Logging Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| O1 | Every agent emits structured logs | agent_name, record_id, tenant_id, start/end/duration/outcome |  |
| O2 | Outcome values consistent | success/error/human_required |  |
| O3 | Claude usage logged | model, tokens, cost |  |
| O4 | Portal automation logged | utility, portal type, attempt, success/failure |  |
| O5 | Error logs include enough context | but no secrets |  |
| O6 | Metrics follow existing stack | Datadog/equivalent/project convention |  |
| O7 | Job retries visible | attempt count/status |  |
| O8 | Failed artifacts linked | screenshot/HTML storage ref |  |
| O9 | Stage transitions visible | audit history readable |  |
| O10 | Manual actions logged | user/time/reason |  |

---

# 19. Alerting Checklist

| Severity | Alert | Audit Question | Status |
|---|---|---|---|
| P0 | Cross-tenant access detected | pages on-call / blocks deployment |  |
| P0 | Portal automation persistent failure >3 consecutive | alert exists |  |
| P0 | QuickBooks invoice creation persistent failure | alert exists |  |
| P0 | Inbound email pipeline down | alert exists |  |
| P1 | Classifier accuracy <80% over rolling 24h | alert exists |  |
| P1 | Equipment ETA slips >2 weeks | alert exists |  |
| P1 | Stage 5 awaiting utility >2× SLA | alert exists |  |
| P2 | CIAC variance >15% | alert exists |  |
| P2 | Predicted P50 slips >1 week | alert exists |  |

---

# 20. Runbook Checklist

| # | Failure Mode | Required Runbook | Status |
|---|---|---|---|
| R1 | Portal automation fails | fallback to email; create portal script update ticket |  |
| R2 | Anthropic API rate limited | backoff/retry; keyword fallback for Agent 5 |  |
| R3 | Classifier accuracy degrades | review recent outputs; update prompt/examples; redeploy |  |
| R4 | QuickBooks auth expired | refresh OAuth; retry invoice creation |  |
| R5 | Inbound email pipeline down | backup provider/manual triage queued messages |  |
| R6 | Bad credentials | surface configured/missing/failed safely; no password exposure |  |
| R7 | DB/RLS failure | block release; security incident handling |  |
| R8 | Object storage upload failure | retry/manual upload path |  |
| R9 | Closeout artifact missing | block closeout and list missing artifacts |  |

---

# 21. Data Retention / Backup Checklist

| # | Requirement | Audit Question | Status |
|---|---|---|---|
| D1 | Communications retained per tenant policy | typically 7 years |  |
| D2 | Portal screenshots/HTML retained 90 days | then purged |  |
| D3 | Anthropic logs retained 30 days | full prompts not retained beyond policy |  |
| D4 | UCI tables included in backups | part of PermitPilot DR plan |  |
| D5 | RTO/RPO verified | client/platform target known |  |
| D6 | Purge job exists | screenshots/HTML cleanup |  |
| D7 | Closeout packages retained | per project document retention policy |  |

---

# 22. Implementation Sequence Audit

| Week/Phase | Document Requirement | Audit Question | Status |
|---|---|---|---|
| Week 1–2 | UCI schema migrated | tables + RLS + indexes exist |  |
| Week 1–2 | Seed utility providers | 10 priority + East Coast relevant providers seeded |  |
| Week 1–2 | Cross-tenant CI tests | security test blocks deployment |  |
| Week 3–4 | Agent 1 built | provider mapper working |  |
| Week 3–4 | Agent 2 built | load profile analyzer working |  |
| Week 3–4 | Agent 4 email path started | safe submission path |  |
| Week 3–4 | PEPCO/BGE portal reference automation | login/submission reference implementation |  |
| Week 5–6 | Agent 3 built | application builder |  |
| Week 5–6 | Agent 5 built | communication parser |  |
| Week 5–6 | Agent 6 built | COS analyst |  |
| Week 5–6 | Portal automation expanded | remaining 8 priority utilities |  |
| Week 7–8 | Agent 8 built | CIAC + QB |  |
| Week 7–8 | Agent 9 built | equipment tracker |  |
| Week 7–8 | Agent 11 built | meter set |  |
| Week 7–8 | Agent 12 built | closeout |  |
| Week 9–10 | E2E tests | all critical paths passing |  |
| Week 9–10 | Portfolio API | portfolio view implemented |  |
| Week 9–10 | Observability/alerting | logs/alerts ready |  |
| Week 9–10 | UAT | Commun-ET + McDonald’s CM team sign-off |  |

---

# 23. Deferred Scope Checklist

| Feature | Document Status | Audit Treatment |
|---|---|---|
| Agent 7 Easement & ROW Coordinator | Deferred Phase 4 | Not required for pilot unless client changes scope |
| Agent 10 Inspection Release Coordinator | Deferred Phase 4 | Manual handling acceptable for pilot |
| Cross-Utility Conflict Hunter full sophistication | Deferred Phase 4 | Basic conflict flags may be in scope, advanced not |
| Expanded portal coverage beyond priority utilities | Phase 4 | Not required in Phase 1–3 |
| ML-based prediction | Phase 5 | Heuristic P50/P90 enough for pilot |
| Closeout Knowledge Graph | Phase 5 | Basic closeout package enough |
| Easement Holdout Resolver | Phase 4–5 | Not pilot blocking |

---

# 24. Final Client Acceptance Checklist

| # | Acceptance Question | Pass Criteria | Status |
|---|---|---|---|
| C1 | Can client create/open project with utility coordination scope? | Project has UCI records |  |
| C2 | Can system identify utility providers? | Provider records created/blocked correctly |  |
| C3 | Can system generate load summary? | Structured load JSON visible/stored |  |
| C4 | Can system draft utility application package? | Draft package docs created |  |
| C5 | Is human review required before submission? | Submit blocked until reviewed |  |
| C6 | Can system submit via portal/email where supported? | ticket/message ID captured |  |
| C7 | Can system track acknowledgment? | stage 5 handled with SLA |  |
| C8 | Can system parse utility communication? | classified/threaded/action items |  |
| C9 | Can system analyze COS/design review? | discrepancy report generated |  |
| C10 | Can system track CIAC/cost? | estimates/actuals/variance/billing |  |
| C11 | Can system track equipment ETA? | ETA history and slips visible |  |
| C12 | Can system coordinate meter set? | milestone/checklist flow |  |
| C13 | Can system close out energized record? | closeout package archived |  |
| C14 | Can dashboard show portfolio status? | stage counts/risks/dates/costs |  |
| C15 | Are all actions tenant-safe? | security tests pass |  |
| C16 | Are agents idempotent? | rerun tests pass |  |
| C17 | Are portal failures debuggable? | screenshot/HTML/logs captured safely |  |
| C18 | Are credentials secure? | no code/log/db plaintext exposure |  |
| C19 | Are alerts/runbooks ready? | operational readiness checked |  |
| C20 | Is deferred scope clearly marked? | no confusion between pilot vs future |  |

---

# 25. Critical Red Flags

| Critical Red Flag | Why Dangerous |
|---|---|
| Credentials hardcoded/logged | Security failure |
| No RLS on UCI tables | Cross-tenant data leak |
| Agent reruns create duplicates | Duplicate submissions/emails/invoices |
| Human review skipped before submission | Real-world portal damage |
| Portal smoke tests submit real applications | Client/utility operational risk |
| Stage changes without audit log | No accountability |
| Communication parser low confidence but auto-advances | Wrong project/status updates |
| QuickBooks duplicate invoice | Billing disaster |
| Deferred Phase 4/5 scope treated as done | False client expectation |

---

# 26. Recommended Audit Layers

Use this checklist in three layers:

1. **Build Audit**  
   Verify what the developer actually implemented.

2. **Security / Tenant Audit**  
   Verify RLS, credential safety, cross-tenant protection, and idempotency.

3. **Client UAT Audit**  
   Verify whether the business workflow actually solves utility coordination for the client.

