import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ProjectTypeMetrics } from '@/types/analytics';
import { cn } from '@/lib/utils';
import { DATA_INTELLIGENCE_PANEL } from '@/components/layout/editorialPageChrome';

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

const panel = cn(DATA_INTELLIGENCE_PANEL);

export function ProjectTypeBreakdownCard({ metrics }: ProjectTypeBreakdownCardProps) {
  if (metrics.length === 0) {
    return (
      <Card className={panel}>
        <CardHeader>
          <CardTitle className="text-foreground dark:text-ink-primary-dark">Project Type Breakdown</CardTitle>
          <CardDescription className="text-muted-foreground dark:text-ink-secondary-dark">Detailed metrics by project type</CardDescription>
        </CardHeader>
        <CardContent className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground dark:text-ink-tertiary-dark">No project type data available</p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...metrics.map(m => m.count));

  return (
    <Card className={panel}>
      <CardHeader>
        <CardTitle className="text-foreground dark:text-ink-primary-dark">Project Type Breakdown</CardTitle>
        <CardDescription className="text-muted-foreground dark:text-ink-secondary-dark">Detailed metrics by project type</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {metrics.map((metric) => (
          <div key={metric.projectType} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground dark:text-ink-primary-dark">
                {PROJECT_TYPE_LABELS[metric.projectType] || metric.projectType}
              </span>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Badge variant="outline" className="border-teal/30 text-muted-foreground dark:text-ink-secondary-dark">
                  {metric.count} permits
                </Badge>
                <Badge
                  variant={metric.approvalRate >= 50 ? 'outline' : 'destructive'}
                  className={
                    metric.approvalRate >= 80
                      ? 'border-teal/35 bg-teal/15 text-teal'
                      : metric.approvalRate >= 50
                        ? 'border-gold/35 bg-gold/10 text-gold'
                        : ''
                  }
                >
                  {metric.approvalRate.toFixed(0)}% approved
                </Badge>
              </div>
            </div>
            <Progress value={(metric.count / maxCount) * 100} className="h-2" />
            <div className="flex justify-between text-sm text-muted-foreground dark:text-ink-tertiary-dark">
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
