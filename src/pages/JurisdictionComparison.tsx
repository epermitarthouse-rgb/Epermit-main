import { JurisdictionComparisonTool } from '@/components/jurisdictions/JurisdictionComparisonTool';
import { Scale } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

export default function JurisdictionComparison() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <>
      <div className="w-full max-w-7xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-4 sm:py-6 md:py-8">
        <div className="flex items-center gap-3 mb-8">
          <Scale className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Jurisdiction Comparison</h1>
            <p className="text-muted-foreground">
              Compare permit fees, review times, and SLAs across multiple jurisdictions
            </p>
          </div>
        </div>

        <JurisdictionComparisonTool />
      </div>
    </>
  );
}
