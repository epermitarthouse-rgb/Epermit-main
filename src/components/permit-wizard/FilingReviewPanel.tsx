import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { toast } from 'sonner';
import { PropertyIntelligenceCard } from './PropertyIntelligenceCard';
import { LicenseValidationCard } from './LicenseValidationCard';
import { DocumentChecklistCard } from './DocumentChecklistCard';
import { PermitClassificationCard } from './PermitClassificationCard';

interface ApprovalPackage {
  assembled_at?: string;
  property_intelligence?: Record<string, unknown> | null;
  license_validation?: {
    all_active?: boolean;
    hard_stop?: boolean;
    hard_stop_reason?: string;
    warnings?: string[];
    results?: Array<Record<string, unknown>>;
    error?: string;
  };
  document_preparation?: {
    total_documents?: number;
    valid_count?: number;
    invalid_count?: number;
    missing_count?: number;
    deficiencies?: string[];
    checklist_results?: Array<Record<string, unknown>>;
    eif_status?: string;
    documents?: Array<Record<string, unknown>>;
    error?: string;
  };
  permit_classification?: Record<string, unknown> & { error?: string };
  agent_summary?: Array<{ agent_name: string; status: string; error?: string | null; duration_ms: number }>;
  escalation_required?: boolean;
  hard_stop?: boolean;
  all_agents_succeeded?: boolean;
}

interface Filing {
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
  approval_package?: ApprovalPackage | null;
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
  filing: Filing | null;
  isLoading?: boolean;
  onDecisionMade?: () => void;
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

function ReviewContent({ filing, isLoading, onDecisionMade }: { filing: Filing | null; isLoading?: boolean; onDecisionMade?: () => void }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pkg = filing?.approval_package;
  const canReview = filing?.filing_status === 'awaiting_approval' && !filing.approval_decision;
  const hasHardStop = pkg?.hard_stop === true;
  const hasEscalation = pkg?.escalation_required === true;
  const allSucceeded = pkg?.all_agents_succeeded === true;
  const muniMeta = filing?.municipality ? MUNICIPALITY_META[filing.municipality] ?? null : null;

  const handleDecision = useCallback(async (decision: 'approved' | 'rejected') => {
    if (!filing || !user) return;
    if (!notes.trim()) {
      toast.error('Notes are required for the approval decision.');
      return;
    }

    setSubmitting(true);
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
        toast.success('Filing approved. Starting execution pipeline...');
        try {
          const { error: execError } = await supabase.functions.invoke('permitwizard-execute', {
            body: { filing_id: filing.id },
          });
          if (execError) {
            console.warn('Execution pipeline invocation failed:', execError);
            toast.warning('Filing approved but execution pipeline failed to start. You can retry from the dashboard.');
          }
        } catch (execErr) {
          console.warn('Failed to invoke execution pipeline:', execErr);
          toast.warning('Filing approved but execution pipeline could not be started automatically.');
        }
      } else {
        toast.success('Filing rejected. No portal actions will be taken.');
      }
      onDecisionMade?.();
    } catch (e) {
      console.error('Decision update failed:', e);
      toast.error('Failed to save decision. Please try again.');
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
          <Badge className={statusConfig.badgeClass} data-testid="badge-filing-status">
            {statusConfig.label}
          </Badge>
        </div>
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
        error={typeof (pkg?.property_intelligence as Record<string, unknown>)?.error === 'string' ? (pkg?.property_intelligence as Record<string, unknown>).error as string : null}
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
              Review the package above and approve or reject the filing. Notes are required.
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
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => handleDecision('approved')}
                disabled={submitting || !notes.trim()}
                data-testid="button-approve-filing"
              >
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                Approve Filing
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDecision('rejected')}
                disabled={submitting || !notes.trim()}
                data-testid="button-reject-filing"
              >
                {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                Reject Filing
              </Button>
            </div>
            {hasHardStop && (
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

export function FilingReviewPanel({ filing, isLoading, onDecisionMade, asDialog, dialogOpen, onDialogClose }: FilingReviewPanelProps) {
  if (asDialog) {
    return (
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) onDialogClose?.(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Filing Review</DialogTitle>
            <DialogDescription>
              Review the pre-submission package and make an approval decision.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            <div className="pr-4">
              <ReviewContent filing={filing} isLoading={isLoading} onDecisionMade={onDecisionMade} />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4">
        <ReviewContent filing={filing} isLoading={isLoading} onDecisionMade={onDecisionMade} />
      </div>
    </ScrollArea>
  );
}
