import { ReactNode, useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { canViewUciPath, getUciRule } from "@/config/uciAccess";
import { logAccessEvent } from "@/lib/accessAudit";
import { AccessDenied } from "@/components/AccessDenied";

/**
 * Route guard for UCI pages. Reads the current path, looks up its access rule,
 * and either renders children (allowed), a loading state, or a "not authorized"
 * card explaining which roles can view the surface.
 */
export const RequireUciAccess = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { roles, role, loading } = useUserRole();
  const rule = getUciRule(pathname);
  const lastLogged = useRef<string | null>(null);

  const denied = Boolean(user && rule && !canViewUciPath(pathname, roles));
  useEffect(() => {
    if (!denied || authLoading || loading) return;
    const key = `${user?.id}:${pathname}`;
    if (lastLogged.current === key) return;
    lastLogged.current = key;
    void logAccessEvent({
      event: "access_denied",
      email: user?.email ?? null,
      userId: user?.id ?? null,
      roleAtEvent: role ?? "unassigned",
      path: pathname,
      reason: rule ? `Not permitted on ${rule.label}` : "No rule",
      metadata: { requiredRoles: rule?.view ?? [] },
    });
  }, [denied, authLoading, loading, pathname, user?.id, user?.email, role, rule]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="pilot-card mx-auto max-w-lg p-8 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-accent" />
        <h2 className="mt-4 font-tight text-xl font-bold text-foreground">Sign in required</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          UCI surfaces are role-gated. Sign in with a workspace account to continue.
        </p>
        <Link
          to="/login"
          className="mt-5 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  if (!rule || canViewUciPath(pathname, roles)) return <>{children}</>;

  return (
    <AccessDenied
      pageLabel={rule.label}
      allowedRoles={rule.view}
      currentRole={role}
      backTo="/uci"
      backLabel="Back to UCI Dashboard"
    />
  );
};