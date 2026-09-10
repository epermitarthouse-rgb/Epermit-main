import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  isDeactivatedProfile,
  shouldForcePasswordChange,
} from "@/lib/profileSecurity";

const CHANGE_PASSWORD_PATH = "/auth/change-password-required";

export function PasswordChangeRequiredRoute({ children }: { children: ReactNode }) {
  const { user, loading, profileSecurity, signOut } = useAuth();
  const location = useLocation();

  if (loading || (user && profileSecurity.loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  if (isDeactivatedProfile(profileSecurity)) {
    void signOut();
    return <Navigate to="/auth" replace state={{ deactivated: true }} />;
  }

  if (!shouldForcePasswordChange(profileSecurity)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export { CHANGE_PASSWORD_PATH };
