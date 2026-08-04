import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  DATA_SOURCE_LABELS,
  MOCK_WORKFLOW_NOTICE,
  type DataSourceKind,
} from "@/lib/operations/operations-types";

const STYLES: Record<DataSourceKind, string> = {
  live: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  partial: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  mock: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  upcoming: "border-border bg-muted/60 text-muted-foreground",
};

const DEFAULT_DETAIL: Record<DataSourceKind, string> = {
  live: "Fully connected to real PermitPilot data for the selected project.",
  partial: "Real PermitPilot data with incomplete workflow coverage — not a full Monday-style ledger.",
  mock: MOCK_WORKFLOW_NOTICE,
  upcoming: "Visible for IA parity; not operational and does not write to the backend.",
};

export function DataSourceBadge({
  kind,
  className,
  detail,
}: {
  kind: DataSourceKind;
  className?: string;
  detail?: string;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              "rounded-md px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide",
              STYLES[kind],
              className,
            )}
          >
            {DATA_SOURCE_LABELS[kind]}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
          {detail ?? DEFAULT_DETAIL[kind]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
