import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ProjectAnalytics } from '@/types/analytics';

interface CostTrackingCardProps {
  projects: ProjectAnalytics[];
}

export function CostTrackingCard({ projects }: CostTrackingCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Group by project type
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
      <Card>
        <CardHeader>
          <CardTitle>Cost per Permit by Type</CardTitle>
          <CardDescription>Permit fees and expeditor costs breakdown</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center">
            <p className="text-muted-foreground text-center">
              No cost data available yet.<br />
              Add permit fees and expeditor costs to projects to see this chart.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost per Permit by Type</CardTitle>
        <CardDescription>Permit fees and expeditor costs breakdown by project type</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart 
              data={data} 
              layout="vertical"
              margin={{ top: 20, right: 30, left: 100, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                type="number"
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => formatCurrency(value)}
              />
              <YAxis 
                type="category"
                dataKey="type"
                className="text-xs fill-muted-foreground"
                tick={{ fontSize: 12 }}
                width={90}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'hsl(var(--background))', 
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
                formatter={(value: number) => formatCurrency(value)}
              />
              <Legend />
              <Bar 
                dataKey="permitFees" 
                name="Permit Fees" 
                fill="hsl(var(--primary))" 
                stackId="a"
                radius={[0, 0, 0, 0]}
              />
              <Bar 
                dataKey="expeditorCosts" 
                name="Expeditor Costs" 
                fill="hsl(262, 83%, 58%)" 
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
