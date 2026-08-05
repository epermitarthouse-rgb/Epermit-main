/**
 * Base URL for the scraper HTTP API (no trailing slash).
 * Use empty string for same-origin requests so Vite's dev proxy handles /api and /view-file.
 *
 * Parallel dev (vite.config.parallel.ts) sets VITE_SCRAPER_USE_SAME_ORIGIN so a shared
 * .env with VITE_API_BASE_URL=http://127.0.0.1:3001 does not bypass the parallel proxy.
 */

const DEFAULT_SCRAPER_BASE_URL = "https://epermit-main-production.up.railway.app";

/**
 * Known-dead/misconfigured Railway hosts that have previously been baked into
 * VITE_API_BASE_URL (e.g. via a stale Vercel env var). Any of these resolve to
 * "Cannot GET <path>" for every route, which looks identical to a routing bug
 * on the real backend. Treat them the same as an unset env var so a stale
 * Vercel Preview/Production variable can never re-introduce this failure mode,
 * even though we cannot edit Vercel env vars directly from here.
 */
const KNOWN_DEAD_SCRAPER_HOSTS = [
  "epermit-production.up.railway.app", // missing "-main" — real service is epermit-main-production
];

function isKnownDeadScraperHost(raw: string): boolean {
  const host = raw.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
  return KNOWN_DEAD_SCRAPER_HOSTS.includes(host);
}

export function getScraperBaseUrl(): string {
  if (import.meta.env.VITE_SCRAPER_USE_SAME_ORIGIN === "true") {
    return "";
  }
  const configured = import.meta.env.VITE_API_BASE_URL;
  const raw =
    configured && !isKnownDeadScraperHost(configured)
      ? configured
      : DEFAULT_SCRAPER_BASE_URL;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/localhost|127\.0\.0\.1/i.test(raw)) return `http://${raw}`;
  return `https://${raw}`;
}
