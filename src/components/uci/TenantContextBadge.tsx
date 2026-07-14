import { Badge } from '@/components/ui/badge';
import { Building2, FlaskConical } from 'lucide-react';

interface TenantContextBadgeProps {
  tenantName?: string | null;
  isDemo?: boolean;
}

export function TenantContextBadge({ tenantName, isDemo }: TenantContextBadgeProps) {
  if (!tenantName && !isDemo) return null;

  return (
    <Badge
      variant={isDemo ? 'secondary' : 'outline'}
      className="gap-1 text-xs font-normal"
    >
      {isDemo ? (
        <FlaskConical className="h-3 w-3" />
      ) : (
        <Building2 className="h-3 w-3" />
      )}
      {isDemo ? 'Demo workspace' : tenantName || 'Workspace'}
    </Badge>
  );
}
