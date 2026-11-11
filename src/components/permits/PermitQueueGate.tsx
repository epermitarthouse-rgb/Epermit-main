import type { ReactNode } from "react";
import { Navigate, useParams } from "react-router-dom";
import PermitQueuePlaceholder from "@/pages/placeholders/PermitQueuePlaceholder";
import { FEATURE_FLAG, useFeatureFlag } from "@/hooks/useFeatureFlags";
import { permitQueuePath } from "@/lib/permitQueue";

/** With `module.central_permits` OFF the Permit Queue stays the placeholder (D-064). */
export function PermitQueueGateView({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? <>{children}</> : <PermitQueuePlaceholder />;
}

export function PermitQueueGate({ children }: { children: ReactNode }) {
  const { enabled } = useFeatureFlag(FEATURE_FLAG.MODULE_CENTRAL_PERMITS);
  return <PermitQueueGateView enabled={enabled}>{children}</PermitQueueGateView>;
}

/** Old /permits/:permitId links land on the same permit in the Permit Queue. */
export function LegacyPermitRedirect() {
  const { permitId } = useParams();
  return <Navigate to={permitQueuePath(permitId)} replace />;
}
