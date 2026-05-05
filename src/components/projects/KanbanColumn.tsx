import { AnimatePresence } from 'framer-motion';
import { Inbox } from 'lucide-react';
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
        'flex min-w-0 flex-col overflow-hidden rounded-xl border shadow-sm transition-[box-shadow,border-color,background-color] duration-200',
        isDragOver
          ? 'border-primary/45 bg-primary/[0.06] shadow-md ring-2 ring-primary/25'
          : 'border-cream-sunken bg-gradient-to-b from-card from-[8%] via-cream/28 via-[55%] to-cream-raised ring-1 ring-navy-deep/10'
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
      {/* Column header strip */}
      <div
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 border-b border-black/[0.06] px-3 py-2.5 dark:border-white/[0.06]',
          config.bgColor
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2 w-2 shrink-0 rounded-full shadow-sm', config.dotColor)} aria-hidden />
          <span className={cn('truncate font-tight text-[11px] font-semibold uppercase tracking-[0.14em]', config.color)}>
            {config.label}
          </span>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border-navy-deep/22 bg-card px-2 py-0 font-mono text-[11px] font-semibold tabular-nums tracking-tight text-ink-primary-light shadow-none"
        >
          {projects.length}
        </Badge>
      </div>

      {/* Cards + compact empty drop zone */}
      <div className="flex flex-col gap-2.5 p-2">
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

        {projects.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-navy-deep/22 bg-cream-raised/95 px-3 py-6 text-center ring-1 ring-navy-deep/[0.05]"
            role="status"
          >
            <Inbox className="h-8 w-8 text-navy/60" strokeWidth={1.25} aria-hidden />
            <p className="font-tight text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-deep">
              No projects
            </p>
            <p className="max-w-[12rem] font-sans text-[11px] leading-relaxed text-navy/72">
              Drop a card here or create one.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
