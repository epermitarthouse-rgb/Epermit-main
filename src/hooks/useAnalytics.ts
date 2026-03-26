import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { 
  ProjectAnalytics, 
  AnalyticsSummary, 
  JurisdictionMetrics, 
  RejectionTrend,
  MonthlyMetrics,
  ProjectTypeMetrics,
  JurisdictionTrend
} from '@/types/analytics';
import { format, subMonths, startOfMonth, parseISO, isWithinInterval, isAfter, isBefore } from 'date-fns';

export interface DateRange {
  from: Date | undefined;
  to: Date | undefined;
}

function isInDateRange(dateStr: string | null, range: DateRange): boolean {
  if (!dateStr) return false;
  if (!range.from && !range.to) return true;
  
  const date = parseISO(dateStr);
  
  if (range.from && range.to) {
    return isWithinInterval(date, { start: range.from, end: range.to });
  }
  if (range.from) {
    return isAfter(date, range.from) || date.getTime() === range.from.getTime();
  }
  if (range.to) {
    return isBefore(date, range.to) || date.getTime() === range.to.getTime();
  }
  return true;
}

export function useAnalytics(dateRange?: DateRange) {
  const { user } = useAuth();
  const [projectAnalytics, setProjectAnalytics] = useState<ProjectAnalytics[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    if (!user) {
      setProjectAnalytics([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch from the analytics view
      const { data, error } = await supabase
        .from('project_analytics')
        .select('id, name, user_id, status, jurisdiction, project_type, permit_fee, expeditor_cost, total_cost, rejection_count, rejection_reasons, created_at, submitted_at, approved_at, draft_to_submit_days, submit_to_approval_days, total_cycle_days, inspection_count, failed_inspection_count, punch_list_count, open_punch_items, document_count');

      if (error) throw error;

      setProjectAnalytics((data as ProjectAnalytics[]) || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch analytics';
      setError(message);
      console.error('Error fetching analytics:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  // Filter projects by date range based on created_at
  const filteredProjects = useMemo(() => {
    if (!dateRange?.from && !dateRange?.to) return projectAnalytics;
    
    return projectAnalytics.filter(p => isInDateRange(p.created_at, dateRange));
  }, [projectAnalytics, dateRange]);

  const summary: AnalyticsSummary = useMemo(() => {
    const total = filteredProjects.length;
    const active = filteredProjects.filter(p => !['approved', 'draft'].includes(p.status)).length;
    const approved = filteredProjects.filter(p => p.status === 'approved').length;
    
    const completedProjects = filteredProjects.filter(p => p.total_cycle_days !== null);
    const avgCycle = completedProjects.length > 0
      ? completedProjects.reduce((sum, p) => sum + (p.total_cycle_days || 0), 0) / completedProjects.length
      : null;

    const submittedProjects = filteredProjects.filter(p => p.submit_to_approval_days !== null);
    const avgSubmitToApproval = submittedProjects.length > 0
      ? submittedProjects.reduce((sum, p) => sum + (p.submit_to_approval_days || 0), 0) / submittedProjects.length
      : null;

    const totalPermitFees = filteredProjects.reduce((sum, p) => sum + (p.permit_fee || 0), 0);
    const totalExpeditorCosts = filteredProjects.reduce((sum, p) => sum + (p.expeditor_cost || 0), 0);
    const totalCosts = filteredProjects.reduce((sum, p) => sum + (p.total_cost || 0), 0);
    const totalRejections = filteredProjects.reduce((sum, p) => sum + (p.rejection_count || 0), 0);

    return {
      totalProjects: total,
      activeProjects: active,
      approvedProjects: approved,
      avgCycleTime: avgCycle,
      avgSubmitToApproval: avgSubmitToApproval,
      totalPermitFees,
      totalExpeditorCosts,
      totalCosts,
      totalRejections,
      avgCostPerPermit: approved > 0 ? totalCosts / approved : null,
    };
  }, [filteredProjects]);

  const jurisdictionMetrics: JurisdictionMetrics[] = useMemo(() => {
    const byJurisdiction = new Map<string, ProjectAnalytics[]>();
    
    filteredProjects.forEach(p => {
      const jurisdiction = p.jurisdiction || 'Unknown';
      if (!byJurisdiction.has(jurisdiction)) {
        byJurisdiction.set(jurisdiction, []);
      }
      byJurisdiction.get(jurisdiction)!.push(p);
    });

    return Array.from(byJurisdiction.entries()).map(([jurisdiction, projects]) => {
      const completed = projects.filter(p => p.total_cycle_days !== null);
      const approved = projects.filter(p => p.status === 'approved').length;
      const avgCycle = completed.length > 0
        ? completed.reduce((sum, p) => sum + (p.total_cycle_days || 0), 0) / completed.length
        : null;

      const submittedProjects = projects.filter(p => p.submit_to_approval_days !== null);
      const avgSubmitToApproval = submittedProjects.length > 0
        ? submittedProjects.reduce((sum, p) => sum + (p.submit_to_approval_days || 0), 0) / submittedProjects.length
        : null;

      const rejections = projects.reduce((sum, p) => sum + (p.rejection_count || 0), 0);

      return {
        jurisdiction,
        projectCount: projects.length,
        avgCycleTime: avgCycle,
        avgSubmitToApproval,
        rejectionCount: rejections,
        approvalRate: projects.length > 0 ? (approved / projects.length) * 100 : 0,
      };
    }).sort((a, b) => b.projectCount - a.projectCount);
  }, [filteredProjects]);

  const rejectionTrends: RejectionTrend[] = useMemo(() => {
    const reasonCounts = new Map<string, number>();
    let totalReasons = 0;

    filteredProjects.forEach(p => {
      (p.rejection_reasons || []).forEach(reason => {
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
        totalReasons++;
      });
    });

    return Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: totalReasons > 0 ? (count / totalReasons) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredProjects]);

  const monthlyMetrics: MonthlyMetrics[] = useMemo(() => {
    const last6Months: MonthlyMetrics[] = [];
    
    for (let i = 5; i >= 0; i--) {
      const monthDate = subMonths(new Date(), i);
      const monthKey = format(monthDate, 'yyyy-MM');
      const monthLabel = format(monthDate, 'MMM yyyy');
      const monthStart = startOfMonth(monthDate);
      const nextMonthStart = startOfMonth(subMonths(new Date(), i - 1));

      const submitted = filteredProjects.filter(p => {
        if (!p.submitted_at) return false;
        const submitDate = parseISO(p.submitted_at);
        return submitDate >= monthStart && submitDate < nextMonthStart;
      }).length;

      const approved = filteredProjects.filter(p => {
        if (!p.approved_at) return false;
        const approveDate = parseISO(p.approved_at);
        return approveDate >= monthStart && approveDate < nextMonthStart;
      }).length;

      const rejected = filteredProjects.filter(p => {
        if (p.status !== 'corrections') return false;
        const createdDate = parseISO(p.created_at);
        return createdDate >= monthStart && createdDate < nextMonthStart;
      }).length;

      const completedThisMonth = filteredProjects.filter(p => {
        if (!p.approved_at || p.total_cycle_days === null) return false;
        const approveDate = parseISO(p.approved_at);
        return approveDate >= monthStart && approveDate < nextMonthStart;
      });

      const avgCycleTime = completedThisMonth.length > 0
        ? completedThisMonth.reduce((sum, p) => sum + (p.total_cycle_days || 0), 0) / completedThisMonth.length
        : null;

      last6Months.push({
        month: monthLabel,
        submitted,
        approved,
        rejected,
        avgCycleTime,
      });
    }

    return last6Months;
  }, [filteredProjects]);

  const projectTypeMetrics: ProjectTypeMetrics[] = useMemo(() => {
    const byType = new Map<string, ProjectAnalytics[]>();
    
    filteredProjects.forEach(p => {
      const projectType = p.project_type || 'other';
      if (!byType.has(projectType)) {
        byType.set(projectType, []);
      }
      byType.get(projectType)!.push(p);
    });

    return Array.from(byType.entries()).map(([projectType, projects]) => {
      const approved = projects.filter(p => p.status === 'approved').length;
      const completed = projects.filter(p => p.total_cycle_days !== null);
      const avgCycle = completed.length > 0
        ? completed.reduce((sum, p) => sum + (p.total_cycle_days || 0), 0) / completed.length
        : null;
      const totalCost = projects.reduce((sum, p) => sum + (p.total_cost || 0), 0);

      return {
        projectType,
        count: projects.length,
        avgCycleTime: avgCycle,
        approvalRate: projects.length > 0 ? (approved / projects.length) * 100 : 0,
        totalCost,
      };
    }).sort((a, b) => b.count - a.count);
  }, [filteredProjects]);

  const jurisdictionTrends: JurisdictionTrend[] = useMemo(() => {
    const byJurisdiction = new Map<string, ProjectAnalytics[]>();
    
    filteredProjects.forEach(p => {
      const jurisdiction = p.jurisdiction || 'Unknown';
      if (!byJurisdiction.has(jurisdiction)) {
        byJurisdiction.set(jurisdiction, []);
      }
      byJurisdiction.get(jurisdiction)!.push(p);
    });

    return Array.from(byJurisdiction.entries()).map(([jurisdiction, projects]) => {
      const submitted = projects.filter(p => p.submitted_at !== null).length;
      const approved = projects.filter(p => p.status === 'approved').length;
      const inReview = projects.filter(p => ['submitted', 'in_review', 'corrections'].includes(p.status)).length;
      
      const completed = projects.filter(p => p.total_cycle_days !== null);
      const avgCycle = completed.length > 0
        ? completed.reduce((sum, p) => sum + (p.total_cycle_days || 0), 0) / completed.length
        : null;

      return {
        jurisdiction,
        submitted,
        approved,
        inReview,
        avgCycleTime: avgCycle,
      };
    }).sort((a, b) => (b.submitted + b.approved + b.inReview) - (a.submitted + a.approved + a.inReview));
  }, [filteredProjects]);

  return {
    projectAnalytics: filteredProjects,
    summary,
    jurisdictionMetrics,
    rejectionTrends,
    monthlyMetrics,
    projectTypeMetrics,
    jurisdictionTrends,
    loading,
    error,
    refetch: fetchAnalytics,
  };
}
