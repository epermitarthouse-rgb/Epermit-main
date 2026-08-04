import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Marks a surface as illustrative demo content rather than real customer data.
 *
 * Applied to every page listed as `Fabricated` or `Mixed` in
 * `docs/data-provenance.md`. Real, DB-backed pages (auth, LOA, admin members,
 * audit log, contact form, analyzer inputs) intentionally do NOT render this.
 */
export type DemoDataBadgeProps = {
  className?: string;
  /** `inline` for page headers, `nav` for sidebar list items (smaller, muted). */
  variant?: "inline" | "nav";
  /** Override the default tooltip copy for surfaces with narrower demo scope. */
  detail?: string;
};

const DEFAULT_DETAIL =
  "This view uses illustrative content for demonstration. Real project data appears once workflows are live. See docs/data-provenance.md for the full audit.";

export const DemoDataBadge = ({ className, variant = "inline", detail }: DemoDataBadgeProps) => {
  const isNav = variant === "nav";
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="note"
            aria-label="Demo data — illustrative only"
            className={cn(
              "inline-flex select-none items-center gap-1 rounded-full border font-semibold uppercase tracking-wide",
              isNav
                ? "border-border/60 bg-muted/60 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                : "border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] text-accent",
              className,
            )}
          >
            <Info className={cn(isNav ? "h-2.5 w-2.5" : "h-3 w-3")} aria-hidden="true" />
            {isNav ? "Demo" : "Demo data · illustrative only"}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
          {detail ?? DEFAULT_DETAIL}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default DemoDataBadge;
