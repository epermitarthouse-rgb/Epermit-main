import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { 
  Mail, 
  Users, 
  CheckCircle, 
  Clock, 
  TrendingUp, 
  Loader2, 
  RefreshCw,
  Play,
  Pause,
  MailCheck,
  Calendar
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';

interface DripCampaign {
  id: string;
  user_id: string;
  email: string;
  user_name: string | null;
  campaign_type: string;
  enrolled_at: string;
  emails_sent: number;
  last_email_sent_at: string | null;
  is_active: boolean;
  completed_at: string | null;
  created_at: string;
}

interface DripStats {
  totalEnrolled: number;
  activeCount: number;
  completedCount: number;
  totalEmailsSent: number;
  avgEmailsPerUser: number;
  completionRate: number;
}

export function DripCampaignManager() {
  const [campaigns, setCampaigns] = useState<DripCampaign[]>([]);
  const [stats, setStats] = useState<DripStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const fetchCampaigns = async () => {
    try {
      // Use service role through edge function to fetch all campaigns
      const { data, error } = await supabase.functions.invoke('admin-drip-campaigns', {
        body: { action: 'list' },
      });

      if (error) throw error;

      if (data?.campaigns) {
        setCampaigns(data.campaigns);
        calculateStats(data.campaigns);
      }
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      // Fallback: try direct query (will only work if user has admin role)
      try {
        const { data, error: queryError } = await supabase
          .from('user_drip_campaigns')
          .select('*')
          .order('created_at', { ascending: false });

        if (!queryError && data) {
          setCampaigns(data);
          calculateStats(data);
        }
      } catch (fallbackError) {
        console.error('Fallback query failed:', fallbackError);
      }
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (campaignData: DripCampaign[]) => {
    const totalEnrolled = campaignData.length;
    const activeCount = campaignData.filter(c => c.is_active).length;
    const completedCount = campaignData.filter(c => c.completed_at).length;
    const totalEmailsSent = campaignData.reduce((sum, c) => sum + c.emails_sent, 0);
    const avgEmailsPerUser = totalEnrolled > 0 ? totalEmailsSent / totalEnrolled : 0;
    const completionRate = totalEnrolled > 0 ? (completedCount / totalEnrolled) * 100 : 0;

    setStats({
      totalEnrolled,
      activeCount,
      completedCount,
      totalEmailsSent,
      avgEmailsPerUser,
      completionRate,
    });
  };

  useEffect(() => {
    fetchCampaigns();
  }, []);

  const handleProcessNow = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-drip-emails');

      if (error) throw error;

      toast({
        title: "Drip Emails Processed",
        description: `${data.emailsSent} emails sent, ${data.campaignsCompleted} campaigns completed.`,
      });

      // Refresh the data
      fetchCampaigns();
    } catch (error) {
      console.error('Error processing drip emails:', error);
      toast({
        title: "Error",
        description: "Failed to process drip emails.",
        variant: "destructive",
      });
    } finally {
      setProcessing(false);
    }
  };

  const getEmailProgress = (emailsSent: number) => {
    const totalEmails = 4; // We have 4 drip emails
    const percentage = (emailsSent / totalEmails) * 100;
    return { percentage, emailsSent, totalEmails };
  };

  const getStatusBadge = (campaign: DripCampaign) => {
    if (campaign.completed_at) {
      return <Badge className="bg-green-500/10 text-green-500 border-green-500/20">Completed</Badge>;
    }
    if (campaign.is_active) {
      return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20">Active</Badge>;
    }
    return <Badge variant="secondary">Paused</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Enrolled</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalEnrolled || 0}</div>
            <p className="text-xs text-muted-foreground">Users in drip campaigns</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Campaigns</CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{stats?.activeCount || 0}</div>
            <p className="text-xs text-muted-foreground">Currently receiving emails</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Emails Sent</CardTitle>
            <MailCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalEmailsSent || 0}</div>
            <p className="text-xs text-muted-foreground">
              Avg {stats?.avgEmailsPerUser.toFixed(1) || 0} per user
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
              {stats?.completionRate.toFixed(1) || 0}%
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.completedCount || 0} completed
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Campaign Management</CardTitle>
              <CardDescription>
                Manage and monitor onboarding drip email campaigns
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={fetchCampaigns}>
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
          {campaigns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No drip campaigns yet</p>
              <p className="text-sm">Users will be enrolled when they complete onboarding</p>
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

      {/* Email Schedule Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Drip Email Schedule
          </CardTitle>
          <CardDescription>
            The onboarding drip campaign sends 4 emails over 7 days
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
                <div className="text-sm text-muted-foreground">You're a Permit Pro!</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
