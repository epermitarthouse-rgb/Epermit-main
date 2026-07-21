import { JurisdictionComparisonTool } from '@/components/jurisdictions/JurisdictionComparisonTool';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/design/ProductPrimitives';

export default function JurisdictionComparison() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Jurisdictions"
        title="Jurisdiction Comparison"
        body="Compare permit fees, review times, and SLAs across multiple jurisdictions."
      />

      <JurisdictionComparisonTool />
    </div>
  );
}
