import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatProjectAddressLine } from "@/lib/uciSetupWorkflow";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/project";
import type { UtilityProvider } from "@/types/uci";

type ProjectSummaryHeaderProps = {
  project: Project;
  provider?: UtilityProvider | null;
  utilityType?: string | null;
  recordId?: string | null;
  mutedClass: string;
  onChangeProject: () => void;
  className?: string;
};

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function titleCaseUtilityType(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Record-workspace project chrome: name primary, provider/address secondary,
 * change-project as a quiet action, optional metadata chips.
 */
export function ProjectSummaryHeader({
  project,
  provider,
  utilityType,
  recordId,
  mutedClass,
  onChangeProject,
  className,
}: ProjectSummaryHeaderProps) {
  const projectName = project.name?.trim() || "Untitled project";
  const permitLine = project.permit_number?.trim() || null;
  const addressLine = formatProjectAddressLine(project);
  const jurisdiction = project.jurisdiction?.trim() || null;
  const providerName =
    provider?.display_name?.trim() ||
    provider?.name?.trim() ||
    provider?.canonical_name?.trim() ||
    null;
  const resolvedUtilityType = titleCaseUtilityType(utilityType ?? provider?.utility_type);
  const secondaryParts = [providerName, addressLine].filter(Boolean);
  const secondary = secondaryParts.join(" · ");

  const chips = [
    providerName ? { key: "provider", label: providerName } : null,
    jurisdiction ? { key: "jurisdiction", label: jurisdiction } : null,
    resolvedUtilityType ? { key: "utility", label: resolvedUtilityType } : null,
    permitLine ? { key: "permit", label: `Permit ${permitLine}` } : null,
  ].filter(Boolean) as Array<{ key: string; label: string }>;

  const showRecordId = Boolean(recordId && recordId.length <= 12);

  return (
    <div
      className={cn(
        "rounded-xl border border-teal/20 bg-gradient-to-br from-cream/90 via-card to-card px-4 py-3.5 shadow-sm",
        "dark:border-teal/25 dark:from-obsidian/80 dark:via-card dark:to-card",
        className,
      )}
      data-testid="uci-project-summary-header"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-teal">
            Coordination project
          </p>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <h2 className="truncate font-display text-xl font-normal tracking-tight text-foreground md:text-2xl">
                  {truncateText(projectName, 64)}
                </h2>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start">
                <p>{projectName}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {secondary ? (
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className={cn("truncate text-sm", mutedClass)}>
                    {truncateText(secondary, 96)}
                  </p>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-sm">
                  <p>{secondary}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <p className={cn("text-sm", mutedClass)}>Provider and address not on file.</p>
          )}
          {chips.length > 0 || showRecordId ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {chips.map((chip) => (
                <Badge
                  key={chip.key}
                  variant="outline"
                  className="max-w-[14rem] truncate border-border/70 bg-background/60 text-[10px] font-medium text-foreground"
                  title={chip.label}
                >
                  {chip.label}
                </Badge>
              ))}
              {showRecordId ? (
                <Badge
                  variant="outline"
                  className="border-dashed border-border/60 bg-transparent text-[10px] font-normal text-muted-foreground"
                  title={recordId ?? undefined}
                >
                  Record {recordId}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 self-start px-2.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onChangeProject}
          data-testid="uci-change-project-button"
        >
          Change project
        </Button>
      </div>
    </div>
  );
}
