import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatProjectAddressLine } from "@/lib/uciSetupWorkflow";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/project";

type UciProjectContextBarProps = {
  project: Project;
  mutedClass: string;
  onChangeProject: () => void;
  className?: string;
  compact?: boolean;
};

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

export function UciProjectContextBar({
  project,
  mutedClass,
  onChangeProject,
  className,
  compact = false,
}: UciProjectContextBarProps) {
  const permitLine = project.permit_number?.trim() || null;
  const addressLine = formatProjectAddressLine(project);
  const jurisdiction = project.jurisdiction?.trim() || null;
  const projectName = project.name?.trim() || null;
  const titleLine = permitLine ?? projectName ?? "Selected project";
  const subtitleParts = [
    projectName && permitLine ? projectName : null,
    addressLine,
    jurisdiction,
  ].filter(Boolean);
  const subtitle = subtitleParts.join(" · ");

  return (
    <div
      className={cn(
        "sticky top-0 z-20 rounded-xl border border-teal/25 bg-cream/95 px-4 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-cream/90",
        "dark:border-teal/30 dark:bg-obsidian/95 dark:supports-[backdrop-filter]:bg-obsidian/90",
        compact ? "py-2.5" : "py-3",
        className,
      )}
      data-testid="uci-project-context-bar"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-teal">UCI Project</p>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="truncate text-base font-semibold text-ink-primary-light dark:text-foreground">
                  {truncateText(titleLine, compact ? 48 : 64)}
                </p>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <p>{titleLine}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {subtitle ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className={cn("mt-1 truncate text-sm", mutedClass)}>
                    {truncateText(subtitle, compact ? 72 : 96)}
                  </p>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-sm">
                  <p>{subtitle}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <p className={cn("mt-1 text-sm", mutedClass)}>Project address not on file.</p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 self-start"
          onClick={onChangeProject}
          data-testid="uci-change-project-button"
        >
          Change project
        </Button>
      </div>
    </div>
  );
}
