import { JurisdictionManager } from '@/components/admin/JurisdictionManager';
import { AdminPageShell } from '@/components/admin/AdminPageShell';

export default function JurisdictionAdmin() {
  return (
    <AdminPageShell
      variant="editorial"
      title="Jurisdiction Administration"
      description="Manage jurisdiction database, fees, SLAs, and reviewer contacts"
      breadcrumbs={[{ label: 'Jurisdictions' }]}
    >
      <JurisdictionManager />
    </AdminPageShell>
  );
}
