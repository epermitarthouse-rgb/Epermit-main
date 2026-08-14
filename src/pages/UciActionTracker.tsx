import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { UciActionTrackerWorkspace } from "@/components/admin/uci-action-tracker/UciActionTrackerWorkspace";

/**
 * Private internal UCI implementation tracker.
 * Route is nested under AdminLayout → useRequireAdmin (user_roles.role = 'admin').
 */
export default function UciActionTracker() {
  return (
    <AdminPageShell
      variant="editorial"
      title="UCI Action Tracker"
      description="Internal-only implementation progress against the 42-row UCI action-item matrix, reconciled to the latest baseline audit and current code."
      breadcrumbs={[{ label: "UCI Action Tracker" }]}
      maxWidthClass="max-w-[1600px]"
      eyebrow="Internal Development"
    >
      <UciActionTrackerWorkspace />
    </AdminPageShell>
  );
}
