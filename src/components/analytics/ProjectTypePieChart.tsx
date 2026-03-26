import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ProjectTypeMetrics } from '@/types/analytics';

interface ProjectTypePieChartProps {
  metrics: ProjectTypeMetrics[];
}

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const PROJECT_TYPE_LABELS: Record<string, string> = {
  new_construction: 'New Construction',
  renovation: 'Renovation',
  addition: 'Addition',
  tenant_improvement: 'Tenant Improvement',
  demolition: 'Demolition',
  other: 'Other',
};

export function ProjectTypePieChart({ metrics }: ProjectTypePieChartProps) {
  if (metrics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Permits by Type</CardTitle>
          <CardDescription>Distribution of permit applications by project type</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">No project data available</p>
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
    <Card>
      <CardHeader>
        <CardTitle>Permits by Type</CardTitle>
        <CardDescription>Distribution of permit applications by project type</CardDescription>
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
              fill="#8884d8"
              dataKey="value"
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string, props: any) => [
                `${value} permits`,
                props.payload.name,
              ]}
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-background border rounded-lg p-3 shadow-lg">
                      <p className="font-medium">{data.name}</p>
                      <p className="text-sm text-muted-foreground">{data.value} permits</p>
                      {data.avgCycleTime && (
                        <p className="text-sm text-muted-foreground">
                          Avg cycle: {data.avgCycleTime.toFixed(1)} days
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Approval rate: {data.approvalRate.toFixed(0)}%
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
