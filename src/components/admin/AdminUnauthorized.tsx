import { Link } from "react-router-dom";
import { Shield, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AdminUnauthorizedProps {
  /** Short context for the denial message (e.g. "admin panel", "jurisdiction admin") */
  context?: string;
  /** Show a link back to dashboard */
  showBack?: boolean;
}

export function AdminUnauthorized({
  context = "this area",
  showBack = true,
}: AdminUnauthorizedProps) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex justify-center mb-2">
            <Shield className="h-16 w-16 text-muted-foreground" aria-hidden />
          </div>
          <CardTitle className="text-center text-xl">Access Denied</CardTitle>
          <CardDescription className="text-center">
            You don't have permission to access {context}. This section is restricted to administrators.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {showBack && (
            <Button variant="outline" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Dashboard
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
