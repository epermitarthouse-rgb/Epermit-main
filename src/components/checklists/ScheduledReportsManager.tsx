import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Calendar,
  Clock,
  Mail,
  Plus,
  Trash2,
  Edit,
  ToggleLeft,
  ToggleRight,
  CalendarDays,
  Send,
  History,
  TestTube,
  Loader2,
  Eye,
  Copy,
  Palette,
  BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useScheduledReports, CreateScheduledReportData } from '@/hooks/useScheduledReports';
import { useSavedChecklists } from '@/hooks/useSavedChecklists';
import { ReportDeliveryHistory } from './ReportDeliveryHistory';
import { ScheduledReportPreviewDialog } from './ScheduledReportPreviewDialog';
import { EmailBrandingDialog } from './EmailBrandingDialog';
import { ReportAnalyticsDashboard } from './ReportAnalyticsDashboard';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export function ScheduledReportsManager() {
  const { scheduledReports, loading, createScheduledReport, updateScheduledReport, deleteScheduledReport, toggleReportActive } = useScheduledReports();
  const { savedChecklists } = useSavedChecklists();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [brandingDialogOpen, setBrandingDialogOpen] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [editingReport, setEditingReport] = useState<string | null>(null);

  const [formData, setFormData] = useState<CreateScheduledReportData>({
    name: '',
    recipient_email: '',
    recipient_name: '',
    project_filter: 'all',
    status_filter: 'all',
    frequency: 'weekly',
    day_of_week: 1,
    day_of_month: 1,
    send_time: '09:00',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    email_subject: '',
    email_intro: '',
    include_summary: true,
    include_details: true,
    include_pdf_attachment: false,
  });

  // Common timezone options
  const TIMEZONE_OPTIONS = [
    { value: 'America/New_York', label: 'Eastern Time (ET)' },
    { value: 'America/Chicago', label: 'Central Time (CT)' },
    { value: 'America/Denver', label: 'Mountain Time (MT)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
    { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
    { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Central European (CET)' },
    { value: 'Asia/Tokyo', label: 'Japan (JST)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  ];

  // Get unique project names for filtering
  const projectNames = useMemo(() => {
    const names = new Set<string>();
    savedChecklists.forEach(c => {
      if (c.form_data.projectName) {
        names.add(c.form_data.projectName);
      }
    });
    return Array.from(names).sort();
  }, [savedChecklists]);

  const resetForm = () => {
    setFormData({
      name: '',
      recipient_email: '',
      recipient_name: '',
      project_filter: 'all',
      status_filter: 'all',
      frequency: 'weekly',
      day_of_week: 1,
      day_of_month: 1,
      send_time: '09:00',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      email_subject: '',
      email_intro: '',
      include_summary: true,
      include_details: true,
      include_pdf_attachment: false,
    });
    setEditingReport(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setDialogOpen(true);
  };

  const handleOpenEdit = (report: typeof scheduledReports[0]) => {
    setEditingReport(report.id);
    setFormData({
      name: report.name,
      recipient_email: report.recipient_email,
      recipient_name: report.recipient_name || '',
      project_filter: report.project_filter || 'all',
      status_filter: report.status_filter || 'all',
      frequency: report.frequency,
      day_of_week: report.day_of_week ?? 1,
      day_of_month: report.day_of_month ?? 1,
      send_time: report.send_time?.slice(0, 5) || '09:00',
      timezone: report.timezone || 'America/New_York',
      email_subject: report.email_subject || '',
      email_intro: report.email_intro || '',
      include_summary: report.include_summary ?? true,
      include_details: report.include_details ?? true,
      include_pdf_attachment: report.include_pdf_attachment ?? false,
    });
    setDialogOpen(true);
  };

  const handleCloneReport = (report: typeof scheduledReports[0]) => {
    setEditingReport(null); // Make sure we're not editing
    setFormData({
      name: `${report.name} (Copy)`,
      recipient_email: report.recipient_email,
      recipient_name: report.recipient_name || '',
      project_filter: report.project_filter || 'all',
      status_filter: report.status_filter || 'all',
      frequency: report.frequency,
      day_of_week: report.day_of_week ?? 1,
      day_of_month: report.day_of_month ?? 1,
      send_time: report.send_time?.slice(0, 5) || '09:00',
      timezone: report.timezone || 'America/New_York',
      email_subject: report.email_subject || '',
      email_intro: report.email_intro || '',
      include_summary: report.include_summary ?? true,
      include_details: report.include_details ?? true,
      include_pdf_attachment: report.include_pdf_attachment ?? false,
    });
    setDialogOpen(true);
    toast.info('Report cloned. Modify and save to create a new schedule.');
  };

  const handleSubmit = async () => {
    if (!formData.name.trim() || !formData.recipient_email.trim()) return;

    if (editingReport) {
      const success = await updateScheduledReport(editingReport, {
        ...formData,
        send_time: formData.send_time ? `${formData.send_time}:00` : '09:00:00',
      });
      if (success) {
        setDialogOpen(false);
        resetForm();
      }
    } else {
      const result = await createScheduledReport(formData);
      if (result) {
        setDialogOpen(false);
        resetForm();
      }
    }
  };

  const handleSendTestEmail = async () => {
    if (!formData.recipient_email.trim()) {
      toast.error('Please enter a recipient email first');
      return;
    }

    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-test-scheduled-report', {
        body: {
          recipient_email: formData.recipient_email,
          recipient_name: formData.recipient_name,
          report_name: formData.name || 'Test Report',
          project_filter: formData.project_filter,
          status_filter: formData.status_filter,
          frequency: formData.frequency,
          email_subject: formData.email_subject,
          email_intro: formData.email_intro,
          include_summary: formData.include_summary,
          include_details: formData.include_details,
        },
      });

      if (error) throw error;

      toast.success(`Test email sent to ${formData.recipient_email.split(',')[0].trim()}`);
    } catch (err: any) {
      console.error('Error sending test email:', err);
      toast.error('Failed to send test email');
    } finally {
      setSendingTest(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedReportId) return;
    await deleteScheduledReport(selectedReportId);
    setDeleteDialogOpen(false);
    setSelectedReportId(null);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="schedules" className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="schedules" className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Schedules
            </TabsTrigger>
            <TabsTrigger value="history" className="flex items-center gap-2">
              <History className="h-4 w-4" />
              Delivery History
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setBrandingDialogOpen(true)}>
              <Palette className="h-4 w-4 mr-2" />
              Branding
            </Button>
            <Button onClick={handleOpenCreate}>
              <Plus className="h-4 w-4 mr-2" />
              New Schedule
            </Button>
          </div>
        </div>

        <TabsContent value="schedules" className="mt-0">
          <AnimatePresence mode="popLayout">
            {scheduledReports.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-12 border border-dashed rounded-lg"
              >
                <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No scheduled reports yet.</p>
                <Button variant="outline" className="mt-4" onClick={handleOpenCreate}>
                  Create Your First Schedule
                </Button>
              </motion.div>
            ) : (
              <div className="space-y-3">
            {scheduledReports.map((report, index) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ delay: index * 0.05 }}
              >
                <Card className={`${!report.is_active ? 'opacity-60' : ''}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="font-medium truncate">{report.name}</h3>
                          <Badge variant={report.is_active ? 'default' : 'secondary'}>
                            {report.is_active ? 'Active' : 'Paused'}
                          </Badge>
                          <Badge variant="outline">
                            {report.frequency === 'weekly' ? 'Weekly' : 'Monthly'}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {report.recipient_email.includes(',') 
                              ? `${report.recipient_email.split(',').length} recipients`
                              : report.recipient_email}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {report.frequency === 'weekly'
                              ? `Every ${DAYS_OF_WEEK.find(d => d.value === report.day_of_week)?.label}`
                              : `Day ${report.day_of_month} of each month`}
                            {report.timezone && (
                              <span className="text-xs opacity-70">
                                ({TIMEZONE_OPTIONS.find(tz => tz.value === report.timezone)?.label || report.timezone})
                              </span>
                            )}
                          </span>
                          {report.next_send_at && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Next: {format(new Date(report.next_send_at), 'MMM d, yyyy h:mm a')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(report)}
                          title="Edit schedule"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCloneReport(report)}
                          title="Clone schedule"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleReportActive(report.id, !report.is_active)}
                          title={report.is_active ? 'Pause schedule' : 'Activate schedule'}
                        >
                          {report.is_active ? (
                            <ToggleRight className="h-5 w-5 text-green-600" />
                          ) : (
                            <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedReportId(report.id);
                            setDeleteDialogOpen(true);
                          }}
                          title="Delete schedule"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>
            )}
          </AnimatePresence>
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          <ReportDeliveryHistory />
        </TabsContent>

        <TabsContent value="analytics" className="mt-0">
          <ReportAnalyticsDashboard />
        </TabsContent>
      </Tabs>
      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => {
        setDialogOpen(open);
        if (!open) resetForm();
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              {editingReport ? 'Edit Scheduled Report' : 'Schedule Recurring Report'}
            </DialogTitle>
            <DialogDescription>
              {editingReport 
                ? 'Update the settings for this scheduled report.'
                : 'Set up automatic email delivery of your checklist reports.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="report-name">Report Name *</Label>
              <Input
                id="report-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Weekly Inspection Summary"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="recipient-email">Recipient Email(s) *</Label>
              <Input
                id="recipient-email"
                type="text"
                value={formData.recipient_email}
                onChange={(e) => setFormData({ ...formData, recipient_email: e.target.value })}
                placeholder="email@example.com, another@example.com"
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Separate multiple emails with commas
              </p>
            </div>

            <div>
              <Label htmlFor="recipient-name">Recipient Name(s)</Label>
              <Input
                id="recipient-name"
                value={formData.recipient_name}
                onChange={(e) => setFormData({ ...formData, recipient_name: e.target.value })}
                placeholder="John Doe, Jane Smith"
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional: names in the same order as emails
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Frequency</Label>
                <Select
                  value={formData.frequency}
                  onValueChange={(v) => setFormData({ ...formData, frequency: v as 'weekly' | 'monthly' })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                {formData.frequency === 'weekly' ? (
                  <>
                    <Label>Day of Week</Label>
                    <Select
                      value={String(formData.day_of_week)}
                      onValueChange={(v) => setFormData({ ...formData, day_of_week: parseInt(v) })}
                    >
                      <SelectTrigger className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((day) => (
                          <SelectItem key={day.value} value={String(day.value)}>
                            {day.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : (
                  <>
                    <Label>Day of Month</Label>
                    <Select
                      value={String(formData.day_of_month)}
                      onValueChange={(v) => setFormData({ ...formData, day_of_month: parseInt(v) })}
                    >
                      <SelectTrigger className="mt-1.5">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                          <SelectItem key={day} value={String(day)}>
                            {day}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Send Time</Label>
                <Input
                  type="time"
                  value={formData.send_time || '09:00'}
                  onChange={(e) => setFormData({ ...formData, send_time: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Timezone</Label>
                <Select
                  value={formData.timezone}
                  onValueChange={(v) => setFormData({ ...formData, timezone: v })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Project Filter</Label>
                <Select
                  value={formData.project_filter}
                  onValueChange={(v) => setFormData({ ...formData, project_filter: v })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projectNames.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status Filter</Label>
                <Select
                  value={formData.status_filter}
                  onValueChange={(v) => setFormData({ ...formData, status_filter: v })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="signed">Signed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="email-subject">Custom Email Subject</Label>
              <Input
                id="email-subject"
                value={formData.email_subject}
                onChange={(e) => setFormData({ ...formData, email_subject: e.target.value })}
                placeholder="Leave empty for default subject"
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="email-intro">Custom Email Introduction</Label>
              <Textarea
                id="email-intro"
                value={formData.email_intro}
                onChange={(e) => setFormData({ ...formData, email_intro: e.target.value })}
                placeholder="Custom message to include in the email..."
                rows={3}
                className="mt-1.5"
              />
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="include-summary"
                  checked={formData.include_summary}
                  onCheckedChange={(v) => setFormData({ ...formData, include_summary: v })}
                />
                <Label htmlFor="include-summary">Include Summary Statistics</Label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  id="include-details"
                  checked={formData.include_details}
                  onCheckedChange={(v) => setFormData({ ...formData, include_details: v })}
                />
                <Label htmlFor="include-details">Include Checklist Details</Label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  id="include-pdf"
                  checked={formData.include_pdf_attachment}
                  onCheckedChange={(v) => setFormData({ ...formData, include_pdf_attachment: v })}
                />
                <Label htmlFor="include-pdf">Attach PDF Report</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Include downloadable PDF
              </p>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <div className="flex gap-2 sm:mr-auto">
              <Button
                variant="outline"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
              <Button
                variant="outline"
                onClick={handleSendTestEmail}
                disabled={sendingTest || !formData.recipient_email.trim()}
              >
                {sendingTest ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <TestTube className="h-4 w-4 mr-2" />
                )}
                Send Test
              </Button>
            </div>
            <Button variant="outline" onClick={() => {
              setDialogOpen(false);
              resetForm();
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formData.name.trim() || !formData.recipient_email.trim()}
            >
              <Send className="h-4 w-4 mr-2" />
              {editingReport ? 'Save Changes' : 'Create Schedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Scheduled Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this scheduled report? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Email Preview Dialog */}
      <ScheduledReportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        recipientEmail={formData.recipient_email}
        recipientName={formData.recipient_name || ''}
        reportName={formData.name}
        frequency={formData.frequency}
        projectFilter={formData.project_filter || 'all'}
        statusFilter={formData.status_filter || 'all'}
        emailSubject={formData.email_subject || ''}
        emailIntro={formData.email_intro || ''}
        includeSummary={formData.include_summary ?? true}
        includeDetails={formData.include_details ?? true}
        includePdfAttachment={formData.include_pdf_attachment ?? false}
      />

      {/* Email Branding Dialog */}
      <EmailBrandingDialog
        open={brandingDialogOpen}
        onOpenChange={setBrandingDialogOpen}
      />
    </div>
  );
}
