import { Construction } from "lucide-react";
import { AlertBanner, Panel } from "@/components/design/ProductPrimitives";
import type { UciNavSection } from "@/lib/uciNavSections";

/**
 * Honest foundation preview for UCI areas without a complete backend.
 * Never simulates records, saves, or successful operations.
 */
export function UciComingSoonPanel({ section }: { section: UciNavSection }) {
  const Icon = section.icon;
  return (
    <Panel
      id={`uci-coming-soon-${section.id}`}
      eyebrow="Foundation"
      title={section.label}
      className="border-dashed"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
          <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <AlertBanner tone="warn" title="Foundation · not yet connected">
            {section.note ??
              "This area has a structural home but no complete PermitPilot backend yet."}
          </AlertBanner>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Construction className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              No mock records, fake actions, or simulated submissions are available from this
              panel. Use the project command center and coordination-record workspace for live UCI work.
            </span>
          </p>
        </div>
      </div>
    </Panel>
  );
}
