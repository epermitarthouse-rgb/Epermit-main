import { useMemo } from 'react';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import {
  BarChart3,
  CheckCircle2,
  XCircle,
  AlertCircle,
  TrendingUp,
  Mail,
  Send,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useReportDeliveryLogs } from '@/hooks/useReportDeliveryLogs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const chartConfig = {
  successful: {
    label: 'Delivered',
    color: 'hsl(var(--chart-1))',
  },
  failed: {
    label: 'Failed',
    color: 'hsl(var(--destructive))',
  },
  partial: {
    label: 'Partial',
    color: 'hsl(var(--chart-3))',
  },
} satisfies ChartConfig;

export function ReportAnalyticsDashboard() {
  const { logs, loading } = useReportDeliveryLogs();

  const analytics = useMemo(() => {
    if (!logs.length) return null;

    // Calculate overall metrics
    const totalEmails = logs.reduce((sum, log) => sum + log.recipient_count, 0);
    const successfulEmails = logs.reduce((sum, log) => sum + log.successful_count, 0);
    const failedEmails = logs.reduce((sum, log) => sum + log.failed_count, 0);
    const deliveryRate = totalEmails > 0 ? (successfulEmails / totalEmails) * 100 : 0;

    // Count by status
    const statusCounts = logs.reduce(
      (acc, log) => {
        acc[log.status] = (acc[log.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Calculate daily trends for the last 30 days
    const thirtyDaysAgo = subDays(new Date(), 30);
    const days = eachDayOfInterval({ start: thirtyDaysAgo, end: new Date() });

    const dailyData = days.map((day) => {
      const dayStart = startOfDay(day);
      const dayLogs = logs.filter((log) => {
        const logDate = startOfDay(new Date(log.sent_at));
        return logDate.getTime() === dayStart.getTime();
      });

      return {
        date: format(day, 'MMM d'),
        fullDate: format(day, 'yyyy-MM-dd'),
        successful: dayLogs.reduce((sum, log) => sum + log.successful_count, 0),
        failed: dayLogs.reduce((sum, log) => sum + log.failed_count, 0),
        total: dayLogs.reduce((sum, log) => sum + log.recipient_count, 0),
      };
    });

    // Per-report breakdown
    const reportBreakdown = logs.reduce(
      (acc, log) => {
        if (!acc[log.report_name]) {
          acc[log.report_name] = {
            name: log.report_name,
            totalSent: 0,
            successful: 0,
            failed: 0,
            deliveries: 0,
          };
        }
        acc[log.report_name].totalSent += log.recipient_count;
        acc[log.report_name].successful += log.successful_count;
        acc[log.report_name].failed += log.failed_count;
        acc[log.report_name].deliveries += 1;
        return acc;
      },
      {} as Record<string, { name: string; totalSent: number; successful: number; failed: number; deliveries: number }>
    );

    const reportData = Object.values(reportBreakdown).sort((a, b) => b.totalSent - a.totalSent);

    // Status distribution for pie chart
    const statusDistribution = [
      { name: 'Success', value: statusCounts.success || 0, fill: 'hsl(var(--chart-1))' },
      { name: 'Partial', value: statusCounts.partial || 0, fill: 'hsl(var(--chart-3))' },
      { name: 'Failed', value: statusCounts.failed || 0, fill: 'hsl(var(--destructive))' },
    ].filter((item) => item.value > 0);

    return {
      totalEmails,
      successfulEmails,
      failedEmails,
      deliveryRate,
      totalDeliveries: logs.length,
      statusCounts,
      dailyData,
      reportData,
      statusDistribution,
    };
  }, [logs]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!analytics || logs.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <BarChart3 className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Analytics Data Yet</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Analytics will appear here once scheduled reports start being sent.
            Create and activate a scheduled report to begin tracking delivery metrics.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Emails Sent</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.totalEmails.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              Across {analytics.totalDeliveries} report deliveries
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Delivery Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {analytics.deliveryRate.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics.successfulEmails.toLocaleString()} successful deliveries
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Successful</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.successfulEmails.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {analytics.statusCounts.success || 0} fully successful reports
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {analytics.failedEmails.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics.statusCounts.failed || 0} failed, {analytics.statusCounts.partial || 0} partial
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Delivery Trend Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Delivery Trend (Last 30 Days)</CardTitle>
            <CardDescription>Daily email delivery statistics</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics.dailyData}>
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 12 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    type="monotone"
                    dataKey="successful"
                    stackId="1"
                    stroke="hsl(var(--chart-1))"
                    fill="hsl(var(--chart-1))"
                    fillOpacity={0.6}
                  />
                  <Area
                    type="monotone"
                    dataKey="failed"
                    stackId="1"
                    stroke="hsl(var(--destructive))"
                    fill="hsl(var(--destructive))"
                    fillOpacity={0.6}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Status Distribution Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
            <CardDescription>Report delivery outcomes</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center">
              {analytics.statusDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analytics.statusDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {analytics.statusDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <ChartTooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          return (
                            <div className="bg-background border rounded-lg shadow-lg p-2">
                              <p className="font-medium">{payload[0].name}</p>
                              <p className="text-sm text-muted-foreground">
                                {payload[0].value} deliveries
                              </p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                  <p>No status data</p>
                </div>
              )}
            </div>
            <div className="flex justify-center gap-4 mt-4">
              {analytics.statusDistribution.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.fill }}
                  />
                  <span className="text-sm">{item.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-Report Breakdown */}
      {analytics.reportData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Report Performance</CardTitle>
            <CardDescription>Delivery statistics by scheduled report</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.reportData.slice(0, 8)}
                  layout="vertical"
                  margin={{ left: 20, right: 20 }}
                >
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    width={150}
                    tick={{ fontSize: 12 }}
                  />
                  <ChartTooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        const rate = data.totalSent > 0
                          ? ((data.successful / data.totalSent) * 100).toFixed(1)
                          : '0';
                        return (
                          <div className="bg-background border rounded-lg shadow-lg p-3">
                            <p className="font-medium mb-2">{data.name}</p>
                            <div className="space-y-1 text-sm">
                              <p>Total Sent: {data.totalSent}</p>
                              <p className="text-green-600">Delivered: {data.successful}</p>
                              <p className="text-destructive">Failed: {data.failed}</p>
                              <p className="text-muted-foreground">Success Rate: {rate}%</p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar
                    dataKey="successful"
                    stackId="a"
                    fill="hsl(var(--chart-1))"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="failed"
                    stackId="a"
                    fill="hsl(var(--destructive))"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
