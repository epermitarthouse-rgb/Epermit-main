import { useState } from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';
import { AnalyticsSummaryCards } from '@/components/analytics/AnalyticsSummaryCards';
import { CycleTimeChart } from '@/components/analytics/CycleTimeChart';
import { JurisdictionTable } from '@/components/analytics/JurisdictionTable';
import { RejectionTrendsChart } from '@/components/analytics/RejectionTrendsChart';
import { CostTrackingCard } from '@/components/analytics/CostTrackingCard';
import { ProjectTypePieChart } from '@/components/analytics/ProjectTypePieChart';
import { JurisdictionTrendsChart } from '@/components/analytics/JurisdictionTrendsChart';
import { ProjectTypeBreakdownCard } from '@/components/analytics/ProjectTypeBreakdownCard';
import { DateRangeFilter, DateRange, PresetRange, getPresetDateRange } from '@/components/analytics/DateRangeFilter';
import { AnalyticsExport } from '@/components/analytics/AnalyticsExport';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Loader2, BarChart3 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Analytics() {
  const { user, loading: authLoading } = useAuth();
  const [presetRange, setPresetRange] = useState<PresetRange>('allTime');
  const [dateRange, setDateRange] = useState<DateRange>(getPresetDateRange('allTime'));
  
  const { 
    projectAnalytics, 
    summary, 
    jurisdictionMetrics, 
    rejectionTrends,
    monthlyMetrics,
    projectTypeMetrics,
    jurisdictionTrends,
    loading, 
    error 
  } = useAnalytics(dateRange);

  if (authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-cream">
        <Loader2 className="h-8 w-8 animate-spin text-teal" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="min-h-screen bg-cream text-ink-primary-light">
      <EditorialPageHeader
        eyebrow="ANALYTICS & REPORTING"
        title="Analytics & Reporting"
        description="Permit cycle times, costs, and performance metrics for your workspace."
        icon={BarChart3}
        iconClassName="text-teal"
        actions={<AnalyticsExport
          summary={summary}
          jurisdictionMetrics={jurisdictionMetrics}
          projectTypeMetrics={projectTypeMetrics}
          rejectionTrends={rejectionTrends}
          dateRange={dateRange}
        />}
      />

      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 md:py-8">
        <div className="mb-8 rounded-2xl border border-cream-sunken bg-cream-raised/80 px-4 py-4 shadow-inner sm:px-5">
          <DateRangeFilter
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            presetRange={presetRange}
            onPresetChange={setPresetRange}
          />
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-teal" />
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-destructive">{error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            <AnalyticsSummaryCards summary={summary} />

            <Tabs defaultValue="trends" className="space-y-6">
              <TabsList className="grid h-auto w-full grid-cols-1 gap-1 rounded-xl border border-cream-sunken bg-cream-sunken/40 p-1 text-ink-secondary-light sm:grid-cols-3 lg:inline-flex lg:w-auto">
                <TabsTrigger
                  value="trends"
                  className="data-[state=active]:bg-cream data-[state=active]:text-ink-primary-light data-[state=active]:shadow-sm"
                >
                  Permit Trends
                </TabsTrigger>
                <TabsTrigger
                  value="performance"
                  className="data-[state=active]:bg-cream data-[state=active]:text-ink-primary-light data-[state=active]:shadow-sm"
                >
                  Performance
                </TabsTrigger>
                <TabsTrigger
                  value="costs"
                  className="data-[state=active]:bg-cream data-[state=active]:text-ink-primary-light data-[state=active]:shadow-sm"
                >
                  Costs & Rejections
                </TabsTrigger>
              </TabsList>

              <TabsContent value="trends" className="space-y-6">
                <JurisdictionTrendsChart trends={jurisdictionTrends} />
                <div className="grid gap-6 lg:grid-cols-2">
                  <ProjectTypePieChart metrics={projectTypeMetrics} />
                  <ProjectTypeBreakdownCard metrics={projectTypeMetrics} />
                </div>
              </TabsContent>

              <TabsContent value="performance" className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <CycleTimeChart monthlyMetrics={monthlyMetrics} />
                  <JurisdictionTable metrics={jurisdictionMetrics} />
                </div>
              </TabsContent>

              <TabsContent value="costs" className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <CostTrackingCard projects={projectAnalytics} />
                  <RejectionTrendsChart trends={rejectionTrends} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
}
