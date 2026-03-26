import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  FileSearch,
  DollarSign,
  GitBranch,
  Building,
  AlertTriangle,
} from 'lucide-react';

interface ClassificationAlternative {
  permit_type?: string;
  confidence?: number;
}

interface PermitClassificationData {
  permit_type?: string;
  permit_subtype?: string;
  confidence?: number;
  review_track?: string;
  estimated_fee?: number;
  fee_breakdown?: Record<string, number>;
  sister_agency_reviews?: string[];
  recommended_description?: string;
  alternatives?: ClassificationAlternative[];
  low_confidence?: boolean;
}

interface PermitClassificationCardProps {
  data: PermitClassificationData | null | undefined;
  error?: string | null;
  agencyName?: string | null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatReviewTrack(track: string): string {
  return track === 'walk_through' ? 'Digital Walk-Through' : track === 'projectdox' ? 'ProjectDox' : track;
}

export function PermitClassificationCard({ data, error, agencyName }: PermitClassificationCardProps) {
  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <FileSearch className="h-4 w-4" />
            Permit Classification
            <Badge variant="destructive">Failed</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive" data-testid="text-classification-error">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <FileSearch className="h-4 w-4" />
            Permit Classification
            <Badge variant="secondary">Pending</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Awaiting permit classification data...</p>
        </CardContent>
      </Card>
    );
  }

  const confidencePercent = Math.round((data.confidence ?? 0) * 100);
  const isLowConfidence = data.low_confidence || confidencePercent < 85;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <FileSearch className="h-4 w-4" />
          Permit Classification
          {isLowConfidence ? (
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-0">Low Confidence</Badge>
          ) : (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0">Classified</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {agencyName && (
          <p className="text-xs text-muted-foreground" data-testid="text-classification-agency">{agencyName}</p>
        )}
        <div className="space-y-3">
          <div className="flex items-center gap-2" data-testid="text-permit-type">
            <Building className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm">
              <span className="text-muted-foreground">Type: </span>
              <span className="font-medium capitalize">{data.permit_type ?? 'Unknown'}</span>
              {data.permit_subtype && (
                <span className="text-muted-foreground"> / {data.permit_subtype}</span>
              )}
            </span>
          </div>

          <div className="space-y-1" data-testid="text-confidence">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Confidence</span>
              <span className={`font-medium ${isLowConfidence ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
                {confidencePercent}%
              </span>
            </div>
            <Progress value={confidencePercent} className="h-2" />
          </div>

          {data.review_track && (
            <div className="flex items-center gap-2 text-sm" data-testid="text-review-track">
              <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Review Track: </span>
              <span className="font-medium">{formatReviewTrack(data.review_track)}</span>
            </div>
          )}

          {data.estimated_fee != null && (
            <div className="flex items-center gap-2 text-sm" data-testid="text-estimated-fee">
              <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Estimated Fee: </span>
              <span className="font-medium">{formatCurrency(data.estimated_fee)}</span>
            </div>
          )}
        </div>

        {isLowConfidence && (data.alternatives ?? []).length > 0 && (
          <div className="space-y-1" data-testid="section-alternatives">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wide flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Alternative Classifications
            </p>
            {data.alternatives!.map((alt, i) => (
              <div key={i} className="flex items-center justify-between p-2 rounded-md bg-muted/30 text-sm" data-testid={`row-alternative-${i}`}>
                <span className="capitalize">{alt.permit_type}</span>
                <span className="text-muted-foreground">{Math.round((alt.confidence ?? 0) * 100)}%</span>
              </div>
            ))}
          </div>
        )}

        {(data.sister_agency_reviews ?? []).length > 0 && (
          <div className="space-y-1" data-testid="section-sister-agencies">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sister Agency Reviews Required</p>
            <div className="flex flex-wrap gap-1">
              {data.sister_agency_reviews!.map((agency, i) => (
                <Badge key={i} variant="outline" data-testid={`badge-agency-${i}`}>{agency}</Badge>
              ))}
            </div>
          </div>
        )}

        {data.recommended_description && (
          <div className="space-y-1" data-testid="text-recommended-description">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recommended Project Description</p>
            <p className="text-sm bg-muted/30 p-2 rounded-md">{data.recommended_description}</p>
          </div>
        )}

        {data.fee_breakdown && Object.keys(data.fee_breakdown).length > 0 && (
          <div className="space-y-1" data-testid="section-fee-breakdown">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Fee Breakdown</p>
            {Object.entries(data.fee_breakdown).map(([key, value], i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="font-medium">{formatCurrency(value)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
