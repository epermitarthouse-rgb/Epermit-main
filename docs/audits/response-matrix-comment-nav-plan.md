# Response Matrix as comment-workflow entry point

**Status:** Plan only (no implementation yet)  
**Goal:** Match Lovable Delivery nav — remove **Comment Review** and **Classified Comments** from the sidebar; make **Response Matrix** the primary entry for the full comment workflow (upload → parse → classify → enrich/route → draft → approve → export).

---

## Current structure

### Sidebar (Delivery group)

Defined in `src/components/layout/hybridNav.ts` → rendered by `AppSidebar` via `DashboardLayout`:

| Item | Route |
|------|--------|
| Permit Filing | `/permit-wizard-filing` |
| Response Matrix | `/response-matrix` |
| Portal Harvest | `/portal-data` |
| **Comment Review** | `/comment-review` |
| **Classified Comments** | `/classified-comments` |

Page titles for those paths live in the same file (`pageTitles`).

### Lovable reference nav

Lovable Delivery (`reference/lovable-ui/src/components/permitpilot/data.ts`) has **no** Comment Review / Classified Comments items — only Response Matrix (`/matrix/response` → PP `/response-matrix`), Portal Harvest, Permit Filing, etc.

Prior PP docs noted keeping those pages even when Lovable omits them (`docs/lovable-ui-full-gap-and-replication-plan.md` §2: “Grouped/collapsible… or page tabs on Response Matrix — **keep routes**”).

### Routes (`src/App.tsx`)

- `/comment-review` → `CommentReview`
- `/classified-comments` → `ClassifiedComments`
- `/response-matrix` → `ResponseMatrix`

### 1. Comment Review (`/comment-review`)

**Page:** `src/pages/CommentReview.tsx` (~2.2k lines)  
**UI pieces:** `src/components/comment-review/*`  
**Libs:** `src/lib/commentReview*.ts`, Edge `parse-manual-comment-letter`, `intake-pipeline-agent`

**Features (evidence):**

- Load portal review comments (`loadFromPortal` → `intake-pipeline-agent`)
- **Manual comment-letter upload** (single + batch), paste, manual form dialog
- Parse → review extracted rows → **Approve All** into `parsed_comments`
- Saved letter management / orphan cleanup
- Project via `useResolvedProjectId` (`?projectId=` / `?project_id=`)

This is the **only** first-class UI for manual file upload + parse/approve of letters.

### 2. Classified Comments (`/classified-comments`)

**Page:** `src/pages/ClassifiedComments.tsx` (~250 lines)

**Features:**

- Lists `parsed_comments` grouped by `discipline`
- **Refresh classifications** → `discipline-classifier-agent` (`reclassify_all: true`)
- Reload list only
- Empty state points users to Comment Review

No upload. Read/reclassify view.

### 3. Response Matrix (`/response-matrix`)

**Page:** `src/pages/ResponseMatrix.tsx`  
**UI:** `src/components/response-matrix/*`

Already covers the **downstream** workflow on `parsed_comments`:

| Capability | Where |
|------------|--------|
| View / edit responses | Reconciliation queue table |
| Discipline on rows | Discipline badges |
| Code enrichment | Actions → **Run Enrichment** (`intake-pipeline-agent`, enrichment-only) |
| Auto-routing | Actions → **Run Auto Routing** |
| Resume pipeline | Actions → **Resume Pipeline** |
| Drafting | Auto-Draft / grounded draft (`generate-response`, `generate-grounded-response`) + `SuggestedResponsePanel` |
| Approval | Owner/admin via response status / panel |
| Export | Export menu + Export Response Package |
| Views | `?view=scoring` \| reconciliation; `?filter=pending`; `?project_id=` |

**Does not today:** comment-file upload, portal load/parse UI, or a discipline-grouped classifier board (only per-row discipline).

### Inbound links (not sidebar)

| Source | Target |
|--------|--------|
| `AgentWorkflowStatus.tsx` | `/comment-review`, `/classified-comments` |
| `PortalDataViewer.tsx` (Review Comments report) | `/comment-review` + copy referencing Comment Review |
| `ProjectHealthCard.tsx` | `/comment-review` when no comments yet but report exists; else `/response-matrix?...` |
| `CommandPalette.tsx` | Response Matrix only (no CR/CC entries) |
| `useRecentlyUsed.ts` | Labels for all three paths |

---

## Recommended structure

### Approach: keep CR / CC as **internal sub-pages**; Matrix as **hub**

**Recommend: keep `/comment-review` and `/classified-comments` as real pages.** Do **not** move that UI into Matrix tabs/drawers in the first pass.

**Rationale (short):**

- Comment Review is a large, stateful upload/parse/approve surface; embedding it risks regressions and violates “preserve functioning components.”
- Classified Comments is small but still a dedicated reclassify UX; Matrix already shows discipline on rows.
- Lovable match is primarily **nav density** — one Delivery entry (Response Matrix) — not a code merge.
- Bookmarks and deep links stay working without brittle redirects.

**Later (optional):** light Matrix query `?workflow=` that scrolls to CTAs or auto-navigates; only consider true tabs if product insists after hub UX ships.

### Sidebar

**Remove** from Delivery in `hybridNav.ts`:

1. Comment Review  
2. Classified Comments  

**Keep:** Response Matrix (and other Delivery items).

Keep `pageTitles` entries so direct visits still get correct shell titles.

---

## Entry points inside Response Matrix

Add a small **Comment workflow** strip (header actions or panel under metrics) — links only, no reimplementation:

| Entry | Action | Destination |
|-------|--------|-------------|
| **Upload comment files** | Primary CTA | `/comment-review` (project query preserved via selected project / `?project_id=`) |
| **Review parsed comments** | Secondary | `/comment-review` (same page; upload accordion + saved portal/manual tables) |
| **View classified comments** | Secondary | `/classified-comments` |
| Optional | **Refresh classifications** | Stay on Matrix later *or* deep-link CC; v1 = link to CC |

Optional Matrix Actions menu items mirroring those links (same destinations).

Empty Matrix (`parsed_comments` length 0): emphasize Upload / Load via Comment Review (and Portal Harvest for scrape), not dead-end empty state.

---

## Preserve behaviour

| Concern | Plan |
|---------|------|
| Manual file upload | Unchanged on `/comment-review`; Matrix only links there |
| Parser / classifier / pipeline | Same Edge agents and pages; Matrix enrichment/routing/resume unchanged |
| Direct URLs / bookmarks | Routes stay registered; no hard delete |
| Backend | No schema, Edge, or scraper changes |

---

## Redirects / deep links

**Do not hard-redirect** `/comment-review` or `/classified-comments` away from their pages (that would break bookmarks and the hub links).

**Do update inbound UX copy/links** so the “happy path” goes through Matrix:

| Change | Suggested target |
|--------|------------------|
| Portal Harvest “Open Comment Review” / copy | Prefer `/response-matrix` + keep secondary “Upload / review comments” → `/comment-review`, **or** keep CR button but reword (“Continue in Response Matrix”) |
| AgentWorkflowStatus parser/classifier buttons | Point to Matrix hub CTAs, or keep CR/CC as “open detail” under Matrix wording |
| ProjectHealthCard “Open Comment Review” | `/response-matrix` when comments exist; when report exists but no rows, Matrix empty CTA → Comment Review upload/load |

**Optional soft deep links (v1.1):**

- `/response-matrix?workflow=upload` → Matrix shows upload CTA (and may `navigate` to CR after mount)
- `/response-matrix?workflow=classified` → highlight classified CTA

Not required for nav match.

---

## Files / routes affected

| Area | Paths |
|------|--------|
| Nav | `src/components/layout/hybridNav.ts` |
| Matrix hub UI | `src/pages/ResponseMatrix.tsx` (+ small component under `src/components/response-matrix/` if preferred) |
| Inbound links | `AgentWorkflowStatus.tsx`, `PortalDataViewer.tsx`, `ProjectHealthCard.tsx` |
| Titles / recent | `hybridNav.ts` `pageTitles`, `useRecentlyUsed.ts` (keep labels) |
| Routes | `App.tsx` — **keep** `/comment-review`, `/classified-comments`, `/response-matrix` |
| Unchanged pages | `CommentReview.tsx`, `ClassifiedComments.tsx`, comment-review libs |

No backend / Railway deploy required for nav-only.

---

## Implementation order

1. **Nav:** Remove Comment Review + Classified Comments from `hybridNavGroups` Delivery items.  
2. **Matrix hub:** Add three CTAs (upload / review parsed / classified). Empty-state copy.  
3. **Inbound links:** Portal Harvest, AgentWorkflowStatus, ProjectHealthCard — align to Matrix-first wording/links.  
4. **Smoke:** Sidebar matches Lovable Delivery density; CR upload still works via CTA; classify refresh on CC; Matrix enrich/route/draft/approve/export unchanged.  
5. **Optional:** `?workflow=` query helpers; Command Palette keywords for upload/classify → Matrix.

---

## Risks

| Risk | Mitigation |
|------|------------|
| Users can’t find upload after sidebar removal | Prominent Matrix CTAs + empty-state + update Portal Harvest button/copy |
| “Review parsed” vs Matrix table confusion | CTA label: “Upload & parse comments” vs Matrix “Edit responses” |
| Over-scoping into tabs/drawers | Stay link-hub; do not embed CommentReview |
| Stale docs / tests asserting sidebar items | Update nav tests / Lovable gap notes when implementing |
| Breaking bookmarks | Keep routes live; no redirect-away |

---

## Verdict

Remove **Comment Review** and **Classified Comments** from the sidebar only. Keep both routes as internal sub-pages. Make **Response Matrix** the Delivery entry with clear links into upload/parse (Comment Review) and discipline review (Classified Comments). No backend changes; no hard redirects.
