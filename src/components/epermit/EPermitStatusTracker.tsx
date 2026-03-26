import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  RefreshCw, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  FileText,
  ChevronDown,
  ExternalLink,
  Loader2
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useEPermitSubmissions, EPermitSubmissionRecord } from '@/hooks/useEPermitSubmissions';

interface EPermitStatusTrackerProps {
  projectId: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  pending: { label: 'Pending', color: 'bg-muted text-muted-foreground', icon: Clock },
  submitted: { label: 'Submitted', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300', icon: FileText },
  under_review: { label: 'Under Review', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300', icon: Clock },
  additional_info_required: { label: 'Info Required', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300', icon: AlertCircle },
  approved: { label: 'Approved', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300', icon: CheckCircle },
  denied: { label: 'Denied', color: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300', icon: AlertCircle },
  cancelled: { label: 'Cancelled', color: 'bg-muted text-muted-foreground', icon: AlertCircle },
  expired: { label: 'Expired', color: 'bg-muted text-muted-foreground', icon: Clock },
};

function SubmissionCard({ 
  submission, 
  onCheckStatus,
  checking 
}: { 
  submission: EPermitSubmissionRecord;
  onCheckStatus: () => void;
  checking: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const statusConfig = STATUS_CONFIG[submission.status] || STATUS_CONFIG.pending;
  const StatusIcon = statusConfig.icon;
  const isTerminal = ['approved', 'denied', 'cancelled', 'expired'].includes(submission.status);

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {submission.tracking_number || 'Processing...'}
            </CardTitle>
            <CardDescription className="text-xs">
              {submission.permit_type.replace(/[/_]/g, ' ')} • {submission.system}
              <Badge variant="outline" className="ml-2 text-[10px]">
                {submission.environment}
              </Badge>
            </CardDescription>
          </div>
          <Badge className={`${statusConfig.color} border-0`}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {statusConfig.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status Message */}
        {submission.status_message && (
          <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded">
            {submission.status_message}
          </p>
        )}

        {/* Details */}
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Applicant:</span>
            <p className="font-medium">{submission.applicant_name}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Submitted:</span>
            <p className="font-medium">
              {submission.submitted_at 
                ? format(new Date(submission.submitted_at), 'MMM d, yyyy')
                : 'Pending'}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Last Checked:</span>
            <p className="font-medium">
              {submission.last_status_check 
                ? formatDistanceToNow(new Date(submission.last_status_check), { addSuffix: true })
                : 'Never'}
            </p>
          </div>
        </div>

        {/* Status History */}
        {submission.status_history && submission.status_history.length > 0 && (
          <Collapsible open={historyOpen} onOpenChange={setHistoryOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="text-xs">Status History ({submission.status_history.length})</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 space-y-2 pl-4 border-l-2 border-muted">
                {[...submission.status_history].reverse().map((entry, idx) => (
                  <div key={idx} className="text-xs">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {entry.status.replace(/_/g, ' ')}
                      </Badge>
                      <span className="text-muted-foreground">
                        {format(new Date(entry.timestamp), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    {entry.message && (
                      <p className="text-muted-foreground mt-1">{entry.message}</p>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          {!isTerminal && (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={onCheckStatus}
              disabled={checking}
            >
              {checking ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Check Status
            </Button>
          )}
          {submission.tracking_number && (
            <Button variant="ghost" size="sm" asChild>
              <a 
                href={`#${submission.tracking_number}`} 
                target="_blank" 
                rel="noopener noreferrer"
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                View in Portal
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function EPermitStatusTracker({ projectId }: EPermitStatusTrackerProps) {
  const { 
    submissions, 
    loading, 
    refreshing, 
    checkStatus, 
    checkAllStatuses 
  } = useEPermitSubmissions(projectId);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const handleCheckStatus = async (submissionId: string) => {
    setCheckingId(submissionId);
    try {
      await checkStatus(submissionId);
    } finally {
      setCheckingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
        <p>No permit submissions yet</p>
        <p className="text-sm">Submit a permit application to track its status here</p>
      </div>
    );
  }

  const activeSubmissions = submissions.filter(
    s => !['approved', 'denied', 'cancelled', 'expired'].includes(s.status)
  );

  return (
    <div className="space-y-4">
      {/* Header with Refresh All */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">
            {submissions.length} Submission{submissions.length !== 1 ? 's' : ''}
          </h4>
          {activeSubmissions.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {activeSubmissions.length} active
            </p>
          )}
        </div>
        {activeSubmissions.length > 0 && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={checkAllStatuses}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Refresh All
          </Button>
        )}
      </div>

      {/* Submissions List */}
      <ScrollArea className="h-[400px] pr-4">
        {submissions.map(submission => (
          <SubmissionCard
            key={submission.id}
            submission={submission}
            onCheckStatus={() => handleCheckStatus(submission.id)}
            checking={checkingId === submission.id}
          />
        ))}
      </ScrollArea>
    </div>
  );
}
