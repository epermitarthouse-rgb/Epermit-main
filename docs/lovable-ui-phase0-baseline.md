# Phase 0 — Branch & baseline (Lovable UI replication)

> Date: 2026-07-22  
> Branch: `feat/lovable-ui-replication`  
> Status: Complete for implementation kickoff

## Branch

- Feature branch confirmed: `feat/lovable-ui-replication`
- Do **not** merge to `main` without explicit approval
- Environment: Vercel Preview → Railway `development` via `VITE_API_BASE_URL`

## Product decisions (PD-1…PD-14) — locked defaults

Defaults from gap analysis / replication plan until overridden:

| ID | Decision | Locked default |
|----|----------|----------------|
| PD-1 | Auth paths | Keep `/auth`; optional `/login` `/signup` → `/auth` redirects |
| PD-2 | Role labels / approval gate | Keep PP `user_roles` / admin; no Lovable staff/client approval gate |
| PD-3 | Marketing shell | Keep public marketing layout for anon `/` |
| PD-4 | LOA | No production LOA until schema; flow-ref only |
| PD-5 | Admin members/audit | Admin preview placeholders only |
| PD-6 | UCI multi-route IA | Tabs/drawers on single `/uci` |
| PD-7 | DesignCheck 8-agent matrix | Do not ship fake matrix |
| PD-8 | Permit Queue | Visible placeholder “Coming soon” |
| PD-9 | Messages inbox | Exclude; keep `NotificationBell` |
| PD-10 | Timeline/Gantt | Feature-flag placeholders only |
| PD-11 | Nav IA | Hybrid: Lovable group labels + valid PP hrefs |
| PD-12 | Route renames | Keep PP paths; optional aliases after parity |
| PD-13 | Baltimore | Hide from primary nav; keep routes |
| PD-14 | Direct-URL placeholders | Register labeled stubs only where classified |

## Critical preserve flows (smoke checklist)

1. Auth sign-in / sign-up / sign-out (+ scrape session clear on logout)
2. Project select continuity (`SelectedProjectContext` / `?projectId=`)
3. Portal Harvest start → progress → terminal / cancel
4. Portal credentials list/create (**no password** in DOM/network)
5. Response Matrix generate + project-admin approval gate
6. Permit Wizard preflight / execute status machine
7. UCI access gate, provider/territory/load-profile, submit gate
8. Comment review + classified comments Edge flows
9. AI compliance analyze + ErrorBoundary
10. Admin gate (`useRequireAdmin`) for `/admin/*`
11. Token routes: `/portal/:token`, `/embed/:token`, `/invite/:token`
12. Mobile bottom nav: Home / Projects / Portal Harvest / Filing / More

## Inventory freeze

- Current PP routes: `docs/current-ui-inventory.json` + plan §2
- Lovable classification: plan §3 / §12
- Mapping: `docs/ui-route-component-mapping.json`

## Screenshots

Optional local screenshots deferred; visual review against Lovable reference on Vercel Preview after Phase 2+.
