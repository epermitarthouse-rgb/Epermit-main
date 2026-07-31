/**
 * Routes whose displayed content is illustrative / fabricated for demo
 * purposes. Sourced from `docs/data-provenance.md`. Any route not listed here
 * is assumed to be Real (DB-backed) or Reference (external doc with an
 * in-page caveat) and therefore renders no demo badge.
 *
 * Keep this list in sync with `docs/data-provenance.md`.
 */

// Exact-match routes that are Real (DB-backed) or Reference (external doc
// with an in-page caveat). Never badge these, even if they share a prefix
// with a fabricated section.
const REAL_OR_REFERENCE_EXACT = new Set<string>([
  "/login",
  "/signup",
  "/auth",
  "/contact",
  "/onboarding/authorization",
  "/delivery/authorization",
  "/admin/authorizations",
  "/admin/members",
  "/admin/audit",
  "/compliance/analyzer",
  "/utility/load-profile",
  "/reference/glossary",
  "/reference/utility-coverage",
  "/utility-map",
  "/utility/provider-map",
  "/code-compliance",
  "/demos",
]);

// Prefixes whose entire subtree is fabricated. Any path equal to or nested
// under one of these is badged, unless it appears in the exact-match set above.
const FABRICATED_PREFIXES = [
  "/", // Home marketing page (exact only — see check below)
  "/dashboard",
  "/mission-control",
  "/command-center",
  "/operations",
  "/feasibility",
  "/critical-path",
  "/permit-queue",
  "/projects",
  "/agents",
  "/messages",
  "/documents",
  "/compliance",
  "/architecture",
  "/content-studio",
  "/admin",
  "/portfolio",
  "/utility",
  "/scheduling",
  "/inspections",
  "/uci",
  "/settings",
  "/matrix",
  "/portals",
  "/raze",
  "/mobile",
  "/field",
  "/sir",
  "/closeout",
  "/reference",
  "/checklists",
  "/demo",
];

export const isDemoRoute = (pathname: string): boolean => {
  const path = pathname.replace(/\/$/, "") || "/";
  if (REAL_OR_REFERENCE_EXACT.has(path)) return false;
  // Home page (marketing surface) is only badged on the exact "/" route.
  if (path === "/") return true;
  return FABRICATED_PREFIXES.some(
    (prefix) => prefix !== "/" && (path === prefix || path.startsWith(`${prefix}/`)),
  );
};
