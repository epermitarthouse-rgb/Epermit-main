import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { History, RefreshCw } from "lucide-react";
import { useProjectActivity } from "@/hooks/useProjectActivity";
import { ActivityTimeline } from "./ActivityTimeline";

interface ProjectActivitySectionProps {
  projectId: string;
}

export function ProjectActivitySection({ projectId }: ProjectActivitySectionProps) {
  const { activities, loading, refetch } = useProjectActivity(projectId);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5 text-primary" />
            Activity
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={refetch}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ActivityTimeline activities={activities} loading={loading} />
      </CardContent>
    </Card>
  );
}
