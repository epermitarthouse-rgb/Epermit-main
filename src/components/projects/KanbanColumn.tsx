import { motion, AnimatePresence } from 'framer-motion';
import { Project, ProjectStatus, PROJECT_STATUS_CONFIG } from '@/types/project';
import { ProjectCard } from './ProjectCard';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface KanbanColumnProps {
  status: ProjectStatus;
  projects: Project[];
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
  onStatusChange: (project: Project, newStatus: ProjectStatus) => void;
  onView: (project: Project) => void;
  onDragStart: (project: Project) => void;
  onDragEnd: () => void;
  onDrop: (status: ProjectStatus) => void;
  isDragOver: boolean;
}

export function KanbanColumn({
  status,
  projects,
  onEdit,
  onDelete,
  onStatusChange,
  onView,
  onDragStart,
  onDragEnd,
  onDrop,
  isDragOver,
}: KanbanColumnProps) {
  const config = PROJECT_STATUS_CONFIG[status];

  return (
    <div
      className={cn(
        "flex flex-col min-h-[300px] sm:min-h-[500px] min-w-[260px] sm:min-w-0 rounded-lg border-2 transition-colors",
        isDragOver ? "border-accent bg-accent/5" : "border-transparent bg-muted/30"
      )}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(status);
      }}
    >
      {/* Column Header */}
      <div className={cn(
        "px-3 py-2 rounded-t-lg flex items-center justify-between",
        config.bgColor
      )}>
        <div className="flex items-center gap-2">
          <div className={cn("w-2 h-2 rounded-full", config.bgColor.replace('bg-', 'bg-').replace('100', '500'))} />
          <span className={cn("font-medium text-sm", config.color)}>
            {config.label}
          </span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {projects.length}
        </Badge>
      </div>

      {/* Cards Container */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {projects.map((project) => (
            <div
              key={project.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                onDragStart(project);
              }}
              onDragEnd={onDragEnd}
            >
              <ProjectCard
                project={project}
                onEdit={onEdit}
                onDelete={onDelete}
                onStatusChange={onStatusChange}
                onView={onView}
              />
            </div>
          ))}
        </AnimatePresence>

        {projects.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            No projects
          </div>
        )}
      </div>
    </div>
  );
}
