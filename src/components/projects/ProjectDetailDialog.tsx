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
  Send
} from 'lucide-react';
import { format } from 'date-fns';
import { Project, PROJECT_STATUS_CONFIG, PROJECT_TYPE_LABELS } from '@/types/project';
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

interface ProjectDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project | null;
  onEdit: (project: Project) => void;
}

export function ProjectDetailDialog({
  open,
  onOpenChange,
  project,
  onEdit,
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-xl">{project.name}</DialogTitle>
              <DialogDescription className="flex items-center gap-2 mt-1">
                {project.permit_number && (
                  <>
                    <FileText className="h-4 w-4" />
                    {project.permit_number}
                  </>
                )}
              </DialogDescription>
            </div>
            <Badge className={`${statusConfig.bgColor} ${statusConfig.color} border-0`}>
              {statusConfig.label}
            </Badge>
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="w-full">
          <TabsList className="grid w-full grid-cols-8">
            <TabsTrigger value="details" className="flex items-center gap-1 text-xs sm:text-sm">
              <Info className="h-4 w-4" />
              <span className="hidden sm:inline">Details</span>
            </TabsTrigger>
            <TabsTrigger value="documents" className="flex items-center gap-1 text-xs sm:text-sm">
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Docs</span>
            </TabsTrigger>
            <TabsTrigger value="epermit" className="flex items-center gap-1 text-xs sm:text-sm">
              <Send className="h-4 w-4" />
              <span className="hidden sm:inline">E-Permit</span>
            </TabsTrigger>
            <TabsTrigger value="annotations" className="flex items-center gap-1 text-xs sm:text-sm">
              <PenTool className="h-4 w-4" />
              <span className="hidden sm:inline">Markup</span>
            </TabsTrigger>
            <TabsTrigger value="comments" className="flex items-center gap-1 text-xs sm:text-sm">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">Comments</span>
            </TabsTrigger>
            <TabsTrigger value="inspections" className="flex items-center gap-1 text-xs sm:text-sm">
              <ClipboardCheck className="h-4 w-4" />
              <span className="hidden sm:inline">Inspect</span>
            </TabsTrigger>
            <TabsTrigger value="team" className="flex items-center gap-1 text-xs sm:text-sm">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">Team</span>
            </TabsTrigger>
            <TabsTrigger value="activity" className="flex items-center gap-1 text-xs sm:text-sm">
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">Activity</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-6 mt-4">
            {/* Project Type & Badges */}
            <div className="flex flex-wrap gap-2">
              {project.project_type && (
                <Badge variant="secondary">
                  {PROJECT_TYPE_LABELS[project.project_type]}
                </Badge>
              )}
            </div>

            {/* Location Section */}
            {(project.address || project.city || project.jurisdiction) && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
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
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
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
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
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
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
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
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
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
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
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

          <TabsContent value="documents" className="mt-4">
            <ProjectDocumentsSection projectId={project.id} />
          </TabsContent>

          <TabsContent value="epermit" className="mt-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">E-Permit Submissions</h3>
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

          <TabsContent value="annotations" className="mt-4">
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

          <TabsContent value="comments" className="mt-4">
            <CommentThread projectId={project.id} />
          </TabsContent>

          <TabsContent value="inspections" className="mt-4">
            <ProjectInspectionsSection projectId={project.id} />
          </TabsContent>

          <TabsContent value="team" className="mt-4">
            <ProjectTeamSection projectId={project.id} projectOwnerId={project.user_id} />
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <ProjectActivitySection projectId={project.id} />
          </TabsContent>
        </Tabs>

        {/* Actions */}
        <div className="flex flex-wrap justify-end gap-2 pt-4 border-t">
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
            Submit to E-Permit
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
