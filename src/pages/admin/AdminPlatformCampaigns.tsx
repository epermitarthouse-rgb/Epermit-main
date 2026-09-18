import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { DripCampaignManager } from "@/components/admin/DripCampaignManager";

export default function AdminPlatformCampaigns() {
  return (
    <AdminPageShell
      variant="editorial"
      title="Onboarding emails"
      description="Monitor the fixed onboarding email sequence sent to new users after they complete setup."
      breadcrumbs={[
        { label: "Platform", href: "/admin/platform/jurisdictions" },
        { label: "Campaigns" },
      ]}
    >
      <DripCampaignManager />
    </AdminPageShell>
  );
}
