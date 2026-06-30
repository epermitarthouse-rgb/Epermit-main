import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ProjectTypeMetrics } from '@/types/analytics';
import { cn } from '@/lib/utils';
import { DATA_INTELLIGENCE_PANEL } from '@/components/layout/editorialPageChrome';

interface ProjectTypePieChartProps {
  metrics: ProjectTypeMetrics[];
}

const COLORS = [
  'hsl(var(--accent-teal))',
  'hsl(var(--accent-gold))',
  'hsl(35 72% 55%)',
  'hsl(0 72% 58%)',
  'hsl(262 55% 62%)',
  'hsl(330 65% 55%)',
];

const PROJECT_TYPE_LABELS: Record<string, string> = {
  new_construction: 'New Construction',
  renovation: 'Renovation',
  addition: 'Addition',
  tenant_improvement: 'Tenant Improvement',
  demolition: 'Demolition',
  other: 'Other',
};

const panel = cn(DATA_INTELLIGENCE_PANEL);

export function ProjectTypePieChart({ metrics }: ProjectTypePieChartProps) {
  if (metrics.length === 0) {
    return (
      <Card className={panel}>
        <CardHeader>
          <CardTitle className="text-foreground dark:text-ink-primary-dark">Permits by Type</CardTitle>
          <CardDescription className="text-muted-foreground dark:text-ink-secondary-dark">
            Distribution of permit applications by project type
          </CardDescription>
        </CardHeader>
        <CardContent className="flex h-64 items-center justify-center">
          <p className="text-muted-foreground dark:text-ink-tertiary-dark">No project data available</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = metrics.map(m => ({
    name: PROJECT_TYPE_LABELS[m.projectType] || m.projectType,
    value: m.count,
    avgCycleTime: m.avgCycleTime,
    approvalRate: m.approvalRate,
  }));

  return (
    <Card className={panel}>
      <CardHeader>
        <CardTitle className="text-foreground dark:text-ink-primary-dark">Permits by Type</CardTitle>
        <CardDescription className="text-muted-foreground dark:text-ink-secondary-dark">
          Distribution of permit applications by project type
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={100}
              dataKey="value"
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as typeof chartData[0];
                  return (
                    <div className="rounded-lg border border-border bg-card p-3 text-sm text-foreground shadow-lg dark:border-[hsl(var(--border-obsidian-strong)/0.5)] dark:bg-obsidian-raised dark:text-ink-primary-dark">
                      <p className="font-medium">{data.name}</p>
                      <p className="text-muted-foreground dark:text-ink-tertiary-dark">{data.value} permits</p>
                      {data.avgCycleTime && (
                        <p className="text-muted-foreground dark:text-ink-tertiary-dark">
                          Avg cycle: {data.avgCycleTime.toFixed(1)} days
                        </p>
                      )}
                      <p className="text-muted-foreground dark:text-ink-tertiary-dark">
                        Approval rate: {data.approvalRate.toFixed(0)}%
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
