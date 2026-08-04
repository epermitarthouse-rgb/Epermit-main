# DesignCheck as a Separate Feature — Implementation Plan

**Date:** 2026-08-05  
**Repo:** `/Users/javerianaveed/epermit/Epermit-main`  
**Branch context:** `feat/lovable-ui-replication` @ `f882f1d` · `main` @ `5199937`  
**Lovable reference:** `reference/lovable-ui`  
**Type:** Plan-only audit. **No code, migrations, deploy, push, or analyzer changes.**

**Supersedes:** The “one primary feature / do not ship DesignCheck overview” recommendation in  
`docs/audits/designcheck-vs-ai-compliance-new-ui-audit.md` §4 and §7.9–7.10.

That prior audit remains valid for **evidence** (routes, backends, security, finding shapes). This plan **intentionally separates** DesignCheck as a pre-submittal readiness dashboard that **consumes and summarizes** PermitPilot compliance data **without renaming, replacing, or modifying** the Code Compliance Analyzer or its Railway/edge backends.

**Related locks still in force**

| ID | Still true |
|----|------------|
| PD-7 | Do **not** present the 8-agent matrix as live orchestration |
| PD-12 | Prefer PP paths; aliases only after parity |
| Functional-preservation | Lovable = visual/UX reference; PP analyzer = functional source of truth |

---

## 1. Product definition

### 1.1 DesignCheck (new / separate)

**DesignCheck** = a **pre-submittal readiness dashboard** that:

1. Gives teams a single place to see package readiness before filing.
2. **Summarizes real Code Compliance Analyzer results** when a project has persisted findings in `document_annotations` / `project_documents`.
3. Surfaces companion workflow sections (agent review status, scoring intelligence, internal prescreen, comment reconciliation) as **Mock Data** or **Coming Soon** until real backends exist.
4. Deep-links into the existing analyzer for any “run analysis / open findings” action — never reimplements analyze.

**Not DesignCheck:** drawing upload, Railway `POST /api/analyze-drawing`, dual IBC/local analysis, batch processor, accept/modify/reject session workflow, PDF/JSON export. Those stay exclusively on **Code Compliance Analyzer**.

### 1.2 Code Compliance Analyzer (unchanged)

| Item | Value |
|------|-------|
| Route | `/code-compliance` (keep forever as primary analyzer) |
| Component | `AIComplianceAnalyzer` |
| API | Railway `POST /api/analyze-drawing` (+ JWT) |
| Persistence | `project_documents` + `document_annotations` (`compliance_issue` / `compliance_metadata`) |
| Nav | Intelligence › **Code Compliance Analyzer** |

**Constraint (hard):** Do **not** rename, replace, restyle-as-replacement, or modify analyzer backend/contract for DesignCheck Phase 1. Optional visual polish of the analyzer remains a separate approved Phase B from the prior audit — out of scope for this DesignCheck plan unless explicitly requested.

### 1.3 Relationship (consume, don’t replace)

```text
DesignCheck dashboard (new)  /designcheck
  Summarize · readiness · mock/soon
        │ read-only aggregates
        │ deep-link "Open Analyzer"
        ▼
Code Compliance Analyzer (existing)  /code-compliance
  Upload · analyze · persist · export
        │
        ▼
Railway analyze-drawing + document_annotations
```

---

## 2. Comparison matrix — Lovable DesignCheck vs PermitPilot data

### 2.1 Surface inventory

| Lovable surface | Lovable route | Lovable status | PP today | DesignCheck plan |
|-----------------|---------------|----------------|----------|------------------|
| DesignCheck overview (8 agents + comment reconciliation) | `/compliance` | **Mock** | Unreachable | Mount as DesignCheck hub; agents = Mock/Coming Soon; findings summary = **Real where available** |
| Code Analyzer | `/compliance/analyzer` | **Partial** (edge + seeds) | Live at `/code-compliance` | **Leave alone**; CTA from DesignCheck → `/code-compliance` |
| Compliance Intelligence scoring | `/compliance/intelligence` | **Mock** | None | Sub-view or tab: Mock / Coming Soon (may show real finding counts as honest subset) |
| Internal Prescreen | `/compliance/prescreen` | **Mock** | Agents exist backend-only; no UI | Sub-view or tab: Coming Soon (or Mock checklist with badge) |

### 2.2 Field-level: what Lovable shows vs what PP can feed

| Lovable UI element | Source in Lovable | PP real data available? | DesignCheck treatment |
|--------------------|-------------------|-------------------------|----------------------|
| Page eyebrow “DesignCheck” | Static | N/A (brand) | Use as product name for the **new** dashboard only |
| “Run DesignCheck” primary CTA | Dead button | Analyzer exists | Wire to `/code-compliance` (optionally with `?projectId=`) |
| Agent review matrix (8 agents) | Hardcoded `designAgents` + fake ProgressLine / StatusPill | **No** multi-agent orchestration | **Mock Data** badge **or** Coming Soon cards — never claim live |
| Comment reconciliation list | Hardcoded Issue rows + “37 comments reconciled” | Response Matrix / comments exist elsewhere; **not** DesignCheck-shaped | **Mock Data** or Coming Soon; optional future: link to `/response-matrix` when project selected |
| Submittal readiness gauge (Intelligence) | Hardcoded `91.5` / Pass-Gate | `summary.overallScore` from analyzer results / annotations | Prefer **derived** score from real findings when project has analysis; else empty state + CTA. Do **not** show hardcoded 91.5 as live |
| Weighted impact (Life Safety / Accessibility / Admin) | Hardcoded counts | Issue `category` + `severity` on annotations | **Real aggregate** when findings exist (map categories → buckets); else empty |
| Predictive delay (+22 days) | Hardcoded | **No** jurisdictional delay model | **Coming Soon** |
| AI Code Citation Findings table | Hardcoded 3 rows | Real issues: severity, codeReference, title/description | **Real** table from `document_annotations` for selected project/doc |
| AI Confidence % | Hardcoded | **No** per-finding confidence in PP model | Omit or Coming Soon column |
| Shadow Match / Audit Required status | Hardcoded | Accept/modify/reject is **session-only** on analyzer, not in DB | Coming Soon (or omit until Phase C of prior audit persists responses) |
| AI Reasoning Engine snippets | Hardcoded | Partial: `description` / `suggestedFix` / `jurisdictionNotes` | Show real description/suggestedFix as “Finding detail”; label reasoning engine Coming Soon if claiming visual-match logic |
| Prescreen checklist | Hardcoded pass/fail | `validate-completeness-agent` et al. exist; **not** wired to this UI | **Coming Soon** panel; do not fake pass rates |
| Prescreen readiness % | Derived from mock checklist | No | Coming Soon |

### 2.3 Analyzer finding shape (source of truth for Real sections)

**API / in-memory (`ComplianceBatchAnalysisResult`):**

```ts
{
  issues: [{
    id, category, title, description,
    severity: "critical" | "warning" | "advisory",
    codeReference, codeYear, location, suggestedFix,
    codeType?: "ibc" | "local"
  }],
  summary: { totalIssues, critical, warnings, advisory, overallScore },
  jurisdictionNotes: string,
  codeType: "ibc" | "local" | "combined"
}
```

**Persisted (`document_annotations.data`):**

| Flag | Role |
|------|------|
| `compliance_metadata: true` | Summary + jurisdictionNotes + analysis options |
| `compliance_issue: true` | One finding row (category, title, description, severity, codeReference, location, suggestedFix, codeType, …) |

Query pattern already proven in `AIComplianceAnalyzer` (load-existing): filter project annotations where `compliance_issue` or `compliance_metadata`, group by `document_id`, rebuild summary counts/score.

**Do not invent new tables for Phase 1.**

---

## 3. Real vs Mock section map

Classification for the **shipped DesignCheck dashboard** (not Lovable reference purity):

| Section | Classification | Behavior |
|---------|----------------|----------|
| Project selector | **Live** | Reuse `useProjects` / selected-project context |
| Documents with analysis | **Live** | Same annotation→document discovery as analyzer load-existing |
| Findings summary KPIs (critical / warning / advisory / total) | **Live** when analysis exists; else empty | Aggregate from annotations |
| Overall / readiness score | **Live (derived)** when analysis exists | Use stored metadata `summary.overallScore` or recompute: `max(0, 100 - critical*15 - warnings*5 - advisory*2)` (match FE load path) |
| Findings table (severity, citation, title, location, suggestedFix) | **Live** when analysis exists | Read-only; “Open in Analyzer” |
| CTA → Code Compliance Analyzer | **Live** | Navigate `/code-compliance` (+ projectId) |
| Dual IBC / Local tabs for summary | **Partial / Live** | If both metadata rows exist, show both; else show available |
| Agent review matrix (8 agents) | **Mock Data** (labeled) **or Coming Soon** | Prefer **Coming Soon** to honor PD-7 spirit; if product wants Lovable visual, require `DemoDataBadge` and no live verbs |
| Comment reconciliation | **Mock Data** or **Coming Soon** | Prefer Coming Soon + soft link to Response Matrix |
| Predictive delay analysis | **Coming Soon** | Disabled panel |
| AI confidence / Shadow Match status | **Coming Soon** | Columns omitted or disabled |
| AI Reasoning Engine (visual match claims) | **Coming Soon** | Detail drawer can show real `description` / `suggestedFix` without that branding |
| Compliance Intelligence full page | **Coming Soon** tab/section | May reuse Real findings table + Real score above |
| Internal Prescreen checklist | **Coming Soon** | Do not ship fake pass/fail as live |
| Run DesignCheck / Run AI Analysis / Run Prescreen | Analyzer CTA = **Live** link; Prescreen = **Coming Soon** | Never call Lovable Gemini edge |

**Disclosure rules**

- Any Mock section: `DemoDataBadge` (same pattern as Operations Board).
- Any Coming Soon section: disabled controls, no fabricated metrics presented as project truth.
- Empty real state: “No compliance analysis for this project yet” + button to Analyzer — **not** seed findings.

---

## 4. Route & sidebar recommendation

### 4.1 Recommended routes

| Surface | Route | Notes |
|---------|-------|-------|
| **DesignCheck hub** | **`/designcheck`** | Preferred over Lovable `/compliance` to avoid colliding with `demo-routes` fabricated prefix and to keep PD-12 (PP path identity) |
| Optional aliases (later) | `/compliance` → `/designcheck` | Only after hub ships; update `demo-routes` so hub is not falsely badged if it becomes mixed live |
| Analyzer (unchanged) | `/code-compliance` | No rename; no replacement |
| Do **not** mount | Lovable `/compliance/analyzer` as a second analyzer | Deep-link to `/code-compliance` instead |
| Optional sub-routes | `/designcheck/intelligence`, `/designcheck/prescreen` | Or single page with tabs/`?section=` (UCI pattern) — prefer **one page + sections** for smallest ship |

**Primary recommendation:** one route `/designcheck` with in-page sections (Summary · Findings · Agents · Intelligence · Prescreen), matching UCI expandable IA without multiplying half-live pages.

### 4.2 Sidebar placement

| Placement | Recommendation |
|-----------|----------------|
| Group | **Intelligence** (same as analyzer) |
| Order | **DesignCheck** first (readiness overview), then **Code Compliance Analyzer** (run analysis) — mirrors Lovable “DesignCheck then Code Analyzer” |
| Labels | `DesignCheck` · `Code Compliance Analyzer` |
| Badge | **No “8” badge** (PD-7). Optional later: count of open critical findings from real data |
| Command palette / Getting Started | Add DesignCheck entry; keep existing analyzer entry |

Lovable today (`reference/lovable-ui/.../data.ts`): Intelligence › DesignCheck (`/compliance`, badge `"8"`) + Code Analyzer (`/compliance/analyzer`). PP should copy **order and naming**, not the fake badge or analyzer route.

### 4.3 What not to do

- Do not rename `/code-compliance` to `/compliance` or “DesignCheck Analyzer”.
- Do not hide the analyzer behind DesignCheck-only nav.
- Do not auto-run analysis from DesignCheck without user intent (cost/JWT path).

---

## 5. Data mappings (DesignCheck ← PP)

### 5.1 Read model (Phase 1 — no new backend)

| DesignCheck UI | Mapping |
|----------------|---------|
| Selected project | `projects` via existing hooks / `SelectedProjectContext` |
| Analyzed documents list | Distinct `document_id` from `document_annotations` where `data.compliance_issue` or `data.compliance_metadata`, join `project_documents` |
| Latest analysis timestamp | `max(document_annotations.updated_at)` for those rows |
| Score | Metadata annotation `summary.overallScore` or recompute from issue severities |
| Severity KPIs | Count issues by `severity` |
| Category / weighted impact | Bucket `category` → Life Safety / Accessibility / Administrative / Other (document mapping table in code; unknown → Other) |
| Findings rows | Issue annotations: `severity`, `codeReference`, `title` or `description`, `location`, `suggestedFix`, `codeType` |
| Jurisdiction / project type / code year | Metadata annotation fields |
| Empty state | No compliance annotations for project |

### 5.2 Actions

| Action | Implementation |
|--------|----------------|
| Open Analyzer | `navigate('/code-compliance')` + preserve project selection |
| Open document’s analysis | Analyzer already supports load-existing; pass project (+ optional document id via query if easy; else user picks in analyzer) |
| Export | **Out of scope** for DesignCheck Phase 1 — keep export on analyzer |
| Run Prescreen / Run agents | Disabled Coming Soon |

### 5.3 Explicit non-mappings (mock boundary)

| Do not map from | Reason |
|-----------------|--------|
| Lovable `designAgents` statuses | No agent runner |
| Hardcoded Intelligence `score = 91.5` | Misleading |
| Hardcoded delay days | No model |
| Hardcoded confidence % | Not in PP schema |
| Lovable `analyze-compliance-drawings` | Wrong gateway/auth; analyzer must stay Railway |
| Session accept/reject responses | Not persisted; DesignCheck must not invent workflow status |

---

## 6. Phased smallest implementation plan

### Phase 0 — Product lock (this doc)

- [x] Define DesignCheck ≠ Analyzer.
- [x] Supersede “one product only” for overview; keep PD-7 (no fake live agents).
- [ ] Human approval of route `/designcheck`, Intelligence nav order, Mock vs Coming Soon choices for agent matrix.

### Phase 1 — Smallest shippable hub (recommended first build)

**Goal:** Readable readiness summary fed by real annotations + clear CTAs; unsupported sections labeled.

1. Add route `/designcheck` + thin page shell (`PageHeader` / ProductPrimitives consistent with feat New UI).
2. Intelligence nav: insert DesignCheck above Code Compliance Analyzer (no badge `"8"`).
3. Project selector + query annotations → KPI cards + findings table (read-only).
4. Empty state → “Run analysis” → `/code-compliance`.
5. Sections Agents / Delay / Prescreen / Confidence: **Coming Soon** panels (or Mock+badge if product insists on Lovable matrix chrome).
6. Register in command palette; treat route in `demo-routes` carefully (mixed live → prefer exact real entry or section-level badges, not whole-page fabricated badge).
7. Smoke on demo account only (shared Supabase).

**Out of Phase 1:** analyzer changes, migrations, Lovable edge, Intelligence scoring methodology, Prescreen agent wiring, CSV, aliases.

### Phase 2 — UX parity with Lovable chrome

- Visual alignment of gauges/tables to Lovable Intelligence layout **using real numbers only**.
- Optional `?section=` for Intelligence / Prescreen Coming Soon panels.
- Soft links: Response Matrix, Code Library.

### Phase 3 — Workflow depth (separate product approvals)

- Persist finding responses → DesignCheck can show status column.
- Wire Internal Prescreen UI to real validation agents.
- Replace agent matrix with real agent statuses only when orchestration exists.
- Predictive delay model (new capability).

**Do not start Phase 3 without explicit backend/product approval.**

---

## 7. Risks & mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Users think DesignCheck **is** the analyzer / 8 agents are live | High | Separate nav labels; PD-7; Coming Soon / DemoDataBadge; CTA copy “Open Code Compliance Analyzer” |
| Hardcoded scores leak into “live” dashboard | High | Never port Intelligence seed constants; empty state when no annotations |
| Dual analyze backends / JWT-less edge still risky | High | DesignCheck **read-only**; do not call analyze APIs from this page (security work remains on prior audit Phase A) |
| Query cost / N+1 on annotations | Med | Reuse analyzer’s filter pattern; limit to selected project; index already via project_id RLS path |
| Score formula drift (API vs FE recompute) | Med | Prefer stored metadata summary; document one formula |
| `demo-routes` badges whole `/compliance*` as fabricated | Med | Use `/designcheck`; update badge taxonomy for mixed pages |
| Scope creep into modifying analyzer | Med | Hard constraint in PR checklist: no `AIComplianceAnalyzer` / Railway service edits in DesignCheck PRs |
| Shared Railway development → production Supabase | Info | Demo accounts only |

---

## 8. Acceptance criteria (Phase 1)

1. `/code-compliance` and analyzer backend unchanged.
2. `/designcheck` reachable from Intelligence sidebar above the analyzer.
3. With a project that has compliance annotations: KPIs + findings table match analyzer-loaded data (same counts/score).
4. With a project that has none: empty state, no seed findings, CTA to analyzer.
5. Agent matrix / predictive delay / prescreen do not present unlabeled fake metrics as live.
6. No call to Lovable `analyze-compliance-drawings` or PP edge analyze from DesignCheck.
7. No migrations.
8. Demo-account smoke passes.

---

## 9. Decision log

| Decision | Recommendation |
|----------|----------------|
| DesignCheck vs Analyzer | **Separate features**; DesignCheck consumes summaries |
| Primary DesignCheck route | **`/designcheck`** |
| Analyzer route | Keep **`/code-compliance`** |
| Nav | Intelligence: DesignCheck → Code Compliance Analyzer |
| Agent matrix | Coming Soon (preferred) or Mock+badge — never live claim |
| Intelligence / Prescreen | Coming Soon sections on same page |
| Backend for Phase 1 | Read `document_annotations` only |
| Prior “one product” rec | **Superseded** for overview; analyzer primacy for analysis **retained** |

---

## 10. First task after approval

**Scaffold DesignCheck hub (read-only):** Add `/designcheck` page + Intelligence sidebar entry (above Code Compliance Analyzer) that (1) selects a project, (2) loads compliance annotations into KPI + findings table, (3) empty-states to `/code-compliance`, and (4) renders Agents / Prescreen / Delay as Coming Soon (or Mock+`DemoDataBadge`). **Do not modify** `AIComplianceAnalyzer`, Railway `analyze-drawing`, or edge functions.

---

## Appendix A — Evidence index (absolute paths)

| Role | Path |
|------|------|
| This plan | `/Users/javerianaveed/epermit/Epermit-main/docs/audits/designcheck-separate-feature-plan.md` |
| Prior audit (superseded in part) | `/Users/javerianaveed/epermit/Epermit-main/docs/audits/designcheck-vs-ai-compliance-new-ui-audit.md` |
| PD-7 lock | `/Users/javerianaveed/epermit/Epermit-main/docs/lovable-ui-phase0-baseline.md` |
| Lovable overview | `/Users/javerianaveed/epermit/Epermit-main/reference/lovable-ui/src/pages/Compliance.tsx` |
| Lovable intelligence | `/Users/javerianaveed/epermit/Epermit-main/reference/lovable-ui/src/pages/ComplianceIntelligence.tsx` |
| Lovable prescreen | `/Users/javerianaveed/epermit/Epermit-main/reference/lovable-ui/src/pages/InternalPrescreen.tsx` |
| Lovable analyzer | `/Users/javerianaveed/epermit/Epermit-main/reference/lovable-ui/src/pages/ComplianceAnalyzer.tsx` |
| Lovable nav agents | `/Users/javerianaveed/epermit/Epermit-main/reference/lovable-ui/src/components/permitpilot/data.ts` |
| PP analyzer page | `/Users/javerianaveed/epermit/Epermit-main/src/pages/CodeCompliance.tsx` |
| PP analyzer | `/Users/javerianaveed/epermit/Epermit-main/src/components/compliance/AIComplianceAnalyzer.tsx` |
| Result types | `/Users/javerianaveed/epermit/Epermit-main/src/lib/complianceBatchProcessor.ts` |
| PP nav | `/Users/javerianaveed/epermit/Epermit-main/src/components/layout/hybridNav.ts` |
| Railway service | `/Users/javerianaveed/epermit/Epermit-main/scraper-service/app/services/compliance/analyze-drawing.service.js` |
| Demo badge helper | `/Users/javerianaveed/epermit/Epermit-main/src/components/permitpilot/DemoDataBadge.tsx` |
| Demo route taxonomy | `/Users/javerianaveed/epermit/Epermit-main/src/components/permitpilot/demo-routes.ts` |

## Appendix B — Supersession note

| Prior recommendation | New recommendation |
|----------------------|--------------------|
| Do not mount DesignCheck overview; keep single primary `/code-compliance` | Mount **separate** DesignCheck readiness dashboard at `/designcheck` that **summarizes** real analyzer findings |
| Optional overview band only on analyzer | Dedicated nav entry + page; analyzer unchanged |
| First task = visual polish of analyzer | First task = scaffold read-only DesignCheck hub + Coming Soon/Mock boundaries |
