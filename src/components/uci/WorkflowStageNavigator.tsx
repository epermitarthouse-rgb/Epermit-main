import { Check, ChevronRight } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  UCI_DRAWER_TABS,
  UCI_RECORD_WORKSPACE_GROUPS,
  type UciDrawerTab,
} from "@/lib/uciNavSections";
import {
  formatWorkflowStageRange,
  getStageWorkspaceLinksForRange,
  getWorkflowGroupPrerequisite,
  getWorkflowGroupProgress,
  type WorkflowGroupProgress,
} from "@/lib/uciWorkspaceGuidance";
import { cn } from "@/lib/utils";

type WorkflowStageNavigatorProps = {
  activeTab: UciDrawerTab;
  currentStage: number;
  isPepcoCoordination: boolean;
  className?: string;
};

function progressStyles(progress: WorkflowGroupProgress, groupHasActiveTab: boolean) {
  if (groupHasActiveTab || progress === "current") {
    return {
      shell: "border-teal/45 bg-teal/5 shadow-sm dark:border-teal/40 dark:bg-teal/10",
      index: "bg-teal text-white",
      label: "text-foreground",
    };
  }
  if (progress === "completed") {
    return {
      shell: "border-success/25 bg-success/5 dark:border-success/30 dark:bg-success/10",
      index: "bg-success text-success-foreground",
      label: "text-foreground",
    };
  }
  if (progress === "support") {
    return {
      shell: "border-border/50 bg-muted/15 dark:border-border/60",
      index: "bg-muted text-muted-foreground",
      label: "text-muted-foreground",
    };
  }
  return {
    shell: "border-border/45 bg-background/50 opacity-90 dark:bg-muted/10",
    index: "bg-muted/80 text-muted-foreground",
    label: "text-muted-foreground",
  };
}

/**
 * Hierarchical workflow map for the record workspace.
 * Parent groups = milestones; child TabsTriggers keep existing tab routing.
 */
export function WorkflowStageNavigator({
  activeTab,
  currentStage,
  isPepcoCoordination,
  className,
}: WorkflowStageNavigatorProps) {
  const visibleGroups = UCI_RECORD_WORKSPACE_GROUPS.map((group) => {
    const tabs = UCI_DRAWER_TABS.filter(
      (tab) => group.tabs.includes(tab.id) && (!tab.pepcoOnly || isPepcoCoordination),
    );
    return { group, tabs };
  }).filter((entry) => entry.tabs.length > 0);

  return (
    <nav
      className={cn("space-y-3", className)}
      aria-label="Coordination workflow"
      data-testid="uci-workflow-stage-navigator"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base tracking-tight text-foreground">Workflow</h3>
        <p className="text-[11px] text-muted-foreground">Milestones → workspace steps</p>
      </div>

      <ol className="flex flex-col gap-0">
        {visibleGroups.map(({ group, tabs }, groupIndex) => {
          const progress = getWorkflowGroupProgress(group.stageRange, currentStage);
          const groupHasActiveTab = tabs.some((tab) => tab.id === activeTab);
          const styles = progressStyles(progress, groupHasActiveTab);
          const isLast = groupIndex === visibleGroups.length - 1;

          return (
            <li key={group.label} className="relative">
              {!isLast ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[1.15rem] top-10 h-[calc(100%-0.5rem)] w-px",
                    progress === "completed" ? "bg-success/40" : "bg-border/70",
                  )}
                />
              ) : null}

              <div
                className={cn(
                  "relative mb-2 rounded-xl border p-3 transition-colors last:mb-0",
                  styles.shell,
                  groupHasActiveTab && "ring-1 ring-teal/30",
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                      styles.index,
                    )}
                    aria-hidden
                  >
                    {progress === "completed" && !groupHasActiveTab ? (
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    ) : (
                      groupIndex + 1
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className={cn("text-sm font-semibold tracking-tight", styles.label)}>
                        {group.label}
                      </p>
                      {group.stageRange ? (
                        <span className="text-[10px] font-medium text-muted-foreground">
                          {formatWorkflowStageRange(group.stageRange)}
                        </span>
                      ) : null}
                      {progress === "current" || groupHasActiveTab ? (
                        <span className="rounded-md bg-teal/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal">
                          Current
                        </span>
                      ) : null}
                      {progress === "completed" && !groupHasActiveTab ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-success">
                          Completed
                        </span>
                      ) : null}
                      {progress === "upcoming" ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Upcoming
                        </span>
                      ) : null}
                      {progress === "support" ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Support
                        </span>
                      ) : null}
                    </div>

                    {progress === "upcoming" && group.stageRange ? (
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        {getWorkflowGroupPrerequisite({
                          stageRange: group.stageRange,
                          currentStage,
                        }) ?? "Preview downstream workspaces before this milestone is active."}
                      </p>
                    ) : null}

                    {progress === "upcoming" && group.stageRange ? (
                      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 bg-transparent p-0">
                        {getStageWorkspaceLinksForRange(group.stageRange).map((link) => {
                          const isActive = link.tab === activeTab;
                          return (
                            <TabsTrigger
                              key={`stage-${link.stage}`}
                              value={link.tab}
                              title={`Open ${link.label} workspace`}
                              className={cn(
                                "h-auto rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-none transition-all",
                                "border-border/60 bg-background/80 text-muted-foreground",
                                "hover:border-teal/35 hover:bg-teal/5 hover:text-foreground",
                                "focus-visible:ring-2 focus-visible:ring-teal/40",
                                "data-[state=active]:border-teal/50 data-[state=active]:bg-teal data-[state=active]:text-white data-[state=active]:shadow-sm",
                                "dark:border-border/70 dark:bg-card/60",
                                "dark:data-[state=active]:bg-teal dark:data-[state=active]:text-white",
                                isActive && "font-semibold",
                              )}
                            >
                              Open {link.label}
                            </TabsTrigger>
                          );
                        })}
                      </TabsList>
                    ) : (
                      <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1.5 bg-transparent p-0">
                        {tabs.map((tab, tabIndex) => {
                          const isActive = tab.id === activeTab;
                          return (
                            <div key={tab.id} className="flex items-center gap-1">
                              {tabIndex > 0 ? (
                                <ChevronRight
                                  className="hidden h-3 w-3 shrink-0 text-muted-foreground/70 sm:block"
                                  aria-hidden
                                />
                              ) : null}
                              <TabsTrigger
                                value={tab.id}
                                title={`${tab.workspace} workspace`}
                                className={cn(
                                  "h-auto rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-none transition-all",
                                  "border-border/60 bg-background/80 text-muted-foreground",
                                  "hover:border-teal/35 hover:bg-teal/5 hover:text-foreground",
                                  "focus-visible:ring-2 focus-visible:ring-teal/40",
                                  "data-[state=active]:border-teal/50 data-[state=active]:bg-teal data-[state=active]:text-white data-[state=active]:shadow-sm",
                                  "dark:border-border/70 dark:bg-card/60",
                                  "dark:data-[state=active]:bg-teal dark:data-[state=active]:text-white",
                                  isActive && "font-semibold",
                                )}
                              >
                                {tab.label}
                              </TabsTrigger>
                            </div>
                          );
                        })}
                      </TabsList>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
