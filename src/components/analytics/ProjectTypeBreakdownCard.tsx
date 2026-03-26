import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ProjectTypeMetrics } from '@/types/analytics';

interface ProjectTypeBreakdownCardProps {
  metrics: ProjectTypeMetrics[];
}

const PROJECT_TYPE_LABELS: Record<string, string> = {
  new_construction: 'New Construction',
  renovation: 'Renovation',
  addition: 'Addition',
  tenant_improvement: 'Tenant Improvement',
  demolition: 'Demolition',
  other: 'Other',
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export function ProjectTypeBreakdownCard({ metrics }: ProjectTypeBreakdownCardProps) {
  if (metrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Project Type Breakdown</CardTitle>
          <CardDescription>Detailed metrics by project type</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">No project type data available</p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...metrics.map(m => m.count));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Type Breakdown</CardTitle>
        <CardDescription>Detailed metrics by project type</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {metrics.map((metric) => (
          <div key={metric.projectType} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium">
                {PROJECT_TYPE_LABELS[metric.projectType] || metric.projectType}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{metric.count} permits</Badge>
                <Badge 
                  variant={metric.approvalRate >= 80 ? 'default' : metric.approvalRate >= 50 ? 'secondary' : 'destructive'}
                >
                  {metric.approvalRate.toFixed(0)}% approved
                </Badge>
              </div>
            </div>
            <Progress value={(metric.count / maxCount) * 100} className="h-2" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                Avg cycle: {metric.avgCycleTime ? `${metric.avgCycleTime.toFixed(1)} days` : 'N/A'}
              </span>
              <span>Total cost: {formatCurrency(metric.totalCost)}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
