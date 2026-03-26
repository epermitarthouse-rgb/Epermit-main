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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <>
      <div className="w-full max-w-7xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-4 sm:py-6 md:py-8">
        <div className="flex flex-col gap-4 mb-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-8 w-8 text-primary" />
              <div>
                <h1 className="text-3xl font-bold">Analytics & Reporting</h1>
                <p className="text-muted-foreground">
                  Permit cycle times, costs, and performance metrics
                </p>
              </div>
            </div>
            
            <AnalyticsExport
              summary={summary}
              jurisdictionMetrics={jurisdictionMetrics}
              projectTypeMetrics={projectTypeMetrics}
              rejectionTrends={rejectionTrends}
              dateRange={dateRange}
            />
          </div>
          
          <DateRangeFilter
            dateRange={dateRange}
            onDateRangeChange={setDateRange}
            presetRange={presetRange}
            onPresetChange={setPresetRange}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="text-center py-8">
            <p className="text-destructive">{error}</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <AnalyticsSummaryCards summary={summary} />

            {/* Tabs for different analytics views */}
            <Tabs defaultValue="trends" className="space-y-6">
              <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:grid-cols-none lg:inline-flex">
                <TabsTrigger value="trends">Permit Trends</TabsTrigger>
                <TabsTrigger value="performance">Performance</TabsTrigger>
                <TabsTrigger value="costs">Costs & Rejections</TabsTrigger>
              </TabsList>

              <TabsContent value="trends" className="space-y-6">
                {/* Jurisdiction Trends */}
                <JurisdictionTrendsChart trends={jurisdictionTrends} />

                {/* Project Type Charts */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <ProjectTypePieChart metrics={projectTypeMetrics} />
                  <ProjectTypeBreakdownCard metrics={projectTypeMetrics} />
                </div>
              </TabsContent>

              <TabsContent value="performance" className="space-y-6">
                {/* Cycle Time & Jurisdiction Performance */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <CycleTimeChart monthlyMetrics={monthlyMetrics} />
                  <JurisdictionTable metrics={jurisdictionMetrics} />
                </div>
              </TabsContent>

              <TabsContent value="costs" className="space-y-6">
                {/* Costs & Rejections */}
                <div className="grid gap-6 lg:grid-cols-2">
                  <CostTrackingCard projects={projectAnalytics} />
                  <RejectionTrendsChart trends={rejectionTrends} />
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </>
  );
}