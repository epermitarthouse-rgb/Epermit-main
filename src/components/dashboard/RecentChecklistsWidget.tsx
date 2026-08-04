import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { 
  ClipboardList, 
  ChevronRight,
  Loader2,
  FileText,
  CheckCircle2,
  Clock,
  PenLine
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

interface ChecklistItem {
  id: string;
  checked: boolean;
  label: string;
  notes?: string;
}

interface SavedChecklist {
  id: string;
  name: string;
  status: string;
  checklist_items: ChecklistItem[];
  updated_at: string;
  project_id: string | null;
  form_data: {
    inspectionType?: string;
    projectName?: string;
  };
}

interface Project {
  id: string;
  name: string;
}

interface ChecklistStats {
  total: number;
  signed: number;
  completed: number;
  inProgress: number;
  draft: number;
}

const EMPTY_STATS: ChecklistStats = {
  total: 0,
  signed: 0,
  completed: 0,
  inProgress: 0,
  draft: 0,
};

export function RecentChecklistsWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [checklists, setChecklists] = useState<SavedChecklist[]>([]);
  const [projects, setProjects] = useState<Record<string, Project>>({});
  const [stats, setStats] = useState<ChecklistStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchChecklists = async () => {
      setLoading(true);
      
      // Recent list (5) + full portfolio status counts (never treat last-5 as totals)
      const [recentRes, statusRes] = await Promise.all([
        supabase
          .from('saved_inspection_checklists')
          .select('id, name, status, checklist_items, updated_at, project_id, form_data')
          .order('updated_at', { ascending: false })
          .limit(5),
        supabase.from('saved_inspection_checklists').select('status'),
      ]);

      if (recentRes.error) {
        console.error('Error fetching checklists:', recentRes.error);
        setLoading(false);
        return;
      }
      if (statusRes.error) {
        console.error('Error fetching checklist stats:', statusRes.error);
      }

      const checklistData = (recentRes.data || []).map(item => ({
        ...item,
        checklist_items: Array.isArray(item.checklist_items) 
          ? (item.checklist_items as unknown as ChecklistItem[])
          : [],
        form_data: (item.form_data as SavedChecklist['form_data']) || {},
      }));

      setChecklists(checklistData);

      const statusRows = statusRes.data || [];
      setStats({
        total: statusRows.length,
        signed: statusRows.filter((c) => c.status === 'signed').length,
        completed: statusRows.filter((c) => c.status === 'completed').length,
        inProgress: statusRows.filter((c) => c.status === 'in_progress').length,
        draft: statusRows.filter((c) => c.status === 'draft').length,
      });

      // Fetch project names for checklists with project_id
      const projectIds = checklistData
        .map(c => c.project_id)
        .filter((id): id is string => id !== null);

      if (projectIds.length > 0) {
        const { data: projectData } = await supabase
          .from('projects')
          .select('id, name')
          .in('id', projectIds);

        if (projectData) {
          const projectMap: Record<string, Project> = {};
          projectData.forEach(p => {
            projectMap[p.id] = p;
          });
          setProjects(projectMap);
        }
      }

      setLoading(false);
    };

    fetchChecklists();

    // Set up real-time subscription
    const channel = supabase
      .channel('checklist-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'saved_inspection_checklists' },
        () => fetchChecklists()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'signed':
        return <Badge className="bg-emerald-500 text-white text-xs">Signed</Badge>;
      case 'completed':
        return <Badge className="bg-blue-500 text-white text-xs">Completed</Badge>;
      case 'in_progress':
        return <Badge className="bg-amber-500 text-white text-xs">In Progress</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs text-ink-secondary-light">Draft</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'signed':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'completed':
        return <FileText className="h-4 w-4 text-teal" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-amber-500" />;
      default:
        return <PenLine className="h-4 w-4 text-ink-tertiary-light" />;
    }
  };

  const calculateProgress = (items: ChecklistItem[]) => {
    if (!items || items.length === 0) return 0;
    const completed = items.filter(item => item.checked).length;
    return Math.round((completed / items.length) * 100);
  };

  const formatInspectionType = (type?: string) => {
    if (!type) return 'General';
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  const renderChecklistItem = (checklist: SavedChecklist) => {
    const progress = calculateProgress(checklist.checklist_items);
    const projectName = checklist.project_id && projects[checklist.project_id]
      ? projects[checklist.project_id].name
      : checklist.form_data.projectName || 'No Project';

    return (
      <div
        key={checklist.id}
        onClick={() => navigate('/checklist-history')}
        className={cn(
          "flex cursor-pointer items-center justify-between rounded-lg border border-cream-sunken/70 bg-cream-sunken/25 p-3 transition-colors hover:bg-cream-sunken/50",
          checklist.status === 'signed' && "border-emerald-500/30 bg-emerald-500/5"
        )}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
            checklist.status === 'signed' ? "bg-emerald-500/20" :
            checklist.status === 'completed' ? "bg-blue-500/20" :
            checklist.status === 'in_progress' ? "bg-amber-500/20" :
            "bg-cream-sunken/60"
          )}>
            {getStatusIcon(checklist.status)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-primary-light">{checklist.name}</p>
            <p className="text-xs text-ink-secondary-light truncate">
              {formatInspectionType(checklist.form_data.inspectionType)} • {projectName}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <Progress value={progress} className="h-1.5 flex-1 max-w-24" />
              <span className="text-xs text-ink-secondary-light">{progress}%</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <div className="text-right hidden sm:block">
            <p className="text-xs text-ink-secondary-light">
              {format(parseISO(checklist.updated_at), 'MMM d')}
            </p>
            {getStatusBadge(checklist.status)}
          </div>
          <ChevronRight className="h-4 w-4 text-ink-tertiary-light" />
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <Card className="rounded-2xl border border-cream-sunken bg-cream-raised text-ink-primary-light shadow-cream dark:bg-cream-raised dark:text-ink-primary-light">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display font-normal tracking-tight text-ink-primary-light">
            <ClipboardList className="h-5 w-5 text-teal" />
            Recent Checklists
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-ink-tertiary-light" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border border-cream-sunken bg-cream-raised text-ink-primary-light shadow-cream hover:border-gold/22 dark:bg-cream-raised dark:text-ink-primary-light">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 shrink-0 text-teal" />
            <CardTitle className="font-display font-normal tracking-tight text-ink-primary-light">
              Recent Checklists
            </CardTitle>
          </div>
          <Button variant="ghost" size="sm" asChild className="text-ink-secondary-light hover:bg-cream-sunken/50 hover:text-ink-primary-light">
            <Link to="/checklist-history">View All</Link>
          </Button>
        </div>
        <CardDescription className="text-ink-secondary-light">
          Portfolio · Recent 5 listed below; stats count all saved checklists
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Quick Stats — full portfolio counts */}
        {stats.total > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <div className="rounded-lg border border-cream-sunken/60 bg-cream-sunken/50 p-2 text-center">
              <p className="text-lg font-bold text-ink-primary-light">{stats.total}</p>
              <p className="text-xs text-ink-secondary-light">Total</p>
            </div>
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] p-2 text-center">
              <p className="text-lg font-bold text-emerald-600">{stats.signed}</p>
              <p className="text-xs text-ink-secondary-light">Signed</p>
            </div>
            <div className="rounded-lg border border-blue-500/25 bg-blue-500/[0.08] p-2 text-center">
              <p className="text-lg font-bold text-teal">{stats.completed}</p>
              <p className="text-xs text-ink-secondary-light">Done</p>
            </div>
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.08] p-2 text-center">
              <p className="text-lg font-bold text-amber-600">{stats.inProgress + stats.draft}</p>
              <p className="text-xs text-ink-secondary-light">Active</p>
            </div>
          </div>
        )}

        {checklists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ClipboardList className="mb-3 h-12 w-12 text-ink-tertiary-light/75" />
            <p className="font-medium text-ink-primary-light">No saved checklists yet</p>
            <p className="mb-4 text-sm text-ink-secondary-light">
              Create and save inspection checklists from your projects
            </p>
            <Button
              variant="outline"
              size="sm"
              asChild
              className="rounded-lg border-cream-sunken bg-cream text-ink-primary-light hover:bg-cream-sunken/50 hover:text-ink-primary-light"
            >
              <Link to="/projects">Go to Projects</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {checklists.map(renderChecklistItem)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
