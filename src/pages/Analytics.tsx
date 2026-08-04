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
import { PageHeader, Panel } from '@/components/design/ProductPrimitives';
import { EmptyState } from '@/components/design/EmptyState';
import { AlertCircle, Loader2 } from 'lucide-react';
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
      <div className="flex min-h-[50vh] items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics & Reporting"
        title="Analytics & Reporting"
        body="Permit cycle times, costs, and performance metrics for your workspace."
        action={
          <AnalyticsExport
            summary={summary}
            jurisdictionMetrics={jurisdictionMetrics}
            projectTypeMetrics={projectTypeMetrics}
            rejectionTrends={rejectionTrends}
            dateRange={dateRange}
          />
        }
      />

      <Panel eyebrow="Date range" title="Report window">
        <DateRangeFilter
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          presetRange={presetRange}
          onPresetChange={setPresetRange}
        />
      </Panel>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <Panel>
          <EmptyState
            icon={AlertCircle}
            title="Could not load analytics"
            body={error}
          />
        </Panel>
      ) : (
        <div className="space-y-6">
          <AnalyticsSummaryCards summary={summary} />

          <Panel>
            <Tabs defaultValue="trends" className="space-y-6">
              <TabsList className="grid h-auto w-full grid-cols-1 gap-1 sm:grid-cols-3 lg:inline-flex lg:w-auto">
                <TabsTrigger value="trends">Permit Trends</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
                <TabsTrigger value="costs">Costs &amp; Rejections</TabsTrigger>
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
          </Panel>
        </div>
      )}
    </div>
  );
}
