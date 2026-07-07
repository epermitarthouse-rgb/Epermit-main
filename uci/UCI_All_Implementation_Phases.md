> **Notice:** This document has been merged into the canonical UCI delivery roadmap. See [`uci/UCI_DELIVERY_ROADMAP.md`](./UCI_DELIVERY_ROADMAP.md).

# UCI Implementation Phases
## Utility Coordination Intelligence — Multi-Utility Delivery Plan

**Reference baseline:** CET-2026-UCI-BACKEND-001  
**Purpose:** Convert the existing UCI foundation and PEPCO read-only integration into the complete client-required Utility Coordination Intelligence module.  
**Architecture rule:** All shared services must be utility-neutral. PEPCO is the first production adapter, not the hardcoded system design.

---

# 1. Current Baseline

The current codebase already contains:

- UCI route and service layer under `/api/uci`
- Seven core UCI database tables
- Manual coordination record initialization
- Manual lifecycle stage transitions with audit history
- PEPCO login and MFA handling
- PEPCO dashboard project discovery
- Per-project PEPCO detail scraping
- Portal overview, status history, messages, document listing, and document downloads
- Frontend rendering for discovered and scraped PEPCO projects
- Legacy metadata persistence under `coordination_records.metadata`

The current system is not yet a complete UCI implementation because:

- Portal data is not fully normalized
- Tenant propagation and tenant-scoped security are incomplete
- Documents are not stored in production-grade shared storage
- UCI lifecycle stages are not automatically updated from portal events
- Long-running syncs are not durable jobs
- Submission automation is not implemented
- Communication classification is not implemented
- Costs, equipment, milestones, and closeout workflows are not operational
- Most UCI agents remain unimplemented

---

# 2. Delivery Principles

Every phase must follow these rules:

1. **Utility-neutral shared architecture**
   - Shared UCI services cannot contain provider-specific condition chains.
   - Provider-specific behavior must live in adapters.

2. **Backward compatibility**
   - Existing PEPCO metadata snapshots remain available.
   - Existing PEPCO login, MFA, discovery, detail scraping, and downloads must continue to work.

3. **Human-controlled submission**
   - No application is submitted automatically without human review and explicit approval.

4. **Idempotency**
   - Re-running any sync or agent must not create duplicate applications, messages, milestones, documents, emails, submissions, or invoices.

5. **Tenant isolation**
   - Every normalized record must carry or derive tenant context.
   - Access checks must enforce project and tenant boundaries.

6. **Durable state**
   - Worker state lives in Postgres, not in-memory process state.
   - Long-running jobs must survive process restarts.

7. **Partial failure tolerance**
   - One failed document or message must not discard successfully synchronized data.

8. **Auditability**
   - Every lifecycle transition, submission, classification, escalation, payment action, and closeout event must be traceable.

---

# 3. Phase 1 — UCI Pilot Hardening and Normalized Read-Only Foundation

## Objective

Turn the existing PEPCO read-only implementation into a reusable, normalized, tenant-safe, production-ready UCI portal synchronization framework.

## 3.1 Utility Adapter Framework

Create a provider adapter system.

Suggested structure:

```text
scraper-service/app/services/uci/adapters/
  utility-adapter.types.js
  utility-adapter-registry.js
  generic-readonly.adapter.js
  pepco.adapter.js
```

Each adapter should support:

```js
{
  providerSlug,
  normalizeApplication(raw),
  normalizeStatus(raw),
  normalizeMessages(raw),
  normalizeDocuments(raw),
  mapPortalStatusToLifecycle(rawStatus, context),
  getExternalApplicationId(raw),
  getExternalJobId(raw)
}
```

Requirements:

- PEPCO-specific mappings live only in `pepco.adapter.js`
- Unsupported utilities use `generic-readonly.adapter.js`
- Shared services resolve adapters through a registry
- Raw source data is preserved for troubleshooting
- Adapter outputs use common UCI domain fields

## 3.2 Normalize Utility Applications

Use `coordination_applications` as the provider-neutral application record.

Add generic fields if missing:

- `external_application_id`
- `external_job_id`
- `provider_slug`
- `portal_status`
- `portal_last_updated_at`
- `portal_submitted_at`
- `action_required`
- `last_synced_at`
- `metadata`

Create:

```text
uci-portal-application-sync.service.js
```

Behavior:

- Upsert by coordination record + provider + external application ID
- Preserve existing records when another project is scraped
- Merge updates instead of replacing entire datasets
- Keep raw snapshots in metadata
- Do not create submission records unless an application was actually prepared or submitted
- Preserve legacy PEPCO metadata during migration

## 3.3 Normalize Communications

Use `coordination_communications`.

Create:

```text
uci-communication-sync.service.js
```

Normalize portal messages with:

- coordination record
- project
- tenant
- provider slug
- external application ID
- external message ID or deterministic fingerprint
- channel
- direction
- sender
- recipient
- subject
- body
- message timestamp
- raw attachments
- raw metadata
- classification nullable
- needs human attention

Idempotency:

- Prefer external message ID
- Otherwise hash provider + application + timestamp + sender + normalized body

Initial deterministic attention flags:

- action required
- information required
- rejected
- contract sent
- payment due
- inspection failed
- deadline or expiration
- missing documents

Do not add AI classification in Phase 1.

## 3.4 Normalize Portal Status History and Milestones

Use `coordination_milestones` or add a provider-neutral status event table if the existing milestone schema cannot safely represent portal history.

Create:

```text
uci-milestone-sync.service.js
```

Store:

- provider slug
- external application ID
- milestone/category
- status
- occurred timestamp
- source
- raw metadata
- stable idempotency key

Repeated portal refreshes must not duplicate historical events.

## 3.5 Shared Portal Sync Orchestrator

Create:

```text
uci-portal-sync.service.js
```

Input:

```js
{
  coordinationRecord,
  providerSlug,
  rawApplications,
  rawMessages,
  rawStatuses,
  rawDocuments,
  syncRunId
}
```

Pipeline:

1. Resolve provider adapter
2. Normalize applications
3. Normalize communications
4. Normalize status history/milestones
5. Store documents
6. Propose lifecycle transition
7. Persist sync summary
8. Return counts, warnings, and errors

Return shape:

```js
{
  providerSlug,
  applications: { discovered, inserted, updated, skipped, failed },
  communications: { inserted, updated, skipped, failed },
  milestones: { inserted, updated, skipped, failed },
  documents: { stored, skipped, failed },
  lifecycle: { proposed, applied, reason },
  warnings: [],
  errors: []
}
```

## 3.6 Tenant Propagation and Security

Update UCI persistence so tenant context is derived from the project, not trusted from request bodies.

Required:

- Populate `tenant_id` on coordination records
- Add/backfill `tenant_id` on child UCI tables where absent
- Create indexes
- Update RLS policies
- Keep project-level access checks
- Add cross-tenant security tests
- Ensure utility providers are tenant-scoped where client requirements demand it

## 3.7 Production Document Storage

Create a provider-neutral storage service:

```text
uci-document-storage.service.js
```

Preferred production backend:

- Supabase Storage
- Existing project document bucket pattern where compatible

Path format:

```text
uci/{tenantId}/{projectId}/{coordinationRecordId}/{providerSlug}/{externalApplicationId}/{safeFilename}
```

Store normalized metadata:

- provider slug
- external application ID
- original filename
- storage bucket
- storage path
- content type
- file size
- checksum
- uploaded/source date
- ingestion status
- source metadata

Requirements:

- Filename sanitization
- Path traversal prevention
- Duplicate checksum detection
- Authorized download route
- No local server path exposure
- Local disk allowed only behind a development flag

## 3.8 Lifecycle Mapping Engine

Create:

```text
uci-lifecycle-mapping.service.js
```

Provider adapters return:

```js
{
  proposedStage,
  proposedState,
  confidence,
  reason,
  sourceStatus,
  automaticTransitionAllowed
}
```

Rules:

- No automatic backward transition unless explicitly allowed
- No stage 4 unless submission is confirmed
- No stage 10 unless energization/closeout is explicitly confirmed
- Every applied transition writes an audit row
- When automatic updates are disabled, store the proposal without changing the current stage

Feature flag:

```text
UCI_AUTO_STAGE_TRANSITIONS
```

Conservative PEPCO examples:

- Submitted → Stage 4 / AWAITING_UTILITY
- In Technical Review → Stage 6 / AWAITING_UTILITY
- More Information Required → Stage 6 / BLOCKED
- In Design → Stage 6 / AWAITING_UTILITY
- Contract Sent → Stage 7 / AWAITING_UTILITY or BLOCKED when action is required

## 3.9 Durable Portal Sync Foundation

Create generic job type:

```text
uci_portal_sync
```

Payload:

```js
{
  tenant_id,
  project_id,
  coordination_record_id,
  provider_slug,
  credential_id,
  external_application_ids,
  download_documents,
  requested_by_user_id
}
```

States:

- queued
- running
- awaiting_human
- completed
- failed
- cancelled

Requirements:

- Idempotency key
- Lease and heartbeat
- Retry with capped backoff
- Persistent progress
- Human/MFA resume
- Provider-neutral dispatcher
- PEPCO as first runner

Feature flag:

```text
UCI_DURABLE_JOBS_ENABLED
```

If full migration is too risky, keep the current synchronous route temporarily while adding the durable schema and worker interfaces.

## 3.10 Phase 1 API Additions

Add:

```text
GET  /api/uci/coordination/:id/applications
GET  /api/uci/coordination/:id/communications
GET  /api/uci/coordination/:id/milestones
GET  /api/uci/coordination/:id/documents
GET  /api/uci/coordination/:id/sync-runs
POST /api/uci/coordination/:id/sync
```

All endpoints must:

- Require authentication
- Verify project access
- Enforce tenant consistency
- Support pagination
- Never expose credentials, tokens, cookies, or local paths

## 3.11 Phase 1 Frontend

Update `/uci` to show normalized provider-neutral sections:

- Utility applications
- Communications
- Milestones
- Documents
- Lifecycle status
- Last portal sync
- Sync warnings/errors

Keep provider-specific panels for diagnostics.

PEPCO card labels:

- Automated
- Read-only
- Active

Banner:

> PEPCO read-only portal automation is enabled. Submission automation is not enabled.

## Phase 1 Acceptance Criteria

- PEPCO read-only flow still works end-to-end
- Repeated syncs do not duplicate normalized records
- Documents are stored outside local debug folders in production mode
- Tenant IDs propagate correctly
- Unauthorized cross-project and cross-tenant access is rejected
- Lifecycle proposal is visible and audited
- Normalized applications, messages, milestones, and documents render in the UI
- Existing metadata views remain available
- Durable sync interfaces exist without breaking current flows

---

# 4. Phase 2 — Provider Mapping and Load Profile Intelligence

## Objective

Implement the first two UCI lifecycle agents and prepare structured application inputs.

## 4.1 Agent 1 — Utility Provider Mapper

Trigger:

- Project intake completion
- Manual “Initialize utility coordination” action

Inputs:

- Project address
- Latitude/longitude
- Project type/prototype
- Required utility types

Behavior:

- Match site against utility provider service territories
- Create one coordination record per utility/scope pair
- Flag ambiguous service territories
- Block records when no provider can be determined
- Write transition history

Outputs:

- Coordination records
- Provider mapping audit
- Human-review tasks for ambiguity

## 4.2 Provider Directory Hardening

Update `utility_providers` to support:

- Tenant scoping
- Service territory geometry or county/ZIP mappings
- Utility type
- Portal type
- SLA values
- Contact details
- Credential reference
- Active/inactive state

Seed priority providers:

- PEPCO
- BGE
- Washington Gas
- Dominion Energy
- FPL
- Con Edison
- PSE&G
- Eversource
- Duke Energy
- Georgia Power

## 4.3 Agent 2 — Load Profile Analyzer

Inputs:

- Project type
- Prototype
- Equipment schedule
- Uploaded specifications
- Existing plans

Outputs:

- Electric load schedule
- Gas BTU schedule
- Water/sewer sizing
- Service recommendation
- Verification flags

Store structured results in:

```text
coordination_applications.load_summary
```

Requirements:

- McDonald’s prototype templates
- Generic QSR fallback
- Explicit “needs verification” markers
- Human review for unusual service sizes
- Versioned calculation metadata

## 4.4 Load Profile UI

Add:

- Load summary view
- Source assumptions
- Missing data flags
- Reviewer comments
- Approval status

## Phase 2 Acceptance Criteria

- Provider mapping can create coordination records automatically
- Ambiguous provider assignments require human confirmation
- Electric/gas/water loads are stored in structured form
- Re-running analysis is idempotent
- Load outputs are reviewable before application preparation

---

# 5. Phase 3 — Application Preparation and Human Review

## Objective

Implement Agent 3 and create utility-specific application packages without submitting them automatically.

## 5.1 Agent 3 — Application Builder

Trigger:

- Load profile completed
- Human requests application draft

Inputs:

- Coordination record
- Load summary
- Project data
- Provider template
- Project documents
- Equipment specifications

Behavior:

- Select provider-specific template
- Populate required fields
- Attach supporting documents
- Generate load calculation worksheet
- Link site plan, single-line, and cut sheets
- Identify missing documents
- Save application as draft

## 5.2 Template Registry

Create provider-neutral template registry:

```text
uci/application-templates/{providerSlug}/
```

Each template must define:

- Application type
- Required fields
- Required documents
- Field mappings
- Validation rules
- Version
- Effective date

## 5.3 Application Review Workflow

Add application states:

- draft
- needs_changes
- reviewed
- approved_for_submission
- submitted
- failed

Add routes:

```text
POST /api/uci/coordination/:id/applications
POST /api/uci/applications/:id/review
```

Review payload:

```js
{
  status,
  notes,
  reviewer_user_id
}
```

## 5.4 Application Review UI

Add:

- Draft package view
- Missing-document list
- Load summary
- Generated forms
- Reviewer notes
- Approve / Request Changes controls
- Version history

## Phase 3 Acceptance Criteria

- Utility-specific draft package can be generated
- Missing requirements are visible
- Human review is mandatory
- Application cannot be submitted unless approved
- Draft generation is idempotent and versioned

---

# 6. Phase 4 — Submission and Confirmation Tracking

## Objective

Implement Agent 4 with explicit human approval, portal/email submission, confirmation capture, and duplicate prevention.

## 6.1 Submission Trigger

Submission only begins when:

- Application status is `approved_for_submission`
- User explicitly clicks Submit
- Required documents are present
- Idempotency check passes

## 6.2 Portal Submission Adapter Contract

Extend provider adapters with:

```js
{
  prepareSubmissionContext(),
  validateSubmissionReadiness(),
  submitApplication(),
  captureConfirmation(),
  captureFailureArtifacts()
}
```

## 6.3 Submission Paths

### Portal path

- Authenticate
- Navigate to submission workflow
- Populate fields
- Upload documents
- Stop for human confirmation if required
- Submit
- Capture confirmation/ticket number
- Save screenshots and structured logs

### Email path

- Generate provider-specific email
- Attach package
- Send through transactional email provider
- Capture message ID
- Store outbound communication

## 6.4 Idempotency

Use application ID as the primary idempotency key.

Prevent:

- Duplicate portal submission
- Duplicate email submission
- Duplicate confirmation records

## 6.5 Submission API

Add:

```text
POST /api/uci/applications/:id/submit
```

## 6.6 Lifecycle Updates

On success:

- Stage 4 → COMPLETED
- Stage 5 → AWAITING_UTILITY
- Start acknowledgment SLA timer

## 6.7 Submission UI

Add:

- Submit button only after approval
- Submission method
- Confirmation number
- Submitted date
- Failure/retry status
- Human-required state
- Submission audit history

## Phase 4 Acceptance Criteria

- Approved application can be submitted
- PEPCO is the first portal implementation
- Email fallback works for unsupported providers
- Confirmation/ticket number is captured
- Duplicate submissions are blocked
- Submission actions are fully audited

---

# 7. Phase 5 — Communication Intelligence and Thread Management

## Objective

Implement Agent 5 and normalize inbound/outbound utility communications.

## 7.1 Inbound Email Pipeline

Address pattern:

```text
uci-inbound+{tenant_slug}@permitpilot.com
```

Webhook:

```text
POST /webhooks/uci/email-inbound
```

Behavior:

- Resolve tenant
- Persist raw email and attachments
- Match coordination record
- Enqueue classification
- Preserve thread metadata

## 7.2 Outbound Email

Use existing transactional email service.

Requirements:

- Tenant-aware reply-to
- Log every outbound email
- Store provider/application linkage
- Preserve message IDs and thread IDs

## 7.3 Agent 5 — Communication Parser

Classifications:

1. acknowledgment
2. class_of_service
3. design_review_response
4. ciac_invoice
5. equipment_eta_update
6. inspection_release_request
7. meter_set_scheduling
8. energization_confirmation
9. escalation_or_problem
10. request_for_information
11. unclassified

Outputs:

- Classification
- Confidence
- Summary
- Action items
- Human-attention flag
- Matched coordination record
- Downstream trigger

## 7.4 Matching Heuristics

Use:

- Utility ticket number
- External application ID
- Job ID
- Project address
- Utility contact email
- Thread ID
- Provider slug

## 7.5 Human Attention Queue

Add:

```text
GET  /api/uci/communications/needs_attention
POST /api/uci/communications/:id/reclassify
```

UI:

- Needs-attention inbox
- Classification override
- Manual threading
- Action item display

## Phase 5 Acceptance Criteria

- Inbound messages are stored and threaded
- Classification taxonomy is implemented
- Low-confidence messages enter human review
- PEPCO portal messages and email messages share one communications model
- Reclassification is audited

---

# 8. Phase 6 — Class of Service and Design Review Intelligence

## Objective

Implement Agent 6.

## 8.1 Document Processing

Inputs:

- COS letter
- Design review response
- Original load summary
- Submitted application

Extract:

- Voltage
- Service capacity
- Transformer specifications
- Meter location
- Gas pressure/line size
- Utility design conditions
- Cost implications

## 8.2 Discrepancy Engine

Compare utility response against submitted requirements.

Flag:

- Undersized service
- Different transformer or meter location
- New easement requirements
- Additional cost
- Missing information
- Schedule impacts

## 8.3 Outputs

- Structured discrepancy report
- Human-attention flag
- Lifecycle update
- Possible cost record creation

## Phase 6 Acceptance Criteria

- COS/design documents are parsed
- Discrepancies are structured and reviewable
- Human approval is required before accepting material deviations
- Stage 6 updates are audited

---

# 9. Phase 7 — CIAC and Cost Tracking

## Objective

Implement Agent 8 and lifecycle stage 7.

## 9.1 Cost Records

Support:

- CIAC
- Application fees
- Design review
- Meter costs
- Recording
- Courier
- Other provider costs

## 9.2 Cost Workflow

- Capture estimate
- Capture utility invoice
- Calculate variance
- Require review above thresholds
- Record payment
- Track client billing
- Link invoice documents

## 9.3 QuickBooks Integration

Requirements:

- Tenant OAuth
- Idempotent invoice creation
- Utility invoice attachment
- Payment webhook handling
- Retry and manual fallback

## 9.4 Alerts

- Variance >5% → review
- Variance >20% → escalation
- Unpaid utility invoice → attention

## Phase 7 Acceptance Criteria

- Costs are tracked from estimate through billing
- QuickBooks invoices are not duplicated
- Variances are surfaced
- Stage 7 completes only when known costs are handled

---

# 10. Phase 8 — Equipment and Long-Lead Tracking

## Objective

Implement Agent 9.

## 10.1 Equipment Records

Track:

- Transformer
- Switchgear
- Meter
- Regulator
- Service cable
- Other provider equipment

## 10.2 ETA Monitoring

- Daily or weekly scheduled checks
- Portal lookup or email request
- ETA history
- Slip calculation
- Next check-in scheduling

## 10.3 Escalation

- No response for two weeks
- ETA slips by more than two weeks
- Delivery threatens energization target

## Phase 8 Acceptance Criteria

- Equipment records update over time
- ETA history is preserved
- Significant slips generate alerts
- Stage 8 reflects actual procurement state

---

# 11. Phase 9 — Meter Set and Pre-Energization Coordination

## Objective

Implement Agent 11 and supporting milestone workflows.

## 11.1 Meter Set Workflow

- Confirm inspection release
- Request meter set
- Capture scheduled date
- Create milestone
- Send 48-hour readiness checklist
- Track utility crew arrival
- Handle failed or missed meter sets

## 11.2 Stakeholder Notifications

Notify:

- Site contact
- Utility PM
- Project manager
- Client stakeholders

## 11.3 Escalation

- Utility no-show
- Site not ready
- Multiple reschedules
- Inspection release missing

## Phase 9 Acceptance Criteria

- Meter set is scheduled and tracked
- Readiness checklist is sent
- Failed attempts are recorded and escalated
- Stage 9 reflects real site readiness

---

# 12. Phase 10 — Energization and Closeout

## Objective

Implement Agent 12 and lifecycle stage 10.

## 12.1 Energization Confirmation

Capture:

- Energization date
- Meter set completion
- Final meter reading
- Commissioning confirmation

## 12.2 Closeout Artifact Validation

Require:

- Utility energization confirmation
- Final meter record
- Commissioning sign-off
- Paid invoices
- Final communications
- Stage transition history

## 12.3 Closeout Package

Generate PDF containing:

- Project summary
- Provider summary
- Application history
- Communications
- Costs
- Equipment
- Milestones
- Stage history
- Energization evidence

Store in project documents.

## 12.4 Project Rollup

When all utility coordination records reach Stage 10:

- Mark project utility coordination complete
- Emit completion event
- Archive final package

## Phase 10 Acceptance Criteria

- Closeout package is generated
- Missing artifacts block completion
- Energization date inconsistencies require review
- Project-level completion is derived from all utility records

---

# 13. Phase 11 — Portfolio Intelligence and Predictive Scheduling

## Objective

Implement Phase 3 client reporting requirements and predictive dates.

## 13.1 Portfolio API

Add:

```text
GET /api/uci/projects/:projectId/portfolio_view
```

Include:

- Stage counts
- Blocked/escalated records
- Predicted energization dates
- Costs
- Equipment delays
- Action-required communications
- Provider performance

## 13.2 Predictive Energization

Heuristic:

- P50 from historical stage durations
- P90 = P50 × 1.4
- Recalculate on each significant update

Store:

- predicted P50
- predicted P90
- calculation reason
- historical baseline version

## 13.3 Reporting

Add:

- Project dashboard
- Tenant portfolio dashboard
- Quarterly reporting templates
- Exportable summaries

## Phase 11 Acceptance Criteria

- Portfolio view aggregates multiple providers and projects
- P50/P90 are recalculated consistently
- Risk and schedule impacts are visible
- Reports can be exported

---

# 14. Phase 12 — Event Bus, Observability, Alerts, and Operations

## Objective

Complete the operational infrastructure required by the client specification.

## 14.1 UCI Events

Emit:

- `uci.coordination_record.created`
- `uci.coordination_record.stage_changed`
- `uci.coordination_record.escalated`
- `uci.application.drafted`
- `uci.application.submitted`
- `uci.communication.received`
- `uci.communication.classified`
- `uci.communication.needs_attention`
- `uci.cost.estimated`
- `uci.cost.actual_received`
- `uci.cost.variance_flagged`
- `uci.equipment.eta_changed`
- `uci.equipment.eta_slipped`
- `uci.milestone.completed`
- `uci.milestone.missed`
- `uci.energization.confirmed`

## 14.2 Structured Logs

Include:

- agent name
- tenant
- project
- coordination record
- provider
- external application ID
- job ID
- start/end time
- duration
- outcome
- retry count

## 14.3 Alerting

P0:

- Cross-tenant access
- Persistent portal failure
- QuickBooks failure
- Inbound email outage

P1:

- Classification accuracy below threshold
- Equipment slip >2 weeks
- Acknowledgment exceeds 2× SLA

P2:

- CIAC variance
- Predicted P50 slip
- Noncritical integration degradation

## 14.4 Runbooks

Document:

- Portal failure fallback
- MFA/manual intervention
- Token expiry
- Email outage
- Anthropic rate limits
- QuickBooks auth expiry
- Failed document storage
- Failed stage transition
- Tenant access incident

## Phase 12 Acceptance Criteria

- Operational events are emitted
- Alerts route correctly
- Runbooks exist
- UCI failures can be diagnosed without inspecting raw code

---

# 15. Deferred Phases

## Phase 13 — Easement and ROW Coordination

Agent 7 remains deferred per client scope.

Future work:

- Easement drafting
- Survey coordination
- Recording status
- ROW permits
- Holdout escalation

## Phase 14 — Inspection Release Coordinator

Agent 10 remains deferred per client scope.

Future work:

- Inspection release requests
- Jurisdiction coordination
- Release confirmation
- Meter-set prerequisites

## Phase 15 — Advanced Intelligence

Deferred:

- ML-based energization prediction
- Closeout knowledge graph
- Cross-utility conflict hunter
- Easement holdout resolver
- Advanced historical benchmarking

---

# 16. Required Test Program

## Unit Tests

Every agent and shared service must cover:

- Happy path
- Error modes
- Idempotency
- Tenant isolation
- Partial failure
- Retry behavior

## Integration Tests

Required critical paths:

1. Intake → provider mapping → load profile → application draft
2. Review → submit → acknowledgment → design review
3. CIAC → equipment → meter set → energization → closeout
4. Inbound communication → classification → thread → stage transition
5. Portal sync → normalized persistence → lifecycle proposal
6. Cross-provider adapter behavior

## Security Tests

- Tenant A cannot read/write Tenant B
- Project access denial
- Storage access denial
- No token/path leakage
- Service role routes still enforce access

## Portal Tests

For each supported utility:

- Mock HTML/API contract test
- Login/MFA test
- Discovery test
- Detail sync test
- Submission test when implemented
- Failure artifact test

## Classifier Tests

- Labeled validation set
- ≥85% classification accuracy target
- Low-confidence routing
- Human override feedback

---

# 17. Recommended Implementation Sequence

## Immediate

1. Phase 1A — adapters, normalized records, tenant propagation
2. Phase 1B — production document storage
3. Phase 1C — lifecycle mapping
4. Phase 1D — durable sync foundation

## Next

5. Phase 2 — provider mapping and load profiles
6. Phase 3 — application preparation and review
7. Phase 4 — submission and confirmation
8. Phase 5 — communications intelligence
9. Phase 6 — COS/design review

## Later Pilot Completion

10. Phase 7 — costs/QuickBooks
11. Phase 8 — equipment
12. Phase 9 — meter set
13. Phase 10 — closeout
14. Phase 11 — portfolio/prediction
15. Phase 12 — operations/observability

---

# 18. Definition of Done for Full UCI

The UCI module is complete only when:

- Utility providers are identified automatically
- Service loads are structured and reviewable
- Applications are prepared from provider templates
- Human review is mandatory before submission
- Submission captures confirmation/ticket numbers
- Inbound communications are classified and threaded
- COS/design documents are analyzed
- Costs and CIAC are tracked
- Long-lead equipment is monitored
- Meter set and pre-energization are coordinated
- Energization and closeout are documented
- Lifecycle stages update with audit history
- Tenant isolation is proven
- Portal jobs are durable
- Documents are stored securely
- Portfolio reporting is available
- All required agents have tests and operational runbooks

---

# 19. Cursor Merge Instruction

When merging this plan with any existing UCI implementation plan:

1. Treat **CET-2026-UCI-BACKEND-001** as the source of truth.
2. Preserve all client-required lifecycle stages and agents.
3. Remove duplicate, conflicting, or provider-specific architecture.
4. Keep PEPCO as the first adapter, not the shared design.
5. Mark Agents 7 and 10 as deferred where required by the client specification.
6. Keep portal submission human-triggered.
7. Do not mark schema or UI shells as completed functionality.
8. Distinguish:
   - implemented
   - partial
   - stub/UI only
   - missing
   - deferred
9. Preserve backward compatibility with current PEPCO behavior.
10. Produce one implementation roadmap with dependencies, acceptance criteria, migrations, APIs, tests, and deployment gates.
