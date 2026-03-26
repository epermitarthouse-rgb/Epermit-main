import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useEmailBranding } from '@/hooks/useEmailBranding';
import { Loader2, Send, Eye } from 'lucide-react';

interface ChecklistSummary {
  projectName: string;
  checklistCount: number;
  stats: {
    completed: number;
    inProgress: number;
    pending: number;
  };
}

interface EmailPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  intro: string;
  summary: ChecklistSummary;
  onSend: () => void;
  sending: boolean;
}

export function EmailPreviewDialog({
  open,
  onOpenChange,
  recipientEmail,
  recipientName,
  subject,
  intro,
  summary,
  onSend,
  sending,
}: EmailPreviewDialogProps) {
  const { settings, loading } = useEmailBranding();

  const primaryColor = settings?.primary_color || '#0f4c5c';
  const headerText = settings?.header_text || 'Insight|DesignCheck';
  const logoUrl = settings?.logo_url;
  const footerText = settings?.footer_text || '© 2025 Insight|DesignCheck. All rights reserved.';

  const emailHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, ${primaryColor} 0%, ${adjustColor(primaryColor, 20)} 100%); padding: 32px; border-radius: 12px 12px 0 0;">
        ${logoUrl 
          ? `<img src="${logoUrl}" alt="Logo" style="max-height: 50px; max-width: 200px;" />`
          : `<h1 style="color: white; margin: 0; font-size: 24px;">${headerText}</h1>`
        }
        <h2 style="color: white; margin: 16px 0 0 0; font-size: 18px; font-weight: normal; opacity: 0.9;">
          Inspection Checklists Report
        </h2>
      </div>
      <div style="background: #f8fafc; padding: 32px; border-radius: 0 0 12px 12px;">
        <div style="background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
            Hi${recipientName ? ` ${recipientName}` : ''},
          </p>
          <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
            ${intro || `Please find attached your inspection checklists report for <strong>${summary.projectName}</strong>.`}
          </p>
          <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 24px 0;">
            <p style="margin: 0; color: #64748b; font-size: 14px;">
              <strong>Report Summary:</strong><br>
              • Project: ${summary.projectName}<br>
              • Checklists Included: ${summary.checklistCount}<br>
              • Completed: ${summary.stats.completed}<br>
              • In Progress: ${summary.stats.inProgress}<br>
              • Pending: ${summary.stats.pending}<br>
              • Generated: ${new Date().toLocaleDateString('en-US', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>
          <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6;">
            The PDF report is attached to this email.
          </p>
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
            Preview how your email will appear to {recipientEmail}
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
                <p className="text-sm"><strong>To:</strong> {recipientEmail}</p>
                <p className="text-sm"><strong>Subject:</strong> {subject || `Inspection Checklists Report - ${summary.projectName}`}</p>
              </div>
              <ScrollArea className="h-[400px]">
                <div 
                  className="p-4"
                  dangerouslySetInnerHTML={{ __html: emailHtml }}
                />
              </ScrollArea>
            </div>

            <div className="flex justify-between items-center pt-4">
              <p className="text-sm text-muted-foreground">
                📎 Attachment: {summary.projectName.replace(/[^a-zA-Z0-9]/g, '_')}_checklists.pdf
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button onClick={onSend} disabled={sending}>
                  {sending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send Email
                </Button>
              </div>
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
