import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { DripCampaignManager } from "@/components/admin/DripCampaignManager";

export default function AdminPlatformCampaigns() {
  return (
    <AdminPageShell
      variant="editorial"
      title="Email campaigns"
      description="Manage drip marketing campaigns for jurisdiction subscribers."
      breadcrumbs={[
        { label: "Platform", href: "/admin/platform/jurisdictions" },
        { label: "Campaigns" },
      ]}
    >
      <DripCampaignManager />
    </AdminPageShell>
  );
}
