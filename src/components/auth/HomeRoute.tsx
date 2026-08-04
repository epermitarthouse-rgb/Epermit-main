import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import Home from "@/pages/Home";
import { Loader2 } from "lucide-react";

/**
 * Route element for `/` (PD-3).
 *
 * - Authenticated users: redirect to `/dashboard`, unchanged from prior behavior.
 * - Anonymous users: render the PermitPilot homepage *inside* the same app shell
 *   (sidebar + header) authenticated users see, matching Lovable's pattern of the
 *   homepage living inside the shell. Sidebar nav items still redirect anonymous
 *   clicks to `/auth` (see `AuthGatedLink` / `AppSidebar`), so no protected data or
 *   routes are reachable without a session.
 */
export function HomeRoute() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <DashboardLayout>
      <Home />
    </DashboardLayout>
  );
}
