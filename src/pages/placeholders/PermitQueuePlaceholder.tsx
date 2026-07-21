import { AlertBanner, PageHeader, Panel } from "@/components/design/ProductPrimitives";
import { EmptyState } from "@/components/design/EmptyState";
import { ListTodo } from "lucide-react";

/**
 * Visible placeholder (plan §3.5 / §12): Permit Queue.
 * No mock queue rows; actions that need BE remain disabled.
 */
export default function PermitQueuePlaceholder() {
  return (
    <div className="container-page space-y-6">
      <PageHeader
        eyebrow="Coming soon"
        title="Permit Queue"
        body="Aggregate view across filings and scrape jobs. This surface is not connected yet."
      />
      <AlertBanner
        tone="info"
        title="Not yet connected"
        detail="Future integration: query design over permit_filings and scrape_jobs (PD-8). Queue open/assign/complete actions stay disabled until a verified API exists."
      />
      <Panel title="Queue" eyebrow="Preview">
        <EmptyState
          icon={ListTodo}
          title="No live queue"
          body="Badge counts and job rows will appear only from real PermitPilot data — never mock inventory."
        />
      </Panel>
    </div>
  );
}
