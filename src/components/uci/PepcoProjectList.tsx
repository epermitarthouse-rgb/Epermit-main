import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pepcoSyncStateLabel, type PepcoMergedProject } from "@/lib/pepcoApplicationDetailUi";
import { CheckCircle2, FileSearch, Loader2, MoreHorizontal, RefreshCw } from "lucide-react";

function syncStateBadgeVariant(
  state: PepcoMergedProject["syncState"],
): "secondary" | "ai" | "destructive" | "outline" {
  switch (state) {
    case "synced":
      return "ai";
    case "sync_failed":
      return "destructive";
    case "refresh_required":
      return "secondary";
    default:
      return "outline";
  }
}

function countChip(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

export type PepcoProjectListProps = {
  projects: PepcoMergedProject[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onScrapeProject: (project: PepcoMergedProject) => void;
  rowBusyKey: string | null;
  disableScrape: boolean;
  formatWhen: (iso: string | null | undefined) => string;
  mutedClass: string;
  sectionTitleClass: string;
};

export function PepcoProjectList({
  projects,
  selectedKey,
  onSelect,
  onScrapeProject,
  rowBusyKey,
  disableScrape,
  formatWhen,
  mutedClass,
  sectionTitleClass,
}: PepcoProjectListProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className={cn("text-sm font-semibold", sectionTitleClass)}>PEPCO Projects</p>
        {projects.length > 0 ? (
          <Badge variant="secondary">
            {projects.length} project{projects.length === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>
      {projects.length > 0 ? (
        <p className={cn("text-xs leading-snug", mutedClass)}>
          Select a project to review and synchronize its portal data.
        </p>
      ) : null}

      {projects.length === 0 ? (
        <div className={cn("rounded-md border border-border/60 px-3 py-4 text-xs", mutedClass)}>
          <p>No PEPCO dashboard projects have been loaded yet.</p>
          <p className="mt-1">Use PEPCO Actions → Discover dashboard projects.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {projects.map((project) => {
            const isSelected = project.key === selectedKey;
            const rowBusy = rowBusyKey === project.key;
            const scrapeDisabled = !project.canScrape || rowBusy || disableScrape;
            const hasDetail = Boolean(project.app);

            return (
              <li key={project.key}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`Select PEPCO project ${project.title}`}
                  onClick={() => onSelect(project.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(project.key);
                    }
                  }}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-2 shadow-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/50",
                    isSelected
                      ? "border-teal bg-teal/[0.08] ring-1 ring-teal/40 dark:border-teal/70 dark:bg-teal/[0.14]"
                      : cn(
                          "border-cream-sunken/70 bg-cream/60 hover:border-teal/35 hover:bg-cream-raised/60",
                          "dark:border-teal/20 dark:bg-obsidian/35 dark:hover:border-teal/40 dark:hover:bg-obsidian/55",
                        ),
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {isSelected ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-teal dark:text-teal-soft" aria-hidden />
                        ) : null}
                        <p className="truncate text-sm font-semibold text-foreground">{project.title}</p>
                      </div>
                      <p className={cn("mt-0.5 truncate text-xs leading-snug", mutedClass)}>
                        <span className="font-mono">{project.jobId ?? "—"}</span>
                        {project.address ? <> · {project.address}</> : null}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-[10px]">
                          {project.portalStatus ?? "Unknown status"}
                        </Badge>
                        <Badge variant={syncStateBadgeVariant(project.syncState)} className="text-[10px]">
                          {pepcoSyncStateLabel(project.syncState)}
                        </Badge>
                        {project.actionRequired ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Action required
                          </Badge>
                        ) : null}
                      </div>
                      {hasDetail ? (
                        <div className={cn("mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]", mutedClass)}>
                          <span>{countChip(project.statusUpdateCount, "status update")}</span>
                          <span>{countChip(project.messageCount, "message")}</span>
                          <span>{countChip(project.documentCount, "document")}</span>
                        </div>
                      ) : null}
                      <p className={cn("mt-1 truncate text-[10px] sm:hidden", mutedClass)}>
                        Scraped {formatWhen(project.lastScrapedAt)} · Updated{" "}
                        {formatWhen(project.portalUpdatedAt)}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <p className={cn("hidden whitespace-nowrap text-right text-[10px] leading-snug sm:block", mutedClass)}>
                        Scraped {formatWhen(project.lastScrapedAt)} · Updated{" "}
                        {formatWhen(project.portalUpdatedAt)}
                      </p>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={scrapeDisabled}
                            aria-label={`Actions for ${project.title}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {rowBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            disabled={scrapeDisabled}
                            title={
                              !project.canScrape
                                ? "This project has no PEPCO application id to scrape."
                                : scrapeDisabled
                                  ? "Wait for the current PEPCO operation to finish."
                                  : undefined
                            }
                            onSelect={() => onScrapeProject(project)}
                          >
                            {hasDetail ? (
                              <RefreshCw className="mr-2 h-4 w-4" />
                            ) : (
                              <FileSearch className="mr-2 h-4 w-4" />
                            )}
                            {hasDetail ? "Refresh Details" : "Scrape Details"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
