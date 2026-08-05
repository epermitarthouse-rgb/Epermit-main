import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Building2, 
  MapPin, 
  Calendar, 
  DollarSign, 
  Ruler,
  FileText,
  Clock,
  CheckCircle,
  Edit,
  FolderOpen,
  Info,
  Users,
  ClipboardCheck,
  History,
  Share2,
  MessageSquare,
  PenTool,
  Send,
  Receipt,
} from 'lucide-react';
import { format } from 'date-fns';
import { Project, PROJECT_STATUS_CONFIG, getProjectTypeLabel } from '@/types/project';
import { ProjectDocumentsSection } from '@/components/documents/ProjectDocumentsSection';
import { ProjectTeamSection } from '@/components/team/ProjectTeamSection';
import { ProjectInspectionsSection } from '@/components/inspections/ProjectInspectionsSection';
import { ProjectActivitySection } from '@/components/activity/ProjectActivitySection';
import { ShareProjectDialog } from './ShareProjectDialog';
import { SlaEstimateDisplay } from './SlaEstimateDisplay';
import { ProjectChatSidebar } from '@/components/collaboration/ProjectChatSidebar';
import { CommentThread } from '@/components/collaboration/CommentThread';
import { DocumentAnnotationCanvas } from '@/components/collaboration/DocumentAnnotationCanvas';
import { EPermitSubmitDialog } from '@/components/epermit/EPermitSubmitDialog';
import { EPermitStatusTracker } from '@/components/epermit/EPermitStatusTracker';
import { BillingInvoicePanel } from './BillingInvoicePanel';

function displayLine(value: string | null | undefined): string {
  const t = value?.trim();
  return t ? t : '—';
}

function displayMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

interface ProjectDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  onEdit: (project: Project) => void;
  /** Refetch single project after billing actions (e.g. QB draft created). */
  onProjectBillingRefresh?: () => Promise<void>;
}

export function ProjectDetailDialog({
  open,
  onOpenChange,
  project,
  onEdit,
  onProjectBillingRefresh,
}: ProjectDetailDialogProps) {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [chatSidebarOpen, setChatSidebarOpen] = useState(false);
  const [epermitDialogOpen, setEpermitDialogOpen] = useState(false);
  
  if (!project) return null;

  const statusConfig = PROJECT_STATUS_CONFIG[project.status];

  return (
    <>
      <ShareProjectDialog
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        project={project}
      />
      <EPermitSubmitDialog
        open={epermitDialogOpen}
        onOpenChange={setEpermitDialogOpen}
        project={project}
      />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={
          'flex max-h-[85vh] w-[calc(100%-2rem)] max-w-5xl flex-col gap-0 overflow-hidden ' +
          'border-border bg-card p-0 shadow-lg sm:rounded-lg'
        }
      >
        <div className="shrink-0 border-b border-border px-6 pb-4 pt-6 pr-14">
          <DialogHeader className="space-y-0 text-left">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <DialogTitle className="font-display text-xl font-normal leading-snug">{project.name}</DialogTitle>
                <DialogDescription className="mt-1 flex flex-wrap items-center gap-2">
                  {project.permit_number && (
                    <>
                      <FileText className="h-4 w-4 shrink-0" />
                      <span>{project.permit_number}</span>
                    </>
                  )}
                </DialogDescription>
              </div>
              <Badge className={`${statusConfig.bgColor} ${statusConfig.color} shrink-0 border-0`}>
                {statusConfig.label}
              </Badge>
            </div>
          </DialogHeader>
        </div>

        <Tabs
          defaultValue="details"
          className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
        >
          <div className="shrink-0 overflow-x-auto overflow-y-hidden border-b border-border bg-muted/25 px-3 py-2 sm:px-5">
            <TabsList className="inline-flex h-auto min-h-10 w-max flex-nowrap items-center justify-start gap-1 rounded-lg border border-border bg-muted/50 p-1">
              <TabsTrigger
                value="details"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <Info className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Details</span>
              </TabsTrigger>
              <TabsTrigger
                value="billing"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <Receipt className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Billing</span>
              </TabsTrigger>
              <TabsTrigger
                value="documents"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Docs</span>
              </TabsTrigger>
              <TabsTrigger
                value="epermit"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <Send className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Portal Submission</span>
              </TabsTrigger>
              <TabsTrigger
                value="annotations"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <PenTool className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Markup</span>
              </TabsTrigger>
              <TabsTrigger
                value="comments"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Comments</span>
              </TabsTrigger>
              <TabsTrigger
                value="inspections"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <ClipboardCheck className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Inspect</span>
              </TabsTrigger>
              <TabsTrigger
                value="team"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <Users className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Team</span>
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap px-2.5 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm"
              >
                <History className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">Activity</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          <TabsContent value="details" className="mt-0 space-y-6 pb-1 outline-none focus-visible:ring-0">
            {/* Project Type & Badges */}
            <div className="flex flex-wrap gap-2">
              {project.project_type && (
                <Badge variant="secondary">
                  {getProjectTypeLabel(project.project_type)}
                </Badge>
              )}
            </div>

            {/* Location Section */}
            {(project.address || project.city || project.jurisdiction) && (
              <div className="space-y-2">
                <h3 className="font-tight text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Location
                </h3>
                <div className="grid gap-2">
                  {project.address && (
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <span>
                        {project.address}
                        {project.city && `, ${project.city}`}
                        {project.state && `, ${project.state}`}
                        {project.zip_code && ` ${project.zip_code}`}
                      </span>
                    </div>
                  )}
                  {project.jurisdiction && (
                    <div className="flex items-center gap-2 text-sm">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>{project.jurisdiction}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <Separator />

            {/* Project Details */}
            <div className="space-y-2">
              <h3 className="font-tight text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Project Details
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                {project.estimated_value && (
                  <div className="flex items-center gap-2 text-sm">
                    <DollarSign className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Value:</span>
                    <span className="font-medium">${project.estimated_value.toLocaleString()}</span>
                  </div>
                )}
                {project.square_footage && (
                  <div className="flex items-center gap-2 text-sm">
                    <Ruler className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Size:</span>
                    <span className="font-medium">{project.square_footage.toLocaleString()} sq ft</span>
                  </div>
                )}
                {project.deadline && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Deadline:</span>
                    <span className="font-medium">{format(new Date(project.deadline), 'MMMM d, yyyy')}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Description */}
            {project.description && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-tight text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Description
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">{project.description}</p>
                </div>
              </>
            )}

            {/* Notes */}
            {project.notes && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-tight text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Notes
                  </h3>
                  <p className="text-sm whitespace-pre-wrap">{project.notes}</p>
                </div>
              </>
            )}

            {/* SLA Estimate */}
            {project.jurisdiction && project.status !== 'approved' && (
              <>
                <Separator />
                <div className="space-y-2">
                  <h3 className="font-tight text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Approval Timeline
                  </h3>
                  <SlaEstimateDisplay
                    jurisdictionName={project.jurisdiction}
                    state={project.state}
                    submittedAt={project.submitted_at}
                    status={project.status}
                  />
                </div>
              </>
            )}

            <Separator />

            {/* Timeline */}
            <div className="space-y-2">
              <h3 className="font-tight text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Timeline
              </h3>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Created:</span>
                  <span>{format(new Date(project.created_at), 'MMMM d, yyyy')}</span>
                </div>
                {project.submitted_at && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-blue-500" />
                    <span className="text-muted-foreground">Submitted:</span>
                    <span>{format(new Date(project.submitted_at), 'MMMM d, yyyy')}</span>
                  </div>
                )}
                {project.approved_at && (
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                    <span className="text-muted-foreground">Approved:</span>
                    <span>{format(new Date(project.approved_at), 'MMMM d, yyyy')}</span>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="billing" className="mt-0 space-y-4 pb-1 outline-none focus-visible:ring-0">
            <div className="space-y-2">
              <h3 className="font-tight text-xs font-bold uppercase tracking-[0.16em] text-foreground">
                Billing summary
              </h3>
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[11px] font-tight font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Client name
                    </p>
                    <p className="text-foreground">{displayLine(project.client_name)}</p>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[11px] font-tight font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Client email
                    </p>
                    <p className="break-all text-foreground">{displayLine(project.client_email)}</p>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[11px] font-tight font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Service type
                    </p>
                    <p className="text-foreground">{displayLine(project.service_type)}</p>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[11px] font-tight font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Contract value
                    </p>
                    <p className="text-foreground">{displayMoney(project.contract_value)}</p>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[11px] font-tight font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Reimbursement
                    </p>
                    <p className="text-foreground">{displayMoney(project.reimbursement_amount)}</p>
                  </div>
                  <div className="min-w-0 space-y-0.5 sm:col-span-2 lg:col-span-3">
                    <p className="text-[11px] font-tight font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Reimbursement description
                    </p>
                    <p className="whitespace-pre-wrap text-foreground">{displayLine(project.reimbursement_description)}</p>
                  </div>
                  <div className="min-w-0 space-y-0.5 sm:col-span-2 lg:col-span-3">
                    <p className="text-[11px] font-tight font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      QuickBooks customer ID
                    </p>
                    <p className="break-all font-mono text-xs text-foreground">{displayLine(project.qb_customer_id)}</p>
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            <BillingInvoicePanel project={project} onBillingRefresh={onProjectBillingRefresh} />
          </TabsContent>

          <TabsContent value="documents" className="mt-0 pb-1 outline-none focus-visible:ring-0">
            <ProjectDocumentsSection projectId={project.id} projectName={project.name} />
          </TabsContent>

          <TabsContent value="epermit" className="mt-0 space-y-4 pb-1 outline-none focus-visible:ring-0">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-tight text-sm font-semibold text-foreground">Portal Submissions</h3>
                  <p className="text-xs text-muted-foreground">
                    Track permit applications submitted to Accela or CityView
                  </p>
                </div>
                <Button size="sm" onClick={() => setEpermitDialogOpen(true)}>
                  <Send className="h-4 w-4 mr-1" />
                  New Submission
                </Button>
              </div>
              <EPermitStatusTracker projectId={project.id} />
            </div>
          </TabsContent>

          <TabsContent value="annotations" className="mt-0 space-y-4 pb-1 outline-none focus-visible:ring-0">
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Use the markup tools below to annotate project drawings. Your annotations are saved automatically and visible to team members.
              </p>
              <DocumentAnnotationCanvas
                projectId={project.id}
                width={600}
                height={400}
              />
            </div>
          </TabsContent>

          <TabsContent value="comments" className="mt-0 pb-1 outline-none focus-visible:ring-0">
            <CommentThread projectId={project.id} />
          </TabsContent>

          <TabsContent value="inspections" className="mt-0 pb-1 outline-none focus-visible:ring-0">
            <ProjectInspectionsSection projectId={project.id} />
          </TabsContent>

          <TabsContent value="team" className="mt-0 pb-1 outline-none focus-visible:ring-0">
            <ProjectTeamSection projectId={project.id} projectOwnerId={project.user_id} />
          </TabsContent>

          <TabsContent value="activity" className="mt-0 pb-1 outline-none focus-visible:ring-0">
            <ProjectActivitySection projectId={project.id} />
          </TabsContent>
          </div>
        </Tabs>

        {/* Actions */}
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-card px-4 py-4 sm:px-6">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="outline" onClick={() => setChatSidebarOpen(true)}>
            <MessageSquare className="mr-2 h-4 w-4" />
            Team Chat
          </Button>
          <Button variant="outline" onClick={() => setShareDialogOpen(true)}>
            <Share2 className="mr-2 h-4 w-4" />
            Share
          </Button>
          <Button variant="outline" onClick={() => setEpermitDialogOpen(true)}>
            <Send className="mr-2 h-4 w-4" />
            Submit to Portal
          </Button>
          <Button onClick={() => {
            onOpenChange(false);
            onEdit(project);
          }}>
            <Edit className="mr-2 h-4 w-4" />
            Edit Project
          </Button>
        </div>

        {/* Chat Sidebar */}
        <ProjectChatSidebar
          projectId={project.id}
          isOpen={chatSidebarOpen}
          onClose={() => setChatSidebarOpen(false)}
        />
      </DialogContent>
    </Dialog>
    </>
  );
}
