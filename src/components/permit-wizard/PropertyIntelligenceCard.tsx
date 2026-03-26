import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Building2,
  Droplets,
  Landmark,
  Shield,
} from 'lucide-react';

interface PropertyIntelligenceData {
  address?: string;
  zoning_district?: string;
  overlay_zones?: string[];
  historic_district?: boolean;
  flood_hazard_zone?: boolean;
  active_permits?: Array<{ permit_number?: string; status?: string; type?: string }> | null;
  stop_work_orders?: Array<{ order_number?: string; reason?: string }> | null;
  advisory_flags?: string[];
}

interface PropertyIntelligenceCardProps {
  data: PropertyIntelligenceData | null | undefined;
  error?: string | null;
  dataSourceLabel?: string | null;
}

export function PropertyIntelligenceCard({ data, error, dataSourceLabel }: PropertyIntelligenceCardProps) {
  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <MapPin className="h-4 w-4" />
            Property Intelligence
            <Badge variant="destructive">Failed</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive" data-testid="text-property-error">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <MapPin className="h-4 w-4" />
            Property Intelligence
            <Badge variant="secondary">Pending</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Awaiting property intelligence data...</p>
        </CardContent>
      </Card>
    );
  }

  const hasAdvisoryFlags = (data.advisory_flags ?? []).length > 0;
  const hasStopWorkOrders = Array.isArray(data.stop_work_orders) && data.stop_work_orders.length > 0;
  const hasActivePermits = Array.isArray(data.active_permits) && data.active_permits.length > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <MapPin className="h-4 w-4" />
          Property Intelligence
          {hasAdvisoryFlags || hasStopWorkOrders ? (
            <Badge variant="destructive">Flags Detected</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0">Clear</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {dataSourceLabel && (
          <p className="text-xs text-muted-foreground" data-testid="text-property-data-source">{dataSourceLabel}</p>
        )}
        {data.address && (
          <div className="flex items-center gap-2 text-sm" data-testid="text-property-address">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-medium">{data.address}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.zoning_district && (
            <div className="flex items-center gap-2 text-sm" data-testid="text-zoning-district">
              <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>Zoning: <span className="font-medium">{data.zoning_district}</span></span>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm" data-testid="text-historic-status">
            <Landmark className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>Historic District: </span>
            {data.historic_district ? (
              <Badge variant="destructive">Yes</Badge>
            ) : (
              <Badge variant="secondary">No</Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm" data-testid="text-flood-status">
            <Droplets className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>Flood Hazard: </span>
            {data.flood_hazard_zone ? (
              <Badge variant="destructive">Yes</Badge>
            ) : (
              <Badge variant="secondary">No</Badge>
            )}
          </div>
        </div>

        {(data.overlay_zones ?? []).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Overlay Zones</p>
            <div className="flex flex-wrap gap-1">
              {data.overlay_zones!.map((zone, i) => (
                <Badge key={i} variant="outline" data-testid={`badge-overlay-zone-${i}`}>{zone}</Badge>
              ))}
            </div>
          </div>
        )}

        {hasAdvisoryFlags && (
          <div className="space-y-1" data-testid="section-advisory-flags">
            <p className="text-xs font-medium text-destructive uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Advisory Flags
            </p>
            <div className="flex flex-col gap-1">
              {data.advisory_flags!.map((flag, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-destructive" data-testid={`text-advisory-flag-${i}`}>
                  <XCircle className="h-3 w-3 shrink-0" />
                  {flag}
                </div>
              ))}
            </div>
          </div>
        )}

        {hasStopWorkOrders && (
          <div className="space-y-1" data-testid="section-stop-work-orders">
            <p className="text-xs font-medium text-destructive uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Stop Work Orders
            </p>
            {data.stop_work_orders!.map((swo, i) => (
              <div key={i} className="text-sm bg-destructive/10 p-2 rounded-md" data-testid={`text-swo-${i}`}>
                {swo.order_number && <span className="font-medium">{swo.order_number}</span>}
                {swo.reason && <span className="text-muted-foreground"> — {swo.reason}</span>}
              </div>
            ))}
          </div>
        )}

        {hasActivePermits && (
          <div className="space-y-1" data-testid="section-active-permits">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Permits</p>
            <div className="space-y-1">
              {data.active_permits!.map((permit, i) => (
                <div key={i} className="flex items-center gap-2 text-sm" data-testid={`text-active-permit-${i}`}>
                  <CheckCircle2 className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span>{permit.permit_number ?? 'Unknown'}</span>
                  {permit.type && <Badge variant="outline" className="text-[10px]">{permit.type}</Badge>}
                  {permit.status && <span className="text-muted-foreground text-xs">({permit.status})</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
