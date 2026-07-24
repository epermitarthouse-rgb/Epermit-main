import { AdminPageShell } from "@/components/admin/AdminPageShell";
import { ArchitectureReplicationWorkspace } from "@/components/admin/architecture-replication/ArchitectureReplicationWorkspace";

export default function ArchitectureReplicationChecklist() {
  return (
    <AdminPageShell
      variant="editorial"
      title="Architecture Replication Checklist"
      description="Route-by-route implementation and verification tracker for mapping the Lovable reference architecture onto the real PermitPilot application."
      breadcrumbs={[{ label: "Architecture Replication" }]}
      maxWidthClass="max-w-[1600px]"
    >
      <ArchitectureReplicationWorkspace />
    </AdminPageShell>
  );
}
