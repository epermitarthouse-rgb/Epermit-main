# UCI action items and dependency status

Last updated: 2026-08-17

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
| Cross-stage | Submissions child route | Partial | Real application/package rows now use one cached operational snapshot instead of project/record fan-out | Source and service tests; authenticated post-fix timing pending | Apply migration and capture cold/warm runtime timing with Highland Springs | Local navigation + operational snapshot API | No | Yes | P2 | Read-only queue; do not mark Complete until measured first-useful-render improvement |
| Cross-stage | Inbox child route | Partial | Stored communications now use the shared cached operational snapshot with fixed DB query count | Source and service tests; authenticated post-fix timing pending | Apply migration and capture PEPCO cold/warm runtime timing | Local navigation + operational snapshot API | No | Yes | P2 | No scrape, sync, OCR, or rebuild occurs on open |
| Cross-stage | Needs Attention child route | Partial | Flagged messages and persisted blockers now come from the same fixed-query snapshot | Source and service tests; authenticated post-fix timing pending | Apply migration and verify partial-child-query failure rendering | Local navigation + operational snapshot API | No | Yes | P2 | Classifier/ingestion capability remains separately partial |
| Cross-stage | Portfolio child route | Partial | Cross-project rollup now uses one shared request and reuses its cache across tabs | Source and service tests; authenticated post-fix timing pending | Apply migration and capture cold/warm runtime timing | Local navigation + operational snapshot API | No | Yes | P2 | Separate from firm-wide reporting/export completeness |
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
| Stage 2 | Provider-aware Agent 2 workspace copy | Complete | Review Queue and source-document guidance uses the coordination provider where relevant, reserves PEPCO application wording for PEPCO portal scope, and keeps manual/project upload guidance provider-neutral | Yes — focused copy tests and frontend lint | Continue applying the same copy convention to future Agent 2 UI | Coordination provider record / workspace UI | No | No | P2 | Copy-only change; extraction and business logic are unchanged |
| Stage 2 | Load candidate extraction and verification | Functional with human review | Structured and PDF candidates, provenance, conflicts, approve/edit/reject, and verified snapshots work | Yes — load candidate tests | Continue parser coverage and resolve remaining ambiguous evidence | Project documents / engineer review | Yes | Yes | P0 | Highland Springs has verified connected load, demand, voltage, phase/wire, amperage, meter count, and dates |
| Stage 2 | Engineering calculation and service sizing | Blocked by client dependency | Verified values can be stored without guessed conversions | Partial | Approved QSR/load templates, diversity rules, power-factor policy, and service-sizing criteria | Client engineering standards | Yes | Yes | P0 | No kVA↔kW or sizing rule may be invented |
| Stage 2→3 | Human engineering-review handoff | Functional with human review | A purpose-specific authenticated action completes active Stage 2 and enters Stage 3; an already-reviewed ready package closes Stage 3, otherwise preparation remains in progress | Yes — service and UI source tests plus Highland Springs persisted exercise | Define production role/acceptance authority beyond existing project write access | Client stage-completion authority | Yes | No | P0 | Synthetic evidence never triggers this transition; transition metadata records the explicit human gate |
| Stage 2 | Highland Springs synthetic evidence set | Test-only / synthetic | Seven synthetic PDFs are uploaded, processed, and available to Stage 2/3 workflows | Yes — Highland Springs exercise | Replace with real reviewed project documents for production use | Synthetic pilot fixture | No | No | P2 | Never represent synthetic evidence as client-issued project evidence |
| Stage 3 | PEPCO production package foundation | Partial | Versioned PEPCO manifest, required-field inventory, document mapping, persistence, and review workflow exist | Yes — package builder/bridge tests | Authoritative form verification, artifact generation, worksheet generation, and production submission readiness | PEPCO form/product documents | Yes | Yes | P1 | Existing PEPCO manifest must not bleed into other providers |
| Stage 3 | Dominion production requirements | Blocked by client dependency | Ordinary Dominion build remains `TEMPLATE_NOT_FOUND` | Yes — explicit synthetic opt-in test confirms production lookup stays empty | Obtain and approve authoritative Dominion application fields, documents, signature policy, and delivery method | Dominion-provided material / client review | Yes | No | P0 | No production Dominion manifest exists |
| Stage 3 | Dominion synthetic checklist — Highland Springs | Test-only / synthetic | Explicit test manifest loads only with `checklist_mode=synthetic_test`; all existing verified fields and six synthetic documents can be mapped | Yes — full persisted exercise | Production requirements remain unknown | Synthetic test checklist | No | No | P1 | Label: `SYNTHETIC TEST CHECKLIST — NOT DOMINION PROVIDED` |
| Stage 3 | Synthetic checklist approval gate | Test-only / synthetic | Draft checklist remains incomplete until a user records synthetic approval | Yes — Highland Springs | Add production requirement-source approval only after authoritative source exists | Human test approval | No | No | P1 | Approval is test scope only |
| Stage 3 | Application field mapping | Functional with human review | Project address/type and exact human-verified load values can be evaluated from a versioned manifest; reviewer UI shows friendly provenance (project record or Agent 2 source document/page) with raw expressions under technical disclosure | Yes — builder tests and 17-row Highland Springs audit | Expand source resolver only for approved provider fields | Provider manifest + verified Stage 2 values | Yes | Yes | P0 | Unknown source expressions fail closed; raw source paths are retained for audit but are not primary reviewer copy |
| Stage 3 | Checklist-based package mapping review | Functional with human review | Each required field/document has an independent `not_reviewed`, `confirmed`, `needs_correction`, or `ready_for_re_review` state; successful mutations update the affected row/counter immediately and all current snapshots must be confirmed before final review | Yes — service/UI helper tests and persisted Highland Springs 11-field/6-document exercise | Production reviewer role/authority remains a client decision | Agent 3 metadata + operator action | Yes | No | P0 | Confirmations reference Agent 2 values without rewriting them; JSONB snapshot comparison is canonical/key-order independent |
| Stage 3 | Provider-neutral uploaded-document inventory | Functional with human review | Project uploads can be listed without a PEPCO portal application; mappings require explicit user confirmation | Yes — Highland Springs | Add richer provider-neutral suggestions without weakening exclusions | Project document inventory | No | Yes | P1 | Filename suggestions are never confirmed requirements |
| Stage 3 | LOA/signature state | Test-only / synthetic | `unknown`, `unsigned`, and `signed_manual_verified` are persisted and shown inline in the single Required documents review table with note and action-scoped controls; unsigned blocks document confirmation/readiness | Yes — unsigned-blocking unit test plus read-only Highland LOA verification | Production signature policy, accepted signer, and actual signature verification | Client/provider signature policy | Yes | Yes | P0 | Signature verification remains separate from document confirmation; Highland source PDF remains named `UNSIGNED`, so the synthetic override is not proof of a real signature |
| Stage 3 | Package readiness gate | Functional with human review | The backend canonical review summary now drives every displayed item state, confirmed/total count, blocker list, **Mark package reviewed** enablement, and the final-review API gate; only explicit final review captures the immutable snapshot | Yes — regression tests, build, and persisted Highland Springs 17/17 exercise | Production provider completeness still depends on authoritative manifests | Package manifest and Stage 2 evidence | Yes | No | P0 | Automated validation is secondary; mapping/signature changes invalidate the affected confirmation until it is explicitly reconfirmed |
| Stage 3 | Read-only synthetic package export | Test-only / synthetic | Authenticated JSON export contains checklist, fields, mappings, signatures, review, validation, and lifecycle snapshot | Yes — Highland Springs | Production ZIP/form/PDF artifact generation | Approved production artifact format | Yes | Yes | P1 | Export has no signed URLs and performs no external action |
| Stage 3 | Structured reviewed-package JSON export | Partial | Synthetic Dominion packages have a read-only JSON route and Builder download action | Synthetic Highland Springs only | Generalize to reviewed production packages; include package/checklist and review versions without presenting JSON as utility-submittable | Product export contract | No | Yes | P1 | Preserve provenance and explicit synthetic/test labels; JSON is an internal structured record, not a utility submission artifact |
| Stage 3 | Complete source-document ZIP export | Not started | Mapped document records retain original filenames and either project-document IDs or PEPCO storage bucket/path metadata | No | Resolve every mapped original under project access, stream unchanged bytes, preserve filenames/provenance, and add a versioned manifest/cover sheet | Existing project-documents storage + package mappings | No | Yes | P1 | Do not flatten, rename, modify, or re-save signed/original documents |
| Stage 3 | Human-readable package summary PDF | Not started | Stored package data is sufficient for project/provider, checklist/version, field schedule, mapped-document inventory, signature state, review status, and synthetic warnings | No | Add a UCI-specific PDF renderer and reviewed-package download endpoint/UI | Existing PDF libraries + package metadata | No | Yes | P1 | Suitable as a cover sheet after implementation; not itself proof of provider acceptance |
| Stage 3 | Field schedule CSV/XLSX export | Not started | Versioned field results, mapped values, sources, statuses, and review snapshots are stored | No | Add stable columns, provenance/version fields, synthetic labeling, and CSV/XLSX download action | Existing CSV/XLSX utilities + package metadata | No | Yes | P2 | Human-review worksheet only unless a provider explicitly accepts the format |
| Stage 3 | Generated provider application PDF/form | Not started | PEPCO has portal selector mappings, but no provider PDF template, AcroForm/coordinate map, or generated application artifact; Dominion production requirements are absent | No | Obtain and version an authoritative provider form plus field/attachment mapping and rendering/validation rules | Provider-issued template and client approval | Yes | Yes | P0 | Expose only when the selected provider/template explicitly supports generation |
| Stage 3 | Combined package PDF | Not started | Individual mapped originals can be PDFs, but UCI has no merge pipeline or package-level compatibility checks | No | Add opt-in merge only for compatible unsigned/copy PDFs, preserve originals separately, define ordering/bookmarks, and record exclusions | Approved package policy + PDF merge implementation | Yes | Yes | P3 | Never replace the ZIP of originals; avoid modifying signed PDFs or implying the merged derivative is an original |
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
- Stage 2→3 lifecycle handoff — added an explicit human completion action; reviewed/ready packages complete Stage 3 without starting Stage 4 or performing submission side effects.
- Agent 3 reviewed-state UX — required fields and documents now have explicit package-mapping confirmations, bulk field confirmation requires an operator prompt, final review is a separate action, and reviewed packages show reviewer/timestamp while retaining request changes/reopen review and the exact reviewed snapshot.
- Package timestamps — UI now uses immutable package `built_at` rather than row `updated_at`, so review or dry-run persistence cannot make a package appear rebuilt after review.

## Local environment verification

- 2026-08-17 Highland Springs lifecycle exercise verified coordination `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69` and Agent 3 package `6314b620-8cc3-4642-a08c-28c2949e921f`, then used the explicit human Stage 2 completion gate. Transition `a4f71988-0a5f-467a-9360-29ef12c4b209` moved Stage 2 `IN_PROGRESS` to Stage 3 `COMPLETED` because the package was both `ready_for_review` and `reviewed`.
- Historical post-transition verification recorded the package as `reviewed`; `submitted_at`, `submission_method`, and utility ticket remained null. Existing validation-only evidence recorded validation passed, with email, portal, live submission, and lifecycle advancement all false.
- 2026-08-17 Agent 3 review-semantics runtime exercise verified the exact package/coordination pair, bulk-confirmed 11 current required fields, confirmed six current mapped documents, observed `ready_for_final_review`, and used the separate final action to produce `reviewed` with an 11-field/6-document immutable snapshot.
- 2026-08-17 review-state UX regression was traced to JSONB object-key reordering combined with bytewise snapshot comparison and UI code waiting for a full coordination refresh. Snapshot comparison is now canonical, Builder applies the mutation-returned application immediately, and the record workspace applies row-scoped mutation state immediately while refreshing in the background.
- 2026-08-17 final-review gate audit found one exact Highland blocker: `document:authorization` was displayed as **Confirmed** by a component-local optimistic override while its persisted confirmation referenced `signature_verified_at=2026-08-17T09:17:32.971Z`; the current signed mapping had `2026-08-17T10:16:06.263Z`, so backend canonical readiness correctly resolved it to `not_reviewed` and reported 16/17. Agent 3 application API rows and successful review/signature mutation responses now carry the backend-computed `package_review_summary`; both package UIs consume it for item state, counts, blocker text, button enablement, and final-review messaging, with no optimistic confirmation gate.
- The corrected Highland runtime sequence reconfirmed only `document:authorization`, observed canonical 17/17 and `ready_for_final_review=true`, then marked package `6314b620-8cc3-4642-a08c-28c2949e921f` reviewed at `2026-08-17T10:25:38.015Z`. The locked snapshot contains 11 fields, six documents, and the current LOA verification timestamp. `submitted_at`, `submitted_by`, submission method/ticket, validation-only metadata, Stage 3 `COMPLETED` state, and transition count remained unchanged; email, portal, live submission, lifecycle advancement, and Stage 4 actions remained false/absent.
- Persisted UX sequence passed after a fresh database read: `0/17 → 1/17 → 3/17 → 11/17`; setting Phase to `needs_correction` persisted with package status `needs_correction` and `10/17` confirmed. The 17-row audit found 11 unique field requirements and six unique live document mappings, no duplicate/stale mapping, exact matches to Agent 2 verified inputs, and source-document/page provenance for every Agent 2 field.
- After that exercise, only the Highland Springs package-review state was reopened: final `draft_status=draft`, `reviewed_by/reviewed_at=null`, `package_review.status=not_reviewed`, and zero item confirmations. Structural package status remains `ready_for_review`; Agent 2 row/status/load values, package load snapshot, six document mappings, signature state, synthetic-checklist approval, submission/validation metadata, Stage 3 lifecycle state, and transition count were byte-for-byte unchanged.
- 2026-08-17 signature-timeout audit: request `89825d3e-ce1a-4049-959c-a4f72afd3fa4` was the 10-second coordination-detail refresh issued after the signature mutation, not the mutation request. The LOA write had persisted (`signed_manual_verified`, verified at `2026-08-17T08:08:28.762Z`) and package readiness was `ready_for_review`; the UI incorrectly kept the signature action busy and reported refresh failure as mutation failure.
- Signature updates now perform one bounded `coordination_applications` update with an in-memory readiness delta, return the updated application immediately, and refresh detail in the background. Runtime `signed → unsigned → signed` verification completed in 608 ms, 648 ms, and 592 ms respectively; final state is signed and `ready_for_review`, with no email, portal, submission, or lifecycle side effect.
- 2026-08-17 Application Package UI cleanup removed the visible legacy document-mapping and package-document duplicates. The Required documents table is now the single primary document-review surface, including inline change/remove, review confirmation, and LOA signature status/note/actions. Read-only Highland verification found six mappings and authorization row `authorization` / `06_Synthetic_LOA_UNSIGNED.pdf` with `signature_required=true`, `signed_manual_verified`, note `Runtime timeout-fix verification`, and no package, Agent 2, signature, or lifecycle mutation during this cleanup.
- 2026-08-17 urgent Application Package render regression (`editing is not defined`) was traced to document editor/signature JSX accidentally inserted inside the hidden legacy mapping loop while its `editing` variable existed only in the new Required documents loop. The misplaced JSX was removed, the controls were mounted in the correct row scope, and the legacy mapping/list branches now render nothing. Server-render regressions cover normal review, field **Edit mapping**, and document **Change** editor states so a row-level control cannot crash the coordination workspace again. A read-only render using the live Highland coordination returned Application fields, Required documents, LOA signature/note, field edit, and document change controls with both legacy duplicate headings absent.
- 2026-08-17 LOA signature reconciliation fix: the signature write and mutation response were already correct, but the coordination workspace applied the response only to child-local override state while the parent detail retained its stale package application. The response application is now reconciled into parent detail immediately, the row also keeps its action-local override, and background refresh failure only emits a warning. Live Highland `unsigned → signed_manual_verified → fresh read → unsigned → fresh read` passed; each mutation response and fresh database read agreed, and the exact original package documents/metadata/review fields were restored afterward (`signed_manual_verified`). Signed rows render **Signed — manually verified ✓** with **Mark unsigned**; unsigned rows render **Verify signed**.
- 2026-08-17 coordination-record detail timeout audit used frontend request ID `c985f8cb-8050-4728-8e09-ea851619e274` and Highland coordination `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69`. The exact request is `GET /api/uci/coordination/:id`. The pre-fix route did not log or echo request IDs, so historical backend receipt of that exact ID cannot be proven from server logs; the browser did start the fetch and aborted it at the shared 10-second operational-read timeout.
- The slow path was persisted-data hydration, not scraping or rebuilding: the record row was 269,624 bytes (268,542-byte metadata, including 266,420 bytes of `uci_document_processing`) and the two application rows were 445,743 bytes. The application query alone measured 4,298 ms; a later cold full-record read measured 5,160 ms. Agent 3's package row duplicated the 188,941-byte Agent 2 `load_summary`, while the package's own `application_package` metadata was 61,680 bytes.
- Detail loading now fetches the record once with selective persisted metadata, excludes `uci_document_processing` (Load Profile lazily uses the existing manifest endpoint), and hydrates the large `load_summary` only on the Agent 2 draft. It does not invoke scrape, OCR, package build, Microsoft Graph, portal discovery, harvest refresh, or lifecycle mutation code.
- Child hydration remains parallel but is now failure-isolated. Transitions, applications/load profile/package, costs, equipment, milestones, and recent communications each return their own timing/error entry; a failed child returns an empty child result and localized workspace warning while the persisted record and healthy sections continue rendering. The frontend immediately renders the selected project-list record while hydration is pending and no longer replaces a valid record with `No detail loaded` after a timeout.
- The URL hydration effect is one-way (`coordinationParam !== detailId`) and tab changes only update `tab`; no Agent 3 circular/refetch loop was found. Inactive Radix tab content is not mounted, so opening Overview does not trigger Load Profile's manifest read. The old all-or-nothing `Promise.all` did allow one child failure to suppress every detail section; that behavior is removed.

### Coordination detail runtime timings

| step | duration | success/failure | blocking? |
|---|---:|---|---|
| record selective projection | 455 ms | success | Yes — establishes record/project |
| project access | 830 ms | success | Yes — authorization |
| transitions | 332 ms | success | No |
| applications + Agent 2 load summary | 589 ms | success | No |
| costs | 309 ms | success | No |
| equipment | 312 ms | success | No |
| milestones | 326 ms | success | No |
| recent communications | 323 ms | success | No |
| complete persisted response | 1,878 ms | success, 263,449 bytes | Yes — HTTP response |
| simulated communications child | <5 ms test fixture | failure isolated; record/transitions/applications returned | No |

- Runtime persisted-data verification found Overview at Stage 3 `COMPLETED`, Agent 2 Load Profile application `c58bbc78-bb9b-4147-b7f8-b7075976a88e`, and Agent 3 Application Package `6314b620-8cc3-4642-a08c-28c2949e921f`, with zero child failures and zero external calls. Application Package and Load Profile render regressions passed; record route/tab-switch regressions passed; the simulated single-child failure test passed. No Highland row or lifecycle state was mutated.
- Every detail response now returns/echoes `x-request-id`, `x-backend-duration-ms`, `Server-Timing`, and `hydration.steps[]` entries with request ID, duration, success/failure, and blocking classification. Pre-fix frontend timeout could mask a backend response that completed after browser abort, but HTTP cannot deliver a usable partial JSON body; the UI therefore had no successful partial response to render. The new response explicitly carries partial child success.
- 2026-08-17 latency audit found a browser-side `projects × coordination records` fan-out: each operational route loaded providers, queried RLS-visible coordination project IDs, fetched every project's coordination list, then fetched every record detail (six DB reads per detail). Portfolio and Needs Attention added another per-project request. The route waited for every request or 10-second timeout before rendering any row.
- The shared fix is `GET /api/uci/operations/snapshot`: one authenticated request, one accessible-project RPC, and three parallel persisted-data queries (records/providers, applications, communications). React Query caches the same snapshot across Submissions, Inbox, Needs Attention, and Portfolio for 60 seconds and disables focus/mount refetches and automatic retries.
- Frontend `[uci-route-timing]` and backend `[uci-operational-read]` / `[uci-operational-snapshot]` logs correlate with `x-request-id`; response headers expose backend and Server-Timing durations. Authenticated local timings are recorded below. The four affected page rows remain Partial until the access RPC migration is deployed and its four-query production path is timed.
- The snapshot endpoint has no imports or calls to portal discovery, portal sync, OCR, document processing, application building, or harvest refresh code.
- Navigation implementation is uncommitted local work on `main`; it is not deployed.
- Local served-module checks used the Vite frontend at `http://localhost:5001` and backend proxy at `http://localhost:3002`.
- Authenticated headless Chromium verification completed with the Highland Springs user's real session and persisted data.
- The prior bounded browser fan-out remains only for unrelated/project-scoped foundation routes; the four operational pages use the shared snapshot endpoint and do not issue per-project or per-record requests.
- The documented production host does not yet contain the local child-route changes.

### Frontend route/data audit

| Route | Current data source | Does request resolve? | Real records available? | Why the prior page looked empty/mock | Exact fix |
|---|---|---|---|---|---|
| `/uci` | Selected project plus coordination/detail APIs | Yes | Yes | Expanded sidebar no longer exposed the selected-project command center | Restored persistent Project Workspace entry |
| `/uci/submissions` | Shared operational snapshot → persisted applications | Yes, one request | Yes | Browser fetched seven project lists and eleven record detail bundles before rendering | Replaced fan-out with one cached aggregate read |
| `/uci/inbox` | Shared operational snapshot → persisted communications | Yes, one request | Yes across accessible projects | Browser waited for all record detail bundles before showing PEPCO communication | Replaced fan-out with one cached aggregate read |
| `/uci/needs-attention` | Shared operational snapshot → persisted attention messages and blockers | Yes, one request | Yes | Per-project attention plus per-record detail requests blocked the full page | Aggregated in fixed-query backend snapshot; optional child failure preserves rows |
| `/uci/portfolio` | Shared operational snapshot → records, blockers, and attention counts | Yes, one request | Yes | Per-project portfolio plus per-record detail requests blocked the full page | Aggregated in fixed-query backend snapshot and shared tab cache |
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

### Operational latency verification — 2026-08-17

Real authenticated records: 69 accessible projects, seven projects with UCI records, 11 coordination records, nine applications (including Highland Springs), and five recent communications (including PEPCO).

| Route | Before UCI API requests | Before slowest / settled | After UCI API requests | After backend | After first useful render | Warm first useful render |
|---|---:|---:|---:|---:|---:|---:|
| `/uci/submissions` | 19 | 4,042 ms / 6,583 ms | 1 | 1,408 ms | 1,883 ms | 30 ms returning to tab |
| `/uci/inbox` | 19 | 3,789 ms / 6,591 ms | 1 | 1,453 ms | 1,806 ms | 98 ms |
| `/uci/needs-attention` | 26 | 3,965 ms / 8,172 ms | 1 | 1,450 ms | 1,780 ms | Cache behavior covered by shared-key route tests |
| `/uci/portfolio` | 26 | 3,870 ms / 8,650 ms | 1 | 1,442 ms | 1,787 ms | 33 ms |

- “Before” replays the prior browser algorithm against the same real API records: provider catalog, seven project coordination reads, eleven record-detail reads, plus seven route-specific project reads for Attention/Portfolio.
- “After” uses the migration-compatible access path currently available in the connected environment (seven DB calls, including one attempted access RPC). Applying `20260817100000_uci_operational_snapshot.sql` reduces this to the designed four DB calls without changing the response.
- Provider Directory and Portal Harvest each issue one UCI API read on open; they do not share the project/record fan-out and were not moved onto this snapshot.
- Simulated communications-query failure rendered all 11 portfolio records with the partial-coverage warning and terminated loading.

## Stage 2/3 hardening pass — 2026-08-17

Production and test status after the one-pass lifecycle audit:

- Stage 2 remains **Functional with human review**. The coordination lifecycle record is the canonical human-completion source. Once the record has advanced beyond Stage 2, Agent 2 renders **Stage 2 complete / 100%**, clears historical missing-input blocker copy, and records a human-accepted sizing exception without inventing an engineering rule.
- Stage 3 package mapping/review remains **Functional with human review** for an approved provider manifest and **Test-only / synthetic** for Highland Springs Dominion. The backend-computed `package_review_summary` is the canonical source for item status, correction count, final-review eligibility, reviewer, timestamp, and locked snapshot.
- Dominion production readiness remains **Blocked by client dependency**. Synthetic mode is no longer automatically selected merely because a provider slug is Dominion; only an existing explicitly synthetic package can be rebuilt in synthetic mode.
- Reviewed packages are now locked against rebuild. An operator must use **Request changes / Reopen review** first; the prior reviewed snapshot and review history remain preserved.
- Stage 3 validation controls cannot route an unsupported non-PEPCO production package into the email submission path. The visible Builder control is validation-only for PEPCO or an explicit Dominion synthetic package; no Stage 4 email, portal submit, or lifecycle side effect was added.
- Successful build, checklist, field/document mapping, signature, review, and supported validation actions apply the mutation-returned application immediately. Follow-up reads run independently, so a refresh timeout cannot convert a persisted success into a failed action or leave the clicked control spinning.
- The standalone Builder render crash caused by reading `validationMetadata` before initialization is fixed.
- Stage 2 completion now uses the canonical Agent 3 review summary before deciding whether Stage 3 is complete; stale `draft_status=reviewed` and `package_status=ready_for_review` labels cannot advance the lifecycle.

### Stage 2/3 regression matrix

| Step | Action | Expected | Actual | Persisted after refresh? | Pass/fail |
|---|---|---|---|---|---|
| Stage 2 source documents | Upload/process and document reprocess | Action-scoped progress; project storage → processing → findings import; bounded recovery | Source and resilience tests pass; reprocess remains document-scoped and sequential | Covered by service/source tests; current authenticated rerun unavailable | Pass (automated); runtime pending |
| Stage 2 review queue | Approve, edit-and-approve, reject, unresolved | One candidate mutation; provenance retained; no inferred values | Load-candidate integration tests pass, including failed mutation rollback and stale-candidate handling | Service persistence tests pass | Pass |
| Stage 2 verified inputs | Manual verified input | Validated human value and provenance persist | Existing API/service path retained; no engineering conversion introduced | Service persistence tests pass | Pass |
| Stage 2 workspace | Verified Inputs, Load Schedule, Service Sizing, Package Readiness | One coherent readiness state; accepted human sizing exception is not open | Lifecycle-backed completion now renders 100%, Stage 2 complete, and closes the human-review/sizing exception row | Lifecycle state is persisted backend source | Pass (automated); runtime pending |
| Stage 2 completion | Explicit human completion / duplicate click | One transition; Stage 3 disposition from canonical package review; clicked control only spins | Same-tick duplicate guard added; stale reviewed/package labels fail closed | Transition integration tests pass | Pass |
| Stage 3 build | Build/rebuild | Explicit provider mode; response drives UI; reviewed package remains locked | Synthetic mode is no longer provider-slug automatic; reviewed rebuild returns `PACKAGE_REVIEW_LOCKED` | Builder integration tests pass | Pass |
| Stage 3 checklist | Synthetic checklist approval | Test-only approval; response settles locally | Mutation response now updates both package UIs immediately | Service/UI source tests pass | Pass (automated); runtime pending |
| Stage 3 fields | Confirm, Confirm all, Edit mapping, Needs correction | Canonical row status; correction reason required; active corrections block final review | Backend summary drives status/count/gate; mutation responses update row immediately | Package review tests pass | Pass |
| Stage 3 documents | Confirm, Change, Remove | Mapping mutation is scoped; confirmation invalidates when mapping changes | Response-driven update added; candidate/detail refresh is non-blocking | Document bridge and package review tests pass | Pass |
| Stage 3 signature | Unknown/unsigned/manual verified | Signature readiness remains separate; unsigned blocks confirmation | Bounded mutation and immediate returned state retained | Signature tests pass | Pass |
| Stage 3 validation | Validate reviewed supported package | Validation only; no email, portal submit, lifecycle advance | Visible validation is limited to PEPCO dry run or explicit Dominion synthetic; unsupported providers fail closed | Synthetic validation service test passes; PEPCO browser tests need installed binary | Partial — environment dependency |
| Stage 3 final review | Mark reviewed | Requires all current canonical items confirmed and no active correction | Backend gate and UI use the same summary | Review service/render tests pass | Pass |
| Stage 3 reopen | Request changes → correction → re-review | Reason stored; original snapshot preserved; reconfirmation required | Existing correction/snapshot history retained; rebuild requires explicit reopen | Review tests pass; prior Highland persisted exercise passed | Pass |
| Stage 3 locked state | Open reviewed package / rebuild attempt | Snapshot remains immutable; no completion actions except reopen/export/validation | Reviewed rebuild is blocked in UI and backend | New lock integration test passes | Pass |
| Stage 3 export | Synthetic JSON export | Read-only package snapshot; no external side effect | Existing explicit synthetic export retained | Prior Highland persisted exercise passed | Pass (synthetic only) |
| Resilience | Mutation succeeds, follow-up refresh fails | Persisted success remains visible; spinner settles | Build/checklist/mapping/signature/review/supported validation now use mutation response first | Build/lint/source tests pass | Pass (automated); runtime pending |
| Read-only performance | Open workspace | No scrape/OCR/rebuild/external action; child failure is localized | Selective hydration/failure isolation retained; no new read-side effects | Detail resilience tests pass | Pass |

Verification for this pass:

- Frontend production build: passed.
- Changed Stage 2/3 frontend lint: passed.
- Focused frontend regression tests: 20/20 passed.
- Focused Stage 2/3 backend tests: 51/51 passed (the broader focused run also passed 126/126).
- Full UCI backend suite: 620/626 passed; all six failures require a missing local Playwright Chromium binary and are confined to Stage 4 PEPCO browser-submit tests.
- Current post-change authenticated Highland Springs browser rerun: not completed. The IDE browser service returned no navigable tab after create/navigate attempts. Therefore this pass does **not** newly mark runtime-only production rows Complete; prior persisted Highland evidence above remains historical evidence, not a substitute for a post-change UAT run.

## Agent 3 correction/re-review hardening — 2026-08-17

Scope remained Stage 2/3 only. No Stage 4, email, portal submission, scrape, OCR, document processing, lifecycle advancement, or external utility action was invoked.

Root causes corrected:

- Reopen, item correction, and mapping change were implemented as separate happy-path additions rather than one state machine. The UI used passive **Needs correction** copy, every field correction pointed at Agent 2, and the package-level correction could obscure the actual requirement.
- A document remap called the full package-slot refresh path. That path reloaded project, every project document, every coordination application, Agent 2 load data, every required field, and all readiness inputs even though the operator changed one slot.
- Candidate lists were loaded eagerly and successful remaps triggered both a full coordination-detail refresh and another candidate fetch. A persisted mutation therefore appeared coupled to slower child reads.
- Same-document selection had no UI no-op guard. The server could rewrite confirmation timestamps and rerun readiness for an unchanged mapping.
- The PEPCO mapping branch referenced an undefined `doc` variable while inferring an unsigned filename.

Fixes:

- Reviewed → Reopen preserves the immutable reviewed snapshot, review history, confirmed item snapshots, reviewer/reason/timestamps, Stage 2 data, mappings, signature state, and lifecycle state. Reopen only changes Agent 3 review state to **Needs changes**.
- **Flag for correction** is now an explicit reason-gated action. The persisted item audit records requirement, reviewer, timestamp, note, and mapping snapshot. Fixed mappings resolve to **Ready for re-review** and require explicit reconfirmation.
- Field fixes route by provenance: Agent 2-backed values open the verified-input workspace, project-backed values open that exact project’s edit form, and package-local mappings remain in Agent 3. Agent 3 never writes Agent 2 values.
- The package correction summary now presents `Requirement | Issue | Note | Fix issue`. Document fixes open the affected row; LOA fixes retain a separate **Verify signed** action.
- Opening Change is local. Candidates load lazily once and selection is local. A successful current-package remap returns its canonical application/review summary and does not block on detail refresh or candidate reload.
- Current built packages use a targeted one-slot document write and in-memory document/signature readiness delta. Legacy/incomplete metadata alone falls back to the compatibility refresh. Mapping history stores prior and next mappings without replacing reviewed snapshots.
- Selecting the currently mapped source disables Apply and shows **Already mapped · No change**. The server also returns `no_change=true` without a write or readiness recompute if called directly.
- A changed document invalidates only that requirement, producing **Ready for re-review** after the flagged mapping changes. Reconfirmation is required before final review.
- Signature verification remains separate from document confirmation. Unsigned required LOA remains unready; verification updates the returned row immediately and still requires document reconfirmation when its confirmation snapshot is stale.
- Mutations have action-scoped busy state, no automatic mutation retry, and use their own response as authoritative state. Optional refresh failure remains a warning and cannot blank the workspace.

### Correction-path timing evidence

| Action | Before HTTP requests / behavior | After HTTP requests | Backend ms | UI settle ms |
|---|---|---:|---:|---:|
| Reopen | Mutation plus UI dependence on broader refresh in older flow | 1 mutation; optional refresh does not block | Live capture unavailable | Mutation response |
| Flag for correction | Passive label / incomplete action semantics | 1 mutation | Live capture unavailable | Mutation response |
| Open Change picker | Candidate work coupled to package render | 0 | <1 local | <1 local |
| Load candidates | Eager/repeated candidate fetch | 1 lazy read, reused | Live capture unavailable | Read response |
| Apply same document | Could mutate and recompute | 0 from UI; server no-op guard | <1 local UI; no DB write | <1 local |
| Apply different document | Request `f8e0b50c-f145-4719-a317-66c2da480c6a` timed out while the old path could reload package/project/Agent 2 inputs | 1 targeted mutation; no blocking detail/candidate refetch | Live capture unavailable | Mutation response |
| Reconfirm requirement | Item mutation plus refresh coupling in older UI | 1 mutation | Live capture unavailable | Mutation response |
| Final review | Separate final action | 1 mutation | Live capture unavailable | Mutation response |

The local service-level correction sequence (reopen → flag → mapping change → ready for re-review → reconfirm → second immutable review snapshot) completed inside the 3.2 ms in-memory test case; the combined correction, mapping, signature, and isolated-child-failure suites completed 26/26 in 189 ms. These are regression timings, not substitutes for authenticated database/browser timings. The Cursor browser execution backend had no navigable tab and then became unavailable, so an honest post-change Highland HTTP/backend/UI timing capture could not be produced in this pass.

### Negative-path UAT result

- Automated/service UAT: **Pass**. Reviewed snapshot preservation, reason requirement, reviewer/timestamp audit, same-document no-op, one-slot remap, ready-for-re-review, explicit reconfirmation, second snapshot version/history, unsigned LOA blocking, and child-read failure isolation passed.
- Frontend render UAT: **Pass**. Correction action labels, provenance-specific fix links, project edit deep-link, document editor, canonical blockers, and LOA controls passed; production build and changed-file lint passed.
- Authenticated Highland Springs runtime UAT for coordination `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69` / package `6314b620-8cc3-4642-a08c-28c2949e921f`: **Blocked by the browser execution environment**, not by application code. No Highland row was mutated by this blocked attempt.

Closure:

- Stage 2 correction safety can close at its existing **Functional with human review** level; this pass did not mutate or regress Agent 2.
- Agent 3 code-level P0/P1 correction flow is closed by tests/build, but formal Stage 3 runtime/UAT closure remains pending one authenticated Highland rerun with timing capture.
- Genuine external dependencies remain authoritative Dominion requirements and production signature/reviewer policy. The temporary browser-runner outage is a verification-environment dependency, not a product dependency.

## Stage 4 / Agent 4 Microsoft email audit — 2026-08-17

Audit only; no email was sent. The existing Graph path is a reusable foundation, not a production-capable submission channel.

| Existing capability | Existing code/service | Can Agent 4 reuse it? | Missing piece |
|---|---|---|---|
| Delegated Microsoft OAuth and encrypted token refresh | `microsoft-graph-auth.service.js`, `microsoft-token-crypto.js`, `microsoft_mailbox_connections` | Yes — reuse token storage/refresh and authenticated mailbox status | Current scopes are `openid profile offline_access User.Read Mail.Read email`; add tenant-approved `Mail.Send` before outbound use |
| Mailbox identity hint | Default/expected mailbox is `Permitting@commun-et.com` in the Microsoft route, frontend API, and auth service | Only after hardening | The callback accepts the signed-in Graph principal and only warns on mismatch; enforce an approved sender/mailbox policy rather than relying on the hint |
| Inbox read and PEPCO verification-code retrieval | `microsoft-mailbox.service.js` → `pollGraphMailboxForPepcoMfaCode`; PEPCO discovery services inject it into portal MFA | Yes — only for narrow PEPCO MFA retrieval | No general utility inbox ingestion, acknowledgment matching, reply tracking, or durable Graph message import |
| Graph outbound transport skeleton | `uci-email-submission.service.js` → `graphSendMail` → `POST /v1.0/me/sendMail` | Reuse only after safety and correctness work | Payload has no `toRecipients`; no recipient config exists; OAuth lacks `Mail.Send`; no production send proof |
| Subject/body construction | `buildUtilitySubmissionEmailContent` | Reuse as a starting template | No user-visible preview/draft, editable approved recipient/body contract, or binding to the reviewed snapshot |
| Graph file-attachment encoding | `graphSendMail` maps supplied base64 files to `fileAttachment` | Reuse encoding helper | Production route never supplies `resolveAttachmentsFn`; referenced package documents are listed in the body but zero file bytes are attached |
| Reviewed package snapshot | `uci-package-review.service.js` stores `package_review.reviewed_snapshot` | Reuse as source material | Send path reads the current application/project instead of the reviewed snapshot; no immutable outbound payload hash/version |
| Submission eligibility | `validateSubmitEligibility` requires reviewed, ready Agent 3 package and rejects rows already marked submitted | Reuse as a precondition | No atomic send claim/idempotency key; concurrent/retried requests can send before `submitted_at` is persisted |
| Graph send result handling | `sendUtilitySubmissionEmail` and `submitViaEmail` persist success/failure metadata | Reuse error normalization only | Graph `sendMail` normally returns `202` without a message body; current `graph-send-${Date.now()}` is synthetic, not a Graph message ID |
| Sent timestamp | `submitViaEmail` writes an application `submitted_at` after the HTTP call | Partially | It is local post-call time, not Graph `sentDateTime`; no sent-message lookup/reconciliation |
| Communication/audit schema | `coordination_communications` supports direction, external message ID, recipient, timestamp, thread ID, and idempotency key | Yes — schema can be reused | Email send path creates no communication row and stores no recipient/body snapshot, Graph `internetMessageId`, or `conversationId` |
| Retry behavior | Failed attempt metadata is persisted and a later call is allowed | Only as failure state | `retryable: true` is advisory; there is no queue, backoff, attempt history, send claim, dedupe, or ambiguous-202 reconciliation |
| Thread/acknowledgment model | Communication schema has `external_message_id` and `thread_id`; PEPCO portal adapter uses them | Schema only | Graph path does not capture `internetMessageId`/`conversationId`, ingest replies, or match utility acknowledgment to the submission |
| Explicit human send confirmation | Package review is a prior human gate | No | The UI submit button calls the endpoint directly with no email preview or second send confirmation; non-PEPCO routing immediately invokes Graph |

Exact non-PEPCO path: `POST /api/uci/applications/:id/submit` → `submitApplicationPackage` → `resolveSubmissionMethod` (every provider except PEPCO becomes `email`) → `submitViaEmail` → `sendUtilitySubmissionEmail` → `graphSendMail`. Synthetic Dominion is intercepted by `runSyntheticChecklistValidationDryRun` before method resolution and does not call Graph.

Required environment variable names are `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_REDIRECT_URI`, and `MS_GRAPH_TOKEN_ENCRYPTION_KEY`. Tokens are delegated authorization-code/refresh tokens encrypted in `microsoft_mailbox_connections`, keyed by PermitPilot user. The connected principal is intended to be `Permitting@commun-et.com`, but this is not currently enforced.

Recommended Agent 4 reuse boundary: reuse delegated OAuth/token refresh, mailbox status, reviewed-package snapshot, eligibility checks, Graph request/error helpers, and the communication schema. Do not expose the existing non-PEPCO submit endpoint as a production send action until recipient policy, preview/draft, explicit confirmation, reviewed-snapshot attachment resolution, immutable outbound payload/version, atomic idempotency, real Graph identifiers, outbound communication audit, and inbound acknowledgment/thread reconciliation are implemented and tenant-approved.

## Stage 4 end-to-end submission audit — 2026-08-17

Audit only. No email was sent, no utility portal was opened or changed, and no submission or lifecycle row was mutated. Focused Stage 4 fixture/service tests passed 21/21.

### 1. Stage 4 architecture definition

The intended state machine is:

`Stage 3 reviewed` → `Stage 4 preparation/validation` → `prepared preview` → `explicit human approval` → `external submission attempt` → `external success proof captured` → `Stage 4 COMPLETED` → `Stage 5 AWAITING_UTILITY`.

These states must remain distinct:

- **Validation / dry run:** checks fields, attachments, provider configuration, and optionally portal selectors. It performs no external submission.
- **Prepared:** freezes the exact outbound method, sender, recipients/destination, subject/body or portal fields, attachment bytes/hashes, and provider/template versions. It is still unsent.
- **Human-approved:** a named operator approves that immutable prepared snapshot for one transmission. Stage 3 package review is necessary but is not this Stage 4 approval.
- **Actually submitted:** an external side effect occurred and method-appropriate success evidence was reconciled. Only this state may set real submission timestamps and advance the lifecycle.

Current code does not model prepared or Stage 4 human-approved states. One `POST /api/uci/applications/:id/submit` endpoint combines validation and possible transmission. A dry run is persisted as `agent_draft_metadata.submission`, but the single object is overwritten by the next result and is not an attempt ledger.

### 2. Submission modes

#### Email / Microsoft Graph

- Path: submit endpoint → all non-PEPCO providers default to `email` → delegated Graph token → `POST /v1.0/me/sendMail`.
- Current OAuth scopes are `openid profile offline_access User.Read Mail.Read email`; `Mail.Send` is absent.
- The Graph payload has subject, text body, optional file attachments, and `saveToSentItems`, but no `toRecipients`. There is no approved provider-recipient configuration.
- The production route supplies no attachment resolver, so package documents are named in the body but zero file bytes are attached.
- The connected mailbox is only hinted as `Permitting@commun-et.com`; it is not enforced. The audited database currently contains zero `microsoft_mailbox_connections` rows.
- Graph `sendMail` normally returns `202` without a message resource. `graph-send-${Date.now()}` is locally fabricated and is not a Graph message ID, `internetMessageId`, or `conversationId`.
- No outbound `coordination_communications` row, immutable recipient/body/attachment snapshot, sent-item reconciliation, thread handoff, atomic send claim, or idempotency key exists.
- Result: reusable transport/auth foundation only; not production-functional and not safe for Stage 4 UAT.

#### Portal / PEPCO and BGE

- PEPCO has field/attachment mappings, validation, fixture-tested Playwright population, a default-off live environment flag, explicit booleans for portal population/live confirmation, final-click logic, screenshot/HTML capture, and ticket/reference extraction.
- The HTTP route does not inject a Playwright page or `runBrowserPopulate`. Therefore a normal API request cannot execute the browser adapter even when `portal_populate=true`; it falls back to validation-only.
- The selectors and confirmation proof are fixture-tested, not operator-verified against the production PEPCO portal.
- Critical ambiguous-outcome defect: after the final portal click, `submitted_pending_confirmation` is classified by the service as `dry_run` because no ticket was found. An external side effect may already have occurred, yet the record says dry run and remains retryable by another request.
- Screenshot base64 and an HTML excerpt are embedded in mutable application JSON metadata rather than stored as a durable proof artifact with hash, retention, and access controls.
- BGE is cataloged as `primary_portal_type=portal` with placeholder automation and no portal URL, but method resolution sends every non-PEPCO provider to email. There is no BGE submission adapter, mapping, browser flow, or ticket capture.
- Result: PEPCO validation is synthetic-testable; live PEPCO is test scaffolding not production-wired. BGE submission is not implemented.

#### Manual external submission

No Stage 4 manual-external workflow exists. There is no controlled way to record method, external destination, actual external datetime, submitted-by operator, external ID/ticket, notes, or uploaded proof and then advance Stage 5. Directly editing application fields would bypass attempt history, proof validation, and the human gate.

### 3. Readiness gate

Required production gate:

- canonical Agent 3 review summary is `reviewed`;
- every current field/document mapping is confirmed, no active correction exists, and signed-document policy is satisfied;
- immutable reviewed snapshot exists and still matches the prepared outbound snapshot;
- Stage 3 is `COMPLETED`;
- provider method/configuration is explicitly approved, not inferred by fallback;
- validation passed for the exact prepared snapshot;
- sender/destination, recipient or portal credential, attachment bytes, and provider requirements are available;
- a named authorized operator approves the exact prepared snapshot immediately before transmission.

Current `validateSubmitEligibility` checks agent-draft identity, package idempotency key, no `submitted_at`, `draft_status=reviewed`, and `package_status=ready_for_review`. It does not recompute `summarizePackageReview`, require `reviewed_snapshot`, verify Stage 3 lifecycle state, bind validation to the snapshot, validate provider configuration, or require a separate Stage 4 approval. `needs_changes` currently blocks through `draft_status`, but the gate relies on mutable labels instead of the canonical review summary. Incomplete, changed, or needs-correction packages must fail closed at the API even if stale labels say reviewed.

### 4. Submission snapshot

Agent 3 correctly retains `package_review.reviewed_snapshot` with fields, documents, signatures, load values, reviewer, and timestamp. Stage 4 does not submit from that snapshot:

- email content reads the current application/project;
- portal context reads current `load_summary`, `package_documents`, and project/address data;
- no prepared outbound snapshot, attachment byte hash, destination, payload hash, provider adapter version, or approval signature is stored before the side effect;
- portal success stores field and attachment-reference snapshots after execution, while email stores only subject, count, and referenced-document IDs/names.

The reviewed package snapshot is a usable source, but the exact sent payload is neither immutable nor reproducible.

### 5. Human confirmation

The required UX is **Prepare** → **Preview exact outbound package** → **Confirm & submit** with a second, method-specific confirmation and named operator. No external call may occur during prepare/preview.

Current submission buttons are hidden in both package UIs. If exposed, one click invokes the submit endpoint directly. PEPCO accepts client-supplied booleans; email ignores Stage 4 confirmation entirely and sends immediately after eligibility. There is no preview of sender, recipients, subject/body, attachment bytes, portal fields, destination, or snapshot hash, and no durable approval record. Stage 3 “Mark package reviewed” is not sufficient authorization to transmit externally.

### 6. Attempts and idempotency

- No `submission_attempts` table or append-only attempt collection exists.
- Each dry-run/failure/success overwrites `agent_draft_metadata.submission`; history, start/end times, actor, request ID, payload hash, and ambiguous outcome are lost.
- The package idempotency key identifies the Agent 3 package row; it is not a transmission idempotency key.
- `submitted_at` blocks later calls only after success persistence. Concurrent requests can both pass eligibility and both perform the external side effect.
- The frontend does not automatically retry transport failures for this POST, which is correct. It can refresh auth once after a confirmed `401 INVALID_JWT`, but there is no server-side claim/dedupe.
- Email failures are labeled retryable without reconciling whether Graph accepted an ambiguous request. Portal no-ticket after click is incorrectly labeled dry run.

Required: atomic attempt claim, unique idempotency key derived from prepared snapshot + method + approved action, explicit states (`prepared`, `approved`, `sending`, `submitted`, `confirmed`, `failed_before_side_effect`, `outcome_unknown`), duplicate-click protection, and reconciliation before any retry where the side effect may have happened.

### 7. Proof/result by method

- **Email:** require approved sender/recipients, immutable MIME-equivalent payload and attachment hashes, Graph request correlation, sent-item lookup, real Graph message resource ID plus `internetMessageId` and `conversationId`, accepted/sent time, and outbound communication row. None is currently captured.
- **Portal:** require provider, final URL, submitted field/attachment hashes, final-click time, external ticket/application reference, confirmation HTML/screenshot stored as durable evidence, and explicit `outcome_unknown` when confirmation is absent after click. Fixture-only ticket extraction exists; durable proof does not.
- **Manual external:** require method, destination, actual submitted datetime, submitted-by operator, external ID/reference where available, notes, and proof upload/hash. Missing entirely.

### 8. Stage 4 → Stage 5

The service advances by writing Stage 4 `COMPLETED` and then Stage 5 `AWAITING_UTILITY` only after its email or portal branch reports confirmed. Validation-only and synthetic Dominion dry runs do not advance, which is correct.

The production semantics are still unsafe:

- email HTTP acceptance is treated as confirmed even though no real Graph message/thread proof is captured;
- portal advancement requires a ticket, but a final click without a ticket is mislabeled dry run rather than outcome unknown;
- the two lifecycle transitions and application success update are separate non-transactional writes, so partial state is possible;
- lifecycle transition helpers do not enforce expected prior stage/state or idempotency.

Only reconciled external success may advance. Prepared-unsent, validation-only, synthetic dry run, failed-before-side-effect, and outcome-unknown attempts must not.

### 9. Acknowledgment/thread handoff

The schema can store `external_message_id`, `thread_id`, sender/recipient, timestamp, and communication idempotency. PEPCO portal sync can normalize portal communications and propose lifecycle changes. The Graph submission path creates no outbound communication, stores no real conversation identifiers, performs no general inbox ingestion, and cannot correlate replies or acknowledgments. Highland Springs currently has zero communications and `acknowledgment_received_at=null`.

Stage 5 needs a submission-to-thread handoff record, inbound Graph/portal ingestion, provider-specific acknowledgment matching, human review for ambiguous matches, and an explicit acknowledgment event. It must not infer acknowledgment merely from local send acceptance.

### 10. Performance and failure safety

- Read-only application/workspace opens do not import or invoke Graph send or portal-submit functions. External actions are behind POST handlers/click handlers; current submit controls are hidden.
- Validation-only PEPCO without browser injection does not open the portal.
- No blind frontend transport retry is configured for submission.
- Safety gaps remain: no request claim, duplicate-click/double-request protection, timeout/ambiguous-send reconciliation, transactional success+lifecycle update, or persistent attempt log. A portal final click followed by missing confirmation is the highest-risk current failure mode.
- Large screenshot base64 stored in application JSON can inflate the already-large application row and degrade read performance.

### 11. Highland Springs safe synthetic Stage 4 design

Safe flow: load the explicit Dominion `synthetic_test` checklist → require the current canonical Agent 3 package to be reviewed and correction-free → create a clearly labeled validation attempt → validate the immutable reviewed snapshot locally → display the exact results and warnings → retain `external_side_effects` all false → remain at Stage 3 `COMPLETED`.

It must not resolve an email/portal method, request Graph tokens, call Graph, open/populate a portal, set real `submitted_at`/`submitted_by`/submission method, fabricate a message ID or utility ticket, create an outbound communication, or advance Stage 4/5. The existing synthetic interception follows those no-side-effect rules, but it persists into the mutable `submission` slot and uses the same submit endpoint/name; a future implementation should give validation its own attempt type/API and preserve history.

Read-only database verification during this audit found:

- package `6314b620-8cc3-4642-a08c-28c2949e921f`: Dominion synthetic, `draft_status=needs_changes`, package review `needs_changes`, retained prior 11-field/6-document reviewed snapshot, `submitted_at/submitted_by/submission_method/ticket=null`;
- prior validation evidence: `validation_only=true`, `dry_run=true`, validation passed, and all external-side-effect flags false;
- coordination `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69`: Stage 3 `COMPLETED`, no Stage 4/5 transition, no acknowledgment, and zero communications.

Because the concurrent Agent 3 correction state is now `needs_changes`, the current eligibility gate correctly rejects another synthetic validation until it is re-reviewed. Historical validation remains test evidence only.

### 12. Stage 4 capability matrix

| Capability | Current implementation | Works now? | Synthetic-testable? | Production gap/dependency |
|---|---|---|---|---|
| Stage 4 validation state | Dry-run result stored in mutable application metadata | Yes, limited | Yes | Separate validation attempts and bind to immutable snapshot |
| Prepared outbound snapshot | No prepared entity/payload hash | No | No | Snapshot schema, attachment bytes/hashes, destination and adapter version |
| Stage 4 human approval | Stage 3 review only; submit API has no separate approval | No | UI concept can be tested | Authorized role, preview/confirm UX, durable one-use approval |
| Readiness gate | Mutable draft/package labels and already-submitted check | Partial | Yes | Canonical review recomputation, lifecycle/config/snapshot validation |
| Graph email transport | Delegated auth and `/me/sendMail` skeleton | No production send | Mock only | Mail.Send, enforced mailbox, recipients, attachments, approved routing |
| Graph identifiers/thread | Fabricated local message ID; no communication row | No | Mock only | Sent-item reconciliation, real IDs/conversation, inbound ingestion |
| PEPCO validation | Field/attachment validation; mocked browser population | Yes locally | Yes | Production mapping/selectors and operator verification |
| PEPCO live submission | Test-injectable page flow; HTTP route has no browser orchestration | No | Fixture only | Authorized session/credential orchestration, durable proof, unknown-outcome handling |
| BGE submission | Provider catalog placeholder; falls through to email | No | No adapter | Authoritative method, requirements, portal/email authorization and adapter |
| Manual external submission | Absent | No | No | Method/date/operator/external ID/proof workflow |
| Attempt history/idempotency | Last-result overwrite; post-success submitted check | No | Race tests possible | Append-only attempts, atomic claim, unique key, reconciliation |
| Method proof | PEPCO fixture ticket/evidence; email subject/count only | Partial fixtures | Yes | Durable artifacts and real external identifiers |
| Stage 4 → 5 transition | Separate application update and two lifecycle writes | Fixture-only | Yes | Transaction/idempotency and reconciled-success requirement |
| Stage 5 acknowledgment handoff | Schema/PEPCO sync foundations | Partial | Fixture only | Outbound linkage, Graph inbox/replies, matching and acceptance event |
| Read-only safety | No submission side effect on page open; controls hidden | Yes | Yes | Preserve with regression tests when Stage 4 UI is added |
| Highland synthetic validation | Explicit synthetic interception; no external/lifecycle side effects | Yes | Yes | Keep separate from production readiness and preserve attempt history |

### P0 before Stage 4 UAT

1. Split validation/preparation/approval/execution APIs and states; keep production execution disabled until all gates pass.
2. Add immutable prepared submission snapshots and append-only attempt records with atomic idempotency/claiming.
3. Recompute canonical Agent 3 review readiness at submit time and require Stage 3 `COMPLETED`; fail closed for corrections or snapshot drift.
4. Add exact preview and explicit one-use human confirmation by an authorized role.
5. Define `outcome_unknown`; never mark post-click/no-confirmation portal attempts as dry run or blindly retry.
6. Make application success + Stage 4/5 transition transactional/idempotent, or add a reconciliation state machine.
7. Keep Highland Springs on the explicit synthetic validation-only path with zero external calls and zero lifecycle advancement.

### P1 before pilot

1. Complete one approved production channel end to end with real destination configuration, attachments, proof, and operator runbook.
2. For Graph: tenant-approved `Mail.Send`, enforced sender, recipient policy, payload preview, real identifiers, sent-item reconciliation, outbound communication row, and inbound acknowledgment matching.
3. For PEPCO: wire authorized Playwright/session orchestration, verify live selectors under approved test conditions, store proof outside mutable application JSON, and define incident/reconciliation handling.
4. Implement manual external submission with proof and the same approval/attempt/lifecycle controls.
5. Add duplicate/concurrency, ambiguous timeout, partial DB failure, stale review, attachment drift, and acknowledgment-correlation tests.
6. Add persistent observability, audit retention, access controls for proof artifacts, and no-side-effect read regressions.

### Production/client dependencies

- Approved utility delivery method per provider; BGE and Dominion must not inherit the generic non-PEPCO email fallback.
- Authoritative Dominion/BGE requirements, accepted forms/attachments, signature policy, and submission destination.
- Named sender mailbox, approved recipients/subject/body rules, Microsoft tenant `Mail.Send` consent, and mailbox identity enforcement.
- Portal automation authorization, terms review, credentials/MFA ownership, test account if available, and operator acceptance.
- Named Stage 4 approver role, separation-of-duties decision, incident/duplicate-submission procedure, retention policy, and proof access policy.
- Utility acknowledgment definition and labeled inbound examples for Stage 5 matching.

