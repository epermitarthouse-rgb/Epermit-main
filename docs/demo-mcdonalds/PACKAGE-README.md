# McDonald's Executive Demo — Source & Replication Package

Generated 2026-07-30. No implementation changes were made to produce this package.

Contents:
- `docs/data-provenance.md` — verbatim copy of the current provenance audit
- `source/` — the four source-of-truth files for the demo
- `brand-assets/` — downloadable McDonald's logo PNG + its asset pointer
- `screenshots/` — desktop / tablet / mobile sweeps + all 9 guided-tour steps

---

## 0. Source of truth (files & routes)

| Item | Path |
|---|---|
| Route | `/demo/mcdonalds` (registered `src/App.tsx:196`) |
| Page component | `src/pages/DemoMcDonalds.tsx` (634 lines — all copy + all data literals live here) |
| Guided tour engine | `src/components/permitpilot/GuidedTour.tsx` |
| Tour step content | `tourSteps` array, `src/pages/DemoMcDonalds.tsx:33-83` |
| Demo disclosure badge | `src/components/permitpilot/DemoDataBadge.tsx` |
| Disclosure banner (renders the badge) | `DemoRouteBanner`, `src/components/permitpilot/PermitPilotShell.tsx:164-180` |
| Route → badge mapping | `src/components/permitpilot/demo-routes.ts` (`/demo` prefix is fabricated) |
| Sidebar entry | `src/components/permitpilot/data.ts:46` — `{ label: "Demo", path: "/demo/mcdonalds", icon: Sparkle }` |
| Header CTA | `src/components/permitpilot/PermitPilotShell.tsx:320-325` — "Request Demo" |
| Page title in shell breadcrumb | `PermitPilotShell.tsx:115` — `"McDonald's · Executive Demo"` |
| Logo asset pointer | `src/assets/mcdonalds-logo.png.asset.json` |
| Inventory records | `public/architecture-inventory/demo.md`, `public/architecture-inventory/cross-cuts/demo.md` |

There is **no backend, no query, no edge function** behind this page. Every value is a hardcoded literal in `DemoMcDonalds.tsx`.

---

## 1. Data provenance — every number on the page

Full route-level audit: `docs/data-provenance.md`. The demo is classified **Fabricated** there (row `/demo/mcdonalds`).

Legend: **Illustrative** = invented for the pitch, no measurement behind it. **Directional** = an internal Commun-ET estimate, not an audited figure. **Production-backed** = read from a live system (there is none on this page).

### Hero stats (`heroStats`, lines 87-92)
| Value | Label | Provenance |
|---|---|---|
| `9–13 wk` | Legacy permit cycle | Directional — Commun-ET's own range for GC + expediter + AHJ email loops. Not sourced from a McDonald's dataset. |
| `3–4 wk` | PermitPilot target cycle | Directional target; matches the approved "3-4 weeks vs legacy 9-13 weeks" benchmark in project memory. **Target, not achieved result.** |
| `72%` | Median cycle-time reduction "across pilot rebuilds, East Coast" | **Illustrative.** No pilot cohort exists. The subline implies a measured pilot — treat as unsupported. |
| `90%` | Fewer rework loops | Approved public marketing number ("90% reduction"). Directional marketing claim. |

### Head-to-head timeline (`legacyTrack` / `pilotTrack`, lines 135-148)
All phase durations are **illustrative model inputs**, not observations.
- Legacy: Prescreen 2 wk · 1st Submittal 3 · AHJ Review 4 · Resubmittal 2 · Final Approval 2 = **13 wk**
- PermitPilot: AI Prescreen 0.5 · 1st Submittal 1 · AHJ Review + Live Response 1.5 · Auto-Resubmit 0.5 · Final Approval 0.5 = **4 wk**
- Derived deltas rendered below the bars: `9 weeks saved` (computed `13 − 4`), `Rework loops 1 → 0.2 avg` (illustrative), `First-pass approval 34% → 84%` "Across 12-store East Coast pilot" (**illustrative — the 12-store pilot does not exist**).

### Agents (`agents`, lines 117-126)
Eight named agents across Detection / Reasoning / Action. The **agent names and lane model are real product architecture** (matches `/agents` AgentCenter and the approved "8 agents" marketing number). The operational specifics inside the descriptions are illustrative:
- "42 jurisdictional portals" — illustrative (approved public number elsewhere is "50+ jurisdictions"; **these two figures conflict and should be reconciled before external use**).
- "15-minute cadence", "8 risk classes", "7 days of a lapsed clock" — illustrative configuration values.
- Utility names (Dominion, Washington Gas, Loudoun Water, Fairfax DPWES) are **real entities**; no integration exists with any of them.

### Utility case study (`utilityCase`, lines 165-171)
| Field | Provenance |
|---|---|
| Ticket IDs `DE-88291`, `WG-40128`, `LW-11902`, `VZ-77501`, `DPW-9902` | **Fabricated.** No such tickets. |
| Per-utility clear days 4 / 6 / 3 / 2 / 5 | Illustrative |
| "All utilities cleared · 11 calendar days" | Illustrative |
| "Legacy sequential path … 34 days" | Illustrative comparator |
| Utility company names | Real entities, used descriptively; no endorsement or data feed |

### Portfolio table (`projects`, lines 150-163)
All 12 rows are **fabricated**: site IDs `MCD-231 … MCD-329`, city/state pairs, AHJ assignments, statuses, and elapsed-day figures. The **AHJ names are real** (Loudoun County, Fairfax DPWES, Montgomery Co., Anne Arundel Co., New Castle Co., Phila. L&I, Camden City, Spotsylvania Co.); the projects attributed to them are not. Header claim "12 East Coast rebuilds · 8 jurisdictions · one board" describes the fabricated set.

### ROI (`roi`, lines 173-178)
| Value | Provenance |
|---|---|
| `39 days` sooner per store, "median across pilots" | **Illustrative.** Roughly consistent with 13 wk → 4 wk, but no pilot median exists. |
| `$118k` carrying cost avoided per store | **Illustrative.** No cost model is documented anywhere in the repo. Highest-risk number on the page — do not present as McDonald's economics. |
| `0.7 FTE` reclaimed per active rebuild | Illustrative |
| `84%` first-pass rate | Illustrative (same figure as the timeline delta) |

### Rollout (`rollout`, lines 180-185)
Week 1-4+ engagement plan. **Illustrative proposal copy**, not a contracted schedule. References "12 East Coast rebuild sites" and "the McDonald's East Coast construction team" — both aspirational.

### Other on-page strings
- `Executive Demo · July 2026` and `McDonald's East Coast Rebuild Program · Commun-ET / PermitPilot` — framing labels, illustrative.
- `MSA CET-2026-MCD-UC-001` (sidebar workspace badge, shell-level) — fabricated identifier.
- `Commun-ET, LLC · PermitPilot for McDonald's East Coast` (CTA footer) — Commun-ET is the real entity; the program name is aspirational.

**Nothing on this page is production-backed.** No AHJ portal, utility API, or client project system is read.

---

## 2. Demo disclosure

### Exact approved wording
Badge label (`DemoDataBadge.tsx:41`), rendered uppercase via CSS from source text:
```
Demo data · illustrative only
```
Rendered appearance: `DEMO DATA · ILLUSTRATIVE ONLY` (uppercase is `uppercase tracking-wide`, source string is sentence case).

Accessible name (`aria-label`, line 31):
```
Demo data — illustrative only
```

Banner sentence beside the badge (`PermitPilotShell.tsx:171-176`):
```
Content on this page is illustrative for demonstration. See docs/data-provenance.md for the full audit.
```

Tooltip on hover (`DemoDataBadge.tsx:20-21`):
```
This view uses illustrative content for demonstration. Real project data appears once workflows are live. See docs/data-provenance.md for the full audit.
```

Sidebar variant label (`variant="nav"`): `Demo`.

### Placement
Rendered by `DemoRouteBanner` **inside the shell, above `<Outlet />`** — i.e. above the page hero, below the top app bar. It is **top-of-page only and scrolls away**; it is not sticky and does not repeat further down. There is no disclosure inside the hero, the ROI section, or the CTA.

### Styling (exact classes)
Banner wrapper:
```
mb-4 flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent/5 px-3 py-2
```
Badge (`variant="inline"`):
```
inline-flex select-none items-center gap-1 rounded-full border font-semibold uppercase tracking-wide
border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] text-accent
```
with a 12×12 Lucide `Info` icon (`h-3 w-3`, `aria-hidden`), `role="note"`, wrapped in a Radix tooltip (`delayDuration={150}`, `side="bottom"`, `max-w-xs text-xs leading-relaxed`). Nav variant: `border-border/60 bg-muted/60 px-1.5 py-0.5 text-[9px] text-muted-foreground`, icon `h-2.5 w-2.5`.

### Top-only vs persistent
**Current behaviour: top only.** Recommendation for PermitPilot replication: make it sticky or repeat it at the ROI and CTA sections, since the $118k / 39-day / 72% claims sit far below the fold and are screenshot-able without the disclosure in frame. See `screenshots/desktop-03-scroll.png` — the ROI block renders with no disclosure visible.

### Legal / client disclaimer text
**None exists.** There is no "not affiliated with McDonald's Corporation" notice, no trademark attribution, no confidentiality footer, and no forward-looking-statement caveat anywhere on the page or in the shell. The only disclaimer is the illustrative-data banner above. This is a gap you must close before any external showing.

---

## 3. Brand assets

| Asset | Where | Status |
|---|---|---|
| McDonald's logo | `brand-assets/mcdonalds-logo.png` (downloadable, included in this package) | **Provenance unknown / unverified** |
| Asset pointer | `brand-assets/mcdonalds-logo.png.asset.json` | asset_id `a6094440-f085-478f-8329-c996fb86e623` |

Details: PNG, 186 × 148 px, 8-bit RGB, non-interlaced, 7,129 bytes, uploaded 2026-07-07. Rendered at 36 × 36 CSS px (`h-8 w-8 object-contain`) inside an `11 × 11` swatch with background `#FFC72C` (McDonald's Golden Yellow — the only hardcoded hex color on the page), `alt="McDonald's"`. It is the **only** McDonald's-branded asset on the page; there is no wordmark, no Golden Arches SVG, and no vector variant.

The file is now available as a real download in this package, not CDN-only. However:

- **No vector (SVG/EPS) variant exists** in the project. If PermitPilot needs print or large-format rendering, the 186 px raster is insufficient and a cleared vector must be obtained from McDonald's brand team.
- Other assets on the page are Commun-ET's own: `src/assets/commun-et-logo.jpg`, `commun-et-logo-full.jpg` (sidebar/footer, shell-level, CDN pointers in repo).

**Clearance: NOT confirmed.** See section 7.

---

## 4. Visual reference

- Live preview URL (private, workspace members only): `https://id-preview--fcd9e4e5-741a-4985-af33-2e6668ed00de.lovable.app/demo/mcdonalds`
- Published URL (visibility is set to **private**): `https://permit-zen-ai.lovable.app/demo/mcdonalds`

Screenshots in `screenshots/` (captured 2026-07-30 against the running app, signed in as admin):

| Set | Files | Notes |
|---|---|---|
| Desktop 1280×1800 | `desktop-01…04` | Page height 4,714 px. `01` is the tour auto-start state. |
| Tablet 834×1500 | `tablet-01…06` | Page height 7,073 px — layout reflows to single/two-column; agent lanes stack. |
| Mobile 390×1400 | `mobile-01…08` | Page height 8,579 px — sidebar collapses to sheet, portfolio table scrolls horizontally. |
| Guided tour | `tour-step-01…09` | All nine steps with spotlight, backdrop cut-out, and card placement. |

**Observed issue:** the McDonald's logo and the Commun-ET sidebar logo render as broken images in the local sandbox because `/__l5e/assets-v1/` is served by Lovable hosting, not the dev server. They render correctly on the preview/published URLs. This is a sandbox artefact, not a page defect — but it is why the logo appears as an alt-text box in the screenshots.

There are **no modals** on this page. The only overlay is the guided tour. There are no expandable sections, no menus, and no hover-revealed panels other than the native `title` tooltips on timeline segments (`"{phase} · {n} wk"`).

---

## 5. CTA behaviour — every button and link

| # | Exact label | Location | Destination | Behaviour | Mock or real data |
|---|---|---|---|---|---|
| 1 | `Enter live portfolio` (renders uppercase: ENTER LIVE PORTFOLIO) | Hero, primary | `/portfolio/executive?tenant=mcd` | In-app SPA navigation (`<Link>`), same tab | Destination is itself **fabricated** (`PortfolioExecutive`). Wire to real data in PermitPilot. |
| 2 | `See the AI workflow lanes` | Hero, ghost | `/matrix/ai-workflow` (**note: no `?tenant=mcd`** — inconsistent with the tour's version of the same link) | In-app SPA nav, same tab | Destination fabricated + localStorage-persisted custom workflows. |
| 3 | `Open Cross-Utility Conflict Hunter` | Utility section, ghost | `/utility/conflict-hunter?tenant=mcd` | In-app SPA nav, same tab | Destination fabricated. |
| 4 | `Sign Letter of Authorization` | Bottom CTA, primary | `/onboarding/authorization?tenant=mcd` | In-app SPA nav, same tab | **Real, DB-backed.** Writes `client_authorizations` + a signature PNG to Cloud storage. Must be pointed at a real tenant in PermitPilot — do not demo-sign. |
| 5 | `Schedule live walkthrough` | Bottom CTA, ghost | `/contact` | In-app SPA nav, same tab | **Real.** Writes `contact_submissions` and triggers the `send-contact-email` function. |
| 6 | `Guided tour` | Fixed launcher, bottom-right, `z-40` | — | Opens the tour overlay at step 1 | n/a |
| 7 | `Request Demo` | Shell top bar (all routes) | `/demo/mcdonalds` | In-app SPA nav | n/a |
| 8 | `Demo` | Sidebar → Command group | `/demo/mcdonalds` | In-app SPA nav | n/a |

Guided-tour controls (all in `GuidedTour.tsx`): `Back` (disabled on step 1), `Next` (becomes `Finish` on the last step), `Skip tour`, `Close guided tour` (X icon), and per-step deep links (see section 6). Tour CTAs use a raw `<a href>`, so they cause a **full page reload** rather than SPA navigation — a known inconsistency worth fixing in PermitPilot.

**No interactive cards or metrics.** Hero stat cards, pain-point cards, agent cards, ROI cards, portfolio rows, and utility rows are all static. Portfolio rows have a `hover:bg-muted/20` hover state but no click handler. Timeline segments show a native browser tooltip only.

**No external links** anywhere on the page. **No new-tab/`target="_blank"` links.**

---

## 6. Guided tour

Engine: `GuidedTour.tsx`. Steps: `tourSteps`, `DemoMcDonalds.tsx:33-83`. Invoked as:
```tsx
<GuidedTour steps={tourSteps} autoStart launcherLabel="Guided tour" />
```

### Triggers
- **Auto-start:** fires 500 ms after mount, **only if** `localStorage["commun-et:tour:demo-mcd"] !== "done"`. First visit per browser only.
- **Manual:** the fixed `Guided tour` launcher button (bottom-right, always visible) restarts from step 1 regardless of the stored flag.

### Steps (order, target, exact copy)

| # | `data-tour` target | Highlighted UI | Title | Body (exact) | Step CTA |
|---|---|---|---|---|---|
| 1 | `hero` | Hero section incl. 4 stat cards | The one-slide thesis | Start here. Legacy permit + utility clock is 9–13 weeks. PermitPilot compresses it to under 4 by running the whole board with AI. These four stats are the deck. | — |
| 2 | `problem` | Four pain-point cards | Where the weeks actually go | Before showing the fix, ground the audience in the four failure modes every McDonald's rebuild hits. If they nod, they'll believe the rest. | — |
| 3 | `timeline` | Head-to-head bar chart card | One store · head-to-head | This is the money bar. Same site, same AHJ, same scope — legacy vs PermitPilot. Point to the three deltas below the bars: elapsed weeks, rework loops, first-pass approval. | — |
| 4 | `agents` | Three agent lane columns | Eight agents, three lanes | Explain the loop: Detection senses change, Reasoning decides, Action moves. Every agent has a job and a lane — nobody's a black box. | `Open live AI workflow` → `/matrix/ai-workflow?tenant=mcd` |
| 5 | `utility` | Utility ticket board + rationale card | Utility coordination — the killer app | Walk the Leesburg ticket board. Five utilities, cleared in 11 days in parallel vs 34 sequential. This is the piece other expediters can't do. | `Open Conflict Hunter` → `/utility/conflict-hunter?tenant=mcd` |
| 6 | `portfolio` | 12-row portfolio table | 12 stores · one board | Zoom into two rows: one green (in review, elapsed < 24 days) and one amber (utility hold). Show how the same executive view scales portfolio-wide. | `Open executive portfolio` → `/portfolio/executive?tenant=mcd` |
| 7 | `roi` | Four ROI cards | The dollar line | 39 days sooner, $118k per store carrying cost avoided, 0.7 FTE reclaimed. Multiply by store count on the whiteboard — the math writes itself. | — |
| 8 | `rollout` | Four-week plan card | Four-week engagement plan | Anchor the ask. Week 1 ingest, Week 2 baseline, Week 3 live, Week 4+ expand. No IT lift, no vendor swap. | — |
| 9 | `cta` | Bottom CTA card | Land the ask | One click: sign the Letter of Authorization. That's the entire close. Schedule the walkthrough as the backup. | `Open the LOA` → `/onboarding/authorization?tenant=mcd` |

Note: the tour copy is written as **presenter stage directions**, not end-user help text. If PermitPilot exposes this tour to clients rather than to the presenter, the copy needs a rewrite.

### Interaction & behaviour
- Each step scrolls its target into view (`behavior: "smooth", block: "center"`), then measures after 350 ms and paints an SVG backdrop (`hsl(215 35% 8% / 0.72)`) with an 8 px-inset rounded cut-out plus a `ring-2 ring-primary/80` spotlight ring.
- Card is 380 px wide (`max-w-[calc(100vw-2rem)]`), auto-placed below → above → right → left of the target with 16 px padding, clamped to the viewport.
- Progress dots: active dot `w-6 bg-primary`, inactive `w-1.5 bg-muted-foreground/30`. Header reads `Step {n} / 9`.
- Keyboard: `→` / `Enter` = next, `←` = back, `Esc` = close. Container is `role="dialog" aria-modal="true"` with `aria-label="Guided tour · step {n} of 9"`.
- **Skip:** `Skip tour`, the X button, and clicking the backdrop all call the same `close()` — which writes `"done"` to localStorage. Skipping is therefore indistinguishable from completing.
- **Completion:** `Finish` on step 9 calls `close()`; same localStorage write. There is no completion event, analytics hook, or confirmation.
- **Restart:** launcher button resets index to 0 and reopens. The `"done"` flag is never cleared, so auto-start never fires again on that browser.
- **Role-based differences: none.** The tour is identical for every role and for anonymous visitors. The page itself is behind sign-in via the shell, but has no `RequireUciAccess` guard or role branching.

### Known behavioural gaps to fix in PermitPilot
1. No focus trap and no focus restoration when the tour closes (the a11y suite covers dialogs elsewhere but this overlay predates it).
2. Step CTAs use `<a href>`, causing a full reload and losing tour position.
3. `?tenant=mcd` is applied inconsistently between hero CTA #2 and tour step 4.
4. Skip and complete are not distinguishable in stored state.

---

## 7. Brand approval — status

**I cannot confirm any of this on Commun-ET's behalf. There is no approval record anywhere in the project.** Here is the factual state, so your legal/brand owner can act on it:

| Question | Documented status in the project |
|---|---|
| Is McDonald's branding approved for this demo? | **No record of approval.** No licence, no brand-use grant, no email trail, nothing in `docs/`, `.lovable/`, or the architecture inventory. The logo was uploaded 2026-07-07 with no provenance metadata. |
| May the demo be shown publicly? | **No.** Deployment visibility is set to **private** (workspace members only), and the page is behind sign-in. Treat as internal/private-pitch only until brand clearance exists. |
| Do the numbers require approval? | **Yes.** `72%`, `39 days`, `$118k`, `84%`, `34% → 84%`, `0.7 FTE`, and all pilot references are illustrative but are worded as measured results. Only "90% reduction, 50+ jurisdictions, 12 modules, 8 agents" are approved public marketing numbers. The `42 portals` figure also contradicts the approved `50+ jurisdictions`. |
| Do the screenshots require approval? | Any screenshot showing the McDonald's logo, the `MCD-###` site IDs, or the ROI figures inherits both the trademark and the accuracy issues above. |
| Must the page carry a "concept" / "illustrative" / "not affiliated" notice? | It currently carries only the illustrative-data banner. It carries **no** trademark attribution and **no** non-affiliation notice. Standard practice for an unsolicited prospect pitch is to add all three. |

### Recommended notice (not yet implemented — provided as copy for your approval)
```
Concept demonstration. Not affiliated with, endorsed by, or sponsored by McDonald's Corporation.
McDonald's and the Golden Arches logo are trademarks of McDonald's Corporation, used here for
identification only. All project data, cycle times, and financial figures shown are illustrative
and do not represent actual McDonald's projects or results.
```
Suggested placement: persistent footer on `/demo/mcdonalds`, plus a repeat of the illustrative badge adjacent to the ROI section.

---

## Summary of what you should NOT carry over as-is
1. The `$118k`, `72%`, `39 days`, `84%`, and `34% → 84%` figures — unsupported and worded as measured.
2. Any reference to a "12-store East Coast pilot" or "pilot rebuilds" — no such cohort exists.
3. The fabricated `MCD-###` site IDs and utility ticket numbers.
4. The McDonald's logo, until written clearance exists.
5. `42 jurisdictional portals` — conflicts with the approved `50+ jurisdictions`.
