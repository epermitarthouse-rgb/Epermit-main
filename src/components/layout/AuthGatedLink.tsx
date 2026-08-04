import { forwardRef, type MouseEvent } from "react";
import { Link, NavLink, type LinkProps, type NavLinkProps, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { isPublicShellHref } from "@/lib/authGatedNav";

function resolveTargetPath(to: LinkProps["to"]): string {
  return typeof to === "string" ? to : to.pathname ?? "/";
}

/**
 * Drop-in replacement for react-router's `Link` used throughout the app shell
 * (sidebar, header, mobile nav). When there is no authenticated user and the
 * target route isn't in the public allowlist, clicking redirects to `/auth`
 * (carrying the intended destination as return-to state) instead of navigating
 * straight to a route that would otherwise 404/redirect via `ProtectedLayoutRoute`.
 *
 * Authenticated behavior is unchanged: navigation proceeds exactly as a plain
 * `Link` would.
 */
export const AuthGatedLink = forwardRef<HTMLAnchorElement, LinkProps>(function AuthGatedLink(
  { to, onClick, ...props },
  ref,
) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const targetPath = resolveTargetPath(to);

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!user && !isPublicShellHref(targetPath)) {
      event.preventDefault();
      navigate("/auth", { state: { from: { pathname: targetPath } } });
      return;
    }
    onClick?.(event);
  };

  return <Link ref={ref} to={to} onClick={handleClick} {...props} />;
});

/** Same gating behavior as `AuthGatedLink`, but for `NavLink` call sites (mobile nav). */
export const AuthGatedNavLink = forwardRef<HTMLAnchorElement, NavLinkProps>(
  function AuthGatedNavLink({ to, onClick, ...props }, ref) {
    const { user } = useAuth();
    const navigate = useNavigate();
    const targetPath = resolveTargetPath(to);

    const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (!user && !isPublicShellHref(targetPath)) {
        event.preventDefault();
        navigate("/auth", { state: { from: { pathname: targetPath } } });
        return;
      }
      if (typeof onClick === "function") onClick(event);
    };

    return <NavLink ref={ref} to={to} onClick={handleClick} {...props} />;
  },
);
