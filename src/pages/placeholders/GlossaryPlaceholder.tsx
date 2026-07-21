import { AlertBanner, PageHeader, Panel } from "@/components/design/ProductPrimitives";
import { EmptyState } from "@/components/design/EmptyState";
import { BookMarked } from "lucide-react";

/**
 * Visible placeholder (plan §3.5 / §12): Glossary.
 * Coming soon until authored content ships; no fake glossary entries.
 */
export default function GlossaryPlaceholder() {
  return (
    <div className="container-page space-y-6">
      <PageHeader
        eyebrow="Coming soon"
        title="Glossary"
        body="Shared permit and utility terminology for teams. Content pack not connected yet."
      />
      <AlertBanner
        tone="info"
        title="Not yet connected"
        detail="Future integration: static markdown pack or CMS. Edit/publish controls remain disabled."
      />
      <Panel title="Terms" eyebrow="Resources">
        <EmptyState
          icon={BookMarked}
          title="Glossary content pending"
          body="No placeholder definitions are shown as production reference material."
        />
      </Panel>
    </div>
  );
}
