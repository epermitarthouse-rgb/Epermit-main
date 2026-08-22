import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Clock,
  Shield,
  ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { formatPermitFilingError } from '@/lib/permitFilingErrors';
import { toast } from 'sonner';
import { AlertBanner } from '@/components/design/ProductPrimitives';
import { PropertyIntelligenceCard } from './PropertyIntelligenceCard';
import { LicenseValidationCard } from './LicenseValidationCard';
import { DocumentChecklistCard } from './DocumentChecklistCard';
import { PermitClassificationCard } from './PermitClassificationCard';
import {
  PERMIT_FILING_CREDENTIALS_REQUIRED_MESSAGE,
  PERMIT_FILING_EXECUTION_ENABLED,
  PERMIT_FILING_EXECUTION_TOOLTIP,
} from './permitFilingWip';
import {
  describeExecutionOutcome,
  hasPortalCredentialsForFiling,
  parseExecutionInvokeResult,
} from '@/lib/permitFilingExecution';
import {
  getPropertyIntelligenceError,
  normalizeApprovalPackage,
  type NormalizedApprovalPackage,
} from '@/lib/approvalPackage';

export interface ReviewFiling {
  id: string;
  project_id?: string;
  user_id?: string;
  filing_status: string;
  permit_type?: string;
  permit_subtype?: string;
  review_track?: string;
  property_address?: string;
  scope_of_work?: string;
  construction_value?: number;
  property_type?: string;
  estimated_fee?: number;
  application_id?: string;
  confirmation_number?: string;
  municipality?: string | null;
  credential_id?: string | null;
  approval_package?: NormalizedApprovalPackage | Record<string, unknown> | null;
  approval_decision?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_notes?: string | null;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
}

const MUNICIPALITY_META: Record<string, { displayName: string; state: string; propertySource: string; licenseSource: string; agencyName: string }> = {
  dc_dob: { displayName: 'DC Department of Buildings', state: 'DC', propertySource: 'via DC Scout', licenseSource: 'via DLCP', agencyName: 'DC Department of Buildings' },
  fairfax_county_va: { displayName: 'Fairfax County Land Development Services', state: 'VA', propertySource: 'via Fairfax County GIS', licenseSource: 'via VA DPOR', agencyName: 'Fairfax County Land Development Services' },
  baltimore_city_md: { displayName: 'Baltimore City Permits & Code Enforcement', state: 'MD', propertySource: 'via MD SDAT', licenseSource: 'via MD DLLR', agencyName: 'Baltimore City Permits & Code Enforcement' },
  howard_county_md: { displayName: 'Howard County DILP', state: 'MD', propertySource: 'via MD SDAT', licenseSource: 'via MD DLLR', agencyName: 'Howard County Dept of Inspections, Licenses & Permits' },
  arlington_county_va: { displayName: 'Arlington County Inspection Services', state: 'VA', propertySource: 'not available for this jurisdiction', licenseSource: 'via VA DPOR', agencyName: 'Arlington County Inspection Services Division' },
  anne_arundel_county_md: { displayName: 'Anne Arundel County Inspections & Permits', state: 'MD', propertySource: 'via MD SDAT', licenseSource: 'via MD DLLR', agencyName: 'Anne Arundel County Office of Inspections & Permits' },
  pg_county_md: { displayName: 'PG County DPIE', state: 'MD', propertySource: 'via MD SDAT', licenseSource: 'via MD DLLR', agencyName: 'Prince George\'s County DPIE' },
  montgomery_county_md: { displayName: 'Montgomery County DPS', state: 'MD', propertySource: 'via MD SDAT', licenseSource: 'via MD DLLR', agencyName: 'Montgomery County Department of Permitting Services' },
  alexandria_va: { displayName: 'City of Alexandria Permit Center', state: 'VA', propertySource: 'not available for this jurisdiction', licenseSource: 'via VA DPOR', agencyName: 'City of Alexandria Permit Center' },
  loudoun_county_va: { displayName: 'Loudoun County Building & Development', state: 'VA', propertySource: 'not available for this jurisdiction', licenseSource: 'via VA DPOR', agencyName: 'Loudoun County Department of Building & Development' },
};

interface FilingReviewPanelProps {
  filing: ReviewFiling | null;
  isLoading?: boolean;
  onDecisionMade?: () => void;
  onBack?: () => void;
  asDialog?: boolean;
  dialogOpen?: boolean;
  onDialogClose?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; badgeClass: string }> = {
  preflight: { label: 'Pre-Flight', badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-0' },
  awaiting_approval: { label: 'Awaiting Approval', badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-0' },
  approved: { label: 'Approved', badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0' },
  filing: { label: 'Filing In Progress', badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-0' },
  submitted: { label: 'Submitted', badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-0' },
  failed: { label: 'Failed', badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-0' },
  cancelled: { label: 'Cancelled', badgeClass: '' },
};

function ReviewContent({
  filing,
  isLoading,
  onDecisionMade,
  onBack,
}: {
  filing: ReviewFiling | null;
  isLoading?: boolean;
  onDecisionMade?: () => void;
  onBack?: () => void;
}) {
  const { user } = useAuth();
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasPortalCredentials, setHasPortalCredentials] = useState<boolean | null>(null);
  const [executionFeedback, setExecutionFeedback] = useState<{
    tone: 'success' | 'warning' | 'error';
    title: string;
    detail: string;
  } | null>(null);

  const pkg = normalizeApprovalPackage(filing?.approval_package);
  const canReview = filing?.filing_status === 'awaiting_approval' && !filing.approval_decision;
  const hasHardStop = pkg?.hard_stop === true;
  const hasEscalation = pkg?.escalation_required === true;
  const muniMeta = filing?.municipality ? MUNICIPALITY_META[filing.municipality] ?? null : null;

  useEffect(() => {
    let cancelled = false;
    if (!user || !canReview) {
      setHasPortalCredentials(null);
      return;
    }

    hasPortalCredentialsForFiling(user.id, filing?.credential_id)
      .then((found) => {
        if (!cancelled) setHasPortalCredentials(found);
      })
      .catch(() => {
        if (!cancelled) setHasPortalCredentials(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, canReview, filing?.credential_id]);

  const handleDecision = useCallback(async (decision: 'approved' | 'rejected') => {
    if (!PERMIT_FILING_EXECUTION_ENABLED) {
      toast.info(PERMIT_FILING_EXECUTION_TOOLTIP);
      return;
    }
    if (!filing || !user) return;
    if (!notes.trim()) {
      toast.error('Notes are required for the approval decision.');
      return;
    }

    if (decision === 'approved') {
      const credentialsReady = await hasPortalCredentialsForFiling(user.id, filing.credential_id);
      if (!credentialsReady) {
        setHasPortalCredentials(false);
        toast.error(PERMIT_FILING_CREDENTIALS_REQUIRED_MESSAGE);
        return;
      }
    }

    setSubmitting(true);
    setExecutionFeedback(null);
    try {
      const now = new Date().toISOString();
      const updateData: Record<string, unknown> = {
        approval_decision: decision,
        approved_by: user.id,
        approved_at: now,
        approval_notes: notes.trim(),
        updated_at: now,
      };

      if (decision === 'approved') {
        updateData.filing_status = 'approved';
      }

      const { error } = await supabase
        .from('permit_filings')
        .update(updateData)
        .eq('id', filing.id);

      if (error) throw error;

      try {
        await supabase
          .from('agent_runs')
          .insert({
            filing_id: filing.id,
            agent_name: 'pre_submission_review',
            layer: 1,
            status: 'completed',
            input_data: { decision, notes: notes.trim() },
            output_data: {
              decision,
              reviewed_by: user.id,
              reviewed_at: now,
              hard_stop_overridden: hasHardStop && decision === 'approved',
              escalation_acknowledged: hasEscalation,
            },
            started_at: now,
            completed_at: now,
          });
      } catch (auditErr) {
        console.warn('Failed to log audit trail:', auditErr);
      }

      if (decision === 'approved') {
        try {
          const { data: execData, error: execError } = await supabase.functions.invoke('permitwizard-execute', {
            body: { filing_id: filing.id },
          });

          if (execError) {
            console.warn('Execution pipeline invocation failed:', execError);
            const outcome = describeExecutionOutcome(null);
            setExecutionFeedback(outcome);
            toast.error(formatPermitFilingError(execError, 'Execution pipeline failed to start.'));
          } else {
            const parsed = parseExecutionInvokeResult(execData);
            const outcome = describeExecutionOutcome(parsed);
            setExecutionFeedback(outcome);
            if (outcome.tone === 'success') {
              toast.success(outcome.detail);
            } else if (outcome.tone === 'warning') {
              toast.warning(outcome.detail);
            } else {
              toast.error(outcome.detail);
            }
          }
        } catch (execErr) {
          console.warn('Failed to invoke execution pipeline:', execErr);
          const outcome = describeExecutionOutcome(null);
          setExecutionFeedback(outcome);
          toast.error(formatPermitFilingError(execErr, 'Execution pipeline could not be started.'));
        }
      } else {
        toast.success('Filing rejected. No portal actions will be taken.');
      }
      onDecisionMade?.();
    } catch (e) {
      console.error('Decision update failed:', e);
      toast.error(formatPermitFilingError(e, 'Failed to save decision. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }, [filing, user, notes, hasHardStop, hasEscalation, onDecisionMade]);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!filing) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <ClipboardCheck className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">No Filing Selected</p>
        <p className="text-sm text-muted-foreground mt-1">Select a filing to review the pre-submission package.</p>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[filing.filing_status] ?? { label: filing.filing_status, badgeClass: '' };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="text-filing-title">
            <Shield className="h-5 w-5" />
            Pre-Submission Review
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            {onBack && (
              <Button variant="outline" size="sm" onClick={onBack} data-testid="button-review-back-inline">
                Back to Permit Filing
              </Button>
            )}
            <Badge className={statusConfig.badgeClass} data-testid="badge-filing-status">
              {statusConfig.label}
            </Badge>
          </div>
        </div>
        {canReview && !PERMIT_FILING_EXECUTION_ENABLED && (
          <AlertBanner
            tone="info"
            title="Review only"
            detail={PERMIT_FILING_EXECUTION_TOOLTIP}
          />
        )}
        {canReview && PERMIT_FILING_EXECUTION_ENABLED && hasPortalCredentials === false && (
          <AlertBanner
            tone="warn"
            title="Portal credentials required"
            detail={PERMIT_FILING_CREDENTIALS_REQUIRED_MESSAGE}
          />
        )}
        {executionFeedback && (
          <AlertBanner
            tone={executionFeedback.tone === 'error' ? 'bad' : executionFeedback.tone === 'success' ? 'good' : 'warn'}
            title={executionFeedback.title}
            detail={executionFeedback.detail}
          />
        )}
        {muniMeta && (
          <p className="text-sm font-medium" data-testid="text-municipality-name">
            {muniMeta.displayName}
            <Badge variant="outline" className="ml-2" data-testid="badge-municipality-state">{muniMeta.state}</Badge>
          </p>
        )}
        {filing.property_address && (
          <p className="text-sm text-muted-foreground" data-testid="text-filing-address">{filing.property_address}</p>
        )}
        {pkg?.assembled_at && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Package assembled: {new Date(pkg.assembled_at).toLocaleString()}
          </p>
        )}
      </div>

      {(hasHardStop || hasEscalation) && (
        <Card className="border-destructive">
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1">
                {hasHardStop && (
                  <p className="text-sm font-medium text-destructive" data-testid="text-hard-stop-warning">
                    Hard Stop: A critical validation failure requires attention before proceeding.
                  </p>
                )}
                {hasEscalation && (
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300" data-testid="text-escalation-warning">
                    Escalation Required: Advisory flags detected (Historic District, NCPC, or Flood Hazard).
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {pkg?.agent_summary && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Agent Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {pkg.agent_summary.map((agent, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs" data-testid={`text-agent-summary-${agent.agent_name}`}>
                  {agent.status === 'completed' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : agent.status === 'failed' ? (
                    <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  ) : agent.status === 'escalated' ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="capitalize truncate">{agent.agent_name.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <PropertyIntelligenceCard
        data={pkg?.property_intelligence as Record<string, unknown> | null | undefined}
        error={getPropertyIntelligenceError(pkg?.property_intelligence ?? null)}
        dataSourceLabel={muniMeta?.propertySource ?? null}
      />

      <LicenseValidationCard
        data={pkg?.license_validation as Record<string, unknown> | null | undefined}
        error={pkg?.license_validation?.error ?? null}
        validationSourceLabel={muniMeta?.licenseSource ?? null}
      />

      <DocumentChecklistCard
        data={pkg?.document_preparation as Record<string, unknown> | null | undefined}
        error={pkg?.document_preparation?.error ?? null}
      />

      <PermitClassificationCard
        data={pkg?.permit_classification as Record<string, unknown> | null | undefined}
        error={pkg?.permit_classification?.error ?? null}
        agencyName={muniMeta?.agencyName ?? null}
      />

      {filing.approval_decision && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              {filing.approval_decision === 'approved' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              Decision: {filing.approval_decision === 'approved' ? 'Approved' : 'Rejected'}
            </CardTitle>
            <CardDescription>
              {filing.approved_at && new Date(filing.approved_at).toLocaleString()}
            </CardDescription>
          </CardHeader>
          {filing.approval_notes && (
            <CardContent>
              <p className="text-sm" data-testid="text-approval-notes">{filing.approval_notes}</p>
            </CardContent>
          )}
        </Card>
      )}

      {canReview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Review Decision</CardTitle>
            <CardDescription>
              {PERMIT_FILING_EXECUTION_ENABLED
                ? 'Review the package above and approve or reject the filing. Notes are required. Approval starts portal authentication and filing when credentials are configured.'
                : 'Review the Pre-Flight package above. Approve and portal submission remain unavailable until automated filing is production-ready.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Enter review notes (required)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="resize-none"
              rows={3}
              data-testid="input-review-notes"
              disabled={!PERMIT_FILING_EXECUTION_ENABLED}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex" tabIndex={0}>
                    <Button
                      onClick={() => handleDecision('approved')}
                      disabled={
                        !PERMIT_FILING_EXECUTION_ENABLED
                        || submitting
                        || !notes.trim()
                        || hasPortalCredentials === false
                      }
                      data-testid="button-approve-filing"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                      Approve Filing
                    </Button>
                  </span>
                </TooltipTrigger>
                {!PERMIT_FILING_EXECUTION_ENABLED && (
                  <TooltipContent className="max-w-xs">{PERMIT_FILING_EXECUTION_TOOLTIP}</TooltipContent>
                )}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex" tabIndex={0}>
                    <Button
                      variant="destructive"
                      onClick={() => handleDecision('rejected')}
                      disabled={!PERMIT_FILING_EXECUTION_ENABLED || submitting || !notes.trim()}
                      data-testid="button-reject-filing"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                      Reject Filing
                    </Button>
                  </span>
                </TooltipTrigger>
                {!PERMIT_FILING_EXECUTION_ENABLED && (
                  <TooltipContent className="max-w-xs">{PERMIT_FILING_EXECUTION_TOOLTIP}</TooltipContent>
                )}
              </Tooltip>
            </div>
            {hasHardStop && PERMIT_FILING_EXECUTION_ENABLED && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Warning: A hard stop was detected. Approving will override this.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function FilingReviewPanel({
  filing,
  isLoading,
  onDecisionMade,
  onBack,
  asDialog,
  dialogOpen,
  onDialogClose,
}: FilingReviewPanelProps) {
  if (asDialog) {
    return (
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) onDialogClose?.(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              Filing Review
            </DialogTitle>
            <DialogDescription>
              Review the Pre-Flight package and agent results. Approve and portal submission remain gated until automated filing is production-ready.
            </DialogDescription>
          </DialogHeader>
          <ReviewContent
            filing={filing}
            isLoading={isLoading}
            onDecisionMade={onDecisionMade}
            onBack={onBack ?? onDialogClose}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <div className="max-w-4xl">
      <ReviewContent filing={filing} isLoading={isLoading} onDecisionMade={onDecisionMade} onBack={onBack} />
    </div>
  );
}
