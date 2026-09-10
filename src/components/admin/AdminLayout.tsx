import { Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { AdminSubNav } from "@/components/admin/AdminSubNav";
import { AdminUnauthorized } from "./AdminUnauthorized";

/**
 * Layout wrapper for admin routes. Ensures the user has admin role before rendering child routes.
 * Renders: loading spinner → unauthorized state → <Outlet /> (admin content).
 */
export function AdminLayout() {
  const { user } = useAuth();
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
    return (
      <AdminUnauthorized
        context="the admin panel"
        showBack
        signedInEmail={user?.email}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 md:px-8">
      <AdminSubNav />
      <Outlet />
    </div>
  );
}
