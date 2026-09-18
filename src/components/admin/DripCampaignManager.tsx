import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import {
  Mail,
  Users,
  TrendingUp,
  Loader2,
  RefreshCw,
  Play,
  MailCheck,
  Calendar,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  calculateDripStats,
  getEmailProgress,
  ONBOARDING_DRIP_EMAIL_COUNT,
  type DripCampaignRow,
  type DripStats,
} from '@/lib/dripCampaignStats';
import {
  fetchAdminDripCampaigns,
  invokeProcessDripEmails,
  isDripCampaignEmpty,
  isDripCampaignFetchError,
  type DripCampaignFetchState,
} from '@/lib/dripCampaignAdmin';

function getStatusBadge(campaign: DripCampaignRow) {
  if (campaign.completed_at) {
    return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Completed</Badge>;
  }
  if (campaign.is_active) {
    return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Active</Badge>;
  }
  return <Badge variant="secondary">Paused</Badge>;
}

export function DripCampaignManager() {
  const [fetchState, setFetchState] = useState<DripCampaignFetchState>({ status: 'loading' });
  const [stats, setStats] = useState<DripStats | null>(null);
  const [processing, setProcessing] = useState(false);

  const loadCampaigns = useCallback(async () => {
    setFetchState({ status: 'loading' });
    try {
      const campaigns = await fetchAdminDripCampaigns();
      setFetchState({ status: 'ready', campaigns });
      setStats(calculateDripStats(campaigns));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load onboarding enrollments';
      console.error('Error fetching drip campaigns:', error);
      setFetchState({ status: 'error', message });
      setStats(null);
    }
  }, []);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const handleProcessNow = async () => {
    setProcessing(true);
    try {
      const data = await invokeProcessDripEmails();

      toast({
        title: 'Onboarding emails processed',
        description: `${data.emailsSent ?? 0} emails sent, ${data.campaignsCompleted ?? 0} sequences completed.`,
      });

      await loadCampaigns();
    } catch (error) {
      console.error('Error processing drip emails:', error);
      toast({
        title: 'Error',
        description: 'Failed to process onboarding emails.',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  if (fetchState.status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isDripCampaignFetchError(fetchState)) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Unable to load onboarding enrollments</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{fetchState.message}</span>
          <Button variant="outline" size="sm" className="w-fit" onClick={loadCampaigns}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const campaigns = fetchState.campaigns;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Enrolled</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalEnrolled ?? 0}</div>
            <p className="text-xs text-muted-foreground">Users in onboarding sequence</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Sequences</CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{stats?.activeCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">Currently receiving onboarding emails</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Emails Sent</CardTitle>
            <MailCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalEmailsSent ?? 0}</div>
            <p className="text-xs text-muted-foreground">
              Avg {(stats?.avgEmailsPerUser ?? 0).toFixed(1)} per user
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completion Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {(stats?.completionRate ?? 0).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.completedCount ?? 0} completed
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Onboarding Email Sequence</CardTitle>
              <CardDescription>
                Monitor users enrolled in the fixed 4-email onboarding drip. Emails send automatically via hourly cron.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={loadCampaigns}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button size="sm" onClick={handleProcessNow} disabled={processing}>
                {processing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4 mr-2" />
                )}
                Process Now
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isDripCampaignEmpty(fetchState) ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No onboarding enrollments yet</p>
              <p className="text-sm">Users are enrolled automatically when they complete onboarding</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Last Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => {
                  const progress = getEmailProgress(campaign.emails_sent);
                  return (
                    <TableRow key={campaign.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {campaign.user_name || 'Unknown User'}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {campaign.email}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(campaign)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${progress.percentage}%` }}
                            />
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {progress.emailsSent}/{progress.totalEmails}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-sm">
                          <Calendar className="h-3 w-3" />
                          {format(new Date(campaign.enrolled_at), 'MMM d, yyyy')}
                        </div>
                      </TableCell>
                      <TableCell>
                        {campaign.last_email_sent_at ? (
                          <div className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(campaign.last_email_sent_at), { addSuffix: true })}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Onboarding Email Schedule
          </CardTitle>
          <CardDescription>
            Fixed sequence: {ONBOARDING_DRIP_EMAIL_COUNT} emails over 7 days after onboarding completion
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                1
              </div>
              <div>
                <div className="font-medium">Day 1</div>
                <div className="text-sm text-muted-foreground">Set Up Your First Project</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                2
              </div>
              <div>
                <div className="font-medium">Day 3</div>
                <div className="text-sm text-muted-foreground">Jurisdiction Intelligence</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                3
              </div>
              <div>
                <div className="font-medium">Day 5</div>
                <div className="text-sm text-muted-foreground">Analytics Dashboard</div>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                4
              </div>
              <div>
                <div className="font-medium">Day 7</div>
                <div className="text-sm text-muted-foreground">You&apos;re a Permit Pro!</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
