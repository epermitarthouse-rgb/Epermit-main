# Response Matrix vs Lovable — Real / Mock / Wiring Audit

**Date:** 2026-07-31  
**Scope:** Audit/report only. No code changes, commit, push, or deploy were performed for this document.  
**Routes:** PermitPilot `/response-matrix` · Lovable `/matrix/response` · Stitch `/responses` (+ `?view=ai-scoring`)

---

## 1. Executive summary

PermitPilot’s Response Matrix is a **production-backed operational workspace** over `parsed_comments` (load, draft, approve, enrich/route, export). Lovable’s Response Matrix is a **fully mock marketing UI**: five hardcoded rows, dead Filter/Auto-Draft controls, and a `?view=scoring` toggle that swaps a Response column for a static “AI Confidence” bar.

PP has **adopted Lovable chrome** (Reconciliation / AI Scoring toggle, Open/Drafted/Accepted/Cross-service metrics, ServicePills, utility AlertBanner) but those labels are mostly **cosmetic overlays** on the real queue:

| Lovable control | Intended (from Lovable source) | PP today |
|-----------------|--------------------------------|----------|
| **Reconciliation** | Default matrix view of comments + drafts across permit + utility “services” | Label for the live comment queue. **Not** a conflict/duplicate/jurisdiction reconciliation engine. |
| **AI Scoring** | Alternate column showing mock 0–100% confidence bars | Swaps Response preview for **`grounded_confidence`** (`high`/`medium`/`low`) from grounded drafts. **Not** Lovable’s % bars; **not** the Guardian quality 1–10 scores. |

PP’s **real** response-quality scoring lives under **Actions → Quality Check** (`guardian-quality-agent` → `comment_quality_checks`), separate from the AI Scoring view toggle.

**Bottom line:** PP is functionally ahead of Lovable on drafting/approval/export. The Lovable Reconciliation/AI Scoring product story (unified permit+utility queue with continuous AI confidence) is **partially labeled, not fully implemented**. Stitch HTML describes a richer AE-integrity / Match% / Confidence% UX that neither Lovable React nor PP fully ships.

---

## 2. Real vs mock inventory (PermitPilot UI)

Classification key:

- **Real production data** — reads live DB/API for the signed-in project  
- **Real backend function** — invokes Edge/API that writes or computes server-side  
- **Partially wired** — real path exists but incomplete, heuristic, or mismatched to label  
- **Mock/static/demo-only** — hardcoded or demo surface  
- **UI-only/no action** — visible control with no meaningful handler  
- **Broken or unreachable** — dead path / misleading / fails silently relative to label  

### 2.1 Page chrome & metrics

| UI element | Classification | Exact source |
|------------|----------------|--------------|
| Page eyebrow / title / body copy (“Comment reconciliation…”) | Partially wired | Static copy in `ResponseMatrix.tsx` (Lovable-aligned). Body appends **real** `commentMatrixSourceLabel` from `ingest_source` on loaded rows. |
| **Reconciliation / AI Scoring** toggle | Partially wired | Query `?view=scoring` (`setMatrixView`). Toggles column only; does not run scoring agent. |
| Filter button (`filter=pending`) | Real production data | Client filter on `status` / empty `response_text`. URL `?filter=pending`. |
| Discipline select | Real production data | Distinct `discipline` values from loaded rows; URL `?discipline=`. |
| Header **Auto-Draft** | Partially wired | Label says Auto-Draft; handler calls **`runBatchGrounded`** (grounded Edge), not `generate-response`. |
| ServicePill “Permit expediting” / “Utility coordination” | UI-only/no action | Always both rendered; no per-row `service` field; no filter. |
| Comment count badge | Real production data | `withoutMetadata.length` after metadata filter. |
| Back-to-dashboard | Real | `navigate("/dashboard")`. |
| Metric **Open** | Derived frontend calc | Heuristic over `status` + `effectiveResponseStatus` + empty response. |
| Metric **Drafted** | Derived frontend calc | Counts AI Generated / Draft / Awaiting Approval / draft / ready for review. |
| Metric **Accepted** | Derived frontend calc | `status === approved` **or** `response_status === Approved`. |
| Metric **Cross-service** | Partially wired | Discipline keyword heuristic (`utilit|electric|gas|water|telecom`). Not UCI provider rows; not Lovable `service` enum. |
| AlertBanner (utility comments reconcile…) | Partially wired | Marketing copy. Rows are all `parsed_comments`; no dual-service data model. Banner asserts “never mocked” — true for table rows. |
| Auth gate | Real | Redirect to `/auth` if no user. |

### 2.2 Comment workflow hub

| UI element | Classification | Exact source |
|------------|----------------|--------------|
| Comment workflow panel | Real (navigation) | `CommentWorkflowEntry.tsx` → `/comment-review?project_id=`. Does not embed upload/parse. |
| Upload & Parse / Review Parsed CTAs | Real (navigation) | Same Comment Review route. |

### 2.3 Reconciliation queue panel & Actions

| UI element | Classification | Exact source |
|------------|----------------|--------------|
| Panel title “Reconciliation queue” | UI-only/no action (label) | Cosmetic; queue = filtered `parsed_comments`. |
| ReviewTimer | Real backend function | `ReviewTimer` / shadow review timing (project-scoped). |
| Export menu (CSV/XLSX) | Real production data + client export | `ResponseMatrixExportMenu` + `responseMatrixExport.ts`; also reads `projects`, `plan_markups`, `project_documents`. |
| Validate Completeness | Real backend function | Edge `validate-completeness-agent` — rule-based (response + status Ready/Approved). Dialog only; no DB write. |
| Quality Check | Real backend function | Edge `guardian-quality-agent` (OpenAI) → inserts `comment_quality_checks`; UI dialog. Blocked when pending plan markups (`qualityCheckBlocked`). |
| Plan Markup | Real | `PlanMarkupWorkspace` + `plan_markups` table. |
| Run Enrichment | Real backend function | `intake-pipeline-agent` `{ run_enrichment_only: true }` → updates code refs on `parsed_comments`. |
| Run Auto Routing | Real backend function | `intake-pipeline-agent` `{ run_routing_only: true }` → `assigned_to` etc. |
| Refresh Classifications | Real backend function | `discipline-classifier-agent` `{ reclassify_all: true }`. |
| Resume Pipeline | Real backend function | `intake-pipeline-agent` `{ resume_pipeline: true }` (+ optional `portal_data_hash`). |
| Upload & Parse (menu) | Real (navigation) | → Comment Review. |
| Export Response Package | Real backend function | `ExportPackageDialog` → Edge `export-response-package`; drafts in `response_package_drafts`; branding `company_branding`. |
| Save Changes | Partially wired | Persists **only** `assigned_to`, `sheet_reference`, `status` — **not** `response_text` (responses save via SuggestedResponsePanel). |

### 2.4 Table columns & row UI

| UI element | Classification | Exact source |
|------------|----------------|--------------|
| Row data | Real production data | `supabase.from("parsed_comments").select(...)` filtered by `project_id`. |
| Metadata exclusion | Derived frontend calc | `isReportMetadataRow` drops portal report noise (skips `manual_letter` / `fallback_llm`). |
| Select / select-all checkboxes | Real (UI state) | Local `selectedRowIds`; feeds grounded batch. |
| Expand chevron | Real | Expands `CommentDetailPanel`. |
| Status select | Real production data | Optimistic RQ cache; persisted via Save Changes. Values from `STATUS_OPTIONS` (matches DB check constraint). |
| Discipline badge | Real production data | `parsed_comments.discipline` (classifier/enrichment). Display-only in matrix (reclassify via Actions). |
| Comment preview | Real production data | `buildFullCommentContext` / `original_text` + previous-cycle context. |
| Code Ref chips | Real production data | `code_reference` + `code_references` JSON/array. |
| Response column (Reconciliation) | Real production data | `response_text` + `effectiveResponseStatus` badges + grounded badges. |
| AI Confidence column (Scoring view) | Partially wired | Shows `grounded_confidence` badge or “No grounded draft yet”. Not % score; not Guardian scores. |
| Modified badge | Derived frontend calc | `getModifiedCommentIds` vs last submitted `response_package_drafts` snapshot. |
| Per-row **Auto** | Real backend function | Edge `generate-response` → writes `response_text`, `response_status=AI Generated`, `ai_generated_response_text`. |
| Per-row **Grounded** | Real backend function | Edge `generate-grounded-response` (plan chunks) → grounded fields + response; queued via `useGroundedDraftQueue`. |
| Batch grounded buttons | Real backend function | Same grounded Edge. |
| Empty: no project | Real | Requires `useResolvedProjectId` (URL `project_id`/`projectId`/`project` or sidebar selection). |
| Empty: no comments | Real | Points to Comment Review upload/parse. |

### 2.5 Expanded detail panel

| UI element | Classification | Exact source |
|------------|----------------|--------------|
| City/reviewer comment, previous, existing letter response | Real production data | Manual-letter / portal fields on `parsed_comments`. |
| SuggestedResponsePanel (edit/save/approve/request changes/reopen) | Real backend function | Direct `parsed_comments` updates; approval trigger sets `approved_at`/`approved_by` (migration `20260620120000_…`). Owner/admin gate via `useProjectTeam`. |
| Confidence badge / evidence / required action / missing info | Real production data | Written by `generate-grounded-response` (`grounded_*` columns). |
| Assigned to / sheet reference inputs | Real (via Save Changes) | Local edit → Save Changes. |
| Plan markup status badge | Real production data | `plan_markups` by `comment_id`. |

### 2.6 Dialogs

| UI element | Classification | Exact source |
|------------|----------------|--------------|
| Completeness dialog | Real backend function | Ephemeral result from Edge. |
| Quality check dialog + Apply suggestion | Partially wired | Scores from Edge/DB insert. Apply suggestion patches RQ cache; toast says persist via **response panel** (Save Changes will **not** persist response_text). |
| Export package dialog | Real backend function | As above. |

### 2.7 Lovable reference inventory (for contrast)

| Lovable UI | Classification | Source |
|------------|----------------|--------|
| Entire table (5 rows) | Mock/static/demo-only | `const rows: Row[] = [...]` in `reference/lovable-ui/src/pages/ResponseMatrix.tsx` |
| Metrics Open/Drafted/Accepted/Cross-service | Mock/static | Filters on mock `status` / `service` |
| Reconciliation / AI scoring toggle | UI-only view switch | `?view=scoring` swaps columns over mock data |
| Filter button | UI-only/no action | No `onClick` |
| Auto-Draft button | UI-only/no action | No `onClick` |
| Export | Mock CSV of hardcoded rows | `CsvExportDialog` |
| Confidence bars | Mock | Hardcoded `confidence: 0.44–0.98` |

---

## 3. Function-by-function status

| Function | Trigger | Backend | Data r/w | Expected result | E2E works? | Real vs fabricated |
|----------|---------|---------|----------|-----------------|------------|--------------------|
| **Load parsed comments** | Mount + RQ `["parsed_comments", projectId]` | Supabase select `parsed_comments` | R | Rows for project, oldest first | Yes (auth + project) | Real |
| **Discipline / classification display** | Render | Prior classifier/pipeline | R `discipline` | Badge per row | Yes if classified | Real display |
| **Refresh classifications** | Actions menu | `discipline-classifier-agent` | W `discipline` | Reclassify all | Yes when Edge/OpenAI up | Real |
| **Reconciliation queue** | Default view | None special | R queue | Work queue of comments | Yes as queue; **no** conflict merge | Label only vs Lovable product name |
| **AI Scoring view** | `?view=scoring` | None on toggle | R `grounded_confidence` | Show confidence column | Yes if grounded ran | Real categorical confidence; **not** Lovable % scoring |
| **Quality Check (true AI score)** | Actions → Quality Check | `guardian-quality-agent` | R comments; W `comment_quality_checks` | 1–10 scores, flags, suggestions | Yes (blocked if pending markups) | Real LLM QA |
| **Response editing** | Expand → SuggestedResponsePanel | Direct update `parsed_comments` | W response fields | Persist draft + status | Yes | Real |
| **Auto-Draft (per-row Auto)** | Row Auto button | `generate-response` | W response fields | Ungrounded AI draft | Yes | Real |
| **Header Auto-Draft** | Header button | `generate-grounded-response` (batch) | W grounded + response | Grounded drafts for pending | Yes if plans prepared | Real but **mislabeled** vs per-row Auto |
| **Grounded draft** | Grounded / batch | `generate-grounded-response` | W grounded_* + response | Evidence-backed draft | Yes if AI-prepared docs | Real |
| **Code enrichment** | Run Enrichment | `intake-pipeline-agent` enrichment-only | W code refs | Enriched count toast | Yes | Real |
| **Auto-routing** | Run Auto Routing | `intake-pipeline-agent` routing-only | W assignment | Routed count | Yes | Real |
| **Resume pipeline** | Resume Pipeline | `intake-pipeline-agent` resume | W pipeline stages / comments | Complete or retry status | Yes (depends on prior run) | Real |
| **Approval / status** | Approve / Changes / Reopen; row status select | DB + trigger | W `response_status`, `status`, approval cols | Owner/admin approve | Yes | Real |
| **Filters / views** | Filter, discipline, scoring | Client + URL | — | Narrow list / swap column | Yes | Real filters; scoring view partial |
| **Export CSV/XLSX** | Export menu | Client + related tables | R | Download file | Yes | Real |
| **Export response package** | Export Response Package | `export-response-package` | R comments; W storage/drafts | PDF/package URL | Yes (gates incomplete responses) | Real |
| **Project switching** | Sidebar / `?project_id=` | `useResolvedProjectId` | — | Reload comments | Yes | Real |
| **Deep links** | `?project_id=`, `?filter=pending`, `?view=scoring`, `?discipline=` | Router | — | Restore view state | Yes | Real |
| **Upload / parse comments** | Hub / empty / menu | Navigates to Comment Review (separate page Edge parse) | Off-page | Not in-matrix | Yes via CR | Real off-page |
| **Cross-service utility queue** | Metric + banner | Heuristic only | — | Utility count | Partial / misleading | Fabricated framing; data still permit comments |

---

## 4. Reconciliation — intended vs current

### 4.1 What Lovable means by “Reconciliation”

**Primary evidence:** `reference/lovable-ui/src/pages/ResponseMatrix.tsx`

- Default view label: **“Reconciliation”** (internal key `"default"`).
- Page title/body: *“Comment reconciliation across permitting and utility coordination”* — one workspace for **county comments**, **provider markups**, and **operator approvals**.
- Each mock row has `service: "permit-expediting" | "utility-coordination"`, `agency`, `project`, status `open|drafted|accepted`.
- Alert: utility comments “now reconcile here too” with shared scoring/approval/export.
- Table shows ID, Project, Service, Code, Comment, **Response**, Status, Reviewer.
- **No** code for: duplicate detection, revision matching, jurisdiction conflict resolution, merge/split, unresolved-field workflow, or writeback.

**Conclusion:** In Lovable React, “Reconciliation” is a **UX name for a unified cross-service comment/response queue**, not a technical reconciliation engine. All data is fabricated.

**Secondary evidence (Stitch):** `permitpilot_response_matrix_ux_v3` / `…_ai_scoring_ux_v3` show a denser AE workflow (timer, grounded, Match%/Confidence%, ICC side panel). Stitch COVERAGE maps these to `/responses` and `/responses?view=ai-scoring`. That is a **different layout** from Lovable’s React toggle; intent is “AE response integrity + ICC references,” still static HTML.

### 4.2 What enters the PP “Reconciliation queue”

| Inclusion rule | Evidence |
|----------------|----------|
| All `parsed_comments` for selected `project_id` | RQ fetch |
| Excludes report-metadata portal noise | `isReportMetadataRow` |
| Optional pending-only | empty response or status pending |
| Optional discipline filter | URL + client filter |
| Manual + portal ingest | `ingest_source` (`raw_ref`, `manual_letter`, …) |
| **Does not** include UCI provider markup objects as a first-class `service` | No `service` column; Cross-service = discipline keywords |

### 4.3 Conflicts / duplicates / revisions / jurisdiction / unresolved

| Concept | Lovable | PermitPilot |
|---------|---------|-------------|
| Duplicates / conflicts | Not implemented (mock only) | Not implemented on this page |
| Revisions / prior cycle | Mock N/A | **Partial:** `previous_comment_text`, Modified badge vs package snapshot |
| Jurisdiction / agency column | Mock `agency` | Not a matrix column (project-level elsewhere) |
| Unresolved fields | Mock “No draft” | Empty response, Gaps (`missing_info_or_risk`), Changes Requested |
| Cross-service blockers | Mock `service` + Cross-service metric | Heuristic metric + decorative ServicePills |

### 4.4 User actions & data changes (PP)

Working on the queue: edit status/assignment/sheet, Auto/Grounded draft, expand approve/edit, enrichment/routing/classify, validate/quality/export.  
**None** of these are a “reconcile conflicts” transaction. After actions, rows update in `parsed_comments` (and related tables as listed in §3).

### 4.5 Verdict

PP **matches Lovable’s visual toggle and copy**, but **“Reconciliation” is only a label** for the existing comment-response matrix. It does **not** implement Lovable’s implied unified permit+utility reconciliation product, nor any conflict-resolution engine.

---

## 5. AI Scoring — intended vs current

### 5.1 Lovable React (`ResponseMatrix.tsx`)

| Aspect | Detail |
|--------|--------|
| **What is scored** | Opaque per-row `confidence: number` (0–1) on mock comments |
| **Dimensions** | Single dimension: “AI Confidence” |
| **Scale** | Percentage bar; green ≥85%, warning ≥65%, else destructive |
| **What it measures** | **Undocumented** in code. Appears as draft/response readiness confidence, **not** multi-axis quality, approval likelihood, completeness, or risk |
| **Inputs** | Hardcoded constants — no AI/backend |
| **UI** | Scoring view replaces Response column with `ConfidenceBar` |
| **Export** | Includes confidence % in mock CSV |

### 5.2 Stitch AI Scoring screen

| Aspect | Detail |
|--------|--------|
| File | `reference/lovable-ui/stitch-reference/.../permitpilot_response_matrix_ai_scoring_ux_v3/` |
| Signals | “Match: 98%”, “Confidence: 82%”, Auto-Draft badge, Approve Draft, ICC Compliance side panel |
| Intent (inferred from UI copy) | AE response integrity vs ICC/code references; architect approval for final memo |
| Backend | Static HTML — **no** algorithm, dimensions schema, or API contract documented |
| Relation to Lovable React | **Divergent** UX (side panel + Match%) vs React’s simple % column toggle |

Handover notes mention “Response Matrix & AI Scoring” and separately “Weighted Impact Vectors” for **compliance** dashboards — that weighted Life Safety logic is **not** implemented in Lovable ResponseMatrix React source.

### 5.3 PermitPilot scoring surfaces (three different things)

| Surface | What it scores | Scale | Inputs | Backend | Persisted? | Shown in AI Scoring view? |
|---------|----------------|-------|--------|---------|------------|---------------------------|
| **AI Scoring toggle** | Grounded draft evidence strength | `high` / `medium` / `low` | Reviewer text + plan chunks | `generate-grounded-response` | `parsed_comments.grounded_confidence` | **Yes** (badge only) |
| **Quality Check** | Response adequacy vs comment | 1–10 + flag taxonomy | Comment + response + code/sheet | `guardian-quality-agent` (gpt-4o) | `comment_quality_checks` | **No** (dialog) |
| **Validate Completeness** | Presence of response + status gate | Boolean + counts | response_text + status | `validate-completeness-agent` (rules) | No | No |

Grounded confidence prompt contract (`generate-grounded-response`): `confidence: high|medium|low` based on evidence strength; downgraded when evidence weak / no chunks.

Guardian flags: `vague`, `incomplete`, `not_addressed`, `code_missing`, `inconsistent`, `needs_sheet_ref`, `wrong_discipline`, `other`.

### 5.4 Verdict

| Question | Answer |
|----------|--------|
| Is Lovable AI Scoring real? | **No** — static floats |
| Does PP AI Scoring view match Lovable? | **No** — categorical grounded confidence vs % bars; no ConfidenceBar component |
| Does PP have real response-quality AI scoring? | **Yes** — Quality Check / Guardian, separate from the toggle |
| Approval likelihood / multi-dimension risk scoring? | **Missing** in both Lovable RM React and PP RM scoring view |
| Continuous scoring without user click? | **Missing** — grounded confidence only after grounded draft; Guardian only on demand |

---

## 6. Gaps and risks

### Product / UX gaps

1. **“Reconciliation” oversells** a standard comment queue; users may expect conflict/utility merge that does not exist.  
2. **“AI Scoring” oversells** a column swap; real scoring is buried in Quality Check.  
3. **Header Auto-Draft ≠ row Auto** (grounded batch vs ungrounded `generate-response`) — operator confusion risk.  
4. **ServicePills + Cross-service + AlertBanner** imply UCI/provider parity; data model is still permit `parsed_comments`.  
5. **Lovable Filter** is dead; PP Filter is pending-only (narrower than Lovable’s implied multi-filter).  
6. **Stitch Match%/ICC panel** not implemented in PP or Lovable React.  
7. **Comment Review / Classified Comments** removed from Delivery nav (hub CTAs remain); upload discoverability depends on Matrix hub (see `docs/audits/response-matrix-comment-nav-plan.md`).

### Technical / data risks

1. **Quality Apply suggestion** does not persist via Save Changes (only via response panel) — easy to lose edits.  
2. **Guardian vs grounded scores** can disagree with no UI reconciliation.  
3. **Metrics double-count ambiguity** — Open/Drafted/Accepted heuristics can overlap or leave rows in none.  
4. **Fake-backend risk** (architecture matrix L023): restyling must not invent Lovable columns (`agency`, `service`, numeric confidence) without real fields.  
5. **Quality Check ownership check** in Edge uses `projects.user_id === user.id` — may fail for team members who are not project owner (same pattern as other agents).  
6. **Shared Supabase on Railway development** — quality/draft runs affect real demo data; use demo accounts only.

### Documentation / reference gaps

| Missing / incomplete | Impact |
|----------------------|--------|
| No written product spec for Lovable “Reconciliation” beyond page copy | Intent must be inferred from mock fields + marketing strings |
| No scoring rubric for Lovable `confidence` floats | Cannot map % to PP dimensions |
| Stitch vs Lovable React diverge | Unclear which is source of truth for “AI Scoring” UX |
| Weighted Life Safety scoring in handoff docs targets Compliance, not RM | Do not assume RM should implement that vector model without product decision |
| Screenshot `screen.png` exists under stitch folders | Visual only; not wired to live data contracts |

---

## 7. Recommended implementation order

1. **Clarify labels (no BE):** Rename or subtitle AI Scoring → “Grounded confidence”; point operators to Quality Check for 1–10 QA; rename header Auto-Draft → “Grounded draft pending” (or make it call `generate-response` to match Lovable/row Auto).  
2. **Wire scoring view to real scores (FE):** Optionally show Guardian last-run scores from `comment_quality_checks` and/or map `grounded_confidence` to a bar; avoid inventing % without a model.  
3. **Honest Cross-service metric:** Either remove/relabel, or tag rows from a real utility/provider field when available.  
4. **Persist Quality Apply via same path as draft save** (or disable Apply until panel save).  
5. **Only if product requires:** Design true reconciliation (duplicates/revisions/jurisdiction) with schema — do **not** fake from Lovable mock columns.  
6. **Defer** Stitch ICC side panel / Match% until scoring contract is defined.  
7. **Keep** Edge generate/approve/export contracts intact during any Lovable visual pass (per lovable UI rules).

---

## 8. Exact files / functions involved

### PermitPilot frontend

| Path | Role |
|------|------|
| `src/pages/ResponseMatrix.tsx` | Main page: fetch, metrics, views, actions, table |
| `src/components/response-matrix/SuggestedResponsePanel.tsx` | Edit/save/approve/request changes/reopen |
| `src/components/response-matrix/ExportPackageDialog.tsx` | Response package export UI |
| `src/components/response-matrix/ResponseMatrixExportMenu.tsx` | CSV/XLSX export |
| `src/components/response-matrix/CommentWorkflowEntry.tsx` | Hub to Comment Review |
| `src/components/response-matrix/RoundChangeSummary.tsx` | Modified-comment detection |
| `src/lib/responseApproval.ts` | `effectiveResponseStatus`, approval helpers |
| `src/lib/groundedCommentContext.ts` | Auto/grounded payloads, validation |
| `src/lib/responseMatrixExport.ts` | Export record builders |
| `src/hooks/useResolvedProjectId.ts` | Project deep link |
| `src/hooks/useGroundedDraftQueue.ts` | Concurrency for grounded drafts |
| `src/hooks/useResponsePackageDrafts.ts` | Package draft rounds |
| `src/hooks/useProjectTeam.ts` | Owner/admin approve gate |
| `src/components/plans/ArchitectApprovalDialog.tsx` | `useApprovalGate` / qualityCheckBlocked |
| `src/components/plans/PlanMarkupWorkspace.tsx` | Plan markup |
| `src/components/shadow/ReviewTimer.tsx` | Review timer |
| `src/components/design/ProductPrimitives.tsx` | PageHeader, MetricCard, ServicePill, AlertBanner, Panel |
| `src/components/layout/hybridNav.ts` | Delivery → Response Matrix |
| `src/App.tsx` | Route `/response-matrix` |
| `src/pages/CommentReview.tsx` | Upload/parse/approve into `parsed_comments` |
| `src/pages/ClassifiedComments.tsx` | Discipline board (route kept; nav removed) |

### Edge / DB

| Path | Role |
|------|------|
| `supabase/functions/generate-response/index.ts` | Ungrounded auto-draft |
| `supabase/functions/generate-grounded-response/index.ts` | Grounded draft + confidence |
| `supabase/functions/guardian-quality-agent/index.ts` | 1–10 response QA |
| `supabase/functions/validate-completeness-agent/index.ts` | Completeness rules |
| `supabase/functions/intake-pipeline-agent/index.ts` | Enrich / route / resume |
| `supabase/functions/discipline-classifier-agent/index.ts` | Reclassify |
| `supabase/functions/export-response-package/index.ts` | Package export |
| Tables: `parsed_comments`, `comment_quality_checks`, `response_package_drafts`, `plan_markups`, `project_documents`, `project_pipeline_runs`, `company_branding` | Data plane |
| Migrations e.g. `20260210200000_parsed_comments_response_matrix.sql`, `20260606140000_pgvector_document_ingestion.sql` (grounded_*), `20260620120000_parsed_comments_response_approval.sql` | Schema/triggers |

### Lovable / Stitch / docs

| Path | Role |
|------|------|
| `reference/lovable-ui/src/pages/ResponseMatrix.tsx` | Mock Reconciliation / AI Scoring |
| `reference/lovable-ui/src/components/permitpilot/data.ts` | Nav `/matrix/response` |
| `reference/lovable-ui/stitch-reference/.../permitpilot_response_matrix_ux_v3/` | Stitch reconciliation-like matrix |
| `reference/lovable-ui/stitch-reference/.../permitpilot_response_matrix_ai_scoring_ux_v3/` | Stitch scoring variant + `screen.png` |
| `reference/lovable-ui/lovable-permitpilot-architecture-matrix.md` | L023 mapping |
| `docs/audits/response-matrix-comment-nav-plan.md` | Nav hub plan |
| `docs/lovable-ui-frontend-implementation-plan.md` | Phase guidance for RM |
| `docs/current-data-model.md` | Table inventory |

---

## 9. Explicit non-actions for this audit

- **No code changes** were made except writing this audit file.  
- **No git commit** was created.  
- **No push** to GitHub.  
- **No Railway (or other) deploy.**

---

*End of audit.*
