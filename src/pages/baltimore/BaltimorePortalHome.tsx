import { Link } from "react-router-dom";
import { BaltimoreLayout } from "@/components/baltimore/BaltimoreLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

export default function BaltimorePortalHome() {
  return (
    <BaltimoreLayout activeModule="home">
      <Card>
        <CardHeader>
          <CardTitle>Baltimore — Permits and Inspections</CardTitle>
          <CardDescription>
            Search and view permit and inspection records for the City of Baltimore.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Use Search Applications to find your permits and inspections by record number or address.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link to="/baltimore/permits">
                <Search className="mr-2 h-4 w-4" />
                Permits and Inspections
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/baltimore/records">Search Applications</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </BaltimoreLayout>
  );
}
