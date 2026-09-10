import { ReactNode, useEffect } from "react";
import { Navigate, useLocation, Outlet } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Loader2 } from "lucide-react";
import {
  CHANGE_PASSWORD_PATH,
} from "@/components/auth/PasswordChangeRequiredRoute";
import {
  isDeactivatedProfile,
  shouldForcePasswordChange,
} from "@/lib/profileSecurity";

interface ProtectedRouteProps {
  children: ReactNode;
}

function useProtectedAccessGate() {
  const { user, loading, profileSecurity, signOut } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!loading && user && isDeactivatedProfile(profileSecurity)) {
      void signOut();
    }
  }, [loading, user, profileSecurity, signOut]);

  return { user, loading, profileSecurity, location };
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, profileSecurity, location } = useProtectedAccessGate();

  if (loading || (user && profileSecurity.loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (isDeactivatedProfile(profileSecurity)) {
    return <Navigate to="/auth" replace state={{ deactivated: true }} />;
  }

  if (shouldForcePasswordChange(profileSecurity)) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}

export function ProtectedLayoutRoute() {
  const { user, loading, profileSecurity, location } = useProtectedAccessGate();

  if (loading || (user && profileSecurity.loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (isDeactivatedProfile(profileSecurity)) {
    return <Navigate to="/auth" replace state={{ deactivated: true }} />;
  }

  if (shouldForcePasswordChange(profileSecurity)) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}
