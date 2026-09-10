import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { PlatformNotificationsPanel } from "@/components/admin/PlatformNotificationsPanel";

export default function AdminPlatformNotifications() {
  return (
    <AdminPageShell
      variant="editorial"
      title="Notifications & branding"
      description="Jurisdiction notifications, email branding, and scheduled sends."
      breadcrumbs={[
        { label: "Platform", href: "/admin/platform/jurisdictions" },
        { label: "Notifications" },
      ]}
    >
      <PlatformNotificationsPanel />
    </AdminPageShell>
  );
}
