import { useEffect, useState } from 'react';
import { format, addBusinessDays, differenceInBusinessDays, isPast } from 'date-fns';
import { CalendarClock, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

interface SlaEstimateDisplayProps {
  jurisdictionName: string | null;
  state: string | null;
  submittedAt: string | null;
  status: string;
  compact?: boolean;
}

interface JurisdictionSla {
  plan_review_sla_days: number | null;
  permit_issuance_sla_days: number | null;
  inspection_sla_days: number | null;
}

export function SlaEstimateDisplay({
  jurisdictionName,
  state,
  submittedAt,
  status,
  compact = false,
}: SlaEstimateDisplayProps) {
  const [slaData, setSlaData] = useState<JurisdictionSla | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!jurisdictionName) return;

    const fetchSla = async () => {
      setLoading(true);
      let query = supabase
        .from('jurisdictions')
        .select('plan_review_sla_days, permit_issuance_sla_days, inspection_sla_days')
        .ilike('name', jurisdictionName);

      if (state) {
        query = query.eq('state', state);
      }

      const { data } = await query.limit(1).maybeSingle();
      setSlaData(data);
      setLoading(false);
    };

    fetchSla();
  }, [jurisdictionName, state]);

  // Don't show for approved projects or if no jurisdiction
  if (status === 'approved' || !jurisdictionName) {
    return null;
  }

  if (loading) {
    return compact ? null : (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="h-3 w-3 animate-pulse" />
        <span>Loading SLA...</span>
      </div>
    );
  }

  if (!slaData || (!slaData.plan_review_sla_days && !slaData.permit_issuance_sla_days)) {
    return null;
  }

  const totalSlaDays = (slaData.plan_review_sla_days || 0) + (slaData.permit_issuance_sla_days || 0);
  
  // Calculate expected approval date
  const baseDate = submittedAt ? new Date(submittedAt) : new Date();
  const expectedApprovalDate = addBusinessDays(baseDate, totalSlaDays);
  const daysRemaining = differenceInBusinessDays(expectedApprovalDate, new Date());
  const isOverdue = isPast(expectedApprovalDate) && status !== 'approved';

  // Determine status color
  const getStatusColor = () => {
    if (isOverdue) return 'text-destructive';
    if (daysRemaining <= 3) return 'text-amber-600';
    if (daysRemaining <= 7) return 'text-amber-500';
    return 'text-emerald-600';
  };

  const getBadgeVariant = () => {
    if (isOverdue) return 'destructive';
    if (daysRemaining <= 3) return 'outline';
    return 'secondary';
  };

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge 
              variant={getBadgeVariant()} 
              className={cn(
                "text-xs gap-1 cursor-help",
                isOverdue && "bg-destructive/10 text-destructive border-destructive/20",
                daysRemaining <= 3 && !isOverdue && "bg-amber-50 text-amber-700 border-amber-200"
              )}
            >
              {isOverdue ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                <CalendarClock className="h-3 w-3" />
              )}
              {isOverdue 
                ? `${Math.abs(daysRemaining)}d overdue` 
                : `~${daysRemaining}d to approval`
              }
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-1 text-xs">
              <p className="font-medium">SLA Estimate for {jurisdictionName}</p>
              {slaData.plan_review_sla_days && (
                <p>Plan Review: {slaData.plan_review_sla_days} business days</p>
              )}
              {slaData.permit_issuance_sla_days && (
                <p>Permit Issuance: {slaData.permit_issuance_sla_days} business days</p>
              )}
              <p className="pt-1 border-t">
                Expected by: {format(expectedApprovalDate, 'MMM d, yyyy')}
              </p>
              {!submittedAt && (
                <p className="text-muted-foreground italic">
                  Based on today's date (not yet submitted)
                </p>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CalendarClock className="h-4 w-4 text-primary" />
        <span>SLA Estimate</span>
        {isOverdue && (
          <Badge variant="destructive" className="text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Overdue
          </Badge>
        )}
      </div>
      
      <div className="grid gap-1.5 text-sm">
        {slaData.plan_review_sla_days && (
          <div className="flex justify-between text-muted-foreground">
            <span>Plan Review</span>
            <span>{slaData.plan_review_sla_days} business days</span>
          </div>
        )}
        {slaData.permit_issuance_sla_days && (
          <div className="flex justify-between text-muted-foreground">
            <span>Permit Issuance</span>
            <span>{slaData.permit_issuance_sla_days} business days</span>
          </div>
        )}
        {slaData.inspection_sla_days && (
          <div className="flex justify-between text-muted-foreground">
            <span>Inspection Scheduling</span>
            <span>{slaData.inspection_sla_days} business days</span>
          </div>
        )}
      </div>

      <div className="pt-2 border-t flex items-center justify-between">
        <span className="text-sm font-medium">Expected Approval</span>
        <div className="flex items-center gap-2">
          <span className={cn("text-sm font-semibold", getStatusColor())}>
            {format(expectedApprovalDate, 'MMM d, yyyy')}
          </span>
          {!isOverdue && daysRemaining > 0 && (
            <span className="text-xs text-muted-foreground">
              ({daysRemaining} days)
            </span>
          )}
        </div>
      </div>

      {!submittedAt && status === 'draft' && (
        <p className="text-xs text-muted-foreground italic">
          * Estimate based on submission today
        </p>
      )}
    </div>
  );
}
