import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { MonthlyMetrics } from '@/types/analytics';
import { cn } from '@/lib/utils';
import { DATA_INTELLIGENCE_PANEL } from '@/components/layout/editorialPageChrome';

interface CycleTimeChartProps {
  monthlyMetrics: MonthlyMetrics[];
}

export function CycleTimeChart({ monthlyMetrics }: CycleTimeChartProps) {
  const data = monthlyMetrics.map(m => ({
    ...m,
    avgCycleTime: m.avgCycleTime ? Number(m.avgCycleTime.toFixed(1)) : 0,
  }));

  return (
    <Card className={cn(DATA_INTELLIGENCE_PANEL)}>
      <CardHeader>
        <CardTitle className="text-ink-primary-dark">Project Activity & Cycle Time</CardTitle>
        <CardDescription className="text-ink-secondary-dark">Monthly submissions, approvals, and average cycle time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-teal/15" />
              <XAxis 
                dataKey="month" 
                className="text-xs"
                stroke="hsl(var(--ink-tertiary-dark))"
                tick={{ fill: 'hsl(var(--ink-secondary-dark))', fontSize: 12 }}
              />
              <YAxis 
                yAxisId="left"
                className="text-xs"
                stroke="hsl(var(--ink-tertiary-dark))"
                tick={{ fill: 'hsl(var(--ink-secondary-dark))', fontSize: 12 }}
              />
              <YAxis 
                yAxisId="right" 
                orientation="right"
                className="text-xs"
                stroke="hsl(var(--ink-tertiary-dark))"
                tick={{ fill: 'hsl(var(--ink-secondary-dark))', fontSize: 12 }}
                label={{ value: 'Days', angle: 90, position: 'insideRight', fill: 'hsl(var(--ink-secondary-dark))' }}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(219 42% 16%)',
                  border: '1px solid hsl(var(--border-obsidian-strong) / 0.5)',
                  borderRadius: '8px',
                  color: 'hsl(var(--ink-primary-dark))',
                }}
              />
              <Legend wrapperStyle={{ color: 'hsl(var(--ink-secondary-dark))' }} />
              <Bar 
                yAxisId="left" 
                dataKey="submitted" 
                name="Submitted" 
                fill="hsl(var(--accent-teal))" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                yAxisId="left" 
                dataKey="approved" 
                name="Approved" 
                fill="hsl(var(--accent-gold))" 
                radius={[4, 4, 0, 0]}
              />
              <Bar 
                yAxisId="right" 
                dataKey="avgCycleTime" 
                name="Avg Cycle (days)" 
                fill="hsl(168 50% 45%)" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
