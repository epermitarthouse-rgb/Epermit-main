# Update platform from attached documents

Three source docs drive this update:

1. **East Coast Utility Coverage Analysis** (July 10, 2026 expanded version) — internal mapping of Commun-ET's named utility relationships against the Orennia Top 20, plus the Ohio / WV / AL / MS / Eastern Canada expanded scope and a full new-service contact directory.
2. **Glossary of Terms** — plain-language reference for Platform/Process, Utility/Regulatory, and Engagement/Commercial terminology.
3. **Commun-ET Final Logo (2B highres)** — official mark to apply where a brand mark appears.

All new pages match the canonical Obsidian dark theme (pilot-card / pilot-kicker patterns already used by UCI). The coverage doc is *Internal Reference, Confidential* and stays inside the workspace (site is already published private / workspace-only).

---

## 1. Seed the utility directory with the companies from the coverage doc

**File:** `src/pages/UtilityProviderMap.tsx` (existing `/utility/provider-map` page).

Extend the `providers` array from 8 DMV entries to a canonical East Coast + Expanded Scope directory sourced verbatim from the coverage doc's contact tables. Each row is a real coordination target with corporate contact and new-service/builder channel, tagged by region and parent holding company.

New shape:

```ts
type Provider = {
  name: string;                    // Operating utility (PEPCO, BGE, ...)
  parent?: string;                 // Holding co. (Exelon, NextEra, ...)
  utility: "Electric" | "Gas" | "Water" | "Telecom" | "Sanitary";
  region: "DMV" | "Northeast" | "Southeast" | "Florida"
        | "Ohio" | "West Virginia" | "Alabama" | "Mississippi";
  territory: string;
  corporateContact: string;        // switchboard + address
  newServiceChannel: string;       // builder portal / new-business line
  sla: string;
  health: "Good" | "Strained" | "Critical";
};
```

Rows added (from the doc's East Coast + Expanded Scope contact directories):

- **DMV** — PEPCO (Exelon), BGE (Exelon), Dominion Energy VA, Washington Gas / WGL, DC Water, Fairfax Water, Verizon FiOS, Lumen (existing rows kept, enriched with `parent` and `newServiceChannel`).
- **Northeast** — Con Edison, PSE&G, National Grid (NY/MA/RI).
- **Southeast** — Duke Energy Carolinas, Georgia Power (Southern Co.).
- **Florida** — Duke Energy Florida, Florida Power & Light (NextEra).
- **Ohio** — AEP Ohio (American Electric Power), Duke Energy Ohio.
- **West Virginia** — Appalachian Power (AEP), Wheeling Power (AEP).
- **Alabama** — Alabama Power (Southern Co.).
- **Mississippi** — Mississippi Power (Southern Co.), Entergy Mississippi.

UI updates on the same page:
- KPI strip becomes: *Providers tracked · Holding-company families · Regions covered · Builder portals wired*.
- Add a **Region** filter dropdown and a **Parent company** chip filter next to the existing search input.
- Each provider card gets a secondary line with the new-service channel and the parent-company badge; keep the existing health chip.
- Wire the search input (currently non-functional) so it filters by name, parent, and territory.

No new route needed — this enriches the existing "Provider Compare" surface in the **Intelligence** nav.

## 2. New page: Utility Coverage Analysis

**Route:** `/intelligence/utility-coverage` → new `src/pages/UtilityCoverage.tsx`.

Sections rendered from the doc's exact structure:
- Header kicker (Internal Reference · Confidential · Ian Swain & Charlotte Ducksworth · July 2026) with the Orennia sourcing caveat as a dismissible callout (2024 data, verify against EIA Form 861 before external use).
- Finding banner ("8 of the 20 largest…").
- East Coast coverage table (8 rows: Duke, Dominion, National Grid, PSEG, Con Ed, Exelon, NextEra, Southern Co.).
- Parent vs Operating Utility explainer.
- Excluded companies table (13 rows with reason).
- Expanded Scope table (Ohio / WV / AL / MS / Eastern Canada) with the FirstEnergy list-gap note.
- Contact directories (East Coast + Expanded Scope) — reuse the enriched `providers` data from step 1 so this page and Provider Compare stay in sync.
- "How this may / may not be used" defensible vs not-defensible boxes.
- Open Items bullet list.

Add to **Intelligence** nav; register in `src/App.tsx`; add title in `PermitPilotShell.tsx`.

## 3. New page: Glossary

**Route:** `/reference/glossary` → new `src/pages/Glossary.tsx`.

Three anchored sections mirroring the doc: Platform & Process, Utility & Regulatory, Engagement & Commercial. Each term is a definition card. Sticky A–Z / section jump nav and a live search filter (name + definition). Kicker with author credits.

Add to **Resources** nav; register route + title mapping. Add a discreet "Open glossary" link on the Reference Library page.

## 4. Apply the official Commun-ET logo

Copy `user-uploads://Commun-ET_Final_Logo_2B_highres-4.jpg` to a Lovable Asset pointer at `src/assets/commun-et-logo.jpg.asset.json`, then use it in:
- `PermitPilotShell.tsx` — replace the current sidebar wordmark (kept as text fallback on the collapsed rail).
- `Login.tsx` — brand block above the login form.
- `OnboardingAuthorization.tsx` and the LOA preview/PDF letterhead.
- `DemoMcDonalds.tsx` "Prepared by Commun-ET" hero chip.
- `index.html` favicon (generate `public/favicon.png`, remove `public/favicon.ico`) and `<meta property="og:image">`.

The logo has a light background; on the Obsidian dark shell it sits inside a soft parchment plate (rounded, 8px padding) so the artwork stays legible without editing. No logo colors are promoted into design tokens — gold/teal accents remain canonical.

---

## Technical notes

- All content is static React (mock data in the page files) — no schema, RLS, or edge-function changes.
- Uses existing shadcn primitives (`Card`, `Table`, `Input`, `Badge`, `Alert`) and pilot-card / pilot-kicker classes.
- Coverage & Glossary pages sit behind the existing app layout; site remains published **private / workspace-only**.

## Files touched

- **New:** `src/pages/UtilityCoverage.tsx`, `src/pages/Glossary.tsx`, `src/assets/commun-et-logo.jpg.asset.json`, `public/favicon.png`, `src/data/utilityProviders.ts` (shared directory sourced from the doc).
- **Edited:** `src/pages/UtilityProviderMap.tsx` (consume shared directory + filters), `src/App.tsx` (2 routes), `src/components/permitpilot/data.ts` (2 nav entries), `src/components/permitpilot/PermitPilotShell.tsx` (titles + logo), `src/pages/Login.tsx`, `src/pages/OnboardingAuthorization.tsx`, `src/pages/DemoMcDonalds.tsx`, `src/pages/ReferenceLibrary.tsx` (glossary link), `index.html`.
- **Removed:** `public/favicon.ico`.
