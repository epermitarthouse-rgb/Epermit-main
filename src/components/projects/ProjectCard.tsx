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

const cardPrimary = 'text-foreground dark:text-ink-primary-dark';
const cardSecondary = 'text-muted-foreground dark:text-ink-secondary-dark';

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
  const moneyValue =
    project.estimated_value ?? project.total_cost ?? project.contract_value ?? null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50'
      )}
    >
      <Card
        className={cn(
          'border-border bg-card transition-[box-shadow,border-color] duration-200',
          'shadow-sm hover:border-primary/40 hover:shadow-md hover:!translate-y-0 active:!translate-y-0',
          'dark:border-navy-line/40 dark:bg-gradient-to-b dark:from-navy-elev dark:to-navy-deep',
          'dark:shadow-[0_4px_20px_-6px_rgba(15,23,42,0.5)] dark:hover:shadow-[0_10px_28px_-8px_rgba(15,23,42,0.58)]',
          cardPrimary,
        )}
      >
        <CardHeader className="space-y-0 px-3 pb-2 pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className={cn('truncate font-sans text-sm font-semibold leading-snug tracking-tight', cardPrimary)}>
                {project.name}
              </h3>
              {project.permit_number ? (
                <p className={cn('mt-1 flex items-center gap-1 font-mono text-[11px] tabular-nums tracking-tight', cardSecondary)}>
                  <FileText className={cn('h-3 w-3 shrink-0', cardSecondary)} aria-hidden />
                  {project.permit_number}
                </p>
              ) : null}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-foreground hover:bg-muted dark:text-ink-primary-dark dark:hover:bg-white/[0.12]"
                >
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

          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge className={cn('border-0 font-tight text-[10px] font-semibold uppercase tracking-wide', statusConfig.bgColor, statusConfig.color)}>
              {statusConfig.label}
            </Badge>
            {project.project_type ? (
              <Badge variant="outline" className={cn('border-border/60 bg-muted/40 font-tight text-[10px] font-medium normal-case tracking-normal dark:border-white/20 dark:bg-white/10', cardPrimary)}>
                {PROJECT_TYPE_LABELS[project.project_type]}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3 pt-0">
          {(project.city || project.state) ? (
            <div className={cn('flex items-start gap-2 font-sans text-xs leading-snug', cardSecondary)}>
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-ink-secondary-dark" aria-hidden />
              <span className="min-w-0 truncate">{[project.city, project.state].filter(Boolean).join(', ')}</span>
            </div>
          ) : null}

          {project.jurisdiction ? (
            <div className={cn('flex items-start gap-2 font-sans text-xs leading-snug', cardSecondary)}>
              <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-ink-secondary-dark" aria-hidden />
              <span className="min-w-0 truncate">{project.jurisdiction}</span>
            </div>
          ) : null}

          {moneyValue != null ? (
            <div className={cn('flex items-center gap-2 font-sans text-xs', cardSecondary)}>
              <DollarSign className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className={cn('font-mono tabular-nums tracking-tight', cardPrimary)}>${moneyValue.toLocaleString()}</span>
            </div>
          ) : null}

          {project.deadline ? (
            <div className={cn('flex items-center gap-2 font-sans text-xs', cardSecondary)}>
              <Calendar className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className={cardSecondary}>Due </span>
                <span className={cn('font-mono tabular-nums', cardPrimary)}>{format(new Date(project.deadline), 'MMM d, yyyy')}</span>
              </span>
            </div>
          ) : null}

          {project.jurisdiction && project.status !== 'approved' && (
            <SlaEstimateDisplay
              jurisdictionName={project.jurisdiction}
              state={project.state}
              submittedAt={project.submitted_at}
              status={project.status}
              compact
            />
          )}

          <div className="flex items-center justify-between border-t border-border/40 pt-2 dark:border-white/[0.14]">
            <span className={cn('font-sans text-[11px]', cardSecondary)}>
              Updated{' '}
              <span className={cn('font-mono tabular-nums', cardPrimary)}>{format(new Date(project.updated_at), 'MMM d, yyyy')}</span>
            </span>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
