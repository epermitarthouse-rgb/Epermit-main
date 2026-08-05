import { Link } from "react-router-dom";
import { BaltimoreLayout } from "@/components/baltimore/BaltimoreLayout";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design/ProductPrimitives";
import { Search } from "lucide-react";

export default function BaltimorePortalHome() {
  return (
    <BaltimoreLayout activeModule="home">
      <Panel
        eyebrow="City of Baltimore"
        title="Permits and Inspections"
      >
        <p className="text-sm text-muted-foreground mb-4">
          Search and view permit and inspection records for the City of Baltimore. Use Search
          Applications to find your permits and inspections by record number or address.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="default" asChild>
            <Link to="/baltimore/permits">
              <Search className="mr-2 h-4 w-4" />
              Permits and Inspections
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/baltimore/records">Search Applications</Link>
          </Button>
        </div>
      </Panel>
    </BaltimoreLayout>
  );
}
