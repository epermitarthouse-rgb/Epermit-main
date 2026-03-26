import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { MonthlyMetrics } from '@/types/analytics';

interface CycleTimeChartProps {
  monthlyMetrics: MonthlyMetrics[];
}

export function CycleTimeChart({ monthlyMetrics }: CycleTimeChartProps) {
  const data = monthlyMetrics.map(m => ({
    ...m,
    avgCycleTime: m.avgCycleTime ? Number(m.avgCycleTime.toFixed(1)) : 0,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Activity & Cycle Time</CardTitle>
        <CardDescription>Monthly submissions, approvals, and average cycle time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="month" 
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
              />
              <YAxis 
                yAxisId="left"
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
              />
              <YAxis 
                yAxisId="right" 
                orientation="right"
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
                label={{ value: 'Days', angle: 90, position: 'insideRight' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--background))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar 
                yAxisId="left" 
                dataKey="submitted" 
                name="Submitted" 
                fill="hsl(var(--primary))" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                yAxisId="left" 
                dataKey="approved" 
                name="Approved" 
                fill="hsl(142.1, 76.2%, 36.3%)" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                yAxisId="right" 
                dataKey="avgCycleTime" 
                name="Avg Cycle (days)" 
                fill="hsl(38, 92%, 50%)" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
