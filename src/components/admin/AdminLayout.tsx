import { Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { AdminUnauthorized } from "./AdminUnauthorized";

/**
 * Layout wrapper for admin routes. Ensures the user has admin role before rendering child routes.
 * Renders: loading spinner → unauthorized state → <Outlet /> (admin content).
 */
export function AdminLayout() {
  const { loading, unauthorized } = useRequireAdmin();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">Checking access...</p>
        </div>
      </div>
    );
  }

  if (unauthorized) {
    return <AdminUnauthorized context="the admin panel" showBack />;
  }

  return <Outlet />;
}
