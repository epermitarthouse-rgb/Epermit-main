# Response Matrix — Reconciliation Concepts Proposal

**Date:** 2026-07-31  
**Type:** Product + technical proposal only. No code, commit, push, or deploy.  
**Inputs:** `docs/audits/response-matrix-lovable-audit.md`, `parsed_comments` migrations, Actions in `ResponseMatrix.tsx`, `comment-parser-agent` portal refresh, `RoundChangeSummary` / `response_package_drafts`.

---

## 1. Current reality (evidence)

### What the Response Matrix already is

- Live workspace over `parsed_comments` for a project: load, draft, approve, enrich, route, classify, quality, completeness, export.
- **“Reconciliation” tab** = cosmetic label for that queue (Lovable mock name). No conflict/duplicate/jurisdiction engine. Audit §4.5.

### What Actions already cover

| Action | Backend | Outcome |
|--------|---------|---------|
| Refresh Classifications | `discipline-classifier-agent` | Writes `discipline` |
| Run Enrichment | `intake-pipeline-agent` enrichment-only | Code refs on rows |
| Run Auto Routing | `intake-pipeline-agent` routing-only | `assigned_to` etc. |
| Resume Pipeline | `intake-pipeline-agent` resume | Pipeline stages |
| Auto / Grounded draft | `generate-response` / `generate-grounded-response` | `response_text`, grounded_* |
| Quality Check | `guardian-quality-agent` | `comment_quality_checks` (per-row response QA; flags include `inconsistent`) |
| Validate Completeness | `validate-completeness-agent` | Ephemeral rules (response + Ready/Approved) |
| Plan Markup | `plan_markups` | Drawing markups |
| Export Response Package | `export-response-package` + `response_package_drafts` | Package + `comment_snapshot` |
| Approve / Changes / Reopen | DB trigger on `parsed_comments` | `response_status`, `approved_at`/`approved_by` |

None of these answer: *what changed between portal rounds*, *which approved response is now stale*, or *which portal row is the same issue as a manual letter*.

### Fields that exist on `parsed_comments` (relevant)

`id`, `project_id`, `original_text`, `discipline`, `code_reference`, `code_references`, `status`, `page_number`, `response_text`, `assigned_to`, `sheet_reference`, `ingest_source` (`raw_ref` | `raw_ref_staging` | `fallback_llm` | `manual_letter`), `source_document_id`, `reviewer_name`, `comment_number`, `previous_comment_text`, `existing_response_text`, `confidence`, grounded_* , response approval columns, `review_round` (**column exists; unused in any `.ts`/`.tsx`**).

### Related tables / partial cycle support

| Asset | What it does | Gap vs “reconciliation” |
|-------|--------------|-------------------------|
| `response_package_drafts.comment_snapshot` + `RoundChangeSummary` | Diff **response_text** (and new IDs) vs last **submitted** package | Does not compare **comment text** across portal refreshes; buried in Export dialog |
| `finalizePortalCommentRefresh` in `comment-parser-agent` | Match staging↔live by `portalCommentKey` (`comment_number` → first ref → normalized text); update text; **delete unmatched old portal rows**; promote new | Counts returned in parse `reconciliation` / `portal_refresh`; **not a durable RM workflow**; **does not clear `response_text` / `response_status` when `original_text` changes** |
| Parse-time duplicate skip | Skips near-duplicate inserts within a parse run | Not cross-source clustering; not operator-facing |
| Comment Review parse toasts | Surfaces parser `disappeared_after_*` ref lists | Pipeline hygiene, not AE reconciliation |
| `previous_comment_text` / `existing_response_text` | In-letter prior wording on **same row** (manual letters) | Not a link between two `parsed_comments` IDs |
| UCI / provider markups | Live in UCI tables (`coordination_*`), not `parsed_comments` | No dual-service canonical item without new model |
| Guardian `inconsistent` | Single comment vs its response | Not cross-comment / cross-discipline conflict |

### Lovable contrast (do not copy)

Lovable “Reconciliation” = mock unified permit+utility queue with fake `service` / `agency`. No matching, delta, or merge logic. PP should not invent those columns without data.

---

## 2. Concepts considered and filtered

| Idea | Data support? | Distinct from Actions? | Verdict |
|------|---------------|------------------------|---------|
| Match new review-cycle comments vs prior-cycle | Partial: portal refresh + package rounds; `review_round` unused | Yes | **Recommend (MVP core)** |
| Flag disappeared / changed / reopened after refresh | Strong: `portal_refresh` + silent text updates | Yes | **Recommend (MVP core)** |
| Approved response vs revised comment | Strong: refresh updates `original_text`, keeps response/approval | Yes | **Recommend (MVP core)** |
| Duplicate / repeated across reports / ingest sources | Medium: `comment_number`, text, codes, `ingest_source` | Yes | **Recommend as #2 (link-only)** |
| Conflicting comments / disciplines / codes / sheets | Weak for auto-resolve; fields exist for heuristics | Partially overlaps Guardian / classifier | **Defer** |
| Canonical merge portal + letters + utility markups | Utility not in `parsed_comments` | Would invent Lovable dual-service | **Defer** until UCI comment model |

---

## 3. Concept A — Portal / cycle delta (new · changed · disappeared · response-at-risk)

### User problem

After a re-scrape or re-parse, the matrix quietly reshuffles: new portal rows appear, matched rows get new `original_text`, unmatched portal rows (and their drafts/approvals) are **deleted**. Operators cannot see what moved, and may export or re-submit against a changed comment with an old approved response.

### Records compared

- **Live** `parsed_comments` where `ingest_source IN ('raw_ref','fallback_llm')` vs **staging** (`raw_ref_staging`) during refresh — logic already in `finalizePortalCommentRefresh` / `portalCommentKey`.
- Optionally: last submitted `response_package_drafts.comment_snapshot` for response continuity after ID-preserving updates.

### Backend logic required

1. **Persist a delta** when portal refresh finalizes (or a dry-run report before delete): per match key → `inserted` | `updated` | `deleted`, with before/after `original_text`, preserved `id` when updated, and whether deleted row had non-empty / Approved response.
2. On **updated** rows where `original_text` changed and `response_text` or `response_status='Approved'` exists → mark **response-at-risk** (do not auto-unapprove in v1 unless product insists; flag for human).
3. Expose read API / Edge summary for project: counts + row list for RM filter.

### Fields / schema needed

**Minimal (MVP):** new table e.g. `comment_reconciliation_events` (or JSON on `project_pipeline_runs.stages`) with: `project_id`, `pipeline_run_id`?, `event_type`, `comment_id` (nullable if deleted), `match_key`, `before_text`, `after_text`, `had_response`, `response_status_at_event`, `created_at`.  
**Optional later:** start writing `parsed_comments.review_round` (today unused) when a new package round or portal hash lands.

**Already present:** `portal_data_hash`, `project_pipeline_runs`, `comment_number`, `original_text`, response/approval columns.

### User actions

- **Run Reconciliation** (or auto-open after Resume Pipeline / successful portal refresh): review delta list.
- Filter matrix: New / Changed / Disappeared / Response at risk.
- Per changed+at-risk row: Reopen response, Clear approval, or Accept change (acknowledge).
- Per disappeared: note only (row gone) — show archived text from event table so work isn’t invisible.

### Final outcome

Operator has an audit trail of portal churn and a short list of responses that may no longer match the city’s wording — before the next package export.

### Overlap with existing features

- **RoundChangeSummary:** response-package round diffs only; Export dialog; ID-based; no comment-text drift.
- **Completeness / Quality:** do not detect comment text change under an approved response.
- **Parser reconciliation object:** ingest ref counts / disappeared refs — engineer-facing, not AE workflow.

### Complexity / value / risk

| | |
|--|--|
| **Complexity** | **Low–medium.** Matching code exists; main work is persist + RM UI + stop losing deleted context. |
| **Operational value** | **High.** Directly protects against silent stale approvals (current refresh behavior). |
| **False-match risk** | Medium on text-only keys; low when `comment_number` present. Prefer human confirm for at-risk; never auto-merge deletes. |

---

## 4. Concept B — Cross-ingest same-issue clustering (portal ↔ manual letter)

### User problem

Same review issue is often ingested twice: portal `raw_ref`/`fallback_llm` **and** `manual_letter` (or two letters). Operators draft and approve twice, or miss that letter text already has `existing_response_text` / `previous_comment_text`.

### Records compared

Pairs/groups of `parsed_comments` in one `project_id` across `ingest_source` values, scored by:

1. Exact / normalized `comment_number`
2. Shared `code_reference` / `code_references` + discipline
3. Text similarity of `original_text` (and letter `previous_comment_text` when present)

### Backend logic required

- Read-only **cluster** job (Edge or client for small N): propose `cluster_id` + confidence; **no auto-merge** in v1.
- User actions: Link (set `canonical_comment_id` / cluster), Keep separate, Suppress duplicate from export.

### Fields / schema needed

**Missing today:** `canonical_comment_id` or `duplicate_of` / `cluster_id`, optional `cluster_confidence`.  
**Present:** `ingest_source`, `comment_number`, texts, codes, `source_document_id`.

### User actions

Run clustering → review suggested pairs → Link or Dismiss → optional “respond once, copy to linked”.

### Final outcome

One canonical work item per issue; secondary rows marked linked/suppressed for package export.

### Overlap

- Parse-time duplicate skip: same batch only; invisible in RM.
- Routing / classification: assignment, not identity.
- Not the same as Concept A (A is time/cycle; B is source identity).

### Complexity / value / risk

| | |
|--|--|
| **Complexity** | **Medium.** Heuristics + UI for link/dismiss; export must respect links. |
| **Operational value** | **Medium–high** on projects that mix portal + letter. Lower if single ingest path. |
| **False-match risk** | **High** on short comments / shared code sections. Human-in-the-loop mandatory; never auto-delete. |

---

## 5. Concept C — Cross-comment conflict surfacing (defer)

### Why not build now

- No conflict graph, agency column, or revision lineage between rows.
- Guardian already flags per-response `inconsistent` / `wrong_discipline` / `code_missing` / `needs_sheet_ref`.
- Auto-flagging “Structural says X, Electrical says Y” needs domain rules or LLM with high false-positive cost and no schema for resolution.

**Prerequisite if revisited:** durable revision IDs + agency/discipline ownership rules, then a suggest-only “possible conflict” panel — still not auto-resolve.

---

## 6. Concept D — Unified permit + utility canonical queue (defer / not this label)

Lovable marketing copy implies county + provider markups in one matrix. PP data plane for RM is **only** `parsed_comments`. UCI lives in `coordination_*`. Building this under “Reconciliation” would invent a dual-service model and contradict the fake-backend warning in the Lovable audit.

**Prerequisite:** product decision + schema for utility review comments as first-class rows (or foreign links), then a separate initiative — not a tab rename.

---

## 7. Recommendation

### Build now — smallest valuable MVP

**Ship Concept A (portal/cycle delta + response-at-risk),** optionally folding the “approved vs revised comment” check into the same pass (it is the same event stream).

1. Persist refresh deltas (stop relying on ephemeral parser JSON).
2. Surface in Response Matrix via **Actions → Run Reconciliation** (dialog or side panel): New / Updated / Deleted / Response at risk.
3. Deep-link filters into the existing queue (do not replace the table).
4. Soften copy: queue is the worklist; reconciliation is a **run**, not a synonymous view.

**Defer Concept B** until A is live and there is evidence of dual-ingest pain on demo/production projects; then add link-only clustering (no auto-merge).

**Do not build** cross-comment conflict engine or permit+utility canonical merge under this label.

**Do not keep “Reconciliation” as a fake product engine** if no delta UI ships — see UI below.

### Prerequisites if choosing Defer entirely

If even A is deferred, missing durable pieces are: event store for portal refresh (before delete), and operator-facing list of text changes under existing responses. `review_round` alone is not enough (unused). Package snapshots alone are not enough (response-only).

### UI shape

| Option | Recommendation |
|--------|----------------|
| Keep toggle tab named “Reconciliation” | **No** as the engine name — it oversells today’s queue. |
| Rename default view | **Yes:** e.g. **Comments** / **Response queue** (keep `?view=scoring` as grounded confidence). |
| `Run Reconciliation` action | **Yes — primary entry** next to Resume Pipeline / Validate Completeness. |
| Remain a tab | Only if tab means “delta review mode” *after* Run produces results — secondary. |

**Suggested chrome:** default view = queue; Actions includes **Run Reconciliation**; optional banner after pipeline refresh: “N comments changed — review reconciliation.”

---

## 8. MVP scope checklist (when implementing later)

- [ ] Persist `portal_refresh` outcomes with before/after text and response flags  
- [ ] Do not delete unmatched portal rows without archival (or soft-delete / event payload)  
- [ ] Flag updated rows with existing Approved/draft response  
- [ ] RM Action + filter; no auto-unapprove without confirmation  
- [ ] Tests around `portalCommentKey` collisions and empty `comment_number`  
- [ ] Honest labels: remove utility “reconcile here” framing until UCI comments exist  
- [ ] No new mock columns (`service`, numeric Lovable confidence)

---

## 9. Explicit non-actions for this proposal

- No application code changes beyond this document.  
- No git commit, push, or deploy.

---

*End of proposal.*
