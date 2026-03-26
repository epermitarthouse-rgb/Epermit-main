import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuSeparator,
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  Building2, 
  MapPin, 
  Calendar, 
  DollarSign,
  MoreVertical,
  Edit,
  Trash2,
  ArrowRight,
  Eye,
  FileText
} from 'lucide-react';
import { format } from 'date-fns';
import { Project, PROJECT_STATUS_CONFIG, PROJECT_TYPE_LABELS, ProjectStatus, STATUS_ORDER } from '@/types/project';
import { cn } from '@/lib/utils';
import { SlaEstimateDisplay } from './SlaEstimateDisplay';

interface ProjectCardProps {
  project: Project;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
  onStatusChange: (project: Project, newStatus: ProjectStatus) => void;
  onView: (project: Project) => void;
  isDragging?: boolean;
}

export function ProjectCard({ 
  project, 
  onEdit, 
  onDelete, 
  onStatusChange,
  onView,
  isDragging = false 
}: ProjectCardProps) {
  const statusConfig = PROJECT_STATUS_CONFIG[project.status];
  const currentStatusIndex = STATUS_ORDER.indexOf(project.status);
  const nextStatus = STATUS_ORDER[currentStatusIndex + 1];
  const prevStatus = currentStatusIndex > 0 ? STATUS_ORDER[currentStatusIndex - 1] : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      whileHover={{ y: -2 }}
      className={cn(
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50"
      )}
    >
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm truncate">{project.name}</h3>
              {project.permit_number && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <FileText className="h-3 w-3" />
                  {project.permit_number}
                </p>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onView(project)}>
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(project)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {prevStatus && (
                  <DropdownMenuItem onClick={() => onStatusChange(project, prevStatus)}>
                    <ArrowRight className="mr-2 h-4 w-4 rotate-180" />
                    Move to {PROJECT_STATUS_CONFIG[prevStatus].label}
                  </DropdownMenuItem>
                )}
                {nextStatus && (
                  <DropdownMenuItem onClick={() => onStatusChange(project, nextStatus)}>
                    <ArrowRight className="mr-2 h-4 w-4" />
                    Move to {PROJECT_STATUS_CONFIG[nextStatus].label}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={() => onDelete(project)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {/* Project Type Badge */}
          {project.project_type && (
            <Badge variant="secondary" className="text-xs">
              {PROJECT_TYPE_LABELS[project.project_type]}
            </Badge>
          )}

          {/* Location */}
          {(project.city || project.state) && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span className="truncate">
                {[project.city, project.state].filter(Boolean).join(', ')}
              </span>
            </div>
          )}

          {/* Jurisdiction */}
          {project.jurisdiction && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3 w-3" />
              <span className="truncate">{project.jurisdiction}</span>
            </div>
          )}

          {/* Value */}
          {project.estimated_value && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              <span>${project.estimated_value.toLocaleString()}</span>
            </div>
          )}

          {/* Deadline */}
          {project.deadline && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>Due {format(new Date(project.deadline), 'MMM d, yyyy')}</span>
            </div>
          )}

          {/* SLA Estimate Badge */}
          {project.jurisdiction && project.status !== 'approved' && (
            <SlaEstimateDisplay
              jurisdictionName={project.jurisdiction}
              state={project.state}
              submittedAt={project.submitted_at}
              status={project.status}
              compact
            />
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs text-muted-foreground">
              Updated {format(new Date(project.updated_at), 'MMM d')}
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
