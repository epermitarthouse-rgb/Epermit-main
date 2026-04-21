/**
 * Base URL for the scraper HTTP API (no trailing slash).
 * Use empty string for same-origin requests so Vite's dev proxy handles /api and /view-file.
 *
 * Parallel dev (vite.config.parallel.ts) sets VITE_SCRAPER_USE_SAME_ORIGIN so a shared
 * .env with VITE_API_BASE_URL=http://127.0.0.1:3001 does not bypass the parallel proxy.
 */
export function getScraperBaseUrl(): string {
  if (import.meta.env.VITE_SCRAPER_USE_SAME_ORIGIN === "true") {
    return "";
  }
  const raw =
    import.meta.env.VITE_API_BASE_URL ||
    "https://epermit-production.up.railway.app";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/localhost|127\.0\.0\.1/i.test(raw)) return `http://${raw}`;
  return `https://${raw}`;
}
