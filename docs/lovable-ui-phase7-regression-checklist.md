# Lovable UI — Phase 7 regression checklist

Branch: `feat/lovable-ui-replication`  
Date: 2026-07-22

## Environment

- [ ] Preview frontend on feature branch
- [ ] `VITE_API_BASE_URL` → `https://epermit-main-development.up.railway.app` (Preview only)
- [ ] Railway **development** only if backend changed (this UI work is FE-only)
- [ ] Demo accounts only (shared Supabase)

## Preserve matrix (manual / conceptual)

| Area | Expected | Status |
|------|----------|--------|
| Auth | `/auth` sign-in/up/out; `/login` `/signup` redirect to `/auth` | Pass (code) |
| Public NotFound | `*` → NotFound (not dashboard) | Pass (code) |
| Admin gate | Non-admin blocked from `/admin/*` | Unchanged guards |
| Project selection | Context + URL/localStorage | Unchanged |
| Scrape | Real job statuses; StatusPill tones only | Pass (visual wrap) |
| Credentials | Settings manager intact; no password echo | Unchanged logic |
| Response Matrix | Generate/approve/export actions preserved | Pass (chrome only) |
| Permit Wizard | Preflight/execute machine unchanged | Pass (chrome only) |
| UCI | `uciApi` + stage UI intact | Pass (header tokens) |
| Comments | Review + classified flows intact | Pass (chrome only) |
| AI compliance | Analyzer + ErrorBoundary | Pass (canvas tokens) |
| Mobile nav | Home / Projects / Harvest / Filing / More | Pass |
| Baltimore | Routes remain; removed from primary nav | Pass (PD-13) |
| Placeholders | Permit Queue, Glossary, admin previews labeled | Pass |
| Excludes | No Operations / Command Center / fake billing routes | Pass |

## Build

- `npm run build` required green before merge readiness

## Production / main

- Confirm `main` untouched
- Confirm Railway production not deployed from this branch
- Confirm Vercel Production env vars unchanged
