import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  AlertTriangle,
  Users,
} from 'lucide-react';

interface LicenseResult {
  professional_name?: string;
  license_type?: string;
  license_number?: string;
  role_on_project?: string;
  validation_status?: string;
  expiration_date?: string;
  scope_of_license?: string;
}

interface LicenseValidationData {
  all_active?: boolean;
  hard_stop?: boolean;
  hard_stop_reason?: string;
  warnings?: string[];
  results?: LicenseResult[];
}

interface LicenseValidationCardProps {
  data: LicenseValidationData | null | undefined;
  error?: string | null;
  validationSourceLabel?: string | null;
}

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof ShieldCheck }> = {
  active: { label: 'Active', variant: 'default', icon: ShieldCheck },
  expired: { label: 'Expired', variant: 'destructive', icon: ShieldAlert },
  not_found: { label: 'Not Found', variant: 'destructive', icon: ShieldX },
  pending: { label: 'Pending', variant: 'secondary', icon: Clock },
};

export function LicenseValidationCard({ data, error, validationSourceLabel }: LicenseValidationCardProps) {
  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <Users className="h-4 w-4" />
            License Validation
            <Badge variant="destructive">Failed</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive" data-testid="text-license-error">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <Users className="h-4 w-4" />
            License Validation
            <Badge variant="secondary">Pending</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Awaiting license validation data...</p>
        </CardContent>
      </Card>
    );
  }

  const results = data.results ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Users className="h-4 w-4" />
          License Validation
          {data.hard_stop ? (
            <Badge variant="destructive">Hard Stop</Badge>
          ) : data.all_active ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0">All Active</Badge>
          ) : (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-0">Warnings</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {validationSourceLabel && (
          <p className="text-xs text-muted-foreground" data-testid="text-license-validation-source">{validationSourceLabel}</p>
        )}
        {data.hard_stop && data.hard_stop_reason && (
          <div className="bg-destructive/10 p-3 rounded-md flex items-start gap-2" data-testid="text-hard-stop-reason">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive font-medium">{data.hard_stop_reason}</p>
          </div>
        )}

        {(data.warnings ?? []).length > 0 && (
          <div className="space-y-1" data-testid="section-license-warnings">
            {data.warnings!.map((warning, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300" data-testid={`text-license-warning-${i}`}>
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {warning}
              </div>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-2">
            {results.map((result, i) => {
              const config = STATUS_BADGE[result.validation_status ?? 'pending'] ?? STATUS_BADGE.pending;
              const StatusIcon = config.icon;
              return (
                <div
                  key={i}
                  className="flex items-start justify-between gap-2 p-3 rounded-md bg-muted/30"
                  data-testid={`row-license-${i}`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-sm font-medium truncate" data-testid={`text-professional-name-${i}`}>
                      {result.professional_name ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {result.role_on_project && <span>{result.role_on_project} • </span>}
                      {result.license_type ?? 'N/A'} #{result.license_number ?? 'N/A'}
                    </p>
                    {result.expiration_date && (
                      <p className="text-xs text-muted-foreground">
                        Expires: {result.expiration_date}
                      </p>
                    )}
                  </div>
                  <Badge variant={config.variant} className="shrink-0" data-testid={`badge-license-status-${i}`}>
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {config.label}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}

        {results.length === 0 && !data.hard_stop && (
          <p className="text-sm text-muted-foreground">No professionals submitted for validation.</p>
        )}
      </CardContent>
    </Card>
  );
}
