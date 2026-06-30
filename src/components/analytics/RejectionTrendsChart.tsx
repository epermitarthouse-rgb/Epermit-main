import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { RejectionTrend } from '@/types/analytics';
import { cn } from '@/lib/utils';
import { DATA_INTELLIGENCE_PANEL } from '@/components/layout/editorialPageChrome';

interface RejectionTrendsChartProps {
  trends: RejectionTrend[];
}

const COLORS = [
  'hsl(0, 72%, 55%)',
  'hsl(var(--accent-gold))',
  'hsl(var(--accent-teal))',
  'hsl(262, 50%, 65%)',
  'hsl(142, 55%, 45%)',
  'hsl(174, 60%, 38%)',
  'hsl(339, 70%, 55%)',
  'hsl(32, 72%, 52%)',
];

const panel = cn(DATA_INTELLIGENCE_PANEL);

export function RejectionTrendsChart({ trends }: RejectionTrendsChartProps) {
  if (trends.length === 0) {
    return (
      <Card className={panel}>
        <CardHeader>
          <CardTitle className="text-foreground dark:text-ink-primary-dark">Rejection Reason Trends</CardTitle>
          <CardDescription className="text-muted-foreground dark:text-ink-secondary-dark">Common reasons for permit corrections</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-center text-muted-foreground dark:text-ink-tertiary-dark">
              No rejection data available yet.<br />
              Rejection reasons will appear here when projects receive corrections.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const data = trends.slice(0, 8).map(t => ({
    name: t.reason,
    value: t.count,
    percentage: t.percentage,
  }));

  return (
    <Card className={panel}>
      <CardHeader>
        <CardTitle className="text-foreground dark:text-ink-primary-dark">Rejection Reason Trends</CardTitle>
        <CardDescription className="text-muted-foreground dark:text-ink-secondary-dark">
          Most common reasons for permit corrections and resubmissions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
                label={({ name, percentage }) => `${name}: ${percentage.toFixed(0)}%`}
                labelLine={false}
              >
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  color: 'hsl(var(--foreground))',
                }}
                formatter={(value: number, name: string) => [`${value} occurrences`, name]}
              />
              <Legend 
                layout="vertical" 
                align="right" 
                verticalAlign="middle"
                formatter={(value) => <span className="text-sm text-muted-foreground dark:text-ink-secondary-dark">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
