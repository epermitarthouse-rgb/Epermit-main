import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEmailBranding } from '@/hooks/useEmailBranding';
import { Loader2, Eye } from 'lucide-react';

interface ScheduledReportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientEmail: string;
  recipientName: string;
  reportName: string;
  frequency: string;
  projectFilter: string;
  statusFilter: string;
  emailSubject: string;
  emailIntro: string;
  includeSummary: boolean;
  includeDetails: boolean;
  includePdfAttachment: boolean;
}

export function ScheduledReportPreviewDialog({
  open,
  onOpenChange,
  recipientEmail,
  recipientName,
  reportName,
  frequency,
  projectFilter,
  statusFilter,
  emailSubject,
  emailIntro,
  includeSummary,
  includeDetails,
  includePdfAttachment,
}: ScheduledReportPreviewDialogProps) {
  const { settings, loading } = useEmailBranding();

  const primaryColor = settings?.primary_color || '#0f4c5c';
  const headerText = settings?.header_text || 'Insight|DesignCheck';
  const logoUrl = settings?.logo_url;
  const footerText = settings?.footer_text || '© 2025 Insight|DesignCheck. All rights reserved.';

  const displayName = recipientName?.split(',')[0]?.trim() || '';
  const displayEmail = recipientEmail?.split(',')[0]?.trim() || 'recipient@example.com';
  const subject = emailSubject || `Scheduled Checklist Report - ${reportName || 'Report'}`;

  // Generate sample data for preview
  const sampleStats = {
    total: 12,
    completed: 5,
    inProgress: 4,
    pending: 3,
  };

  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${adjustColor(primaryColor, 20)} 100%); padding: 32px; border-radius: 12px 12px 0 0;">
        ${logoUrl 
          ? `<img src="${logoUrl}" alt="Logo" style="max-height: 50px; max-width: 200px;" />`
          : `<h1 style="color: white; margin: 0; font-size: 24px;">${headerText}</h1>`
        }
        <h2 style="color: white; margin: 16px 0 0 0; font-size: 18px; font-weight: normal; opacity: 0.9;">
          Scheduled Checklist Report
        </h2>
      </div>
      <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px;">
        <div style="background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
            Hi${displayName ? ` ${displayName}` : ''},
          </p>
          <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
            ${emailIntro || `Here is your ${frequency} inspection checklist report${projectFilter !== 'all' ? ` for <strong>${projectFilter}</strong>` : ''}.`}
          </p>
          
          ${includeSummary ? `
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0 0 12px 0; font-weight: bold; color: #374151;">Report Summary</p>
            <p style="margin: 0; color: #64748b; font-size: 14px; line-height: 1.8;">
              • Total Checklists: ${sampleStats.total}<br>
              • Completed: <span style="color: #22c55e; font-weight: 500;">${sampleStats.completed}</span><br>
              • In Progress: <span style="color: #f59e0b; font-weight: 500;">${sampleStats.inProgress}</span><br>
              • Pending: <span style="color: #94a3b8; font-weight: 500;">${sampleStats.pending}</span><br>
              ${projectFilter !== 'all' ? `• Project: ${projectFilter}<br>` : ''}
              ${statusFilter !== 'all' ? `• Status Filter: ${statusFilter}<br>` : ''}
              • Generated: ${new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>
          ` : ''}

          ${includeDetails ? `
          <div style="margin: 24px 0;">
            <p style="margin: 0 0 12px 0; font-weight: bold; color: #374151;">Checklist Details</p>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <thead>
                <tr style="background: #f8fafc;">
                  <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e2e8f0;">Checklist</th>
                  <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e2e8f0;">Status</th>
                  <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e2e8f0;">Updated</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Foundation Inspection - Site A</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 4px; font-size: 12px;">Completed</span></td>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Jan 15, 2026</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Framing Inspection - Site B</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 12px;">In Progress</span></td>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Jan 14, 2026</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">Electrical Rough - Site A</td>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><span style="background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 4px; font-size: 12px;">Pending</span></td>
                  <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Jan 12, 2026</td>
                </tr>
              </tbody>
            </table>
            <p style="margin: 8px 0 0 0; color: #64748b; font-size: 12px; font-style: italic;">
              Showing 3 of ${sampleStats.total} checklists (sample preview)
            </p>
          </div>
          ` : ''}

          ${includePdfAttachment ? `
          <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px 16px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0; color: #1e40af; font-size: 14px;">
              📎 <strong>PDF Attachment:</strong> A detailed PDF report is attached to this email.
            </p>
          </div>
          ` : ''}

          <div style="border-top: 1px solid #e2e8f0; padding-top: 24px; margin-top: 24px;">
            <p style="margin: 0; color: #64748b; font-size: 14px;">
              Best regards,<br>
              <strong style="color: ${primaryColor};">The ${headerText} Team</strong>
            </p>
          </div>
        </div>
        <p style="color: #64748b; font-size: 12px; margin-top: 24px; text-align: center;">
          ${footerText}
        </p>
        <p style="color: #94a3b8; font-size: 11px; margin-top: 8px; text-align: center;">
          This is a ${frequency} scheduled report. To modify or unsubscribe, contact your administrator.
        </p>
      </div>
    </div>
  `;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Email Preview
          </DialogTitle>
          <DialogDescription>
            Preview how the scheduled report email will appear to recipients
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="border rounded-lg overflow-hidden bg-muted/30">
              <div className="bg-muted px-4 py-2 border-b">
                <p className="text-sm"><strong>To:</strong> {displayEmail}{recipientEmail.includes(',') ? ` (+${recipientEmail.split(',').length - 1} more)` : ''}</p>
                <p className="text-sm"><strong>Subject:</strong> {subject}</p>
              </div>
              <ScrollArea className="h-[450px]">
                <div 
                  className="p-4"
                  dangerouslySetInnerHTML={{ __html: emailHtml }}
                />
              </ScrollArea>
            </div>

            <div className="flex justify-between items-center pt-4">
              <div className="text-sm text-muted-foreground space-y-1">
                <p>📊 Summary: {includeSummary ? 'Included' : 'Not included'}</p>
                <p>📋 Details: {includeDetails ? 'Included' : 'Not included'}</p>
                {includePdfAttachment && <p>📎 PDF attachment will be included</p>}
              </div>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close Preview
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Helper function to adjust color brightness
function adjustColor(color: string, percent: number): string {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (
    0x1000000 +
    (R < 255 ? (R < 0 ? 0 : R) : 255) * 0x10000 +
    (G < 255 ? (G < 0 ? 0 : G) : 255) * 0x100 +
    (B < 255 ? (B < 0 ? 0 : B) : 255)
  ).toString(16).slice(1);
}
