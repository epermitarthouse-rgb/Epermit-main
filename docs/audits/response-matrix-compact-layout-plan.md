# Response Matrix — Metric Audit & Compact Layout Plan

**Date:** 2026-07-31  
**Type:** Plan / audit only. No application code, commit, push, or deploy.  
**Inputs:** `docs/audits/response-matrix-lovable-audit.md`, `src/pages/ResponseMatrix.tsx`, `src/lib/responseApproval.ts`, `src/components/response-matrix/CommentWorkflowEntry.tsx`, `src/components/design/ProductPrimitives.tsx`, Lovable `reference/lovable-ui/src/pages/ResponseMatrix.tsx`.

---

## 1. Problem statement

On a standard laptop viewport, operators must scroll past:

1. Large `PageHeader` (eyebrow + long title + body + view toggle)
2. Control row (Filter, Discipline, Auto-Draft, ServicePills, comment count, back)
3. Four large `MetricCard`s (`md:grid-cols-4`, `p-5`, `text-3xl`/`text-4xl` values)
4. Utility `AlertBanner`
5. Full `CommentWorkflowEntry` Panel (title, copy, two CTAs)

…before the **Comment response queue** table appears. The table is the primary work surface; chrome currently dominates above-the-fold space.

Separately, the four metrics (Open / Drafted / Accepted / Cross-service) were adopted from Lovable chrome. This audit traces whether they are accurate, mutually exclusive, and backed by real data.

---



## 2. Metric audit



### 2.0 Shared base set and dual status model


| Concept                 | Evidence                                                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Base set**            | All four counts use `withoutMetadata` = loaded `parsed_comments` minus `isReportMetadataRow` (`ResponseMatrix.tsx` ~734, ~1306–1342).                                                                                                                       |
| **Filters ignored**     | Metrics do **not** use `rows` (pending / discipline filters). Counts stay global for the project.                                                                                                                                                           |
| **Comment count badge** | Also `withoutMetadata.length` — same base set as metrics.                                                                                                                                                                                                   |
| **Not mock**            | Counts are derived from live rows; no hardcoded numbers.                                                                                                                                                                                                    |
| **Dual fields**         | `status` (comment workflow: Pending Review / Pending / Approved / Rejected / Draft / Ready for Review) **and** `response_status` via `effectiveResponseStatus` (AI Generated / Draft / Awaiting Approval / Approved / Changes Requested). Metrics mix both. |


`effectiveResponseStatus` (`src/lib/responseApproval.ts`):

- If `response_status` is a known approval status → use it.
- Else if `response_text` empty → `null`.
- Else if `grounded_generated_at` or `ai_generated_response_text` → `"AI Generated"`.
- Else → `"Draft"`.

Lovable contrast: mock rows use a **single** mutually exclusive `status: "open" | "drafted" | "accepted"` plus a real mock `service` enum. PP does not have that model.

---



### 2.1 Open


| Question                | Finding                                                                                                                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code**                | `openCount` (~1306–1316)                                                                                                                                                                                                                     |
| **Fields**              | `response_text`, `status` (lowercased), `effectiveResponseStatus(r)`                                                                                                                                                                         |
| **Counted when any of** | (1) empty/whitespace `response_text`; **or** (2) `status` ∈ `{pending, pending review}`; **or** (3) effective response status === `"Changes Requested"`; **or** (4) effective response status === `null`                                     |
| **Classification**      | **Heuristic / overlapping / misleading** (not mock)                                                                                                                                                                                          |
| **Why**                 | OR of empty response, comment-status pending, and approval “Changes Requested.” A row with a full AI draft can still count as Open if `status` is still `"Pending"`. Detail copy (“Needs operator attention”) is broader than “no response.” |
| **Overlap**             | Yes — with Drafted (pending + drafted response); with Accepted (comment `status === "Approved"` + empty response is rare but possible); with Cross-service (orthogonal).                                                                     |
| **Gap**                 | Rows with `status === "Rejected"` and a draft can fall only into Drafted; Rejected + empty text still Open via empty response.                                                                                                               |


---



### 2.2 Drafted


| Question                | Finding                                                                                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code**                | `draftedCount` (~1317–1327)                                                                                                                                                                                                                                             |
| **Fields**              | `effectiveResponseStatus(r)`, `status`                                                                                                                                                                                                                                  |
| **Counted when any of** | `rs ∈ {AI Generated, Draft, Awaiting Approval}` **or** `status ∈ {draft, ready for review}`                                                                                                                                                                             |
| **Classification**      | **Heuristic / overlapping** (not mock)                                                                                                                                                                                                                                  |
| **Why**                 | Mixes approval pipeline stages with comment-row `status`. A row can be Drafted via comment status alone even when `response_status` is Approved (if somehow inconsistent). Detail “Ready for review” does not match all counted states (AI Generated may not be ready). |
| **Overlap**             | Yes — with Open when pending + has draft; with Accepted when `status === "Approved"` **or** `rs === "Approved"` while comment status is still Draft/Ready for Review.                                                                                                   |
| **Not counted**         | `"Changes Requested"` goes to Open, not Drafted — inconsistent with “needs work” vs “has draft.”                                                                                                                                                                        |


---



### 2.3 Accepted


| Question           | Finding                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code**           | `acceptedCount` (~1328–1332)                                                                                                                                                                                                                                                                                                            |
| **Fields**         | `status`, `effectiveResponseStatus(r)`                                                                                                                                                                                                                                                                                                  |
| **Counted when**   | `status === "approved"` **OR** `rs === "Approved"`                                                                                                                                                                                                                                                                                      |
| **Classification** | **Real fields, overlapping / potentially misleading**                                                                                                                                                                                                                                                                                   |
| **Why**            | Comment-row `Approved` and response-approval `Approved` are different workflows. Completeness agent / export package care about responses and readiness; this metric can inflate if operators mark comment `status` Approved without `response_status === "Approved"`. Detail “Ready to export” overstates — export gates are separate. |
| **Overlap**        | Yes — with Open/Drafted as above.                                                                                                                                                                                                                                                                                                       |
| **Real?**          | Yes, derived from live columns — not invented utility data.                                                                                                                                                                                                                                                                             |


---



### 2.4 Cross-service


| Question            | Finding                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code**            | `crossServiceCount` (~1333–1342)                                                                                                                                                                                          |
| **Fields**          | `discipline` only (string contains)                                                                                                                                                                                       |
| **Counted when**    | lowercase discipline includes any of: `utilit`, `electric`, `gas`, `water`, `telecom`                                                                                                                                     |
| **Classification**  | **Misleading heuristic** — **not** a real service/source field                                                                                                                                                            |
| **Service source?** | **No.** No `service` column, no UCI / provider markup join, no `ingest_source` utility path. Lovable counts `service === "utility-coordination"` on mock rows. PP infers from **discipline keyword** (classifier output). |
| **Risk**            | MEP disciplines like “Electrical” or “Water” from permit review inflate “Cross-service” and reinforce the utility banner / ServicePills story without dual-service data.                                                  |
| **Overlap**         | Orthogonal axis — same row can be Open+Drafted+Cross-service simultaneously.                                                                                                                                              |


---



### 2.5 Mutual exclusivity & reconciliation with comment count


| Check                                          | Result                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mutually exclusive?                            | **No.** Open ∩ Drafted, Open ∩ Accepted, Drafted ∩ Accepted all possible.                                                                                  |
| `Open + Drafted + Accepted === comment count`? | **No** — overlaps inflate sum; gaps (e.g. Rejected + non-matching statuses) undercount; Cross-service is a fourth non-partition metric.                    |
| `Open + Drafted + Accepted + Cross-service`?   | Meaningless as a total — Cross-service is not a lifecycle stage.                                                                                           |
| Vs visible table rows                          | Metrics use unfiltered `withoutMetadata`; table may show fewer via `?filter=pending` / discipline. Badge matches metrics base, not filtered `rows.length`. |
| Clickable / filter today?                      | **No** — `MetricCard` is display-only (`ProductPrimitives.tsx`).                                                                                           |




#### Overlap examples (same `parsed_comments` row)


| Scenario                                             | Open | Drafted | Accepted | Cross-service         |
| ---------------------------------------------------- | ---- | ------- | -------- | --------------------- |
| Empty response, status Pending                       | ✓    |         |          | if discipline matches |
| `response_status=AI Generated`, status still Pending | ✓    | ✓       |          | maybe                 |
| `rs=Approved`, status Ready for Review               |      | ✓       | ✓        | maybe                 |
| `status=Approved`, empty response                    | ✓    |         | ✓        | maybe                 |
| `rs=Changes Requested`, has text                     | ✓    |         |          | maybe                 |
| Electrical discipline, `rs=Draft`                    |      | ✓       |          | ✓                     |


---



### 2.6 Recommended corrected definitions (FE-only; no invented utility data)

Prefer a **mutually exclusive lifecycle** on the **response approval** axis (what operators actually draft/approve), plus honest optional facets.


| Chip / metric                                     | Definition (recommended)                                                                                                                                                     | Source                      |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Needs response** (rename Open)                  | `!response_text?.trim()`                                                                                                                                                     | Real                        |
| **In draft** (rename Drafted)                     | Has response **and** `effectiveResponseStatus` ∈ `{AI Generated, Draft, Awaiting Approval, Changes Requested}`                                                               | Real                        |
| **Accepted**                                      | `effectiveResponseStatus === "Approved"` **only** (do not OR comment `status === "Approved"`)                                                                                | Real                        |
| **Other / gap** (optional, not shown as big card) | Has response but status outside above (legacy edge); or comment `status === "Rejected"` with no approval path — surface only if count > 0                                    | Real                        |
| **Cross-service**                                 | **Remove from summary bar**, or relabel to something honest like “Utility-like disciplines (heuristic)” — **do not** present as provider/UCI count until a real field exists | Do **not** invent `service` |


**Partition invariant (after fix):**  
`Needs response + In draft + Accepted (+ Other) === withoutMetadata.length`.

**Chip → table filter (UI plan):** clicking a chip filters `rows` to that definition (URL param e.g. `?lifecycle=needs-response|in-draft|accepted`); “All” clears. Keep existing pending filter as alias or merge into Needs response / In draft as product decides — do not keep two conflicting “pending” semantics without documenting.

**Do not:**

- Fabricate utility / provider counts
- Keep Cross-service as a peer lifecycle metric
- Keep ServicePills + utility AlertBanner as if dual-service data exists (see layout)

---



## 3. Above-the-fold inventory (current)

Approximate vertical stack in `ResponseMatrix.tsx` render order:


| Block            | Component / content                                                          | Approx. height impact   | Keep function?                        |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------- | ------------------------------------- |
| Page header      | Eyebrow, long title, body, Reconciliation/AI Scoring toggle                  | High (`text-3xl`/`4xl`) | Yes — compact                         |
| Toolbar          | Filter, Discipline, Auto-Draft, ServicePills, count, Back                    | Medium                  | Yes — denser; pills optional remove   |
| Metrics          | 4× `MetricCard`                                                              | **Very high**           | Yes as chips/bar, not cards           |
| Utility banner   | `AlertBanner` marketing copy                                                 | Medium                  | Collapse/remove (unsupported framing) |
| Comment workflow | `CommentWorkflowEntry` Panel                                                 | High                    | Keep both CTAs — relocate             |
| Queue panel      | Panel chrome + ReviewTimer, Export, Actions, Save Changes                    | Medium                  | Sticky with table                     |
| Table            | Sticky column heads (`table-head-sticky`); panel actions **not** page-sticky | Primary work            | Near fold                             |


`CommentWorkflowEntry`: navigates both buttons to `/comment-review?project_id=` — real, must remain reachable (also duplicated under Actions → Upload & Parse).

---



## 4. Compact UI plan — layout options

**Constraints (all options):**

- Preserve all existing functions and real data paths
- Keep **Upload & Parse** and **Review Parsed Comments** (hub and/or Actions)
- No mock numbers; no backend/schema changes in this plan’s implementation phase
- Export, Actions, Review Timer, Save Changes stay with the table (prefer sticky toolbar)
- Table visible without major scrolling on ~1440×900 / 13–14" laptop

---



### Option A — Compact header + chip summary bar (recommended direction)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Response Matrix · Comment response queue          [Reconciliation|AI]   │
│ Short one-line description · ingest source label                        │
├─────────────────────────────────────────────────────────────────────────┤
│ [Open n] [Drafted n] [Accepted n] │ Filter │ Discipline │ Auto-Draft │  │
│ Upload&Parse │ Review parsed │ n comments │ ← Dashboard                  │
├─────────────────────────────────────────────────────────────────────────┤
│ sticky: ReviewTimer · Export · Actions · Save Changes                   │
│ sticky: table column headers                                            │
│ rows…                                                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

- Title + description in one horizontal header (smaller type; drop multi-line hero title).
- Lifecycle chips replace MetricCards; click filters table; active chip highlighted.
- **Omit Cross-service chip** (or tertiary “Discipline hints” only after honest relabel — prefer omit).
- **No** utility AlertBanner by default (or one-line dismissible if product insists on soft copy).
- Comment workflow → two compact toolbar buttons (same handlers as today).
- Optional: collapsible “Upload & Parse” panel **below** table or behind a chevron — default collapsed so table stays near fold.
- ServicePills removed from chrome (decorative; no action).

**Pros:** Best fold density; chips become useful; honest about metrics; closest to preferred direction.  
**Cons:** Less Lovable “dashboard cards” visual parity; requires metric definition fix for chip trust.

---



### Option B — Lovable-parity cards, collapsed secondary chrome

Keep four small metric **chips** (or half-height cards in one row) labeled like Lovable, but:

- Collapse Comment Workflow into toolbar buttons
- Dismissible one-line banner or remove
- Compact header
- Cross-service shown only with tooltip: “Discipline keyword match — not provider markups”

**Pros:** Stronger Lovable label parity.  
**Cons:** Retains misleading Cross-service unless tooltip + definition fix; still slightly taller than A.

---



### Option C — Two-row command bar, metrics as table footer / side rail

- Row 1: title + view toggle + workflow CTAs  
- Row 2: filters + Auto-Draft + count  
- Metrics as a slim left rail or footer strip under the table (“n needs response · n in draft · n accepted”)  
- Table starts immediately under row 2

**Pros:** Maximum table priority.  
**Cons:** Metrics less discoverable; weaker Lovable parity; rail awkward on mobile.

---



## 5. Recommendation

**Ship Option A**, with metric definitions from §2.6.


| Criterion               | Why A                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Usability               | Table near fold; chips both summarize and filter                                                                                                           |
| Honesty                 | Drops unsupported utility banner / Cross-service peer metric                                                                                               |
| Lovable parity          | Keeps Reconciliation/AI Scoring toggle, Open/Drafted/Accepted vocabulary (renamed subtitles OK), Export/Actions density — without fake dual-service chrome |
| Functional preservation | All CTAs remain; Actions menu Upload & Parse retained as backup                                                                                            |


**Implementation order (when coding later — not this doc):**

1. Compact header + merge toolbars (no metric logic change yet) — immediate scroll win.
2. Relocate Comment Workflow CTAs; remove/collapse banner & ServicePills.
3. Replace MetricCards with chips; wire chip filters.
4. Fix count definitions to mutual exclusivity (§2.6); drop Cross-service from bar.
5. Sticky panel action bar (Timer / Export / Actions / Save) above sticky table heads.
6. Visual QA on laptop + mobile wrap; smoke existing Actions / draft / export.

**Out of scope for this layout pass:** portal reconciliation engine, UCI dual-service model, schema, mock confidence %, renaming Reconciliation → Comments (covered in other audits/proposals).

---



## 6. Explicit non-actions

- No application code changes beyond writing this document.  
- No git commit, push, or deploy.

---

*End of plan.*