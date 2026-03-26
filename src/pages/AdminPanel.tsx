import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { Shield, Send, Users, Bell, Loader2, Mail, Eye, Palette, Save, History, CheckCircle, XCircle, Clock, Calendar, Trash2, Building2, MailCheck, Flag, MapPin } from 'lucide-react';
import { DripCampaignManager } from '@/components/admin/DripCampaignManager';
import { AdminPageShell } from '@/components/admin/AdminPageShell';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

interface JurisdictionSubscribers {
  jurisdiction_id: string;
  jurisdiction_name: string;
  jurisdiction_state: string;
  subscriber_count: number;
}

interface BrandingSettings {
  id: string;
  logo_url: string | null;
  primary_color: string;
  header_text: string;
  footer_text: string;
  unsubscribe_text: string;
}

interface ActivityLog {
  id: string;
  admin_email: string;
  action_type: string;
  jurisdiction_id: string | null;
  jurisdiction_name: string | null;
  notification_title: string | null;
  notification_message: string | null;
  subscriber_count: number;
  email_sent: boolean;
  delivery_status: string;
  error_message: string | null;
  created_at: string;
}

interface ScheduledNotification {
  id: string;
  jurisdiction_id: string;
  jurisdiction_name: string;
  notification_title: string;
  notification_message: string;
  send_email: boolean;
  scheduled_for: string;
  status: string;
  created_at: string;
}

const defaultBranding: Omit<BrandingSettings, 'id'> = {
  logo_url: null,
  primary_color: '#0f766e',
  header_text: 'PermitPilot',
  footer_text: '© 2024 PermitPilot. All rights reserved.',
  unsubscribe_text: 'Unsubscribe from these notifications',
};

export default function AdminPanel() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [jurisdictions, setJurisdictions] = useState<JurisdictionSubscribers[]>([]);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>('');
  const [notificationTitle, setNotificationTitle] = useState('');
  const [notificationMessage, setNotificationMessage] = useState('');
  const [sendEmailNotification, setSendEmailNotification] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingJurisdictions, setLoadingJurisdictions] = useState(true);
  const [showPreview, setShowPreview] = useState(false);
  
  // Branding state
  const [branding, setBranding] = useState<BrandingSettings | null>(null);
  const [editedBranding, setEditedBranding] = useState<Omit<BrandingSettings, 'id'>>(defaultBranding);
  const [savingBranding, setSavingBranding] = useState(false);
  const [loadingBranding, setLoadingBranding] = useState(true);
  
  // Activity log state
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  
  // Scheduling state
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [scheduledNotifications, setScheduledNotifications] = useState<ScheduledNotification[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(true);

  useEffect(() => {
    if (!user) return;

    async function fetchData() {
      // Fetch jurisdictions
      try {
        const { data, error } = await supabase
          .from('jurisdiction_subscriptions')
          .select('jurisdiction_id, jurisdiction_name, jurisdiction_state');

        if (error) throw error;

        const jurisdictionMap = new Map<string, JurisdictionSubscribers>();

        data?.forEach((sub) => {
          const existing = jurisdictionMap.get(sub.jurisdiction_id);
          if (existing) {
            existing.subscriber_count++;
          } else {
            jurisdictionMap.set(sub.jurisdiction_id, {
              jurisdiction_id: sub.jurisdiction_id,
              jurisdiction_name: sub.jurisdiction_name,
              jurisdiction_state: sub.jurisdiction_state,
              subscriber_count: 1,
            });
          }
        });

        setJurisdictions(Array.from(jurisdictionMap.values()).sort((a, b) =>
          a.jurisdiction_name.localeCompare(b.jurisdiction_name)
        ));
      } catch (error) {
        console.error('Error fetching jurisdictions:', error);
      } finally {
        setLoadingJurisdictions(false);
      }

      // Fetch branding settings
      try {
        const { data, error } = await supabase
          .from('email_branding_settings')
          .select('*')
          .limit(1)
          .single();

        if (error && error.code !== 'PGRST116') throw error;

        if (data) {
          setBranding(data);
          setEditedBranding({
            logo_url: data.logo_url,
            primary_color: data.primary_color,
            header_text: data.header_text,
            footer_text: data.footer_text,
            unsubscribe_text: data.unsubscribe_text,
          });
        }
      } catch (error) {
        console.error('Error fetching branding:', error);
      } finally {
        setLoadingBranding(false);
      }

      // Fetch activity logs
      try {
        const { data, error } = await supabase
          .from('admin_activity_log')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        setActivityLogs((data as ActivityLog[]) || []);
      } catch (error) {
        console.error('Error fetching activity logs:', error);
      } finally {
        setLoadingLogs(false);
      }

      // Fetch scheduled notifications
      try {
        const { data, error } = await supabase
          .from('scheduled_notifications')
          .select('*')
          .in('status', ['pending', 'processing'])
          .order('scheduled_for', { ascending: true });

        if (error) throw error;
        setScheduledNotifications((data as ScheduledNotification[]) || []);
      } catch (error) {
        console.error('Error fetching scheduled notifications:', error);
      } finally {
        setLoadingScheduled(false);
      }
    }

    fetchData();
  }, [user?.id]);

  const handleSaveBranding = async () => {
    setSavingBranding(true);
    try {
      if (branding?.id) {
        // Update existing
        const { error } = await supabase
          .from('email_branding_settings')
          .update(editedBranding)
          .eq('id', branding.id);

        if (error) throw error;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('email_branding_settings')
          .insert(editedBranding)
          .select()
          .single();

        if (error) throw error;
        if (data) setBranding(data);
      }

      toast({
        title: "Branding Saved",
        description: "Email branding settings have been updated.",
      });
    } catch (error) {
      console.error('Error saving branding:', error);
      toast({
        title: "Error",
        description: "Failed to save branding settings.",
        variant: "destructive",
      });
    } finally {
      setSavingBranding(false);
    }
  };

  const handleSendNotification = async () => {
    if (!selectedJurisdiction || !notificationTitle.trim() || !notificationMessage.trim()) {
      toast({
        title: "Missing Information",
        description: "Please select a jurisdiction and fill in all fields.",
        variant: "destructive",
      });
      return;
    }

    setSending(true);

    let logEntry: Partial<ActivityLog> = {
      admin_email: user?.email || 'unknown',
      action_type: 'notification_sent',
      delivery_status: 'pending',
    };

    try {
      const jurisdiction = jurisdictions.find(j => j.jurisdiction_id === selectedJurisdiction);
      if (!jurisdiction) throw new Error('Jurisdiction not found');

      logEntry = {
        ...logEntry,
        jurisdiction_id: selectedJurisdiction,
        jurisdiction_name: jurisdiction.jurisdiction_name,
        notification_title: notificationTitle,
        notification_message: notificationMessage,
      };

      const { data: subscribers, error: subError } = await supabase
        .from('jurisdiction_subscriptions')
        .select('user_id')
        .eq('jurisdiction_id', selectedJurisdiction);

      if (subError) throw subError;

      if (!subscribers || subscribers.length === 0) {
        toast({
          title: "No Subscribers",
          description: "There are no subscribers for this jurisdiction.",
          variant: "destructive",
        });
        setSending(false);
        return;
      }

      logEntry.subscriber_count = subscribers.length;

      const notifications = subscribers.map((sub) => ({
        user_id: sub.user_id,
        title: notificationTitle,
        message: notificationMessage,
        jurisdiction_id: selectedJurisdiction,
        jurisdiction_name: jurisdiction.jurisdiction_name,
      }));

      const { error: insertError } = await supabase
        .from('jurisdiction_notifications')
        .insert(notifications);

      if (insertError) throw insertError;

      let emailResult = null;
      let emailError = null;
      
      if (sendEmailNotification) {
        logEntry.email_sent = true;
        const { data, error: emailErr } = await supabase.functions.invoke('send-jurisdiction-notification', {
          body: {
            jurisdictionId: selectedJurisdiction,
            jurisdictionName: jurisdiction.jurisdiction_name,
            title: notificationTitle,
            message: notificationMessage,
          },
        });

        if (emailErr) {
          emailError = emailErr;
          console.error('Email notification error:', emailErr);
          logEntry.delivery_status = 'partial';
          logEntry.error_message = emailErr.message || 'Email delivery failed';
          toast({
            title: "Partial Success",
            description: `In-app notifications sent to ${subscribers.length} subscriber(s), but email delivery failed.`,
            variant: "default",
          });
        } else {
          emailResult = data;
          logEntry.delivery_status = 'success';
        }
      } else {
        logEntry.email_sent = false;
        logEntry.delivery_status = 'success';
      }

      if (emailResult) {
        toast({
          title: "Notifications Sent",
          description: `In-app: ${subscribers.length} | Emails: ${emailResult.emailsSent} sent${emailResult.emailsFailed > 0 ? `, ${emailResult.emailsFailed} failed` : ''}`,
        });
      } else if (!sendEmailNotification) {
        toast({
          title: "Notifications Sent",
          description: `Successfully sent in-app notifications to ${subscribers.length} subscriber(s).`,
        });
      }

      // Log activity
      const { data: logData, error: logError } = await supabase
        .from('admin_activity_log')
        .insert({
          admin_user_id: user?.id,
          admin_email: logEntry.admin_email,
          action_type: logEntry.action_type,
          jurisdiction_id: logEntry.jurisdiction_id,
          jurisdiction_name: logEntry.jurisdiction_name,
          notification_title: logEntry.notification_title,
          notification_message: logEntry.notification_message,
          subscriber_count: logEntry.subscriber_count,
          email_sent: logEntry.email_sent,
          delivery_status: logEntry.delivery_status,
          error_message: logEntry.error_message || null,
        })
        .select()
        .single();

      if (!logError && logData) {
        setActivityLogs(prev => [logData as ActivityLog, ...prev]);
      }

      setNotificationTitle('');
      setNotificationMessage('');
      setSelectedJurisdiction('');
    } catch (error) {
      console.error('Error sending notifications:', error);
      
      // Log failed attempt
      logEntry.delivery_status = 'failed';
      logEntry.error_message = error instanceof Error ? error.message : 'Unknown error';
      
      const { data: logData, error: logError } = await supabase
        .from('admin_activity_log')
        .insert({
          admin_user_id: user?.id,
          admin_email: logEntry.admin_email,
          action_type: logEntry.action_type,
          jurisdiction_id: logEntry.jurisdiction_id || null,
          jurisdiction_name: logEntry.jurisdiction_name || null,
          notification_title: logEntry.notification_title || null,
          notification_message: logEntry.notification_message || null,
          subscriber_count: logEntry.subscriber_count || 0,
          email_sent: logEntry.email_sent || false,
          delivery_status: logEntry.delivery_status,
          error_message: logEntry.error_message,
        })
        .select()
        .single();

      if (!logError && logData) {
        setActivityLogs(prev => [logData as ActivityLog, ...prev]);
      }

      toast({
        title: "Error",
        description: "Failed to send notifications. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handleScheduleNotification = async () => {
    if (!selectedJurisdiction || !notificationTitle.trim() || !notificationMessage.trim()) {
      toast({
        title: "Missing Information",
        description: "Please select a jurisdiction and fill in all fields.",
        variant: "destructive",
      });
      return;
    }

    if (!scheduledDate || !scheduledTime) {
      toast({
        title: "Missing Schedule",
        description: "Please select a date and time for the scheduled notification.",
        variant: "destructive",
      });
      return;
    }

    const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
    if (scheduledFor <= new Date()) {
      toast({
        title: "Invalid Schedule",
        description: "Scheduled time must be in the future.",
        variant: "destructive",
      });
      return;
    }

    setSending(true);

    try {
      const jurisdiction = jurisdictions.find(j => j.jurisdiction_id === selectedJurisdiction);
      if (!jurisdiction) throw new Error('Jurisdiction not found');

      const { data, error } = await supabase
        .from('scheduled_notifications')
        .insert({
          admin_user_id: user?.id,
          admin_email: user?.email || 'unknown',
          jurisdiction_id: selectedJurisdiction,
          jurisdiction_name: jurisdiction.jurisdiction_name,
          notification_title: notificationTitle,
          notification_message: notificationMessage,
          send_email: sendEmailNotification,
          scheduled_for: scheduledFor.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setScheduledNotifications(prev => [...prev, data as ScheduledNotification].sort(
          (a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime()
        ));
      }

      toast({
        title: "Notification Scheduled",
        description: `Notification will be sent on ${format(scheduledFor, 'MMM d, yyyy')} at ${format(scheduledFor, 'h:mm a')}.`,
      });

      setNotificationTitle('');
      setNotificationMessage('');
      setSelectedJurisdiction('');
      setScheduledDate('');
      setScheduledTime('');
      setIsScheduled(false);
    } catch (error) {
      console.error('Error scheduling notification:', error);
      toast({
        title: "Error",
        description: "Failed to schedule notification. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const handleDeleteScheduled = async (id: string) => {
    try {
      const { error } = await supabase
        .from('scheduled_notifications')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setScheduledNotifications(prev => prev.filter(n => n.id !== id));
      toast({
        title: "Scheduled Notification Deleted",
        description: "The scheduled notification has been removed.",
      });
    } catch (error) {
      console.error('Error deleting scheduled notification:', error);
      toast({
        title: "Error",
        description: "Failed to delete scheduled notification.",
        variant: "destructive",
      });
    }
  };

  const currentBranding = editedBranding;

  const adminQuickLinks = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => navigate('/admin/shadow-mode')}>
        <Shield className="mr-2 h-4 w-4" />
        Shadow Mode
      </Button>
      <Button variant="outline" size="sm" onClick={() => navigate('/admin/jurisdictions')}>
        <Building2 className="mr-2 h-4 w-4" />
        Jurisdictions
      </Button>
      <Button variant="outline" size="sm" onClick={() => navigate('/admin/feature-flags')}>
        <Flag className="mr-2 h-4 w-4" />
        Feature Flags
      </Button>
    </div>
  );

  return (
    <>
      <AdminPageShell
        title="Admin Panel"
        description="Notifications, drip campaigns, activity log, and email branding."
        breadcrumbs={[{ label: 'Overview' }]}
        actions={adminQuickLinks}
      >
        <div className="space-y-6">

          <Tabs defaultValue="notifications" className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="notifications" className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Notifications
              </TabsTrigger>
              <TabsTrigger value="drip" className="flex items-center gap-2">
                <MailCheck className="h-4 w-4" />
                Drip Campaigns
              </TabsTrigger>
              <TabsTrigger value="activity" className="flex items-center gap-2">
                <History className="h-4 w-4" />
                Activity Log
              </TabsTrigger>
              <TabsTrigger value="branding" className="flex items-center gap-2">
                <Palette className="h-4 w-4" />
                Email Branding
              </TabsTrigger>
            </TabsList>

            <TabsContent value="drip">
              <DripCampaignManager />
            </TabsContent>

            <TabsContent value="notifications" className="space-y-6">
              {/* Stats Cards */}
              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">
                      Jurisdictions with Subscribers
                    </CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{jurisdictions.length}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium">
                      Total Subscriptions
                    </CardTitle>
                    <Bell className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {jurisdictions.reduce((sum, j) => sum + j.subscriber_count, 0)}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Send Notification Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Send className="h-5 w-5" />
                    Send Code Update Notification
                  </CardTitle>
                  <CardDescription>
                    Send a notification to all subscribers of a specific jurisdiction about code updates.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="jurisdiction">Select Jurisdiction</Label>
                    {loadingJurisdictions ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading jurisdictions...
                      </div>
                    ) : jurisdictions.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No jurisdictions have subscribers yet.
                      </p>
                    ) : (
                      <Select value={selectedJurisdiction} onValueChange={setSelectedJurisdiction}>
                        <SelectTrigger id="jurisdiction">
                          <SelectValue placeholder="Choose a jurisdiction..." />
                        </SelectTrigger>
                        <SelectContent>
                          {jurisdictions.map((j) => (
                            <SelectItem key={j.jurisdiction_id} value={j.jurisdiction_id}>
                              {j.jurisdiction_name}, {j.jurisdiction_state} ({j.subscriber_count} subscriber{j.subscriber_count !== 1 ? 's' : ''})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">Notification Title</Label>
                    <Input
                      id="title"
                      placeholder="e.g., 2024 Building Code Update"
                      value={notificationTitle}
                      onChange={(e) => setNotificationTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message">Notification Message</Label>
                    <Textarea
                      id="message"
                      placeholder="Describe the code update details..."
                      rows={4}
                      value={notificationMessage}
                      onChange={(e) => setNotificationMessage(e.target.value)}
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="sendEmail" 
                      checked={sendEmailNotification}
                      onCheckedChange={(checked) => setSendEmailNotification(checked === true)}
                    />
                    <Label htmlFor="sendEmail" className="flex items-center gap-2 cursor-pointer">
                      <Mail className="h-4 w-4" />
                      Also send email notifications
                    </Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="scheduleNotification" 
                      checked={isScheduled}
                      onCheckedChange={(checked) => setIsScheduled(checked === true)}
                    />
                    <Label htmlFor="scheduleNotification" className="flex items-center gap-2 cursor-pointer">
                      <Calendar className="h-4 w-4" />
                      Schedule for later
                    </Label>
                  </div>

                  {isScheduled && (
                    <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                      <div className="space-y-2">
                        <Label htmlFor="scheduleDate">Date</Label>
                        <Input
                          id="scheduleDate"
                          type="date"
                          value={scheduledDate}
                          onChange={(e) => setScheduledDate(e.target.value)}
                          min={format(new Date(), 'yyyy-MM-dd')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="scheduleTime">Time</Label>
                        <Input
                          id="scheduleTime"
                          type="time"
                          value={scheduledTime}
                          onChange={(e) => setScheduledTime(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <Button 
                      variant="outline"
                      onClick={() => setShowPreview(true)} 
                      disabled={!selectedJurisdiction || !notificationTitle || !notificationMessage}
                      className="flex-1"
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Preview
                    </Button>
                    {isScheduled ? (
                      <Button 
                        onClick={handleScheduleNotification} 
                        disabled={sending || !selectedJurisdiction || !notificationTitle || !notificationMessage || !scheduledDate || !scheduledTime}
                        className="flex-1"
                      >
                        {sending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Scheduling...
                          </>
                        ) : (
                          <>
                            <Calendar className="mr-2 h-4 w-4" />
                            Schedule
                          </>
                        )}
                      </Button>
                    ) : (
                      <Button 
                        onClick={handleSendNotification} 
                        disabled={sending || !selectedJurisdiction || !notificationTitle || !notificationMessage}
                        className="flex-1"
                      >
                        {sending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <Send className="mr-2 h-4 w-4" />
                            Send Now
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Scheduled Notifications */}
              {scheduledNotifications.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Scheduled Notifications
                    </CardTitle>
                    <CardDescription>
                      Notifications waiting to be sent
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {scheduledNotifications.map((notification) => (
                        <div 
                          key={notification.id} 
                          className="flex items-start justify-between gap-4 p-3 border rounded-lg"
                        >
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{notification.notification_title}</h4>
                              <Badge variant="outline" className="text-xs">
                                {notification.status === 'pending' ? 'Pending' : 'Processing'}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">{notification.jurisdiction_name}</p>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {format(new Date(notification.scheduled_for), 'MMM d, yyyy h:mm a')}
                              </span>
                              {notification.send_email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="h-3 w-3" />
                                  Email enabled
                                </span>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteScheduled(notification.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Subscribers List */}
              {jurisdictions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Jurisdictions Overview</CardTitle>
                    <CardDescription>
                      All jurisdictions with active subscribers
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="divide-y">
                      {jurisdictions.map((j) => (
                        <div key={j.jurisdiction_id} className="py-3 flex justify-between items-center">
                          <div>
                            <p className="font-medium">{j.jurisdiction_name}</p>
                            <p className="text-sm text-muted-foreground">{j.jurisdiction_state}</p>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Users className="h-4 w-4" />
                            {j.subscriber_count}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="branding" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5" />
                    Email Template Branding
                  </CardTitle>
                  <CardDescription>
                    Customize the appearance of email notifications sent to subscribers.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {loadingBranding ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : (
                    <>
                      <div className="grid md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="headerText">Header Text / Brand Name</Label>
                            <Input
                              id="headerText"
                              value={editedBranding.header_text}
                              onChange={(e) => setEditedBranding(prev => ({ ...prev, header_text: e.target.value }))}
                              placeholder="PermitPilot"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="logoUrl">Logo URL (optional)</Label>
                            <Input
                              id="logoUrl"
                              value={editedBranding.logo_url || ''}
                              onChange={(e) => setEditedBranding(prev => ({ ...prev, logo_url: e.target.value || null }))}
                              placeholder="https://example.com/logo.png"
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="primaryColor">Primary Color</Label>
                            <div className="flex gap-2">
                              <Input
                                id="primaryColor"
                                type="color"
                                value={editedBranding.primary_color}
                                onChange={(e) => setEditedBranding(prev => ({ ...prev, primary_color: e.target.value }))}
                                className="w-16 h-10 p-1 cursor-pointer"
                              />
                              <Input
                                value={editedBranding.primary_color}
                                onChange={(e) => setEditedBranding(prev => ({ ...prev, primary_color: e.target.value }))}
                                placeholder="#0f766e"
                                className="flex-1"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="footerText">Footer Text</Label>
                            <Input
                              id="footerText"
                              value={editedBranding.footer_text}
                              onChange={(e) => setEditedBranding(prev => ({ ...prev, footer_text: e.target.value }))}
                              placeholder="© 2024 PermitPilot. All rights reserved."
                            />
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="unsubscribeText">Unsubscribe Link Text</Label>
                            <Input
                              id="unsubscribeText"
                              value={editedBranding.unsubscribe_text}
                              onChange={(e) => setEditedBranding(prev => ({ ...prev, unsubscribe_text: e.target.value }))}
                              placeholder="Unsubscribe from these notifications"
                            />
                          </div>

                          <Button 
                            onClick={handleSaveBranding} 
                            disabled={savingBranding}
                            className="w-full"
                          >
                            {savingBranding ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="mr-2 h-4 w-4" />
                                Save Branding
                              </>
                            )}
                          </Button>
                        </div>

                        {/* Live Preview */}
                        <div className="space-y-2">
                          <Label>Live Preview</Label>
                          <div className="border rounded-lg overflow-hidden bg-[#0D1E38] text-sm">
                            <div style={{ backgroundColor: editedBranding.primary_color }} className="px-4 py-3 text-center">
                              {editedBranding.logo_url && (
                                <img 
                                  src={editedBranding.logo_url} 
                                  alt="Logo" 
                                  className="max-h-8 mx-auto mb-1"
                                  onError={(e) => (e.currentTarget.style.display = 'none')}
                                />
                              )}
                              <h3 className="text-white font-bold text-sm">{editedBranding.header_text}</h3>
                            </div>
                            <div className="p-4 space-y-2">
                              <p className="text-xs text-[#6B9AC4]">Jurisdiction Code Update</p>
                              <p className="font-bold text-[#F0F6FF]">Sample Notification Title</p>
                              <span 
                                className="inline-block px-2 py-0.5 rounded-full text-xs font-medium"
                                style={{ 
                                  backgroundColor: `${editedBranding.primary_color}20`,
                                  color: editedBranding.primary_color 
                                }}
                              >
                                Sample Jurisdiction, ST
                              </span>
                              <div 
                                className="p-2 text-xs"
                                style={{ 
                                  backgroundColor: '#091428',
                                  borderLeft: `3px solid ${editedBranding.primary_color}` 
                                }}
                              >
                                Sample notification message content...
                              </div>
                            </div>
                            <div className="bg-[#091428] px-4 py-2 text-center">
                              <p className="text-xs text-[#6B9AC4]">{editedBranding.footer_text}</p>
                              <p className="mt-1">
                                <span 
                                  className="text-xs cursor-pointer"
                                  style={{ color: editedBranding.primary_color }}
                                >
                                  {editedBranding.unsubscribe_text}
                                </span>
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activity" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Notification Activity Log
                  </CardTitle>
                  <CardDescription>
                    Track all notifications sent from the admin panel with timestamps, sender info, and delivery status.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingLogs ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : activityLogs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No activity logs yet.</p>
                      <p className="text-sm">Logs will appear here when you send notifications.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {activityLogs.map((log) => (
                        <div 
                          key={log.id} 
                          className="border rounded-lg p-4 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-semibold">
                                  {log.notification_title || 'Untitled Notification'}
                                </h4>
                                {log.delivery_status === 'success' && (
                                  <Badge variant="default" className="bg-green-500">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Success
                                  </Badge>
                                )}
                                {log.delivery_status === 'partial' && (
                                  <Badge variant="secondary" className="bg-yellow-500 text-white">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Partial
                                  </Badge>
                                )}
                                {log.delivery_status === 'failed' && (
                                  <Badge variant="destructive">
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Failed
                                  </Badge>
                                )}
                                {log.delivery_status === 'pending' && (
                                  <Badge variant="outline">
                                    <Clock className="h-3 w-3 mr-1" />
                                    Pending
                                  </Badge>
                                )}
                              </div>
                              {log.jurisdiction_name && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  Jurisdiction: {log.jurisdiction_name}
                                </p>
                              )}
                            </div>
                            <div className="text-right text-sm text-muted-foreground shrink-0">
                              <p>{format(new Date(log.created_at), 'MMM d, yyyy')}</p>
                              <p>{format(new Date(log.created_at), 'h:mm a')}</p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-4 text-sm">
                            <div className="flex items-center gap-1.5">
                              <Users className="h-4 w-4 text-muted-foreground" />
                              <span>{log.subscriber_count} subscriber{log.subscriber_count !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                              <span>{log.email_sent ? 'Email sent' : 'In-app only'}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-muted-foreground">
                              <span>by {log.admin_email}</span>
                            </div>
                          </div>

                          {log.notification_message && (
                            <p className="text-sm text-muted-foreground line-clamp-2 bg-muted/50 p-2 rounded">
                              {log.notification_message}
                            </p>
                          )}

                          {log.error_message && (
                            <p className="text-sm text-destructive bg-destructive/10 p-2 rounded">
                              Error: {log.error_message}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Coverage Requests — integration-ready placeholder */}
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                Coverage Requests
              </CardTitle>
              <CardDescription>
                Manage jurisdiction coverage requests submitted via the public form. Backend (RLS) supports admin view and updates; UI wiring pending.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Not connected yet — list and actions will appear here once the admin coverage-requests view is implemented.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Table: <code className="bg-muted px-1 rounded">coverage_requests</code>. Admins can SELECT, UPDATE, DELETE.
              </p>
            </CardContent>
          </Card>
        </div>
      </AdminPageShell>

      {/* Email Preview Modal */}
      <Dialog open={showPreview} onOpenChange={setShowPreview}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Preview
            </DialogTitle>
            <DialogDescription>
              This is how the email notification will appear to subscribers.
            </DialogDescription>
          </DialogHeader>
          
          <div className="border rounded-lg overflow-hidden bg-[#0D1E38]">
            {/* Email Header */}
            <div style={{ backgroundColor: currentBranding.primary_color }} className="px-6 py-4 text-center">
              {currentBranding.logo_url && (
                <img 
                  src={currentBranding.logo_url} 
                  alt={currentBranding.header_text}
                  className="max-h-12 mx-auto mb-2"
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              )}
              <h2 className="text-xl font-bold text-white">{currentBranding.header_text}</h2>
            </div>
            
            {/* Email Body */}
            <div className="p-6 space-y-4">
              <div className="text-sm text-muted-foreground">
                Jurisdiction Code Update Notification
              </div>
              
              <h1 className="text-2xl font-bold text-foreground">
                {notificationTitle || 'Notification Title'}
              </h1>
              
              <span 
                className="inline-block px-3 py-1 rounded-full text-sm font-medium"
                style={{ 
                  backgroundColor: `${currentBranding.primary_color}20`,
                  color: currentBranding.primary_color 
                }}
              >
                {jurisdictions.find(j => j.jurisdiction_id === selectedJurisdiction)?.jurisdiction_name || 'Selected Jurisdiction'}, {jurisdictions.find(j => j.jurisdiction_id === selectedJurisdiction)?.jurisdiction_state || 'State'}
              </span>
              
              <div 
                className="p-4"
                style={{ 
                  backgroundColor: '#091428',
                  borderLeft: `4px solid ${currentBranding.primary_color}` 
                }}
              >
                <p className="text-foreground whitespace-pre-wrap">
                  {notificationMessage || 'Notification message will appear here...'}
                </p>
              </div>
              
              <hr className="my-4" />
              
              <p className="text-sm text-muted-foreground">
                You are receiving this email because you subscribed to updates for this jurisdiction on {currentBranding.header_text}.
              </p>
            </div>
            
            {/* Email Footer */}
            <div className="bg-muted px-6 py-4 text-center">
              <p className="text-sm text-muted-foreground">{currentBranding.footer_text}</p>
              <p className="mt-2">
                <span style={{ color: currentBranding.primary_color }} className="text-sm cursor-pointer hover:underline">
                  {currentBranding.unsubscribe_text}
                </span>
              </p>
            </div>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowPreview(false)}>
              Close
            </Button>
            <Button 
              onClick={() => {
                setShowPreview(false);
                handleSendNotification();
              }}
              disabled={sending}
            >
              {sending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Now
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}