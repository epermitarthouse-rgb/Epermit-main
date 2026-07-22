/**
 * Shared allowlist of shell hrefs that remain reachable without authentication.
 *
 * PD-3: the homepage (and full sidebar) now render inside the same app shell for
 * anonymous users. Every other in-app destination requires a session (mirrors the
 * `ProtectedLayoutRoute` route guard in `src/App.tsx`), so any shell chrome link that
 * isn't in this list must redirect anonymous visitors to `/auth` instead of navigating
 * straight to the target route.
 */
export const PUBLIC_SHELL_HREFS = ["/", "/demos", "/pricing", "/faq", "/contact", "/auth"] as const;

export function isPublicShellHref(href: string): boolean {
  return PUBLIC_SHELL_HREFS.some((p) => href === p || href.startsWith(`${p}/`));
}
