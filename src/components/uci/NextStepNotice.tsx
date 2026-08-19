import { ArrowRight, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UciDrawerTab } from "@/lib/uciNavSections";
import type { NextStepNoticeModel } from "@/lib/uciWorkspaceGuidance";
import { cn } from "@/lib/utils";

type NextStepNoticeProps = {
  notice: NextStepNoticeModel;
  activeTab: UciDrawerTab;
  onSelectTab?: (tab: UciDrawerTab) => void;
  className?: string;
};

/**
 * Contextual helper under the workflow navigator — stage / tab guidance only.
 */
export function NextStepNotice({
  notice,
  activeTab,
  onSelectTab,
  className,
}: NextStepNoticeProps) {
  const showJump =
    Boolean(notice.recommendedTab) &&
    notice.recommendedTab !== activeTab &&
    typeof onSelectTab === "function";

  return (
    <aside
      className={cn(
        "flex gap-3 rounded-xl border border-teal/25 bg-teal/[0.04] px-3.5 py-3",
        "dark:border-teal/30 dark:bg-teal/10",
        className,
      )}
      data-testid="uci-next-step-notice"
      aria-label="Next recommended step"
    >
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal/15 text-teal">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal">{notice.title}</p>
        <p className="text-sm leading-relaxed text-foreground">{notice.body}</p>
        {showJump && notice.recommendedTab ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 h-8 border-teal/35 bg-background/70 text-xs text-foreground hover:border-teal/50 hover:bg-teal/5"
            onClick={() => onSelectTab?.(notice.recommendedTab!)}
          >
            Go to {notice.recommendedLabel ?? notice.recommendedTab}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
