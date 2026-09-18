import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getModuleFlagForPath } from '@/lib/moduleFeatureFlags';

/**
 * Global product visibility gate for module routes.
 * Session is enforced upstream; governance permissions remain on individual pages.
 * Order: Session → Module flag ON → Governance permission → Render
 */
export function ModuleFlagGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { flags, isLoading } = useFeatureFlags();
  const requiredFlag = getModuleFlagForPath(location.pathname);

  if (!requiredFlag) {
    return children;
  }

  if (isLoading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isFeatureEnabled(flags, requiredFlag)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
