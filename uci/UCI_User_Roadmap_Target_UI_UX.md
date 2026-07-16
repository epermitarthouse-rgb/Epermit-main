# UCI User Roadmap — Target UI/UX

This is the expected user journey for the complete UCI module. It follows the client’s 10-stage utility-coordination lifecycle and keeps human review at the points where the specification requires it.

---

## 1. Open Utility Coordination

**User action**

```text
Dashboard
→ Utility Coordination
```

**What the screen should show**

- Selected project
- Project address
- Current utility-coordination status
- Existing coordination records
- Items needing attention
- Clear primary action based on the project’s current stage

**Reason**

The user should enter one project-specific workspace rather than seeing unrelated provider and agent information.

**Expected outcome**

The system either shows the existing utility records or guides the user to initialize coordination.

---

## 2. Select the project

**User action**

```text
Utility Coordination
→ Select project
```

The project card should show:

- project name
- permit/reference number
- structured address
- scraped portal address, when available
- utility-coordination status

### If no project is selected

Show:

```text
Select a project to begin utility coordination.
```

Hide the remaining setup controls.

### If the project has no address

Show:

```text
Project address is missing.
Add or confirm the address before identifying utility providers.
```

**Reason**

Provider mapping depends on the physical project location. The system must not infer a utility without a usable address.

**Expected outcome**

One project and one confirmed address become the active context for all later UCI actions.

---

## 3. Confirm the project address

**User action**

```text
Project
→ Review address
→ Confirm address source
```

### If structured and scraped addresses match

The system should preselect the address and ask the user to confirm it.

### If they differ

Show both:

```text
Structured project address
Scraped utility-portal address
```

The user selects which one applies.

### If neither exists

The user must add the address before continuing.

**Reason**

The client’s D2.2 architecture identifies utilities from the actual project location. A wrong address can select the wrong provider.

**Expected outcome**

The project has one confirmed address with its source recorded.

---

# Stage 1 — Provider Mapping

## 4. Identify utility providers

**User action**

```text
Provider Mapping
→ Find utilities
```

### Future automatic flow

The system should:

1. Geocode the confirmed address.
2. Check the point against electric service-territory polygons.
3. Check whether the address is near a territory boundary.
4. Fall back to county candidates if polygon resolution fails.
5. Show the source, confidence, and alternatives.

### Current manual fallback

Until automatic territory matching is complete:

```text
Select utility type
→ Search provider
→ Add provider
```

Utility types remain separate:

- Electric
- Gas
- Water
- Sewer
- Telecom

**Reason**

A project can have several parallel utility scopes, each requiring its own lifecycle and record.

**Expected outcome**

One `coordination_record` is created for every confirmed utility and scope.

Example:

```text
PEPCO — Electric
Washington Gas — Gas
WSSC — Water/Sewer
Verizon — Telecom
```

---

## 5. Review provider confidence

### Clean polygon match

Show:

```text
Suggested provider: PEPCO
Confidence: High
Source: EIA Energy Atlas
```

The user confirms or overrides.

### Boundary or multiple-provider result

Show:

```text
Multiple possible providers
Human confirmation required
```

Present the shortlist and evidence.

### Manual selection

Show:

```text
Selected manually using project knowledge
```

Require a confirmation checkbox.

**Reason**

The client requires all selections to remain visible, confirmable, overridable, and auditable.

**Expected outcome**

Every utility record has:

- confirmed provider
- service type
- resolution method
- source
- confidence
- confirming user
- confirmation time
- override reason, when applicable

---

# Stage 2 — Load Profile and Service Sizing

## 6. Open the utility coordination record

**User action**

```text
Coordination records
→ Select provider
→ View
```

The user enters the provider-specific workspace.

Example:

```text
PEPCO — Electric
Stage 2: Load Profile
State: In Progress
```

**Reason**

Electric, gas, water/sewer, and telecom loads require different units, documents, calculations, and review rules.

**Expected outcome**

The user works only on the selected utility scope.

---

## 7. Process source documents

**User action**

```text
Load Profile
→ Source Documents
→ Process Documents
```

The system should:

- register every utility-related document
- process every page
- extract native text and tables
- identify pages requiring Vision or OCR
- store evidence by document and page
- classify findings by UCI stage

**Reason**

Agent 2 must build its load profile from project evidence, not hardcoded assumptions.

**Expected outcome**

The user sees:

- total documents
- completed, partial, and failed documents
- processed pages
- Vision/OCR pages pending
- extracted findings
- source evidence

---

## 8. Review extracted findings

**User action**

```text
Load Profile
→ Review Queue
```

Suggested review tabs:

- Pending
- Approved
- Unresolved
- Rejected
- Stale / History

The user reviews each finding against its document and page evidence.

### Approve

Use when the value is clearly supported.

### Reject

Use when it is noise, duplicate, or semantically wrong.

### Mark unresolved

Use when engineering interpretation is required.

### Add manual verified input

Use when the engineer or client provides an approved value outside the parsed documents.

**Reason**

Extracted values must never become project load values automatically without review.

**Expected outcome**

Only reviewed values move into Verified Inputs.

---

## 9. Build verified inputs

**User action**

```text
Load Profile
→ Verified Inputs
```

The screen should organize values by service type.

### Electric

- voltage
- phase
- wire configuration
- connected load
- demand load
- service amperage
- lighting load
- motor load
- water heating
- service configuration

### Gas

- appliance BTU/h
- total connected gas load
- pressure requirement
- meter or regulator requirement

### Water/sewer

- fixture demand
- GPM
- DFU
- meter size
- incoming pressure
- sanitary capacity

### Telecom

- carrier
- service type
- drops
- entrance requirements

**Reason**

Verified Inputs are the controlled source of truth for calculations and package generation.

**Expected outcome**

Every accepted value contains:

- value and unit
- source document
- page
- evidence
- verification method
- verified by
- verified at

---

## 10. Generate the load schedule

**User action**

```text
Load Profile
→ Load Schedule
→ Generate or Recalculate
```

### If approved factors/templates exist

The system calculates the schedule using approved engineering rules.

### If approved factors are missing

Show:

```text
Demand calculation cannot be completed.
An approved template or engineering factor is required.
```

### Important safeguards

- Do not treat panel totals as project totals.
- Do not convert kVA to kW without a verified power factor.
- Do not treat HVAC thermal capacity as electric load.
- Do not add fixture detail rows to a summary total twice.

**Reason**

The application and service-size recommendation depend on defensible, project-level values.

**Expected outcome**

A reviewed load schedule is generated without undocumented assumptions.

---

## 11. Determine service sizing

**User action**

```text
Load Profile
→ Service Sizing
```

The screen should compare:

- connected load
- demand load
- requested service
- existing service
- proposed service
- voltage, phase, and configuration
- engineering notes

### If complete

Show:

```text
Service sizing ready for review
```

### If incomplete

Show the exact missing values.

**Reason**

Stage 2 is not complete merely because documents were processed. The service size must be supported by verified project values.

**Expected outcome**

The user approves the final service-sizing recommendation.

---

## 12. Complete Stage 2

**User action**

```text
Package Readiness
→ Review missing items
→ Mark Load Profile complete
```

The button remains disabled until required values and approvals exist.

**Expected outcome**

The record moves from:

```text
Stage 2 — IN_PROGRESS
```

to:

```text
Stage 2 — COMPLETED
Stage 3 — IN_PROGRESS
```

---

# Stage 3 — Application Preparation

## 13. Build the application package

**User action**

```text
Application Preparation
→ Create application
```

The system selects the provider-specific template and fills it using:

- project information
- verified load summary
- requested service
- project contacts
- site address
- existing and proposed service details

**Reason**

Application values must come from approved project data rather than fresh AI interpretation.

**Expected outcome**

A draft utility application is created.

---

## 14. Review package documents

**User action**

```text
Application Preparation
→ Package Documents
```

Expected slots:

- utility application form
- load calculation worksheet
- site plan
- single-line diagram
- equipment cut sheets
- letter of authorization
- supporting correspondence
- required project-specific attachments

### If a required document is missing

Show:

```text
Application blocked
Missing: Single-line diagram
```

### If a scraped file matches a slot

The user confirms the mapping.

**Reason**

The application must be complete before submission.

**Expected outcome**

Every required slot is either filled, waived with a reason, or visibly blocking the package.

---

## 15. Human application review

**User action**

```text
Application Preparation
→ Review Application
```

The user can:

```text
Approve for submission
Request changes
```

The system should display:

- application values
- load-summary snapshot
- attachments
- missing requirements
- validation warnings
- reviewer notes

**Reason**

The client specification explicitly prohibits automatic submission without human review.

**Expected outcome**

The application becomes:

```text
Reviewed
```

or returns to:

```text
Needs changes
```

---

# Stage 4 — Submission

## 16. Submit the reviewed application

**User action**

```text
Reviewed Application
→ Submit
```

The user chooses the available method:

- Portal
- Email
- Manual submission record

### Portal path

The system:

1. Logs into the utility portal.
2. Populates the form.
3. Uploads attachments.
4. Stops for final confirmation when required.
5. Submits.
6. Captures confirmation number and evidence.

### Email path

The system:

1. Creates the utility submission email.
2. Attaches the package.
3. Sends through the approved mailbox.
4. Stores the message ID and evidence.

### Manual path

The user records:

- submission date
- confirmation reference
- submitter
- evidence

**Reason**

Every submission must be idempotent and traceable.

**Expected outcome**

The application records:

- submission method
- submitted by
- submitted at
- ticket or message ID
- evidence
- package snapshot

The record advances to:

```text
Stage 5 — AWAITING_UTILITY
```

---

# Stage 5 — Acknowledgment

## 17. Monitor utility acknowledgment

**User action**

Usually none. The system monitors email and portal communications.

The user can open:

```text
Communications
→ Needs Attention
```

The system should identify:

- acknowledgment
- ticket assignment
- utility project manager
- requests for information
- missing documents
- problems

**Reason**

Submission does not mean the utility has formally accepted or assigned the work.

**Expected outcome**

When acknowledgment is confirmed, the system stores:

- utility ticket number
- utility PM
- acknowledgment date
- next required action

Then Stage 5 becomes complete.

---

# Stage 6 — Class of Service / Design Review

## 18. Review the received COS or design document

**User action**

```text
Communications
→ Class of Service
→ Review
```

The system extracts:

- assigned voltage
- service capacity
- service configuration
- meter location
- transformer details
- conduit requirements
- utility responsibilities
- customer responsibilities
- design conditions
- validity dates
- required next documents

**Reason**

The utility’s approved design may differ from the submitted request.

**Expected outcome**

A structured COS record is created with source evidence.

---

## 19. Compare submitted versus utility-approved values

**User action**

```text
COS Review
→ Compare to Submission
```

The screen should show:

| Submitted | Utility response | Result |
|---|---|---|
| Requested service | Assigned service | Match/discrepancy |
| Requested voltage | Assigned voltage | Match/discrepancy |
| Submitted demand | Utility design basis | Match/discrepancy |
| Meter location | Approved location | Match/discrepancy |

### If no material discrepancy

The user approves the COS.

### If discrepancies exist

The system creates a human-attention item.

**Reason**

Agent 6 must not silently accept a smaller service, different configuration, or new design condition.

**Expected outcome**

Stage 6 becomes:

- `COMPLETED` when accepted
- `IN_PROGRESS` or `ESCALATED` when discrepancies remain

---

# Stage 7 — CIAC and Costs

## 20. Review costs

**User action**

```text
Costs
→ Review estimate or invoice
```

The user sees:

- cost type
- estimated amount
- actual amount
- variance
- utility invoice
- payment status
- client billing status

### High variance

Show:

```text
Human approval required
Actual cost differs materially from estimate.
```

**Reason**

Utility costs must be reviewed before payment or client billing.

**Expected outcome**

Approved costs proceed to payment and QuickBooks billing without duplication.

---

# Stage 8 — Equipment and Long-Lead Items

## 21. Track long-lead equipment

**User action**

```text
Equipment
→ View tracker
```

The screen shows:

- transformer
- switchgear
- meter
- regulator
- service cable
- initial ETA
- current ETA
- ETA history
- slip duration
- next check-in

**Reason**

Long-lead equipment often determines the real energization date.

**Expected outcome**

The user sees schedule risk early and receives alerts when ETA slips exceed the configured threshold.

---

# Stage 9 — Pre-Energization Coordination

## 22. Complete readiness checks

**User action**

```text
Pre-Energization
→ Readiness Checklist
```

Expected items:

- inspection release received
- service equipment approved
- meter set scheduled
- site accessible
- switchgear installed
- utility crew scheduled
- site contact confirmed

### If a requirement is missing

The record remains blocked.

**Reason**

A failed meter set wastes time and delays energization.

**Expected outcome**

The project is confirmed ready for the scheduled utility work.

---

## 23. Coordinate the meter set

**User action**

```text
Meter Set
→ Confirm schedule
```

The system should:

- record the utility-confirmed date
- send the 48-hour checklist
- track rescheduling
- record completed or missed status
- escalate no-shows and failed attempts

**Expected outcome**

The meter-set milestone is completed with date and evidence.

---

# Stage 10 — Energization and Closeout

## 24. Confirm energization

**User action**

```text
Closeout
→ Confirm energized
```

The system may also detect an energization confirmation from communications.

The user verifies:

- actual energization date
- final meter set
- commissioning result
- final meter information
- utility confirmation

**Reason**

The system must distinguish scheduled energization from completed energization.

**Expected outcome**

The actual service date is stored.

---

## 25. Generate the closeout package

**User action**

```text
Closeout
→ Generate Package
```

The package should include:

- project and provider summary
- stage history
- communications
- approved application
- COS/design response
- cost records and receipts
- equipment history
- meter-set evidence
- energization confirmation
- closeout documents

### If something is missing

Show the exact missing artifact and keep closeout blocked.

**Reason**

The final record must be complete and auditable.

**Expected outcome**

The closeout PDF is archived in project documents.

---

## 26. Complete utility coordination

When one utility record is complete:

```text
PEPCO — Stage 10 Complete
```

When all utility records are complete:

```text
Project Utility Coordination — Complete
```

**Reason**

A project may have electric complete while gas, water, or telecom remains open.

**Expected outcome**

Project completion is based on all required coordination records, not only one provider.

---

# Persistent UI areas

## A. Needs Attention

Accessible from:

```text
Utility Coordination
→ Needs Attention
```

Shows:

- ambiguous provider selections
- missing load values
- rejected or unresolved findings
- failed submissions
- utility RFIs
- COS discrepancies
- cost variances
- equipment delays
- SLA breaches
- failed meter sets
- missing closeout evidence

**Purpose**

Give users one actionable queue rather than making them inspect every project manually.

---

## B. Communications

Accessible from:

```text
Utility Coordination
→ Communications
```

Shows:

- inbound and outbound messages
- classification
- linked project and provider
- summary
- action items
- attachments
- confidence
- human-review status

**Purpose**

Preserve the complete utility conversation and prevent messages from being lost or attached to the wrong project.

---

## C. Portfolio

Accessible from:

```text
Utility Coordination
→ Portfolio
```

Shows:

- projects by stage
- items needing attention
- predicted energization dates
- cost rollup
- equipment delays
- SLA risks
- client and provider filters

**Purpose**

Allow Commun-ET and the client to manage many projects without opening each record.

---

## D. Provider Directory

Accessible from:

```text
Utility Coordination
→ Provider Directory
```

This should be a secondary reference/admin screen, not the main user workflow.

Shows:

- provider display name
- legal name
- utility type
- territory-data status
- portal status
- CET relationship
- active status
- supported automation
- verification contacts

**Purpose**

Manage provider configuration without overwhelming the project-level workflow.

---

# Stage status language

Every record should consistently use:

| Status | Meaning |
|---|---|
| Not started | No work has begun |
| In progress | Commun-ET is actively working |
| Awaiting utility | Waiting for utility response; SLA running |
| Blocked | A required dependency is missing |
| Escalated | Delay or issue requires human action |
| Completed | Stage requirements are satisfied |

---

# Core UX rule

At every screen, the user should see:

```text
Where am I?
What is complete?
What is missing?
What should I do next?
Why is the next action blocked?
What will happen after I click?
```

The UI should present one primary next action based on the current stage, while technical logs, provider metadata, source provenance, and audit history remain available as secondary detail.
