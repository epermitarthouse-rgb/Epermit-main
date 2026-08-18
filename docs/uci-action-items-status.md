# UCI action items and dependency status

Last updated: 2026-08-18

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
| Stage 3 | Application field mapping | Functional with human review | Project address/type and exact human-verified load values can be evaluated from a versioned manifest; reviewer UI shows friendly provenance (project record or Load Profile Analyzer source document/page) with raw expressions under technical disclosure | Yes — builder tests and 17-row Highland Springs audit | Expand source resolver only for approved provider fields | Provider manifest + verified Stage 2 values | Yes | Yes | P0 | Unknown source expressions fail closed; raw source paths are retained for audit but are not primary reviewer copy |
| Stage 3 | Checklist-based package mapping review | Functional with human review | Each required field/document has an independent `not_reviewed`, `confirmed`, `needs_correction`, or `ready_for_re_review` state; operators use **Confirm** or reason-required **Request change**, successful mutations update the affected row/counter immediately, and all current snapshots must be confirmed before final review | Yes — service/UI helper tests and authenticated persisted Highland Springs 17-item exercise | Production reviewer role/authority remains a client decision | Application Builder metadata + operator action | Yes | No | P0 | Confirmations reference Load Profile Analyzer values without rewriting them; JSONB snapshot comparison is canonical/key-order independent |
| Stage 3 | Provider-neutral uploaded-document inventory | Functional with human review | Project uploads can be listed without a PEPCO portal application; mappings require explicit user confirmation | Yes — Highland Springs | Add richer provider-neutral suggestions without weakening exclusions | Project document inventory | No | Yes | P1 | Filename suggestions are never confirmed requirements |
| Stage 3 | LOA/signature state | Test-only / synthetic | `unknown`, `unsigned`, and `signed_manual_verified` are persisted; primary operator copy is **Unsigned — action required** or **Signed ✓**, while reviewer/time/note are secondary history; unsigned creates an exact signature re-review blocker | Yes — unit tests plus authenticated persisted Highland unsigned/signed/reconfirm exercise | Production signature policy, accepted signer, and actual signature verification | Client/provider signature policy | Yes | Yes | P0 | Highland source PDF remains named `UNSIGNED`, so the synthetic override is not proof of a real signature |
| Stage 3 | Package readiness gate | Functional with human review | The backend canonical review summary now drives every displayed item state, confirmed/total count, blocker list, **Mark package reviewed** enablement, and the final-review API gate; only explicit final review captures the immutable snapshot | Yes — regression tests, build, and persisted Highland Springs 17/17 exercise | Production provider completeness still depends on authoritative manifests | Package manifest and Stage 2 evidence | Yes | No | P0 | Automated validation is secondary; mapping/signature changes invalidate the affected confirmation until it is explicitly reconfirmed |
| Stage 3 | Read-only synthetic package export | Test-only / synthetic | Legacy authenticated synthetic JSON route remains available for compatibility; the primary UX now uses generalized package exports | Yes — Highland Springs | Retire the legacy route only after consumers move to structured package JSON | Product export contract | No | No | P2 | Export has no signed URLs and performs no external action |
| Stage 3 | Structured reviewed-package JSON export | Complete | Generalized Agent 3 structured JSON includes package/checklist/review versions, provenance, reviewed snapshot, validation metadata, and explicit non-submittable labeling under Advanced / structured | Unit plus live Highland Springs read-only smoke | Ongoing schema-version maintenance | Product export contract | No | No | P1 | Synthetic/test labels are explicit; JSON is an internal structured record, not a utility submission artifact |
| Stage 3 | Complete source-document ZIP export | Partial | Authenticated ZIP contains summary PDF, unchanged mapped originals under preserved filenames, package manifest with hashes, structured JSON, and reviewed snapshot metadata; unavailable originals fail the whole export closed | Unit byte-preservation test plus live Highland Springs six-document smoke | Exercise an authoritative production package and confirm provider-specific submission acceptance | Existing project-documents storage + package mappings | No | Yes | P1 | No flattening, merging, renaming of source basenames, modification, or re-save of signed/original documents |
| Stage 3 | Human-readable package summary PDF | Partial | Generalized PDF renderer includes project/provider, status, friendly field provenance, documents/signatures, correction/review notes, reviewer/timestamps, checklist/version, reviewed snapshot, and synthetic warnings | Unit plus live Highland Springs read-only smoke | Production-package UAT and provider acceptance remain unverified | Existing PDF library + package metadata | No | Yes | P1 | Suitable as a human cover sheet; not a provider form or proof of provider acceptance |
| Stage 3 | Field schedule CSV/XLSX export | Not started | Field results are already readable in the summary PDF and machine-readable in structured JSON | Assessed 2026-08-18 | Add only for a demonstrated reviewer spreadsheet workflow or provider-accepted schedule; otherwise it duplicates the implemented formats | Reviewer/provider workflow decision | Yes | No | P2 | Potentially useful for sorting/filtering large field sets, but not part of the minimum package and never utility-submittable by assumption |
| Stage 3 | Generated provider application PDF/form | Not started | PEPCO has portal selector mappings, but no provider PDF template, AcroForm/coordinate map, or generated application artifact; Dominion production requirements are absent | No | Obtain and version an authoritative provider form plus field/attachment mapping and rendering/validation rules | Provider-issued template and client approval | Yes | Yes | P0 | Expose only when the selected provider/template explicitly supports generation |
| Stage 3 | Combined package PDF | Not started | Individual mapped originals can be PDFs, but UCI has no merge pipeline or package-level compatibility checks | No | Add opt-in merge only for compatible unsigned/copy PDFs, preserve originals separately, define ordering/bookmarks, and record exclusions | Approved package policy + PDF merge implementation | Yes | Yes | P3 | Never replace the ZIP of originals; avoid modifying signed PDFs or implying the merged derivative is an original |
| Stage 4 | Submission and Confirmation Tracker (capability UX) | Partial / synthetic UAT | P0 validation + P1 Prepare→Preview→Confirm on `/uci/submissions`; primary **Not submitted**; confirmed packages show Mail.Send readiness blocker; live send controls unreachable | Source + Highland table UAT 2026-08-18 | Capture proof after live send is intentionally enabled; production delivery channels | Product UX + Stage 4 APIs | No | Yes | P0 | Do not treat confirm as Submitted |
| Stage 4 | PEPCO validation dry run | Partial | PEPCO field/attachment validation and optional browser population stop before final submit by default | Yes — fixture/browser tests | Production portal selector verification and operator acceptance | PEPCO portal | Yes | Yes | P0 | Live PEPCO remains environment- and confirmation-gated; HTTP route does not inject Playwright |
| Stage 4 | Dominion synthetic validation-only dry run | Test-only / synthetic | Dedicated `POST /api/uci/applications/:id/validation-attempts` + append-only `submission_validation_attempts`; Builder/Tracker call validation_only only; never Graph/portal/Stage 5 | Yes — unit tests + Highland Springs P0 UAT | Keep zero external/lifecycle side effects; production Dominion path still blocked | Synthetic checklist | No | No | P0 | Dry run ≠ submitted; `submitted_at` stays null |
| Stage 4 | Non-PEPCO email (Microsoft Graph) | Partial / controlled live UAT | Delegated `/me/sendMail` with `toRecipients` + binary attachments via new `transmit` path (`uci-submission-transmission.service.js`). Live flag local-only. Highland self-send UAT passed 2026-08-18 | Unit + Highland live self-send (Sent Items verified) | Apply `submission_transmission_attempts` migration on remote; production recipients; Stage 5 still off for email UAT | Client recipients + tenant Mail.Send | Yes | Yes | P1 | Do not use legacy `submitViaEmail` (advances Stage 5) |
| Stage 4 | Manual external submission recording | Not started | No controlled operator workflow to record outside-PermitPilot filing with proof | No | Method, submitted-by, datetime, external reference, proof upload, approval, lifecycle gate | Unsupported-provider operations policy | Yes | Yes | P1 | After email Prepare/Preview/Confirm path |
| Stage 4 | Submission preview + human confirmation | Test-only / synthetic | Prepare → Preview → Confirm persists to `submission_preparations`; confirm = intent only; Tracker shows Mail.Send blocker | Yes — unit + Highland table confirm `dd3c2c2c-…` | Live send still blocked until Mail.Send + reconnect + explicit enable | Product UX + authorization role | Yes | Yes | P1 | Stage 3 “Mark package reviewed” is not transmission approval |
| Stage 4 | Submission snapshot / attempt audit / idempotency | Partial | Validation + preparations tables applied; transmission attempts claimed before Graph (JSONB mirror until remote migration applied); Highland live idempotency key replay verified | Yes — Highland 2026-08-18 live UAT | Apply `20260818210000_submission_transmission_attempts.sql` on `eeqxyjrcldivtpikcpvk` | Technical implementation | No | Yes | P1 | Validation/prep ≠ transmission; `outcome_unknown` refuses blind retry |
| Stage 4 | Production live utility submission | Blocked by technical dependency | PEPCO live path exists behind explicit gates; no production-ready Dominion path | Fixture tests only | Operator-validated portal/email execution, confirmation evidence, incident handling | Utility portals / mailbox / runbooks | Yes | Yes | P0 | Never infer production readiness from dry-run results |
| Stage 4 | Stage 4 → Stage 5 handoff | Complete (code) | Live transmit reconcile endpoint `POST /applications/:id/reconcile-stage5` plus legacy confirmed submit both enter Stage 5 `AWAITING_UTILITY` and start ack SLA; Stage 6 never starts | Yes — unit tests | Apply Stage 5 migration remotely; live utility ack still external | Lifecycle + transmission services | Yes (live proof) | No | P0 | Transmit itself still does not auto-advance; reconcile after `status=sent` |
| Stage 5 | Communication classification and attention queue | Functional with human review | Eleven-category LLM+keyword classifier (OpenAI primary when Anthropic absent; 0.75), Graph poll + webhook inbound, portal shared model, matcher/unmatched queue, ack acceptance, Flag/Confirm/Reject/Rematch, SLA start/stop/2×, Needs Attention | Yes — Stage 5 unit + ≥85% synthetic harness | Live Graph Mail.Read, OpenAI key for live LLM path (Anthropic optional), client-labeled accuracy set for production certification | Mailbox / OpenAI / labeled samples | Yes | Yes | P0 | Synthetic accuracy ≥85% verified; production certification blocked on labeled samples |
| Stage 5 | Acknowledgment SLA engine | Complete (code) | Start on Stage 5 entry, stop on valid ack complete, overdue events, 2× escalation → ESCALATED | Yes — unit tests | Provider SLA business-day policy confirmation | Provider directory SLA columns | Yes (policy) | No | P1 | Defaults to 5 business days |
| Stage 5 | Graph inbound ingestion | Implemented; live-verify pending | Idempotent Graph `/me/messages` poll + attachments metadata + `POST /webhooks/uci/email-inbound` into shared model / unmatched queue | Yes — unmatched path unit tests | Connected mailbox Mail.Read + webhook secret | Microsoft Graph / mailbox consent | Yes | Yes | P0 | Reuses per-user mailbox OAuth |
| Stage 5 | Ack auto-complete + Stage 6 guard | Complete (code) | High-confidence matched acknowledgment with ticket/account + date can complete Stage 5; flagged/low-conf/unmatched never auto-advance; Stage 6 only after Stage 5 COMPLETED + ack date | Yes — unit tests | Live utility acknowledgment samples | Utility inbound messages | Yes | No | P0 | Does not start Stage 6 product |
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
| Utility email routing | 4–5 | Approved **recipients** by provider/project, subject/body/attachment policy, tenant **Mail.Send** consent. Sender = each operator’s connected M365 mailbox (not a single required Permitting@ From) | Non-PEPCO email is not production-functional | P0 |
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
- 2026-08-18 Application Builder operator-flow implementation replaced the separate flag/comment pattern with row-scoped **Confirm** and reason-required **Request change** actions. Field fixes route to an exact Load Profile Analyzer verified input (`tab`, `section`, `field_key`, stable verified-value/source-document identifiers, anchor, and return path) or exact project field. Documents expose authenticated **Open document**, **Change document**, and exact mapping/signature correction targets. Same-document selection remains a no-op; a real mapping or signature change invalidates only the affected confirmation.
- Operator-facing UCI labels now use **Utility Provider Mapper**, **Load Profile Analyzer**, **Application Builder**, and **Submission and Confirmation Tracker** instead of numeric agent names. Numeric identifiers remain only in code, test descriptions, historical notes, and audit metadata.
- Reviewed presentation now shows the reviewer display name/timestamp, checklist state, confirmed items, minimal signature state, validation support, downloads, and one reason-required **Reopen review** action. Per-row lock copy, disabled reviewed-state rebuild/save controls, visible reviewer UUIDs, synthetic UAT notes, and internal signature state names are removed from primary UI. Reopen returns to an editable ready review without itself creating **Needs changes**.
- 2026-08-18 authenticated persisted Highland UAT verified coordination `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69` and package `6314b620-8cc3-4642-a08c-28c2949e921f`: reviewed baseline → reopen → field confirm → exact field Request change → Needs changes → reconfirm → same-document no-op → different document replacement → original mapping restore → document reconfirm → unsigned signature blocker → signed → reconfirm → final review → authenticated fresh detail read. Final state is canonical `reviewed`, `17/17`, signature `signed_manual_verified`, and review history advanced from 12 to 13. The 24 authenticated HTTP reads/mutations had a maximum observed duration of 4,388 ms; submission fields and all Stage 4/external actions remained unchanged.
- The 2026-08-18 authenticated UAT supersedes the earlier temporary reset note above: the Highland package is intentionally left in a clean reviewed state with its original document mapping restored and history preserved.
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
- Current post-change Highland persisted-service rerun: completed and documented below. The IDE browser service still could not retain a navigable tab, so browser paint timing is unavailable; this does not affect the persisted synthetic lifecycle result and does not upgrade any production-only capability.

## Agent 3 package export UX — 2026-08-18

Implemented the minimum useful read-only export set without Stage 4, email, portal, submission, or lifecycle side effects:

- **Download package** is now the primary export dropdown in both Agent 3 package surfaces.
- **Package Summary PDF** renders project/provider, package and review status, mapped values with friendly provenance, required documents, signature state/notes, correction and review notes, reviewer/timestamps, checklist/template versions, and reviewed-snapshot metadata. Synthetic packages carry a prominent test-only warning.
- **Complete ZIP** contains `package_summary.pdf`, `package_manifest.json`, generalized structured JSON, reviewed snapshot metadata when present, and every mapped original source document. Source bytes are downloaded directly from the existing project-documents bucket and added unchanged; source basenames are preserved inside per-requirement folders to avoid collisions.
- **Structured JSON** is generalized beyond the synthetic-only route and moved under **Advanced / structured**. It explicitly states that it is an internal audit artifact and is not utility-submittable.
- ZIP generation fails closed if any mapped original cannot be resolved under the package project or approved PEPCO storage mapping; it does not silently emit an incomplete package.
- No provider form was generated. PEPCO has no authoritative PDF template mapping, and Dominion remains synthetic-only, so exposing a fabricated provider form would be incorrect.
- CSV/XLSX was assessed but deferred. It could help reviewers sort/filter unusually large field schedules, but the summary PDF and structured JSON cover the current minimum and no provider acceptance of a spreadsheet schedule is known.

Verification:

- Focused backend package-builder/export tests: 27/27 passed, including valid PDF generation, synthetic/non-submittable labels, ZIP manifest/snapshot contents, and byte-for-byte preservation of a signed source fixture.
- Focused Agent 3 frontend helper/render/route tests: 17/17 passed, including the coordination-workspace package render with the shared download menu.
- Changed frontend lint: zero errors (six pre-existing hook dependency warnings in touched files).
- Production frontend build: passed outside the sandbox; the first sandboxed PWA service-worker minification attempt exited early after bundle generation.
- Live read-only Highland Springs smoke for package `6314b620-8cc3-4642-a08c-28c2949e921f`: generalized JSON resolved the synthetic label and reviewed snapshot; summary PDF generated with a valid `%PDF-` header; Complete ZIP generated with six mapped originals, `originals_preserved=true`, `signed_sources_modified=false`, and `suitable_for_submission=false`. No database row, source file, lifecycle state, email, portal, or Stage 4 action was changed.

## Agent 3 correction/re-review hardening — 2026-08-17

Scope remained Stage 2/3 only. No Stage 4, email, portal submission, scrape, OCR, document processing, lifecycle advancement, or external utility action was invoked.

Root causes corrected:

- The exact Highland phantom blocker was package `6314b620-8cc3-4642-a08c-28c2949e921f`: `draft_status=needs_changes`, stored `package_review.status=needs_changes`, and `package_review.package_correction.active=true` with note `need change`, while every one of the 17 current items was confirmed. Backend and frontend derivation treated the historical reopen flag and draft label as independent live corrections, so an empty item table still produced **Needs changes**.
- Reopen, item correction, and mapping change were implemented as separate happy-path additions rather than one state machine. The UI used passive **Needs correction** copy, every field correction pointed at Agent 2, and the package-level correction could obscure the actual requirement.
- A document remap called the full package-slot refresh path. That path reloaded project, every project document, every coordination application, Agent 2 load data, every required field, and all readiness inputs even though the operator changed one slot.
- Candidate lists were loaded eagerly and successful remaps triggered both a full coordination-detail refresh and another candidate fetch. A persisted mutation therefore appeared coupled to slower child reads.
- Same-document selection had no UI no-op guard. The server could rewrite confirmation timestamps and rerun readiness for an unchanged mapping.
- The PEPCO mapping branch referenced an undefined `doc` variable while inferring an unsigned filename.

Fixes:

- The canonical active-correction set is now exactly the current items whose derived status is `needs_correction` or `ready_for_re_review`. Package status, active count, correction summary, final-review gate, and both UIs consume that same set. `draft_status`, stored review labels, reopen reasons, historical item notes, old snapshots, and `package_correction.active` no longer create blockers.
- Reopen records its reason in correction history, clears the legacy package-level active flag, unlocks to `draft`, and leaves all current confirmations visible. Reopen alone is **Ready for review**; **Needs changes** begins only after a current requirement is flagged.
- Reviewed → Reopen preserves the immutable reviewed snapshot, review history, confirmed item snapshots, reviewer/reason/timestamps, Stage 2 data, mappings, signature state, and lifecycle state. It only unlocks Agent 3; a current flagged requirement is what changes status to **Needs changes**.
- **Flag for correction** is now an explicit reason-gated action. The persisted item audit records requirement, reviewer, timestamp, note, and mapping snapshot. Fixed mappings resolve to **Ready for re-review** and require explicit reconfirmation.
- Field fixes route by provenance: Agent 2-backed values open the verified-input workspace, project-backed values open that exact project’s edit form, and package-local mappings remain in Agent 3. Agent 3 never writes Agent 2 values.
- The package correction summary now presents `Requirement | Issue | Note | Fix issue`. Document fixes open the affected row; LOA fixes retain a separate **Verify signed** action.
- Opening Change is local. Candidates load lazily once and selection is local. A successful current-package remap returns its canonical application/review summary and does not block on detail refresh or candidate reload.
- Current built packages use a targeted one-slot document write and in-memory document/signature readiness delta. Legacy/incomplete metadata alone falls back to the compatibility refresh. Mapping history stores prior and next mappings without replacing reviewed snapshots.
- Selecting the currently mapped source disables Apply and shows **Already mapped · No change**. The server also returns `no_change=true` without a write or readiness recompute if called directly.
- A changed document invalidates only that requirement, producing **Ready for re-review** after the flagged mapping changes. Reconfirmation is required before final review.
- Signature verification remains separate from document confirmation. Unsigned required LOA remains unready; verification updates the returned row immediately and still requires document reconfirmation when its confirmation snapshot is stale.
- Mutations have action-scoped busy state, no automatic mutation retry, and use their own response as authoritative state. Optional refresh failure remains a warning and cannot blank the workspace.
- Reviewed rows reject field/document/signature mutation until Reopen. Package mutation routes reuse the access-checked row, targeted document changes reuse current slot definitions, and database writes return only the row ID while the service constructs the authoritative response from the persisted patch.

### Exact Highland status-source trace

| Status source | Record/id | Active value before fix | Why it triggered Needs changes | Canonical result |
|---|---|---|---|---|
| `coordination_applications.draft_status` | package `6314b620-8cc3-4642-a08c-28c2949e921f` | `needs_changes` | Old status derivation treated the workflow label as a live correction | Historical workflow label; not an active requirement |
| `application_package.package_review.status` | same package | `needs_changes` | Could reinforce stale UI fallback state | Audit metadata only; canonical summary wins |
| `package_review.package_correction.active` | same package | `true` (`need change`) | Added one invisible package-level correction with no requirement row | Reopen history only; excluded from active set |
| Current field/document review items | 11 fields + 6 documents | 17 `confirmed`; 0 actionable | Old logic did not let the empty current set clear the package flag | `active_correction_count=0`, Ready for review |
| LOA current snapshot | `document:authorization` | `confirmed`, `signed_manual_verified` at `2026-08-17T10:16:06.263Z` | Not a blocker; investigated to exclude stale signature state | Confirmed and ready |

### Correction-path timing evidence

| Action | Before requests / backend | After HTTP requests | After backend | UI settle |
|---|---|---:|---:|---:|
| Reopen | 1 service action / 1,947 ms | 1 | 1,544 ms | Mutation response; refresh non-blocking |
| Flag for correction | 1 / 2,388 ms | 1 | 1,622 ms | Mutation response |
| Open Change picker | Candidate work coupled to render | 0 | <1 ms local | <1 ms local |
| Load candidates | Eager/repeated / 1,642 ms | 1 lazy read, reused | 1,692 ms | Read response |
| Apply same document | Direct guard 1,083 ms | 0 from UI; 1 only if API called directly | 1,088 ms direct guard; no write | <1 ms UI |
| Apply different document | Prior request `f8e0b50c-f145-4719-a317-66c2da480c6a` timed out; pre-optimization persisted exercise 3,898 ms | 1 | 1,949 ms | Mutation response; no detail/candidate wait |
| Reconfirm requirement | 2,259–2,332 ms | 1 per affected requirement | 2,000 ms | Mutation response |
| Final review | 2,255 ms | 1 | 1,592 ms | Mutation response |

Timings are the real remote Highland service/database path. Cursor’s browser-tab backend remained unable to retain a navigable tab, so browser paint timing could not be sampled; UI settling is nevertheless response-driven and covered by render/mutation-state tests. No mutation waits for the optional coordination refresh.

### Negative-path UAT result

- Automated/service UAT: **Pass**. Reviewed snapshot preservation, reason requirement, reviewer/timestamp audit, stale package-flag exclusion, same-document no-op, one-slot remap, ready-for-re-review, explicit reconfirmation, second snapshot version/history, unsigned LOA blocking, reviewed-state mutation lock, and child-read failure isolation passed.
- Frontend render UAT: **Pass**. Correction action labels, provenance-specific fix links, project edit deep-link, document editor, canonical blockers, and LOA controls passed; production build and changed-file lint passed.
- Persisted Highland Springs UAT for coordination `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69` / package `6314b620-8cc3-4642-a08c-28c2949e921f`: **Pass**. Reopen produced Ready for review with zero active corrections; Flag produced exactly one active correction; same-document apply was a no-op; different-document apply produced Ready for re-review; the original source was restored and explicitly reconfirmed; LOA unsigned → manually verified invalidated its document confirmation until reconfirmed; final review persisted 17/17, zero active corrections, `reviewed`, and a new immutable snapshot.
- Final Highland preservation proof: Agent 2 application rows and lifecycle transitions were byte-for-byte unchanged; original `01_Synthetic_Load_Letter.pdf` mapping was restored; LOA is `signed_manual_verified`; submission timestamp/user/method/ticket remain null.

Closure:

- Stage 2 correction safety can close at its existing **Functional with human review** level; this pass did not mutate or regress Agent 2.
- Stage 3 synthetic Agent 3 UAT is formally closed for the reviewed → reopen → flag → fix → re-review → reviewed lifecycle. Production Dominion readiness remains a separate client dependency.
- Genuine external dependencies remain authoritative Dominion requirements and production signature/reviewer policy.

### Reviewed/reopen release-blocking cleanup — 2026-08-18

Additional authenticated Highland Springs browser UAT found and corrected three release blockers:

- Approved synthetic checklists still rendered a disabled **Approve synthetic checklist** control. Both Agent 3 render paths now show **Checklist approved ✓** with approver/timestamp and render Approve only while genuinely pending.
- Every reviewed field/document repeated **Snapshot locked** in its Action cell. Reviewed rows now have no impossible actions; one package-level **Reviewed package ✓** notice carries reviewer/time and explains that mappings become editable after Reopen.
- The sync-run polling hook captured an inline terminal callback in its effect dependency. Every poll state update recreated that callback, restarted the effect, and immediately issued another `/sync-runs` read. Authenticated reproduction showed a continuous request storm that delayed or starved Reopen/remap responses. The hook now keeps the current callback in a ref, so a normal render cannot restart polling. Project tenant/editor checks also run in parallel after project lookup, reducing authenticated access overhead without weakening authorization.
- A changed previously-confirmed mapping directly after Reopen derived as **Not reviewed** unless it had first been flagged. Backend and frontend now classify any ready changed confirmed mapping as **Ready for re-review**, preserving the required explicit reconfirmation gate.
- Confirm remained clickable while an Apply mapping request was in flight, allowing a fast second action to capture the prior candidate snapshot. Both Agent 3 screens now disable document confirmation for that slot until its mapping mutation completes.
- Change now opens its action panel immediately with scoped candidate loading; subsequent opens reuse the candidate cache. Same-document selection remains a zero-request disabled no-op.

Exact historical request `6e65d02d-eb1b-483a-b878-595963661e09`:

| Step | Duration/evidence | DB mutation | Blocking query | Response sent? |
|---|---|---|---|---|
| Client request | Reached the client timeout window | None attributable to this ID | Local API runtime unavailable/request-starved | No |
| Backend receipt | No matching request ID in route/server logs | No | Handler was not reached | No |
| Persisted transition | No reopen event attributable to this ID | No | N/A | No |
| Authenticated post-fix rerun | HTTP 200 in 3.41 s; editable UI in 4.03 s | One bounded review metadata update | Auth, project/application access, persisted JSONB update only | Yes |

The original ID therefore cannot be truthfully assigned backend step timings: it never produced a backend trace or response. It is not evidence that Reopen rebuilt the package; authenticated tracing confirms the endpoint invokes no Agent 2 reload, OCR, scrape, document processing, candidate discovery, Graph, portal, validation, or lifecycle action.

Authenticated browser timings after cleanup:

| Action | HTTP requests | Backend/HTTP ms | UI settle ms |
|---|---:|---:|---:|
| Open reviewed package | 3 total (`providers`, detail, one sync-run read) | Detail trace 2,008 | 5,694 |
| Checklist render | 0 additional | 0 additional | Included in 5,694 open |
| Reopen | 1 mutation + 1 non-blocking detail refresh | 3,411 | 4,026–4,564 |
| Open Change panel | 0 blocking reads before panel paint | local | Immediate panel; first candidate read continued scoped |
| Load candidates | 1 lazy read | 3,413 first load | 3,413 first load |
| Apply same document | 0 | 0 | <1; disabled **Already mapped** |
| Remap one document | 1 | 3,439 | 3,439 to **Ready for re-review** |
| Reopen Change with cache | 0 | 0 | 56 |
| Reconfirm requirement | 1 mutation + 1 non-blocking detail refresh | 2,904 | 2,904 |
| Mark reviewed | 1 mutation + 1 non-blocking detail refresh | 2,961–3,474 | 2,961–3,975 |
| Download Summary PDF | 1 | response-driven | 3,357; 4,980 bytes |
| Download Complete ZIP | 1 | response-driven | 5,769; 106,349 bytes |

The authenticated request storm dropped from repeated `/sync-runs` calls after every render (dozens during a single remap trace) to one read on package open and the intended 4-second schedule only when an active durable job is stored.

Authenticated UAT result: **Pass**. Reviewed render showed `Reviewed package ✓`, checklist approval audit, no Approve CTA, no repeated Snapshot locked text, read-only confirmed fields/documents, Reopen, validation, and download. Reopen preserved the prior snapshot and produced no phantom correction. A different document produced **Ready for re-review**; the correct original was restored, explicitly reconfirmed after the mapping response, reviewed again, and remained reviewed after hard refresh. Final persistence is `reviewed`, 17/17 confirmed, zero active corrections, original `01_Synthetic_Load_Letter.pdf`, and signed/verified LOA. Summary PDF and Complete ZIP both downloaded with non-zero valid payloads. No Stage 4, email, Graph, portal, submission, scrape, OCR, document-processing, or lifecycle operation ran.

Verification: 25/25 focused backend tests and 14/14 focused frontend tests pass; changed-file lint has zero errors; production build passes. Repository-wide lint still has pre-existing unrelated debt outside this pass.

Stage 3 synthetic Agent 3 may now be frozen. Stage 4 was not started in this pass and should begin only as a separately authorized scope. Production Dominion Stage 3 remains blocked on authoritative provider requirements, accepted signature policy, and production reviewer authority.

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

## Stage 4 Submission and Confirmation Tracker audit — 2026-08-18

**Scope:** Audit only for capability **Submission and Confirmation Tracker** (Agent 4). No Stage 4 implementation, no Graph mail, no portal, no live submit, no Stage 5 start, and no Stage 2/3 business-logic changes. Tracker rows above were refreshed to match code-verified findings.

**Verdict:** Stage 4 is a **partial foundation (~25–35% of the intended tracker)**. Validation/dry-run scaffolding and lifecycle hooks exist; the operator-facing Prepare → Preview → Confirm → Capture proof → Stage 5 await flow does **not**. Dry run ≠ submitted. Highland Springs is eligible for a **synthetic validation-only** exercise after Stage 3 UAT restored `reviewed`, but production external submission remains blocked.

### Intended vs actual flow

| Intended step | Actual code | Status |
|---|---|---|
| Reviewed Application Builder package | Stage 3 review + `package_review.reviewed_snapshot` | Exists (Stage 3) |
| Prepare submission | No prepared outbound entity/API | Missing |
| Preview exactly what will be sent | No preview surface; validation returns field/attachment inventories only | Missing / partial |
| Explicit human confirmation (Stage 4) | Stage 3 review only; API has no one-use Stage 4 approval | Missing |
| External submission | Single `POST /api/uci/applications/:id/submit` may dry-run, email, or (injectable) PEPCO portal | Partial / unsafe for production |
| Capture proof/reference | PEPCO fixture ticket/evidence; email stores fabricated local message id | Partial / incomplete |
| Stage 5 awaiting acknowledgment | `advanceLifecycleAfterConfirmedSubmission` writes Stage 4 COMPLETED → Stage 5 AWAITING_UTILITY | Code exists; must not run from synthetic/dry-run |

**Primary code map**

- Routes: `scraper-service/app/routes/uci.routes.js` → `POST /applications/:id/submit`
- Orchestrator: `uci-application-submit.service.js` (`submitApplicationPackage`, `validateSubmitEligibility`, `resolveSubmissionMethod`, `advanceLifecycleAfterConfirmedSubmission`)
- Email: `uci-email-submission.service.js` → `graphSendMail` → `https://graph.microsoft.com/v1.0/me/sendMail`
- Graph auth: `microsoft-graph-auth.service.js` (scopes: `openid profile offline_access User.Read Mail.Read email` — **no Mail.Send**)
- PEPCO: `uci-pepco-submission.service.js` + `scrapers/pepco/submit-flow.js` + `uci/application-templates/pepco/submission-field-mappings.json`
- UI: visible header **Validate synthetic package** / **Validate PEPCO package** in `UciApplicationBuilder.tsx` when reviewed; Step 06 **Submit to utility** remains `hidden`; `useUciApplicationBuilder` never passes `live_submission_confirmed`; blocks non-PEPCO / non-Dominion-synthetic
- Queue: `/uci/submissions` → read-only **Application Queue** (`UciRoutePages.tsx`), not a confirmation tracker
- Tables: `coordination_applications` (`submission_method`, `submitted_at`, `submitted_by`, `utility_ticket_number`, `agent_draft_metadata.submission`); `coordination_communications` (schema reusable, unused by Graph send); **no** `submission_attempts` table
- Env: `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_REDIRECT_URI`, `MS_GRAPH_TOKEN_ENCRYPTION_KEY`, `UCI_PEPCO_LIVE_SUBMISSION_ENABLED` (default off); mailbox hint `Permitting@commun-et.com`

### Mode findings (re-verified)

1. **Email (Graph):** No `toRecipients`; no recipient config; no production `resolveAttachmentsFn` (body lists docs, zero bytes attached); fabricated `graph-send-${Date.now()}` ID; no `conversationId` / `internetMessageId`; no outbound communication row. Builder UI avoids calling this for unsupported providers, but the API still routes every non-PEPCO (except synthetic Dominion intercept) to email.
2. **Portal:** PEPCO validation + fixture Playwright populate/submit exist; HTTP submit does **not** inject a browser, so normal API calls stay validation-only. After final click without ticket, status `submitted_pending_confirmation` is persisted as `confirmation_status: dry_run` — **dangerous mislabel**. No BGE adapter (falls through to email).
3. **Manual external:** **Absent.** Operators cannot truthfully record an outside filing with method, operator, datetime, external reference, and proof.

### Readiness / preview / snapshot / idempotency / Stage 4→5

- Gate checks mutable `draft_status=reviewed` + `package_status=ready_for_review` + not already submitted. Does **not** recompute canonical review summary, require `reviewed_snapshot`, verify Stage 3 COMPLETED, or require Stage 4 confirmation.
- No user-facing preview of sender, recipients, subject/body, exact attachment bytes, portal destination, or package version hash.
- Send path reads live application/project, not an immutable prepared snapshot derived from the reviewed package.
- No transmission idempotency key / atomic claim; concurrent requests can double-send before `submitted_at` is written. Ambiguous timeout → no `outcome_unknown` UX.
- Synthetic Dominion and PEPCO dry-run correctly leave lifecycle unadvanced. Confirmed email/portal success advances Stage 4 then 5 (fixture-proven for injected deps only).

### Highland Springs synthetic test design (do not run external)

Package `6314b620-8cc3-4642-a08c-28c2949e921f` / coordination `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69` (McDonald's Highland Springs VA LC 451497): after 2026-08-18 Stage 3 UAT, package is **`reviewed` / 17/17** with Stage 3 COMPLETED and null submission fields. Safe design: Reviewed → (conceptual Prepare/Preview labels) → human confirm → **SYNTHETIC TEST — NO EXTERNAL SUBMISSION** via existing synthetic intercept / **Validate synthetic package** → assert `validation_only`, all `external_side_effects` false, no Graph/portal, no real `submitted_at`, no fabricated ticket, no Stage 5. Prefer a dedicated validation attempt type in future implementation so history is not overwritten.

### UX (operator language)

Operators should eventually see **Submission and Confirmation Tracker**: prepare package for send, preview exactly what leaves PermitPilot, confirm once, then see confirmation/reference or “status uncertain — verify before retrying.” Today they mostly see Application Builder validation wording and a read-only Application Queue. Avoid backend jargon (Graph, Playwright, idempotency key) in primary copy.

### Capability matrix (2026-08-18)

| Capability | Current implementation | Works now? | Synthetic-testable? | Production dependency |
|---|---|---|---|---|
| Email (Microsoft Graph) | `/me/sendMail` skeleton; no recipients/attachments/Mail.Send | No | Mock only | Tenant Mail.Send, mailbox, recipients, attachment policy |
| Portal (PEPCO) | Validation + injectable Playwright; HTTP has no browser | Validation yes; live no | Yes (fixtures) | Live flag, credentials/MFA, selector UAT, durable proof |
| Portal (BGE/other) | Catalog only; method falls to email | No | No | Provider method + adapter/authorization |
| Manual external | None | No | No | Operator proof workflow policy |
| Readiness gates | Mutable reviewed labels | Partial | Yes | Canonical review + snapshot + Stage 4 confirm |
| Submission preview | Absent | No | UI design only | Product UX |
| Snapshot / audit | Mutable last `submission` object | Partial | Yes | Append-only attempts + prepared snapshot |
| Idempotency / uncertain outcome | Post-success `submitted_at` only | No | Race tests possible | Atomic claim + `outcome_unknown` |
| Stage 4 → 5 | On confirmed email/portal only | Fixture-only | Yes for synthetic non-advance | Reconciled proof; do not start Stage 5 product here |
| Synthetic Highland path | Dominion synthetic intercept | Yes | Yes | Keep labeled; no external side effects |

### P0 required for Stage 4 synthetic UAT

1. Keep Highland on validation-only / synthetic path with zero Graph, portal, fabricated ticket, or Stage 5 advance.
2. Expose explicit **Validate (synthetic)** vs never “Submitted” for dry run; preserve attempt history instead of overwriting if possible.
3. Fail closed if package is not canonical reviewed / has active corrections (recompute readiness at API).
4. Do not enable live email/portal for this UAT.

### P1 before pilot handoff

1. Prepare → Preview → Confirm UX under **Submission and Confirmation Tracker**.
2. Append-only attempts, transmission idempotency, `outcome_unknown` (especially post-click no ticket).
3. Graph: Mail.Send, recipients, attachments from reviewed snapshot, real IDs, outbound communication row.
4. PEPCO: authorized browser orchestration on the HTTP path; durable proof artifacts.
5. Manual external submission with proof.
6. Transactional/idempotent Stage 4→5 only after reconciled external success.

### Genuine client / external dependencies

- Approved delivery method per provider (Dominion/BGE must not inherit blind email fallback).
- Authoritative Dominion requirements and signature/delivery policy.
- Mailbox `Permitting@commun-et.com` (or approved sender), recipients, Mail.Send consent.
- Portal automation authorization / credentials / MFA ownership.
- Named Stage 4 confirmer role and incident/duplicate-submission runbook.
- Acknowledgment definition for later Stage 5 (out of scope to implement now).

## Stage 4 P0 — Submission and Confirmation Tracker synthetic UAT — 2026-08-18

**Status:** P0 synthetic UAT implemented and exercised on Highland Springs. **P1 not started. Stage 5 not started.** Live email/portal remain disabled from this UX.

### Delivered

- Capability UX: **Submission and Confirmation Tracker** (`/uci/submissions`) + Application Builder entry **Validate submission package**
- API: `POST/GET /api/uci/applications/:id/validation-attempts` (validation_only only)
- Append-only audit: migration `supabase/migrations/20260818120000_submission_validation_attempts.sql` + JSONB mirror for older envs
- Entry gates (server + UI): Reviewed + reviewed snapshot + no active corrections; draft/needs_changes show blockers
- Primary state always **Not submitted** for this path; secondary **Validation passed / failed / blocked**
- Intended submission mode: `unavailable_not_configured`
- Synthetic Dominion banner: **SYNTHETIC TEST — NO EXTERNAL SUBMISSION**

### Highland Springs runtime evidence

- Coordination `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69` · package `6314b620-8cc3-4642-a08c-28c2949e921f`
- Package was `draft` with retained snapshot / 17/17 confirmed → re-locked **Reviewed** via existing Stage 3 review API (UAT setup only)
- Validation result: `validation_passed` / `validation_only` / `unavailable_not_configured` / 6 attachments
- Assertions: `submitted_at=null`, no utility ticket, Stage 3 `COMPLETED` unchanged, zero Stage 4/5 transitions, zero communications, all `external_side_effects` false

### Migration apply / table persistence — 2026-08-18 (follow-up)

- Env: linked Supabase project `eeqxyjrcldivtpikcpvk` (same as Highland UAT / `SUPABASE_URL`)
- Table `public.submission_validation_attempts` present; service-role select/insert OK; RLS policies from migration (SELECT/INSERT via `has_project_access`; no UPDATE/DELETE = append-only intent)
- Highland re-validate: `table_persisted=true`, list `source=submission_validation_attempts`, row `47566b8a-576b-49db-97ea-d4fd0f7c5f51` (`result=passed`, `attempt_mode=validation_only`, snapshot `agent-3-reviewed-package-snapshot-v1`)
- JSONB `submission_validation_attempts[]` / `latest_validation` still mirrored for UI/backward compatibility; **primary write/read path is the table** when present

### Focused tests

- `scraper-service/tests/uci-submission-validation.test.js` (pass)
- Dominion synthetic intercept assertions updated in `uci-application-submit.test.js` (pass; Playwright browser tests remain environment-dependent)

### Remaining P1 gaps (partially implemented 2026-08-18)

- **Prepare → Preview → Confirm (email)** implemented without Graph send — see next section; Highland final table verify passed
- `20260818180000_submission_preparations.sql` applied on `eeqxyjrcldivtpikcpvk` (user-applied; do not re-run)
- **Mail.Send + mailbox reconnection** still required before any live send; live flag remains OFF
- Manual external / portal later; Stage 5 **not started**

## Stage 4 P1 Prepare → Preview → Confirm — 2026-08-18

**Status:** Implemented **without** Graph `sendMail`, Mail.Send enablement, portal, or Stage 5.

### Delivered

- Migration: `supabase/migrations/20260818180000_submission_preparations.sql`
- Service: `uci-submission-prepare.service.js` — From = per-user connected mailbox; `/me` identity match; Connect Outlook block; never `sendMail`
- APIs: `POST/GET/PATCH /api/uci/applications/:id/submission-preparations` + `POST .../:prepId/confirm`
- Tracker UX journey + Builder link to tracker
- Tests: `tests/uci-submission-prepare.test.js` (4/4)
- Highland: live gate `CONNECT_OUTLOOK`; prepare/confirm with mailbox deps; JSONB history persisted; `submitted_at=null`; stage 3 unchanged

### Table access verify — 2026-08-18 (follow-up)

- Project `eeqxyjrcldivtpikcpvk` matches scraper `SUPABASE_URL`; table **exists**; service_role **select/insert/update** OK
- Prior false JSONB path: PostgREST **schema cache** miss (`Could not find the table ... in the schema cache`) right after apply — not RLS/GRANT. Earlier **403** was Supabase **Management API** (`/v1/projects/.../database/query` / CLI login-role), unrelated to table RLS
- Runtime fix: one retry on schema-cache miss before JSONB fallback
- Highland table-primary confirm row: `f724819d-bbf9-4578-a66b-abfdf826de55` (`table_persisted=true`, list `source=submission_preparations`)

### Highland final table-backed verify + Mail.Send gate — 2026-08-18

**Package** `6314b620-8cc3-4642-a08c-28c2949e921f` · **coordination** `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69`

| Assertion | Result |
|---|---|
| Reviewed → Prepare → Preview → Confirm | Pass |
| `submission_preparations` with `table_persisted=true` | Pass — confirm row `dd3c2c2c-66b4-4418-8179-e0e2e36bd1a2` |
| List refresh preserves confirmed state (`source=submission_preparations`) | Pass |
| Duplicate confirm idempotent | Pass |
| `submitted_at=null`; Stage 3 `COMPLETED` unchanged; no Stage 4/5 transitions | Pass |
| Graph `sendMail` called | **No** (mailbox deps mocked; prepare service never invokes send) |
| Live email enabled | **No** — `UCI_EMAIL_LIVE_SUBMISSION_ENABLED` default OFF |

**Production readiness blocker (operator-visible):** `Email sending unavailable — Microsoft Mail.Send permission required`

- API: `production_readiness_blocker` / `email_readiness` on prepare/preview/confirm/list; `ready_to_send=false`; `sending_enabled=false`
- UI: Submission and Confirmation Tracker page banner + confirmed-package callout (exact phrase)
- Gate: `UCI_EMAIL_LIVE_SUBMISSION_ENABLED` (`.env.example`, default unset/false). Even if later set true, prepare/confirm still do not call `sendMail` until a separate send path is authorized after Mail.Send + mailbox reconnection.
- Stage 5: **not started**

## Stage 4 P1 email sender architecture (audit) — 2026-08-18

**Decision:** User-connected mailbox Based. Keep delegated OAuth + `/me/sendMail`. Do **not** hardcode `Permitting@commun-et.com` or `dzahid@…` as Stage 4 From.

### OAuth persistence model (today)

- Table `microsoft_mailbox_connections`: **UNIQUE (`user_id`)** — one connection row per PermitPilot user; stores `mailbox_email`, encrypted tokens, scopes, status (`20260519103000_microsoft_mailbox_connections.sql`)
- OAuth callback resolves Graph `/me` mail/UPN and upserts that identity for the authenticated user (`microsoft.routes.js`, `upsertEncryptedMailboxConnectionRow`)
- Token refresh/`getValidAccessTokenForUser` is keyed by **PermitPilot user id** — already per-user, not global
- **Settings status sync (2026-08-18):** Parallel stack reads via Vite `:5001` → proxy `:3002`. OAuth callback broadcasts `permitpilot-microsoft-mailbox` + `localStorage` so Settings refetches without reload; focus/visibility also refetch. Do not treat API/proxy failures as “Not connected” when a prior connected status is known. PermitPilot login email may differ from Graph mailbox (e.g. `daniyalzahid12@yahoo.com` → connected Graph `/me`).

### What is hardcoded / hinted today

| Item | Role today | Stage 4 P1 treatment |
|---|---|---|
| `DEFAULT_MICROSOFT_MAILBOX` / `DEFAULT_MAILBOX_EMAIL` = `Permitting@commun-et.com` | OAuth **start query default** + Settings connect convenience | Hint only; stop treating as required From; Connect Outlook uses signed-in Graph identity |
| `MS_GRAPH_EXPECTED_MAILBOX_LOWER` | **Warn-only** console if Graph principal ≠ Permitting@ | Keep warn-only for ops/MFA; **not** an enforced Stage 4 allowlist |
| Settings copy (updated) | Was “connect Permitting@…” | Now: connect **your** M365 mailbox; per-user tokens; Stage 4 From = connected mailbox |
| Scopes | Connected Highland mailbox token includes `Mail.Send` (OAuth start string may still omit until product expands default scopes) | Live UAT used connected token scopes |
| `graphSendMail` payload | Now includes `toRecipients` / optional `ccRecipients` + attachments; fabricated local message id until Graph message resource is resolved | Prefer Sent Items reconciliation for proof |

## Stage 4 controlled live email UAT — Highland Springs — 2026-08-18

**Status:** **Pass** (one controlled self-send). Stage 5 **not** advanced. Legacy `submitViaEmail` **not** used.

### Approvals honored
- To: `dzahid@commun-et.com` only (self-send)
- Subject/body/6 synthetic attachments approved
- Live flag enabled in local `scraper-service/.env` only (gitignored)
- No Stage 5 / no `submitted_at`

### Implementation
- Service: `uci-submission-transmission.service.js` — claim before Graph; statuses `claimed|sent|failed|outcome_unknown`
- Route: `POST /api/uci/applications/:id/submission-preparations/:prepId/transmit`
- `graphSendMail` fixed: requires `toRecipients`; supports attachments + abort/timeout → `uncertain`
- Migration file: `supabase/migrations/20260818210000_submission_transmission_attempts.sql` (remote apply blocked by CLI login-role; UAT used JSONB mirror `table_persisted=false`)
- Tests: `tests/uci-submission-transmission.test.js` (3/3)

### Highland execution
| Field | Value |
|---|---|
| Package | `6314b620-8cc3-4642-a08c-28c2949e921f` |
| Coordination | `1a2b4b06-a7f9-4b17-96ca-f757be8e0c69` |
| Preparation | `c902dce4-3cd8-4176-bb39-c46c30c61a81` (From=`dzahid@commun-et.com`) |
| Transmission | `dc4df479-a011-4714-9e94-47ef0b43add1` status=`sent` |
| Idempotency key | `highland-live-uat-selfsend-2026-08-18` |
| Graph | HTTP **202**; local id `graph-send-1787062532541` |
| Attachments | **6** binaries |
| Duplicate retry | `idempotent_replay=true` — Graph **not** called again |
| Lifecycle | Stage **3** `COMPLETED` unchanged; `submitted_at=null` |
| Sent Items | **Pass** — subject `[UCI SYNTHETIC TEST] [UCI] DOMINION…`, `hasAttachments=true`, to self, `2026-08-18T14:15:31Z` |
| Inbox | No match (self-send visible in Sent Items) |

### Report line
```
yes | dzahid@commun-et.com | dzahid@commun-et.com | 6 | Graph 202 / sent | dc4df479-… (JSONB) | yes | stage 3 COMPLETED
```


### Exact P1 From / preview / audit / block rules (plan only — no send)

1. **Prepare:** Bind Stage 3 `reviewed_snapshot`; assemble outbound email draft (To from provider routing config, subject/body, attachment list/hashes); record `from_mailbox` candidate from operator’s `microsoft_mailbox_connections.mailbox_email`
2. **Preview:** Show provider, method=`email`, **From: \<connected mailbox\>**, To, package version/snapshot id, subject/body, attachments, reviewer, PermitPilot operator
3. **Confirm:** Explicit one-use human confirmation; still **do not** call Graph send until Mail.Send + recipients gates pass
4. **Block if disconnected:** No valid connection → email submit blocked with **Connect Outlook** CTA (Settings)
5. **Identity match:** At prepare/confirm, Graph `/me` identity must equal stored `mailbox_email` (and preview From); mismatch → fail closed, reconnect
6. **Audit:** Persist sender mailbox + PermitPilot operator on append-only **transmission** attempts (separate from `submission_validation_attempts`)
7. **Idempotency / uncertain:** Transmission claim key; `outcome_unknown` on ambiguous Graph results; never mark Submitted without reconciled proof
8. **Out of P1:** Shared mailbox / Send As / Send on behalf; Stage 5; portal/manual after email path lands

### Checklist updates (Manual / Cursor / client)

- **Client:** Approve utility **recipients** + subject/attachment policy + tenant **Mail.Send** consent — **not** a single required Permitting@ sender
- **Operators:** Each Commun-ET user connects **their** Outlook in Settings before Stage 4 email
- **Cursor/implementers:** Prefer per-user connection; remove Stage 4 docs/requirements that mandate Permitting@ as From; keep shared mailbox for later Exchange Send As only

## Stage 4 Submission Tracker live-send UI wiring — 2026-08-19

**Status:** Implemented (no email sent during this work). User will manually test Send in UI.

### Root cause fixed
- `emailProductionReadiness()` previously **hardcoded** `mail_send_permission_configured=false`, so Tracker always showed “Mail.Send permission required” even when the connected token had `Mail.Send`.
- Readiness now reads **real** scopes from `microsoft_mailbox_connections` (via `getMailboxStatusForUser` → `mail_send_permission_configured`).
- `UCI_EMAIL_LIVE_SUBMISSION_ENABLED` remains a **separate** gate (`ready_to_send = live flag AND Mail.Send`).
- OAuth default `GRAPH_SCOPES` now includes `Mail.Send` for future reconnects.

### UI / API
- Tracker banners follow live readiness (Mail.Send vs live-flag-off vs ready).
- Confirmed + ready → editable **To**, From/subject/body/attachment manifest, **Send test email** / **Send submission**.
- Send uses existing `POST .../transmit` (`/me/sendMail` path); AlertDialog confirmation required before Graph side effect.
- Idempotency: `ui-transmit:<preparationId>` + `submission_transmission_attempts` / JSONB mirror.
- Hard refresh retains sent state via `latest_transmission` on preparations list (+ metadata fallback).
- Stage 5 entry is **not** automatic on transmit; use `POST /api/uci/applications/:id/reconcile-stage5` after `status=sent`.

## Stage 5 Acknowledgment / Communication Parser — 2026-08-19

**Status:** Stage 5 product implemented in code with automated tests. Live Graph/LLM/client-labeled certification remain external verification dependencies.

### Implemented
- Stage 4→5 handoff from live transmission reconcile + legacy confirmed submit; ack SLA start/stop/overdue/2× escalation
- Graph inbound poll + webhook ingest (idempotent); portal sync shares `coordination_communications` and enqueues classification
- Matcher (ticket/account/address/sender/thread/provider/LC) + unmatched queue table
- 11-category **LLM classifier** (`uci-llm-classifier.service.js`) + keyword fallback; confidence threshold **0.75** everywhere
- Primary provider: **OpenAI** via existing `createOpenAiClient` when `ANTHROPIC_API_KEY` is absent; Anthropic retained as optional auto-primary when configured
- Provider/model/version/confidence/fallback audited on `agent_5_classification` metadata only (no provider wording in operator UI)
- Ack acceptance with ticket/PM/next-action/date capture; high-confidence auto-complete; Flag-for-review blocks auto lifecycle
- Reviewer Confirm / Reclassify / Rematch / Reject / notes; Needs Attention includes unmatched
- Stage 6 guard: `canEnterStage6` only after Stage 5 COMPLETED + `acknowledgment_received_at`; no Stage 6 product started
- Synthetic accuracy harness ≥85%; migration `20260819040000_uci_stage5_acknowledgment.sql`

### External / live-verification dependencies
- Microsoft Graph Mail.Read (or equivalent) on operator mailbox for live inbound
- `OPENAI_API_KEY` for live LLM path (keyword fallback always available; Stage 5 does **not** block on missing Anthropic)
- Optional `ANTHROPIC_API_KEY` (+ `UCI_CLAUDE_CLASSIFIER_ENABLED`) if Claude should be primary under `UCI_LLM_CLASSIFIER_PROVIDER=auto`
- Client-labeled utility message sample set for production ≥85% certification
- Apply Stage 5 migration on remote Supabase
- `UCI_EMAIL_INBOUND_WEBHOOK_SECRET` for webhook auth when exposing public ingest

### Local env (gitignored)
- `scraper-service/.env` already has `UCI_EMAIL_LIVE_SUBMISSION_ENABLED=true` (not committed).
- Local `OPENAI_API_KEY` present; `ANTHROPIC_API_KEY` not configured — Stage 5 uses OpenAI primary.

### Provider switch note (2026-08-19)
Audit found Claude integrated via Anthropic Messages HTTP (no `@anthropic-ai` SDK package) but **not** callable locally (no Anthropic key). Switched Stage 5 primary LLM to existing PermitPilot OpenAI client; keyword fallback retained.

## Stage 4 operator UI simplification — 2026-08-19

**Status:** UI/naming + operator-flow cleanup only. Idempotency, Stage 5, and audit persistence unchanged.

### Audit (Highland sent prep)
- Send absent because the **current preparation already has a `sent` transmission**; UI keyed send off app-level latest transmission + prep confirm state; `ui-transmit:<preparationId>` idempotency (and prep-level sent/claimed/outcome_unknown) prevents re-send of the same prep.
- Safe re-test: **Create new transmission / Send another test** → new `submission_preparations` row → Preview → explicit Send (new `ui-transmit:<newPrepId>`). Prior sent row stays immutable.
- **Validate submission package**: eligibility (reviewed snapshot, no corrections) + package readiness (`missing_*`, `package_status=ready_for_review`); writes validation attempt; **does not send**. Prepare already ran the same eligibility gate; Send requires confirmed prep + live gates + attachment resolve — not the Validate endpoint. Standalone Validate removed from primary UI; Prepare now auto-preflights the same readiness checks.
- Recommended flow: **Open package → Prepare → Preview → Send** (confirm runs automatically on Send when needed).

### Delivered
- Tracker: compact sent line; hide Graph/Stage 5/env jargon; capability package label `Application Builder · Reviewed package v1`; Create new transmission / Send another test after sent.
- Shared `src/lib/uciCapabilityLabels.ts` for agent→capability and package/sent formatting.
- Application Builder primary action routes to Tracker Prepare (Validate button removed from primary UI).

