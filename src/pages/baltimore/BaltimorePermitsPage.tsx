import { Link } from "react-router-dom";
import { BaltimoreLayout } from "@/components/baltimore/BaltimoreLayout";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/design/ProductPrimitives";
import { Search } from "lucide-react";

export default function BaltimorePermitsPage() {
  return (
    <BaltimoreLayout activeModule="permits" permitsSubActive={null}>
      <Panel eyebrow="Permits" title="Permits and Inspections">
        <p className="text-sm text-muted-foreground mb-4">
          Search for your permit and inspection records. Find permits and inspections by record
          number or address. Click Search Applications to view the records list.
        </p>
        <Button variant="default" asChild>
          <Link to="/baltimore/records">
            <Search className="mr-2 h-4 w-4" />
            Search Applications
          </Link>
        </Button>
      </Panel>
    </BaltimoreLayout>
  );
}
