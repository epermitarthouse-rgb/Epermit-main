# Main vs Feat — Remaining Diff Audit (Post-Restore)

**Date:** 2026-08-06  
**Repo:** `/Users/javerianaveed/epermit/Epermit-main`  
**SHAs verified (after `git fetch`):**

| Ref | SHA | Tip message |
|-----|-----|-------------|
| `origin/main` | `52a94059ccab5cfae3aca6f1269b9beb4c30c68c` | Complete feat product tree replace on main after revert trap. |
| `origin/feat/lovable-ui-replication` | `f5d6fb96943c4347e5ff360ba38ce720aabfd025` | Document intentional Lovable IA and ship UCI Soon-shaped nav. |

**Method:** `git diff --stat` / `--name-status` / file diffs; `git grep` for nav labels; blame/history for Code Analyzer rename.  
**Scope:** Remaining differences after the feat product-tree restore onto main.  
**Constraints:** Read-only audit. No commit / push / deploy / label fixes applied.

**Ancestry note:** `origin/main..origin/feat/lovable-ui-replication` is **empty** — feat tip is an ancestor of main. Remaining diffs are **main-only additions** or **main regressions** (files/behavior present on feat tip but absent/altered on main), not unmerged feat commits.

---

## 1. Executive verdict

### Is migration 100% for product parity with feat tip?

| Bar | Verdict |
|-----|---------|
| **Sidebar / hybrid IA nav labels vs feat tip** | **Yes** — identical, including **Code Analyzer** |
| **Routed product pages under `src/pages` (non-Admin)** | **Yes** — no content diff outside Admin/orphans |
| **`package.json` deps** | **Yes** — identical between tips |
| **`supabase/functions`** | **Yes** — identical |
| **Full tree (scraper cancel + docs + config)** | **No** — scraper cancellation stack and most Lovable planning docs are still missing on main |
| **“No intentional main-only product work”** | **No** — Admin P0 Members/Audit + signOut hardening are intentional main-ahead work |

**Bottom line:** For **UI/nav product parity with feat tip `f5d6fb9`**, the restore succeeded. The user’s report that feat nav still says **“Code Compliance Analyzer”** while main says **“Code Analyzer”** does **not** match current tips — **both** tips already say **“Code Analyzer”** in the sidebar source of truth.

Remaining work is mostly: (1) **scraper cancel restore** from feat, (2) optional docs/scripts restore, (3) decide fate of **orphaned** pre-merge landing files on main, (4) accept Admin P0 as main-ahead.

---

## 2. Code Analyzer label — source of truth

### Sidebar / shell (what users mean by “the nav”)

| Location | `origin/feat` (`f5d6fb9`) | `origin/main` (`52a9405`) |
|----------|---------------------------|---------------------------|
| `src/components/layout/hybridNav.ts` → Intelligence item `title` | `"Code Analyzer"` | `"Code Analyzer"` |
| `src/components/layout/hybridNav.ts` → `pageTitles["/code-compliance"]` | `"Code Analyzer"` | `"Code Analyzer"` |
| `src/components/layout/AppSidebar.tsx` | Reads `hybridNavGroups` (no hard-coded title) | Same |

**Only `hybridNav.ts` layout diff between tips** is Admin Members/Audit flags (preview → live), **not** the Code Analyzer title:

```diff
-        description: "Preview — workspace members (not live)",
-        comingSoon: true,
-        adminPreview: true,
+        description: "Workspace members directory",
```

### Why the user’s observation is likely stale / surface confusion

1. **Feat tip itself renamed the sidebar** in `f5d6fb9` (`Code Compliance Analyzer` → `Code Analyzer`). Blame on both tips attributes line 150 to `f5d6fb96`.
2. Earlier history on feat: `f882f1d` set `"Code Compliance Analyzer"` (from `"Compliance Analyzer"`); `f5d6fb9` shortened to Lovable **Code Analyzer**.
3. **Secondary surfaces still say the longer name on BOTH tips** (not a main↔feat delta):

| Surface | String (both tips) |
|---------|-------------------|
| `src/components/layout/Header.tsx` | `"Code Compliance Analyzer"` |
| `src/components/navigation/CommandPalette.tsx` | `"Code Compliance Analyzer"` |
| `src/hooks/useRecentlyUsed.ts` | `"/code-compliance": "Code Compliance Analyzer"` |
| `src/pages/CodeCompliance.tsx` eyebrow / title | `"Code Compliance Analyzer"` / `"AI Code Compliance Analyzer"` |
| `src/components/compliance/AIComplianceAnalyzer.tsx` | `"AI Code Compliance Analyzer"` |

If someone compares **sidebar on main** vs **page eyebrow / Header / old feat deploy**, they will see “Code Analyzer” vs “Code Compliance Analyzer” even though **current feat tip sidebar matches main**.

### Which string is “correct”?

| Target | Correct nav label | Evidence |
|--------|-------------------|----------|
| **Lovable IA target** | **Code Analyzer** | Matrix: `"name": "Code Analyzer"`; `auditNotes`: “Directive confirmed: Lovable Code Analyzer ↔ PermitPilot /code-compliance.”; feat WIP audit records rename in `hybridNav.ts` |
| **Feat tip `f5d6fb9`** | **Code Analyzer** | Committed rename in `f5d6fb9` |
| **Longer product/marketing copy** | Still often “Code Compliance Analyzer” | Page eyebrow, Header, CommandPalette (both tips) — leftover inconsistency **inside** each tip, not between tips |

**Recommendation for Code Analyzer:** Keep sidebar **Code Analyzer** (matches Lovable + feat tip). Optionally later align Header / CommandPalette / `useRecentlyUsed` / page eyebrow to the same short name for consistency — that is **intra-branch polish**, not a migration miss.

---

## 3. Full remaining diff inventory

`git diff --stat origin/feat/lovable-ui-replication origin/main` → **87 files**, ~+2165 / −17185 (bulk of deletions are docs + demo screenshots + scraper cancel libs).

### 3.A `src/` (product UI)

| Path | Diff | Category | Recommendation |
|------|------|----------|----------------|
| `src/components/layout/hybridNav.ts` | Admin Members/Audit: remove `comingSoon`/`adminPreview`; live descriptions | **Intentional main-only** (Admin P0) | **Keep** |
| `src/App.tsx` | Wire live `AdminMembers` / `AdminAudit` instead of `AdminPreviewPlaceholder` | **Intentional main-only** | **Keep** |
| `src/pages/AdminMembers.tsx` | Added on main | **Intentional main-only** | **Keep** |
| `src/pages/AdminAudit.tsx` | Added on main | **Intentional main-only** | **Keep** |
| `src/hooks/useAdminMembers.ts` | Added on main | **Intentional main-only** | **Keep** |
| `src/hooks/useAuth.tsx` | `signOut` clears local session even if network fails | **Intentional main-only** (guest header fix lineage) | **Keep** |
| `src/pages/LandingPage.tsx` | Present on main, **not imported/routed** in `App.tsx` | **Main orphan / dead code** (pre-`HomeRoute` leftover) | **Delete or wire** — not needed for feat parity |
| `src/pages/CommunETLanding.tsx` | Same — only used by unwired `LandingPage` | **Main orphan** | **Delete or wire** |
| `src/components/auth/PublicOnlyRoute.tsx` | Present on main, **unused** by `App.tsx` | **Main orphan** | **Delete or wire** |

All other `src/` files: **no tip-to-tip diff**. Nav titles list is identical including DesignCheck, Code Analyzer, UCI, etc. Routes for `/code-compliance` identical.

### 3.B Config / deps

| Path | Diff | Category | Recommendation |
|------|------|----------|----------------|
| `package.json` / lockfile | **No diff** | Parity | **Keep** (already matched) |
| `tailwind.config.ts` | Main drops `surface` / `brand` color maps and `rounded.xl`; reorders `pilot` | **Likely accidental / incomplete restore** or unused-token cleanup | **Verify usage** — if feat CSS relies on them, **restore from feat**; else **keep** slim main |
| `tsconfig.app.json` | Main missing `"resolveJsonModule": true` | **Should match feat** (feat enables it) | **Restore from feat** unless proven unused |

### 3.C Supabase

| Path | Diff | Category | Recommendation |
|------|------|----------|----------------|
| `supabase/migrations/20260806010000_admin_members_directory.sql` | Added on main | **Intentional main-only** (Admin P0) | **Keep** |
| `supabase/functions/*` | **No diff** | Parity | **Keep** |

### 3.D Scraper service (largest functional gap)

Main is **behind feat** on the scrape-cancel / PGC-retry stack introduced on feat (`773be98` and follow-ons). Deletion on main traces to revert `972e312` and was **not** fully restored by the src-focused product-tree replaces (`165bd80` / `52a9405`).

| Path | Diff | Category | Recommendation |
|------|------|----------|----------------|
| `scraper-service/lib/scrape-job-cancellation.js` | **Deleted on main** (exists on feat) | **Should match feat** (missed migration / revert trap) | **Restore from feat** |
| `scraper-service/lib/pgc-retry-artifacts.js` | Deleted on main | **Should match feat** | **Restore from feat** |
| Call sites: `accela-scraper.js`, `pgc-eplan-scraper.js`, `register-execution-routes.js`, `session-api.routes.js`, `scrape-events.js`, `scrape-file-results.js`, `scrape-progress-publisher.js`, ProjectDox scrapers, UCI portal sync | Cancel/abort wiring reduced/removed on main | **Should match feat** | **Restore from feat** |
| Related tests (`scrape-job-cancellation`, `scraper-cancel-boundaries`, `pgc-retry-artifacts`, `pgc-brava-publish-fallback`, `uci-cancel-mid-sync`, arlington-cancel assertions) | Deleted/weakened on main | **Should match feat** | **Restore from feat** |

Prior audit already warned: *“Merge carefully; do not drop feat libs.”* — that drop is what main currently has.

### 3.E Docs / scripts / cursor rules

| Path | Diff | Category | Recommendation |
|------|------|----------|----------------|
| ~50 Lovable planning docs + demo-mcdonalds screenshots under `docs/` | Present on feat, absent on main | **Intentional feat drift / incomplete restore** (restore kept `docs/audits/`, not full `docs/`) | **Optional restore from feat** if still used as process source; not product runtime |
| `docs/audits/admin-members-access-flow-plan.md` | Main-only | **Intentional main-only** | **Keep** |
| `.cursor/rules/lovable-ui-development-workflow.mdc` | Deleted on main | Optional tooling | **Restore from feat** if workflow still active |
| `scripts/generate-architecture-replication-data.py`, `scripts/generate-lovable-permitpilot-matrix.py` | Deleted on main | Optional tooling | **Restore from feat** if matrix regen still needed |

---

## 4. Nav labels, page titles, routes, package.json (focused checks)

| Check | Result |
|-------|--------|
| All `hybridNav` item `title`s | **Identical** across tips |
| `pageTitles` map | **Identical** (incl. `"/code-compliance": "Code Analyzer"`) |
| Product routes in `App.tsx` | Same set; main swaps Members/Audit placeholders → live pages |
| `/` home | Both use `HomeRoute` (not CommunET `LandingPage`) |
| `package.json` | **Identical** |

---

## 5. Recommendations summary table

| Item | Feat tip | Main tip | Category | Action |
|------|----------|----------|----------|--------|
| Sidebar “Code Analyzer” | `Code Analyzer` | `Code Analyzer` | Parity | **None** — already matched |
| Header / palette / recent / page eyebrow long name | Long name | Long name | Intra-tip inconsistency | Optional later rename polish (not migration) |
| Admin Members/Audit live | Preview placeholders | Live pages + SQL | Intentional main-only | **Keep** |
| `useAuth` local clear on signOut | Basic `signOut()` | Clear session locally | Intentional main-only | **Keep** |
| Orphan `LandingPage` / `CommunETLanding` / `PublicOnlyRoute` | Absent | Present, unwired | Main orphan | **Delete** (or explicitly re-home) |
| Scrape cancel + PGC retry stack | Present | Missing | Should match feat | **Restore from feat** |
| Lovable planning docs / demo screenshots | Present | Mostly absent | Docs drift | Optional **restore from feat** |
| `tsconfig` `resolveJsonModule` | `true` | Missing | Should match feat | **Restore from feat** |
| `tailwind` `surface`/`brand`/`xl` | Present | Slimmed | Verify | Restore if anything still references tokens |
| `package.json` | Same | Same | Parity | None |

---

## 6. Direct answers

1. **Migration 100% with feat tip for product UI/nav?**  
   **Yes for routed Lovable product UI and nav labels.** **No for full-repo parity** because scraper cancellation and most planning docs remain missing on main.

2. **Code Analyzer: who is correct?**  
   **“Code Analyzer”** is correct for both **Lovable target** and **feat tip**. Main matches. The longer “Code Compliance Analyzer” string is **not** what current feat tip shows in the sidebar; if that was observed on a feat environment, that environment was likely **pre-`f5d6fb9`** or a non-sidebar surface.

3. **Fixes applied in this pass?**  
   **None** — audit only, per request.
