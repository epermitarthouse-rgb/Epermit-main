# UCI action items and dependency status

Last updated: 2026-08-15

This is the central lifecycle tracker for Utility Coordination Intelligence. Production capability and synthetic/test capability are tracked separately. A synthetic result never makes the corresponding production row complete.

Allowed status values:

- Complete
- Functional with human review
- Test-only / synthetic
- Partial
- Blocked by client dependency
- Blocked by technical dependency
- Not started

## Lifecycle action tracker

| Stage | Feature/action | Status | What works now | Test completed? | Remaining gap | Dependency source | Client dependency? | Technical dependency? | Priority | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Foundation | UCI relational schema | Complete | Core provider, coordination, transition, application, communication, cost, equipment, and milestone tables and migrations exist | Yes — migration and service tests | Verify future schema changes as features expand | Repository migrations | No | No | P1 | Production deployment state is tracked separately from code completeness |
| Foundation | Tenant propagation and RLS | Partial | Tenant IDs, propagation helpers, access service, and cross-tenant tests exist | Yes — local security tests | Live Supabase migration/application and isolation proof | Production environment | No | Yes | P0 | Do not mark complete until live environment verification is recorded |
| Cross-stage | UCI navigation and application workspace | Complete | Persistent Project Workspace entry, operational child pages, UCI hub, record drawer tabs, and `/uci/application-builder` are wired locally | Yes — authenticated headless click-through with Highland Springs plus route/navigation tests | Production deployment is tracked separately from code completeness | Product code / runtime environment | No | No | P1 | Runtime verified real rows and `/uci/records/:id` deep links; no heading-only completion claim |
| Cross-stage | Provider type directory and aliases | Complete | Canonical provider catalog includes electric/gas/water/sewer/telecom entries and Dominion Virginia slug resolution | Yes — provider directory tests | Ongoing catalog maintenance | Provider directory catalog | No | No | P2 | Directory identity is not territory or application-requirement authority |
| Cross-stage | Submissions child route | Complete | Real application/package rows show project, provider/type, package status, lifecycle, blockers, activity, and package deep link | Authenticated runtime — 9 rows; Highland Springs visible | Production deployment only | Local navigation implementation | No | No | P2 | Read-only queue; live submission remains disabled |
| Cross-stage | Inbox child route | Complete | Stored communications render across accessible UCI projects with explicit loading, error, and `No utility communications yet` empty states | Authenticated runtime — 5 rows, loading terminated | Production deployment only | Local navigation implementation | No | No | P2 | Highland Springs itself currently has zero stored communications |
| Cross-stage | Needs Attention child route | Complete | Flagged messages, record errors, application action-required flags, and package blockers render with deep links | Authenticated runtime — 10 flagged items, loading terminated | Production deployment only | Local navigation implementation | No | No | P2 | Classifier/ingestion capability remains separately partial |
| Cross-stage | Portfolio child route | Complete | Real cross-project coordination rows show provider/type, stage/state, activity, readiness blockers, and record actions | Authenticated runtime — 11 records; Highland Springs visible | Production deployment only | Local navigation implementation | No | No | P2 | Separate from firm-wide reporting/export completeness |
| Cross-stage | Portal Harvest route | Complete | Existing dedicated harvest inventory/link/refresh page is mounted with bounded loading and explicit error/empty states | Authenticated runtime — 3 harvested applications | Connector production validation | Local navigation + portal services | Yes | Yes | P2 | Frontend route complete; intake connector breadth remains Partial |
| Cross-stage | Provider Directory child route | Complete | Searchable live provider catalog renders real provider records and portal actions | Authenticated runtime — 56 providers | Catalog maintenance and production deployment | Local navigation implementation | No | No | P2 | Directory identity is not territory authority |
| Cross-stage | COS, CIAC, and Energization routes | Partial | Distinct pages use real structural/cost/date data where available | Source/build checks | Authenticated browser verification and deployment | Local navigation + lifecycle services | No | Yes | P2 | Coming Soon notices are localized to unavailable actions |
| Cross-stage | Knowledge and Territory Evidence routes | Partial | Distinct history-search and provider-resolution pages exist | Source/build checks | Browser verification and deployment | Local navigation implementation | No | Yes | P3 | Knowledge indexing remains unavailable |
| Cross-stage | Miss Utility 811 and Conflicts routes | Not started | Dedicated `Not enabled` pages truthfully expose unavailable features | Authenticated runtime click-through | Connected backends if product scope is approved | Product scope / technical implementation | Yes | Yes | P3 | UI classification is honest; no fake backend capability |
| Stage 1 | Electric provider territory resolution | Functional with human review | Geocoding, electric territory polygons, county fallback, confidence, and human confirm/override work for approved footprint | Yes — resolver and territory tests | Production data verification and boundary maintenance | EIA territory datasets / production storage | No | Yes | P1 | Highland Springs is human-confirmed to Dominion Energy Virginia |
| Stage 1 | Non-electric provider mapping | Functional with human review | Manual selection and coordination initialization work | Partial | Verified gas/water/sewer/telecom territory sources and matching rules | Client/service-territory sources | Yes | Yes | P2 | Do not infer non-electric service territories |
| Stage 1 | Provider setup address reconciliation | Functional with human review | Structured, jurisdiction, and selected portal addresses are compared with explicit acknowledgement | Yes | Broader production address-source verification | Project/client address authority | Yes | No | P1 | Address mismatches block package readiness |
| Intake | Portal harvest inventory | Partial | Harvest queue, matching suggestions, project linking, and durable item storage exist | Yes — portal harvest tests | Production connector breadth, recurring operations, and non-PEPCO verification | Utility portals / credentials | Yes | Yes | P2 | Harvest suggestions do not auto-link ambiguous records |
| Intake | PEPCO portal discovery and document download | Partial | Read-only dashboard/application discovery, MFA resume, scoped download, storage, and evidence work | Yes — fixture and service tests | Production operator validation and ongoing portal-change maintenance | PEPCO portal | Yes | Yes | P1 | Read path only; live submission remains separately gated |
| Intake | Dominion portal discovery | Not started | Provider directory entry only | No | No Dominion adapter, fixtures, credentials flow, or approved automation scope | Dominion portal and client authorization | Yes | Yes | P3 | Synthetic Stage 3 work does not create a Dominion portal adapter |
| Stage 2 | Document processing and role classification | Functional with human review | Native PDF processing, page coverage, role classification, findings, and fallback status persistence work | Yes — document processing tests | OCR/Vision production configuration and manual review of uncertain findings | Uploaded/project documents | No | Yes | P1 | Findings remain evidence, not automatically verified engineering values |
| Stage 2 | Load candidate extraction and verification | Functional with human review | Structured and PDF candidates, provenance, conflicts, approve/edit/reject, and verified snapshots work | Yes — load candidate tests | Continue parser coverage and resolve remaining ambiguous evidence | Project documents / engineer review | Yes | Yes | P0 | Highland Springs has verified connected load, demand, voltage, phase/wire, amperage, meter count, and dates |
| Stage 2 | Engineering calculation and service sizing | Blocked by client dependency | Verified values can be stored without guessed conversions | Partial | Approved QSR/load templates, diversity rules, power-factor policy, and service-sizing criteria | Client engineering standards | Yes | Yes | P0 | No kVA↔kW or sizing rule may be invented |
| Stage 2 | Highland Springs synthetic evidence set | Test-only / synthetic | Seven synthetic PDFs are uploaded, processed, and available to Stage 2/3 workflows | Yes — Highland Springs exercise | Replace with real reviewed project documents for production use | Synthetic pilot fixture | No | No | P2 | Never represent synthetic evidence as client-issued project evidence |
| Stage 3 | PEPCO production package foundation | Partial | Versioned PEPCO manifest, required-field inventory, document mapping, persistence, and review workflow exist | Yes — package builder/bridge tests | Authoritative form verification, artifact generation, worksheet generation, and production submission readiness | PEPCO form/product documents | Yes | Yes | P1 | Existing PEPCO manifest must not bleed into other providers |
| Stage 3 | Dominion production requirements | Blocked by client dependency | Ordinary Dominion build remains `TEMPLATE_NOT_FOUND` | Yes — explicit synthetic opt-in test confirms production lookup stays empty | Obtain and approve authoritative Dominion application fields, documents, signature policy, and delivery method | Dominion-provided material / client review | Yes | No | P0 | No production Dominion manifest exists |
| Stage 3 | Dominion synthetic checklist — Highland Springs | Test-only / synthetic | Explicit test manifest loads only with `checklist_mode=synthetic_test`; all existing verified fields and six synthetic documents can be mapped | Yes — full persisted exercise | Production requirements remain unknown | Synthetic test checklist | No | No | P1 | Label: `SYNTHETIC TEST CHECKLIST — NOT DOMINION PROVIDED` |
| Stage 3 | Synthetic checklist approval gate | Test-only / synthetic | Draft checklist remains incomplete until a user records synthetic approval | Yes — Highland Springs | Add production requirement-source approval only after authoritative source exists | Human test approval | No | No | P1 | Approval is test scope only |
| Stage 3 | Application field mapping | Functional with human review | Project address/type and exact human-verified load values can be evaluated from a versioned manifest | Yes — builder tests and Highland Springs | Expand source resolver only for approved provider fields | Provider manifest + verified Stage 2 values | Yes | Yes | P0 | Unknown source expressions fail closed |
| Stage 3 | Provider-neutral uploaded-document inventory | Functional with human review | Project uploads can be listed without a PEPCO portal application; mappings require explicit user confirmation | Yes — Highland Springs | Add richer provider-neutral suggestions without weakening exclusions | Project document inventory | No | Yes | P1 | Filename suggestions are never confirmed requirements |
| Stage 3 | LOA/signature state | Test-only / synthetic | `unknown`, `unsigned`, and `signed_manual_verified` are persisted; unsigned blocks readiness | Yes — unsigned and manual test-verified states exercised | Production signature policy, accepted signer, and actual signature verification | Client/provider signature policy | Yes | Yes | P0 | Highland source PDF remains named `UNSIGNED`; synthetic override is not proof of a real signature |
| Stage 3 | Package readiness gate | Functional with human review | Missing fields/documents and address review calculate readiness; review and submit now require `ready_for_review` | Yes — regression tests | Production provider completeness still depends on authoritative manifests | Package manifest and Stage 2 evidence | Yes | No | P0 | Incomplete packages can no longer be marked reviewed |
| Stage 3 | Read-only synthetic package export | Test-only / synthetic | Authenticated JSON export contains checklist, fields, mappings, signatures, review, validation, and lifecycle snapshot | Yes — Highland Springs | Production ZIP/form/PDF artifact generation | Approved production artifact format | Yes | Yes | P1 | Export has no signed URLs and performs no external action |
| Stage 4 | PEPCO validation dry run | Partial | PEPCO field/attachment validation and optional browser population stop before final submit by default | Yes — fixture/browser tests | Production portal selector verification and operator acceptance | PEPCO portal | Yes | Yes | P0 | Live PEPCO remains environment- and confirmation-gated |
| Stage 4 | Dominion synthetic validation-only dry run | Test-only / synthetic | Reviewed synthetic Dominion package records validation evidence without email, portal, or lifecycle change | Yes — unit and persisted Highland Springs exercise | None for synthetic scope; production submission remains blocked | Synthetic checklist | No | No | P1 | External side effects are explicitly recorded false |
| Stage 4 | Non-PEPCO email submission | Partial | Microsoft Graph send service and submission persistence exist | Unit tests only | Recipients, attachment resolution, Mail.Send consent, real message IDs, explicit provider authorization, and safe live gate | Client mail routing / Microsoft tenant | Yes | Yes | P0 | Synthetic Dominion path bypasses email before method resolution |
| Stage 4 | Production live utility submission | Blocked by technical dependency | PEPCO live path exists behind explicit gates; no production-ready Dominion path | Fixture tests only | Operator-validated portal/email execution, idempotency, confirmation evidence, and incident handling | Utility portals / mailbox / runbooks | Yes | Yes | P0 | Never infer production readiness from dry-run results |
| Stage 5 | Communication classification and attention queue | Partial | Eleven-category keyword classification, reclassification, and attention views work for persisted communications | Yes — classifier tests | Inbound utility email ingestion, stronger summaries, and lifecycle triggers | Client mailbox and labeled samples | Yes | Yes | P2 | No measured client-domain accuracy yet |
| Stage 6 | Class-of-service/design review | Partial | Structural analysis and discrepancy inventory can be persisted | Yes — foundation tests | Parse actual COS/design documents and compare engineering values | Utility-issued COS/design documents | Yes | Yes | P2 | Human engineering review remains required |
| Stage 7 | CIAC and cost tracking | Partial | Manual cost create/update, estimate/actual, and variance work | Yes — service tests | Invoice parsing, approvals, payment workflow, and QuickBooks bridge | Utility invoices / client billing rules | Yes | Yes | P2 | Existing platform QuickBooks should be extended, not duplicated |
| Stage 8 | Long-lead equipment tracking | Partial | Equipment rows, ETA history, check-in, and slip calculation work | Yes — service tests | Scheduled worker, durable alerts, and utility follow-up integration | Utility ETA communications | Yes | Yes | P2 | Current check-ins are manual |
| Stage 9 | Meter-set preparation | Partial | Idempotent milestone/checklist preparation works | Yes — foundation tests | Inspection release, utility scheduling, notifications, and completion handling | Client/utility scheduling inputs | Yes | Yes | P2 | Agent 10 inspection release remains deferred |
| Stage 10 | Energization and closeout | Partial | Closeout preparation checklist metadata exists | Yes — foundation tests | Confirmation consumer, actual date, artifact validation, archive/export, and project completion | Utility energization confirmation / client closeout policy | Yes | Yes | P2 | No real closeout package generation |
| Portfolio | Project coordination rollup | Partial | Project-level portfolio view, stage counts, and attention KPIs work | Yes — service/UI tests | Tenant/quarter reporting templates and trusted cross-project aggregation | Client reporting specification | Yes | Yes | P2 | Not yet a firm-wide Mission Control export |
| Operations | UCI observability and runbooks | Partial | Durable scrape jobs/events and process-local UCI events provide partial visibility | Partial | Persistent domain events, alert routing, retention policy, DR proof, and runbooks | Client operations policy / platform tooling | Yes | Yes | P1 | Must mature before live submission |
| Testing | Safe lifecycle E2E | Partial | Broad unit/integration tests and the Highland Springs synthetic Stage 3 persisted exercise exist | Yes — synthetic only | Staging UAT and production-safe external integration proof | Client UAT plan / staging environment | Yes | Yes | P0 | Synthetic E2E does not establish production submission capability |

## Client dependency backlog

The following asks are deduplicated across lifecycle stages.

| Dependency | Affected stages | Needed decision or artifact | Current impact | Priority |
|---|---|---|---|---|
| Authoritative Dominion application package requirements | 3–4 | Current Dominion-provided form/checklist, supporting-document list, signature rules, and accepted delivery channel | Production Dominion package remains blocked | P0 |
| Approved QSR electrical calculation standards | 2–3 | Load templates, diversity/demand rules, power-factor policy, service-sizing criteria, and reviewer authority | Engineering calculations and generated worksheets remain blocked | P0 |
| Authorization/signature policy | 3–4 | When LOA is required, acceptable signer, signature form, verification method, and retention expectations | Production signature readiness cannot be calculated | P0 |
| Live submission authorization and operator controls | 4 | Which providers/channels may transmit, named operator role, confirmation UX, rollback/incident policy | All production external submission remains gated | P0 |
| Utility email routing | 4–5 | Approved sender mailbox, recipients by provider/project, subject/body requirements, attachment policy, and Mail.Send consent | Non-PEPCO email is not production-functional | P0 |
| Portal access and automation approval | Intake, 4 | Utility credentials, MFA ownership, terms/authorization, staging/test accounts where available | Non-PEPCO portal work cannot start; PEPCO needs operator verification | P1 |
| Non-electric service-territory sources | 1 | Approved gas/water/sewer/telecom source datasets and conflict rules | Mapping remains manual | P2 |
| Stage completion and manual-transition authority | 1–10 | Acceptance criteria per lifecycle stage and roles allowed to override | Lifecycle remains partially manual and over-permissive | P1 |
| Owner/billing and sensitive-data requirements | 3, 7 | Required account-holder/W-9/tax fields, secure-storage policy, and billing workflow | UI remains Coming Soon; no insecure collection is allowed | P1 |
| McDonald's tenant and portfolio reporting specification | Portfolio | Tenant configuration, grouping, KPIs, quarterly templates, and export format | Firm/quarter reporting remains blocked | P2 |
| Labeled communications validation sample | 5 | Representative utility messages with approved category labels | Classifier accuracy cannot be measured against client target | P2 |
| Pilot UAT scenarios and acceptance criteria | Testing | Named projects, happy/error paths, reviewers, expected artifacts, and sign-off process | Formal UAT cannot close | P1 |
| Retention, backup, and incident-response policy | Operations | Retention periods, restore expectations, alert contacts, and submission incident runbooks | Production operations gate remains incomplete | P1 |

## Stage 3 change log — 2026-08-15

Rows added or materially changed by the Highland Springs work:

- Dominion production requirements — explicitly tracked as client-blocked; still no real manifest.
- Dominion synthetic checklist — added as test-only and exercised end to end.
- Synthetic checklist approval gate — added.
- Application field mapping — exact verified-value paths added.
- Provider-neutral document inventory — PEPCO application prerequisite removed for project uploads.
- LOA/signature state — added and tested in unsigned and manual test-verified states.
- Package readiness gate — strengthened so incomplete packages cannot be reviewed or submitted.
- Read-only synthetic export — added and exercised.
- Dominion synthetic validation-only dry run — added with explicit zero external side effects.
- Production live submission — remains blocked and separate from all synthetic results.

## Local environment verification

- Navigation implementation is uncommitted local work on `main`; it is not deployed.
- Local served-module checks used the Vite frontend at `http://localhost:5001` and backend proxy at `http://localhost:3002`.
- Authenticated headless Chromium verification completed with the Highland Springs user's real session and persisted data.
- Cross-project routes first restrict fan-out to project IDs visible through `coordination_records` RLS, then use bounded API concurrency and 10-second read timeouts. A stalled project can no longer keep the route in permanent loading.
- The documented production host does not yet contain the local child-route changes.

### Frontend route/data audit

| Route | Current data source | Does request resolve? | Real records available? | Why the prior page looked empty/mock | Exact fix |
|---|---|---|---|---|---|
| `/uci` | Selected project plus coordination/detail APIs | Yes | Yes | Expanded sidebar no longer exposed the selected-project command center | Restored persistent Project Workspace entry |
| `/uci/submissions` | RLS-visible UCI project IDs → coordination/detail APIs | Yes, bounded | Yes | Unbounded all-project fan-out and sparse package rendering | Restricted/limited fan-out; rendered package status, lifecycle, blockers, activity, and deep links |
| `/uci/inbox` | RLS-visible UCI project IDs → stored detail communications | Yes, bounded | Yes across accessible projects | Unbounded fan-out and generic empty copy | Bounded reads plus explicit error and `No utility communications yet` state |
| `/uci/needs-attention` | Needs-attention endpoint plus detail record/application blockers | Yes, bounded | Yes | Only flagged messages rendered; package/record blockers were discarded | Combined real messages, record errors, action-required flags, and package blockers |
| `/uci/portfolio` | Coordination, detail, and project portfolio APIs | Yes, bounded | Yes | Sparse stage cards and hanging fan-out | Rendered provider/type, lifecycle, readiness/blockers, activity, and actions |
| `/uci/portal-harvest` | Existing dedicated PEPCO harvest API/page | Yes, bounded | Yes | Existing implementation needed reuse and runtime proof | Retained actual inventory/link/refresh workflow; hid zero metrics while unresolved |
| `/uci/provider-directory` | Provider API | Yes, bounded | Yes | Read had no timeout | Added operational read timeout; retained search and provider portal actions |
| COS / CIAC / Energization | Selected-project coordination/detail APIs | Yes, bounded | Yes where recorded | Missing zero-record copy and indefinite reads | Added bounded reads and explicit empty states |
| Knowledge / Territory | Coordination history / provider-resolution APIs | Yes, bounded | Partial real evidence | Broad fan-out could be slow; empty result was visually blank | Restricted knowledge fan-out and added explicit empty/error states |
| Miss Utility / Conflicts | No connected backend | N/A | No | Capability is not implemented | Kept honest `Not enabled` pages; classified capability as Not started |

### Authenticated route runtime results

| Route | Loading resolved? | Record count | Visible first record / empty state | Deep link works? |
|---|---|---:|---|---|
| `/uci` | Yes | 4 Highland Springs coordination records | McDonald's Highland Springs, VA - LC 451497 workspace | Yes |
| `/uci/submissions` | Yes | 9 | McDonald's Highland Springs, VA - LC 451497 | Yes — application-prep |
| `/uci/inbox` | Yes | 5 | Stored cross-project utility communication | Yes — communications |
| `/uci/needs-attention` | Yes | 10 flagged items | Real flagged message/package blocker | Yes |
| `/uci/portfolio` | Yes | 11 | McDonald's Highland Springs, VA - LC 451497 | Yes |
| `/uci/portal-harvest` | Yes | 3 | Persisted PEPCO harvest application | Linked records expose coordination links |
| `/uci/provider-directory` | Yes | 56 | Live provider catalog record | Provider portal action where configured |
| `/uci/class-of-service` | Yes | 4 Highland Springs records | Highland Springs coordination record | Yes — COS |
| `/uci/ciac-refunds` | Yes | 4 Highland Springs records | Highland Springs coordination record / recorded cost rows | Yes — costs |
| `/uci/energization` | Yes | 4 Highland Springs records | Highland Springs coordination record | Yes — energization-closeout |
| `/uci/miss-utility` | Yes | 0 | `Not enabled` state | N/A |
| `/uci/knowledge` | Yes | 11 | McDonald's Highland Springs, VA - LC 451497 | Yes — lifecycle |
| `/uci/conflicts` | Yes | 0 | `Not enabled` state | N/A |
| `/uci/utility-territory-map` | Yes | 69 project-resolution results | Real provider-resolution evidence | Project workspace link |

