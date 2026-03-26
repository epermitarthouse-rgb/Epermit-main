import { FeatureFlagsPanel } from '@/components/admin/FeatureFlagsPanel';
import { AdminPageShell } from '@/components/admin/AdminPageShell';

export default function FeatureFlagsAdmin() {
  return (
    <AdminPageShell
      title="Feature Flags"
      description="Toggle features per browser (stored in localStorage). Server-side flags not implemented yet."
      breadcrumbs={[{ label: 'Feature Flags' }]}
    >
      <div className="max-w-3xl">
        <FeatureFlagsPanel />
      </div>
    </AdminPageShell>
  );
}
