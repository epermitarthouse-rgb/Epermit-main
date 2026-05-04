import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { JurisdictionTrend } from '@/types/analytics';
import { cn } from '@/lib/utils';
import { DATA_INTELLIGENCE_PANEL } from '@/components/layout/editorialPageChrome';

interface JurisdictionTrendsChartProps {
  trends: JurisdictionTrend[];
}

const panel = cn(DATA_INTELLIGENCE_PANEL);

export function JurisdictionTrendsChart({ trends }: JurisdictionTrendsChartProps) {
  if (trends.length === 0) {
    return (
      <Card className={cn(panel, 'col-span-full')}>
        <CardHeader>
          <CardTitle className="text-ink-primary-dark">Permit Trends by Jurisdiction</CardTitle>
          <CardDescription className="text-ink-secondary-dark">Comparison of permit activity across jurisdictions</CardDescription>
        </CardHeader>
        <CardContent className="flex h-64 items-center justify-center">
          <p className="text-ink-tertiary-dark">No jurisdiction data available</p>
        </CardContent>
      </Card>
    );
  }

  const topJurisdictions = trends.slice(0, 8);

  return (
    <Card className={cn(panel, 'col-span-full')}>
      <CardHeader>
        <CardTitle className="text-ink-primary-dark">Permit Trends by Jurisdiction</CardTitle>
        <CardDescription className="text-ink-secondary-dark">
          Comparison of permit activity across top jurisdictions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={topJurisdictions} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-teal/15" />
            <XAxis
              type="number"
              tick={{ fill: 'hsl(var(--ink-secondary-dark))', fontSize: 12 }}
              stroke="hsl(var(--ink-tertiary-dark))"
            />
            <YAxis
              type="category"
              dataKey="jurisdiction"
              width={120}
              tick={{ fill: 'hsl(var(--ink-secondary-dark))', fontSize: 12 }}
              stroke="hsl(var(--ink-tertiary-dark))"
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as JurisdictionTrend;
                  return (
                    <div className="rounded-lg border border-[hsl(var(--border-obsidian-strong)/0.5)] bg-obsidian-raised p-3 text-sm text-ink-primary-dark shadow-lg">
                      <p className="font-medium">{label}</p>
                      <div className="mt-2 space-y-1">
                        <p className="text-teal">Submitted: {data.submitted}</p>
                        <p className="text-gold">{data.approved}</p>
                        <p className="text-amber-300">In Review: {data.inReview}</p>
                        {data.avgCycleTime && (
                          <p className="text-ink-tertiary-dark">Avg cycle: {data.avgCycleTime.toFixed(1)} days</p>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend wrapperStyle={{ color: 'hsl(var(--ink-secondary-dark))' }} />
            <Bar dataKey="submitted" name="Submitted" fill="hsl(var(--accent-teal))" radius={[0, 4, 4, 0]} />
            <Bar dataKey="approved" name="Approved" fill="hsl(var(--accent-gold))" radius={[0, 4, 4, 0]} />
            <Bar dataKey="inReview" name="In Review" fill="hsl(35 72% 55%)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
