import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { JurisdictionTrend } from '@/types/analytics';

interface JurisdictionTrendsChartProps {
  trends: JurisdictionTrend[];
}

export function JurisdictionTrendsChart({ trends }: JurisdictionTrendsChartProps) {
  if (trends.length === 0) {
    return (
      <Card className="col-span-full">
        <CardHeader>
          <CardTitle>Permit Trends by Jurisdiction</CardTitle>
          <CardDescription>Comparison of permit activity across jurisdictions</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">No jurisdiction data available</p>
        </CardContent>
      </Card>
    );
  }

  // Show top 8 jurisdictions
  const topJurisdictions = trends.slice(0, 8);

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle>Permit Trends by Jurisdiction</CardTitle>
        <CardDescription>Comparison of permit activity across top jurisdictions</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={topJurisdictions} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" />
            <YAxis 
              type="category" 
              dataKey="jurisdiction" 
              width={120}
              tick={{ fontSize: 12 }}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload as JurisdictionTrend;
                  return (
                    <div className="bg-background border rounded-lg p-3 shadow-lg">
                      <p className="font-medium">{label}</p>
                      <div className="mt-2 space-y-1 text-sm">
                        <p className="text-sky-500">Submitted: {data.submitted}</p>
                        <p className="text-emerald-500">Approved: {data.approved}</p>
                        <p className="text-amber-500">In Review: {data.inReview}</p>
                        {data.avgCycleTime && (
                          <p className="text-muted-foreground">
                            Avg cycle: {data.avgCycleTime.toFixed(1)} days
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend />
            <Bar 
              dataKey="submitted" 
              name="Submitted" 
              fill="#0ea5e9" 
              radius={[0, 4, 4, 0]}
            />
            <Bar 
              dataKey="approved" 
              name="Approved" 
              fill="#10b981" 
              radius={[0, 4, 4, 0]}
            />
            <Bar 
              dataKey="inReview" 
              name="In Review" 
              fill="#f59e0b" 
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
