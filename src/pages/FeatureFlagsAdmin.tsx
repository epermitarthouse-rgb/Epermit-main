import { FeatureFlagsPanel } from '@/components/admin/FeatureFlagsPanel';
import { AdminPageShell } from '@/components/admin/AdminPageShell';

export default function FeatureFlagsAdmin() {
  return (
    <AdminPageShell
      variant="editorial"
      title="Feature Flags"
      description="Control platform-wide product visibility. Changes apply globally for all users."
      breadcrumbs={[{ label: 'Feature Flags' }]}
    >
      <div className="max-w-3xl">
        <FeatureFlagsPanel />
      </div>
    </AdminPageShell>
  );
}
