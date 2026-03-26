import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { RejectionTrend } from '@/types/analytics';

interface RejectionTrendsChartProps {
  trends: RejectionTrend[];
}

const COLORS = [
  'hsl(0, 84%, 60%)',      // Red
  'hsl(38, 92%, 50%)',     // Orange/Amber
  'hsl(221, 83%, 53%)',    // Blue
  'hsl(262, 83%, 58%)',    // Purple
  'hsl(142, 71%, 45%)',    // Green
  'hsl(174, 84%, 32%)',    // Teal
  'hsl(339, 80%, 50%)',    // Pink
  'hsl(25, 95%, 53%)',     // Orange
];

export function RejectionTrendsChart({ trends }: RejectionTrendsChartProps) {
  if (trends.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Rejection Reason Trends</CardTitle>
          <CardDescription>Common reasons for permit corrections</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center">
            <p className="text-muted-foreground text-center">
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
    <Card>
      <CardHeader>
        <CardTitle>Rejection Reason Trends</CardTitle>
        <CardDescription>Most common reasons for permit corrections and resubmissions</CardDescription>
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
                  backgroundColor: 'hsl(var(--background))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number, name: string) => [`${value} occurrences`, name]}
              />
              <Legend 
                layout="vertical" 
                align="right" 
                verticalAlign="middle"
                formatter={(value) => <span className="text-sm">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
