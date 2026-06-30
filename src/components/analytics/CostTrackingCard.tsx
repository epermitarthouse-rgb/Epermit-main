import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ProjectAnalytics } from '@/types/analytics';
import { cn } from '@/lib/utils';
import { DATA_INTELLIGENCE_PANEL } from '@/components/layout/editorialPageChrome';

interface CostTrackingCardProps {
  projects: ProjectAnalytics[];
}

const panel = cn(DATA_INTELLIGENCE_PANEL);

export function CostTrackingCard({ projects }: CostTrackingCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const byType = new Map<string, { permitFees: number; expeditorCosts: number; count: number }>();
  
  projects.forEach(p => {
    const type = p.project_type || 'Other';
    const current = byType.get(type) || { permitFees: 0, expeditorCosts: 0, count: 0 };
    byType.set(type, {
      permitFees: current.permitFees + (p.permit_fee || 0),
      expeditorCosts: current.expeditorCosts + (p.expeditor_cost || 0),
      count: current.count + 1,
    });
  });

  const data = Array.from(byType.entries())
    .map(([type, values]) => ({
      type: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      permitFees: values.permitFees,
      expeditorCosts: values.expeditorCosts,
      avgCost: values.count > 0 ? (values.permitFees + values.expeditorCosts) / values.count : 0,
    }))
    .sort((a, b) => (b.permitFees + b.expeditorCosts) - (a.permitFees + a.expeditorCosts))
    .slice(0, 6);

  if (data.length === 0 || data.every(d => d.permitFees === 0 && d.expeditorCosts === 0)) {
    return (
      <Card className={panel}>
        <CardHeader>
          <CardTitle className="text-foreground dark:text-ink-primary-dark">Cost per Permit by Type</CardTitle>
          <CardDescription className="text-muted-foreground dark:text-ink-secondary-dark">
            Permit fees and expeditor costs breakdown
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center">
            <p className="text-center text-muted-foreground dark:text-ink-tertiary-dark">
              No cost data available yet.<br />
              Add permit fees and expeditor costs to projects to see this chart.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={panel}>
      <CardHeader>
        <CardTitle className="text-foreground dark:text-ink-primary-dark">Cost per Permit by Type</CardTitle>
        <CardDescription className="text-muted-foreground dark:text-ink-secondary-dark">
          Permit fees and expeditor costs breakdown by project type
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart 
              data={data} 
              layout="vertical"
              margin={{ top: 20, right: 30, left: 100, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-teal/15" />
              <XAxis 
                type="number"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                stroke="hsl(var(--border))"
                tickFormatter={(value) => formatCurrency(value)}
              />
              <YAxis 
                type="category"
                dataKey="type"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                stroke="hsl(var(--border))"
                width={90}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--card))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  color: 'hsl(var(--foreground))',
                }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
              <Bar 
                dataKey="permitFees" 
                name="Permit Fees" 
                fill="hsl(var(--accent-teal))" 
                stackId="a"
                radius={[0, 0, 0, 0]}
              />
              <Bar 
                dataKey="expeditorCosts" 
                name="Expeditor Costs" 
                fill="hsl(var(--accent-gold))" 
                stackId="a"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
