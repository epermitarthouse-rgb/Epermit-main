import { Link } from "react-router-dom";
import { BaltimoreLayout } from "@/components/baltimore/BaltimoreLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EDITORIAL_FORM_CARD } from "@/components/layout/editorialPageChrome";
import { Search } from "lucide-react";

export default function BaltimorePermitsPage() {
  return (
    <BaltimoreLayout activeModule="permits" permitsSubActive={null}>
      <Card className={EDITORIAL_FORM_CARD}>
        <CardHeader>
          <CardTitle className="text-ink-primary-light">Permits and Inspections</CardTitle>
          <CardDescription className="text-ink-secondary-light">
            Search for your permit and inspection records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ink-secondary-light">
            Find permits and inspections by record number or address. Click Search Applications to view the records list.
          </p>
          <Button variant="gold" asChild>
            <Link to="/baltimore/records">
              <Search className="mr-2 h-4 w-4" />
              Search Applications
            </Link>
          </Button>
        </CardContent>
      </Card>
    </BaltimoreLayout>
  );
}
