import { AlertBanner } from "@/components/design/ProductPrimitives";
import { isLocalPermitInspection } from "@/lib/localPermitInspection";

export function LocalInspectionBanner({ active = isLocalPermitInspection() }: { active?: boolean }) {
  if (!active) return null;
  return (
    <AlertBanner
      tone="warn"
      title="Local read-only inspection of production data"
      detail="Open only because this local dev server set VITE_LOCAL_PERMIT_INSPECTION. The production flag is unchanged. Sync, link and grant actions are disabled here."
    />
  );
}
