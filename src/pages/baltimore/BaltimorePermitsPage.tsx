import { Link } from "react-router-dom";
import { BaltimoreLayout } from "@/components/baltimore/BaltimoreLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export default function BaltimorePermitsPage() {
  return (
    <BaltimoreLayout activeModule="permits" permitsSubActive={null}>
      <Card>
        <CardHeader>
          <CardTitle>Permits and Inspections</CardTitle>
          <CardDescription>
            Search for your permit and inspection records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Find permits and inspections by record number or address. Click Search Applications to view the records list.
          </p>
          <Button asChild>
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
