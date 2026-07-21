import { ShovelsPermitSearch } from '@/components/shovels/ShovelsPermitSearch';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { AlertBanner, PageHeader } from '@/components/design/ProductPrimitives';

export default function PermitIntelligence() {
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
        eyebrow="Live Data"
        title="Permit Intelligence"
        body="Real-time commercial permit data and contractor intelligence."
        action={
          <Badge variant="secondary" className="text-xs">
            Powered by Shovels
          </Badge>
        }
      />

      <AlertBanner
        tone="good"
        title="Live data"
        detail="Search permits and contractors across the United States. Filter by jurisdiction, type, and value."
      />

      <ShovelsPermitSearch />
    </div>
  );
}
