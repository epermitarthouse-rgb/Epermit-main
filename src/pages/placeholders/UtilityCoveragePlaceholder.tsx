import { AlertBanner, PageHeader, Panel } from "@/components/design/ProductPrimitives";
import { EmptyState } from "@/components/design/EmptyState";
import { Network } from "lucide-react";

/**
 * Visible placeholder (Resources › Utility Coverage).
 * Coming Soon until the static East Coast coverage pack is ported with an EIA caveat.
 * Not a substitute for Jurisdiction Map / Provider Compare.
 */
export default function UtilityCoveragePlaceholder() {
  return (
    <div className="container-page space-y-6">
      <PageHeader
        eyebrow="Coming soon"
        title="Utility Coverage"
        body="East Coast utility coverage directory and findings. Static reference pack not connected yet."
      />
      <AlertBanner
        tone="info"
        title="Not yet connected"
        detail="Future integration: authored utilityProviders reference pack with sourcing caveat (EIA / internal). Live Jurisdiction Map and Provider Compare remain under Intelligence — this page will not overlay fake coverage on Mapbox."
      />
      <Panel title="Coverage directory" eyebrow="Resources">
        <EmptyState
          icon={Network}
          title="Coverage content pending"
          body="No placeholder KPIs or provider rows are shown as production coverage analysis."
        />
      </Panel>
    </div>
  );
}
