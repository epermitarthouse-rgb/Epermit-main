# Washington / default ProjectDox (parallel package)

This folder is the **future** home for the generic Avolve ProjectDox flow currently embedded in `server.js` (default dashboard URL, `performLogin`, `scrapeAll`, tab definitions).

**Parallel structure:** `login.js` / `scrape.js` / `mapper.js` describe where logic will live. No code has been moved out of `server.js` yet; the production path is unchanged.

When migrating:

1. Extract only after regression coverage (login + scrape + export smoke).
2. Preserve `portal_data` keys consumed by `src/pages/PortalDataViewer.tsx`.
3. Keep portal-specific waits and frame behavior; do not “clean up” retries without proof.
