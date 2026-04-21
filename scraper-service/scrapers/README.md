# Scraper packages (parallel structure)

This tree is the **future** home for jurisdiction-specific scrapers. **Production today** still runs `node server.js`, which owns HTTP routes and most orchestration.

## Layout

| Package | Legacy implementation | Parallel module |
|--------|------------------------|-----------------|
| Washington / default ProjectDox | `server.js` (`performLogin`, `scrapeAll`, …) | `washington/*` (descriptors + `planPortalRoute` previews; logic blocked on server.js) |
| Baltimore Accela | `accela-scraper.js` | `baltimore/*` wraps `accelaLogin` / `scrapeAccelaRecord` |
| Fairfax Accela | `accela-scraper.js` | `fairfax/*` wraps `accelaLogin` / `scrapeAccelaRecord` |
| PGC ePlan | `pgc-eplan-scraper.js`, `pgc-progress-logger.js` | `pgc/*` delegates to legacy modules; mapper still in `server.js` |
| Montgomery ProjectDox | `scrapers/montgomery/*.js` (auth, filer, submit, portal-login, dashboard-discovery, projectdox-scraper); mapper stub still in `mapper.js` |
| Howard ProjectDox | `scrapers/howard/*.js` (portal-login, dashboard-discovery, projectdox-scraper, avolve-bootstrap) |

## Planning HTTP surface (parallel app only)

`app/app.js` mounts planning routes under **`/__future`** (e.g. `GET /__future/health`). Run optionally:

```bash
node parallel-dev-server.js
```

Do **not** replace `server.js` until migration is tested.

## Debug disk artifacts (optional)

Playwright screenshots under `scraper-service/` (PGC login traces, `debug_dashboard.png`, Accela checkpoints, etc.) are **disabled by default**. To write them again, set `SCRAPER_DEBUG_ARTIFACTS=1` (or `true` / `yes`) in the environment. Scraping behavior and API responses are unchanged either way.

## Blockers (explicit)

- **`server.js` cannot be `require()`’d** for delegation — it calls `startServer()` at load time.
- **Washington mapper/scrape/login** and **PGC/Montgomery mappers** remain trapped in `server.js` until safe extraction with regression tests.
