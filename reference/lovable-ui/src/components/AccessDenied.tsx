import { Link } from "react-router-dom";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { type AppRole, roleLabels } from "@/hooks/useUserRole";

export type AccessDeniedProps = {
  /** Human-readable page/surface name, e.g. "Miss Utility 811". */
  pageLabel: string;
  /** Roles permitted to view this surface. */
  allowedRoles: AppRole[];
  /** The current viewer's highest role, or null if unassigned. */
  currentRole: AppRole | null;
  /** Optional extra guidance shown under the required-roles line. */
  hint?: string;
  /** Where the "back" link points. Defaults to /dashboard. */
  backTo?: string;
  /** Label for the back link. Defaults to "Back to dashboard". */
  backLabel?: string;
};

/**
 * Consistent 403 / access-denied UI. Always shows:
 *  - Which surface was blocked
 *  - The viewer's current role
 *  - The exact list of roles permitted to view the surface
 *  - A back link to a safe destination
 *
 * Use this anywhere a role gate rejects a signed-in user so the messaging,
 * styling, and remediation guidance stay identical across the app.
 */
export const AccessDenied = ({
  pageLabel,
  allowedRoles,
  currentRole,
  hint,
  backTo = "/dashboard",
  backLabel = "Back to dashboard",
}: AccessDeniedProps) => {
  const allowed = allowedRoles.length
    ? allowedRoles.map((r) => roleLabels[r]).join(" · ")
    : "No roles configured";

  return (
    <div
      role="alert"
      aria-labelledby="access-denied-title"
      className="pilot-card mx-auto max-w-xl p-8"
      data-testid="access-denied"
    >
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-6 w-6 text-destructive" aria-hidden />
        <div className="flex-1">
          <div className="pilot-kicker text-destructive">403 · Access restricted</div>
          <h2
            id="access-denied-title"
            className="mt-1 font-tight text-xl font-bold text-foreground"
          >
            You don't have access to {pageLabel}
          </h2>

          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Your role:</dt>
              <dd className="font-tight font-semibold text-foreground">
                {currentRole ? roleLabels[currentRole] : "Unassigned"}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">Roles that can view this page:</dt>
              <dd
                className="font-tight font-semibold text-foreground"
                data-testid="access-denied-allowed-roles"
              >
                {allowed}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            {hint ??
              "Ask a workspace admin to grant you one of the required roles, or return to a surface you can view."}
          </p>

          <Link
            to={backTo}
            className="mt-5 inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {backLabel}
          </Link>
        </div>
      </div>
    </div>
  );
};