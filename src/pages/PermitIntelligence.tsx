import { ShovelsPermitSearch } from '@/components/shovels/ShovelsPermitSearch';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Database, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';

export default function PermitIntelligence() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <>
      <div className="w-full max-w-7xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-4 sm:py-6 md:py-8">
        <div className="flex items-center gap-3 mb-2">
          <Database className="h-8 w-8 text-primary" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold">Permit Intelligence</h1>
              <Badge variant="secondary" className="text-xs">
                Powered by Shovels
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Real-time commercial permit data and contractor intelligence
            </p>
          </div>
        </div>

        <Card className="mb-6 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
          <CardContent className="py-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live Data</span>
              </div>
              <span className="text-muted-foreground">
                Search permits and contractors across the United States • Filter by jurisdiction, type, and value
              </span>
            </div>
          </CardContent>
        </Card>

        <ShovelsPermitSearch />
      </div>
    </>
  );
}
