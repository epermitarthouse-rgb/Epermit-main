import React, { useId, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared keyboard-accessible disclosure. Children mount only while expanded. */
export function AnalyzerDisclosure({
  expanded,
  onExpandedChange,
  header,
  children,
  testId,
  className,
  headerClassName,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  header: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
  headerClassName?: string;
}) {
  const panelId = useId();
  return (
    <div className={className} data-testid={testId} data-expanded={expanded ? "true" : "false"}>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          headerClassName,
        )}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => onExpandedChange(!expanded)}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">{header}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      <div id={panelId} hidden={!expanded}>
        {expanded ? children : null}
      </div>
    </div>
  );
}
