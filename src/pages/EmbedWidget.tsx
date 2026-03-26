import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Building2, 
  Calendar, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  ArrowRight,
  FileText,
  Loader2
} from 'lucide-react';
import { format } from 'date-fns';
import { Project, PROJECT_STATUS_CONFIG, ProjectStatus } from '@/types/project';

interface WidgetData {
  project: Project;
  nextSteps: string[];
  upcomingMilestones: { title: string; date: string; completed: boolean }[];
}

const STATUS_PROGRESS: Record<ProjectStatus, number> = {
  draft: 10,
  submitted: 30,
  in_review: 60,
  corrections: 50,
  approved: 100,
};

const NEXT_STEPS: Record<ProjectStatus, string[]> = {
  draft: [
    'Complete project documentation',
    'Upload required drawings',
    'Submit for review'
  ],
  submitted: [
    'Awaiting initial review',
    'Prepare for potential questions',
    'Monitor for status updates'
  ],
  in_review: [
    'Plan reviewer is assessing documents',
    'Be available for clarification requests',
    'Expected response within 5-10 business days'
  ],
  corrections: [
    'Review correction comments',
    'Update drawings as required',
    'Resubmit corrected documents'
  ],
  approved: [
    'Download approved permit',
    'Schedule required inspections',
    'Begin permitted work'
  ],
};

export default function EmbedWidget() {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<WidgetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Widget configuration from query params
  const theme = searchParams.get('theme') || 'light';
  const compact = searchParams.get('compact') === 'true';
  const showMilestones = searchParams.get('milestones') !== 'false';
  const showNextSteps = searchParams.get('steps') !== 'false';
  const accentColor = searchParams.get('accent') || '#8B5CF6';

  useEffect(() => {
    const fetchData = async () => {
      if (!token) {
        setError('Invalid widget token');
        setLoading(false);
        return;
      }

      try {
        // Validate share link
        const { data: shareLink, error: linkError } = await supabase
          .from('project_share_links')
          .select('*')
          .eq('token', token)
          .single();

        if (linkError || !shareLink) {
          setError('Invalid or expired link');
          setLoading(false);
          return;
        }

        if (!shareLink.is_active) {
          setError('This widget has been deactivated');
          setLoading(false);
          return;
        }

        if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
          setError('This widget link has expired');
          setLoading(false);
          return;
        }

        // Update view count
        await supabase
          .from('project_share_links')
          .update({
            view_count: shareLink.view_count + 1,
            last_viewed_at: new Date().toISOString(),
          })
          .eq('id', shareLink.id);

        // Fetch project
        const { data: project, error: projectError } = await supabase
          .from('projects')
          .select('*')
          .eq('id', shareLink.project_id)
          .single();

        if (projectError || !project) {
          setError('Project not found');
          setLoading(false);
          return;
        }

        // Fetch upcoming inspections as milestones
        const { data: inspections } = await supabase
          .from('inspections')
          .select('*')
          .eq('project_id', shareLink.project_id)
          .order('scheduled_date', { ascending: true })
          .limit(3);

        const milestones = [
          {
            title: 'Project Created',
            date: project.created_at,
            completed: true
          },
          ...(project.submitted_at ? [{
            title: 'Submitted for Review',
            date: project.submitted_at,
            completed: true
          }] : []),
          ...(inspections || []).map(i => ({
            title: `${i.inspection_type.replace(/_/g, ' ')} Inspection`,
            date: i.scheduled_date,
            completed: i.status === 'passed'
          })),
          ...(project.deadline ? [{
            title: 'Project Deadline',
            date: project.deadline,
            completed: false
          }] : []),
        ].slice(0, 4);

        setData({
          project: project as Project,
          nextSteps: NEXT_STEPS[project.status as ProjectStatus] || [],
          upcomingMilestones: milestones,
        });
      } catch (err) {
        console.error('Widget error:', err);
        setError('Failed to load widget');
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    // Set up realtime subscription for live updates
    const channel = supabase
      .channel(`widget-${token}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects' },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [token]);

  // Apply theme
  const isDark = theme === 'dark';
  const bgColor = isDark ? '#1a1a2e' : '#ffffff';
  const textColor = isDark ? '#e2e8f0' : '#1a202c';
  const mutedColor = isDark ? '#94a3b8' : '#64748b';
  const borderColor = isDark ? '#334155' : '#e2e8f0';

  if (loading) {
    return (
      <div 
        className="flex items-center justify-center p-8"
        style={{ backgroundColor: bgColor, color: textColor }}
      >
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: accentColor }} />
      </div>
    );
  }

  if (error) {
    return (
      <div 
        className="flex items-center justify-center p-6 text-center"
        style={{ backgroundColor: bgColor, color: textColor }}
      >
        <div className="space-y-2">
          <AlertCircle className="h-8 w-8 mx-auto" style={{ color: '#ef4444' }} />
          <p className="text-sm font-medium">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { project, nextSteps, upcomingMilestones } = data;
  const statusConfig = PROJECT_STATUS_CONFIG[project.status];
  const progress = STATUS_PROGRESS[project.status];

  return (
    <div 
      className="font-sans overflow-hidden"
      style={{ 
        backgroundColor: bgColor, 
        color: textColor,
        borderRadius: '12px',
        border: `1px solid ${borderColor}`,
      }}
    >
      {/* Header */}
      <div 
        className="p-4"
        style={{ borderBottom: `1px solid ${borderColor}` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div 
              className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${accentColor}20` }}
            >
              <Building2 className="h-5 w-5" style={{ color: accentColor }} />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold truncate" style={{ color: textColor }}>
                {project.name}
              </h2>
              {project.permit_number && (
                <p className="text-xs flex items-center gap-1" style={{ color: mutedColor }}>
                  <FileText className="h-3 w-3" />
                  #{project.permit_number}
                </p>
              )}
            </div>
          </div>
          <Badge 
            className="shrink-0 text-xs px-2 py-0.5"
            style={{ 
              backgroundColor: statusConfig.bgColor,
              color: statusConfig.color.replace('text-', ''),
            }}
          >
            {statusConfig.label}
          </Badge>
        </div>

        {/* Progress */}
        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span style={{ color: mutedColor }}>Progress</span>
            <span className="font-medium">{progress}%</span>
          </div>
          <div 
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: `${accentColor}20` }}
          >
            <div 
              className="h-full rounded-full transition-all duration-500"
              style={{ 
                width: `${progress}%`,
                backgroundColor: accentColor 
              }}
            />
          </div>
        </div>
      </div>

      {/* Milestones */}
      {showMilestones && !compact && upcomingMilestones.length > 0 && (
        <div 
          className="p-4"
          style={{ borderBottom: `1px solid ${borderColor}` }}
        >
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: mutedColor }}>
            Milestones
          </h3>
          <div className="space-y-2">
            {upcomingMilestones.map((milestone, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <div 
                  className="h-6 w-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ 
                    backgroundColor: milestone.completed ? `${accentColor}20` : `${borderColor}`,
                  }}
                >
                  {milestone.completed ? (
                    <CheckCircle2 className="h-3.5 w-3.5" style={{ color: accentColor }} />
                  ) : (
                    <Clock className="h-3.5 w-3.5" style={{ color: mutedColor }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate capitalize">{milestone.title}</p>
                  <p className="text-xs" style={{ color: mutedColor }}>
                    {format(new Date(milestone.date), 'MMM d, yyyy')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next Steps */}
      {showNextSteps && !compact && nextSteps.length > 0 && (
        <div className="p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: mutedColor }}>
            Next Steps
          </h3>
          <div className="space-y-2">
            {nextSteps.map((step, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <ArrowRight className="h-4 w-4 mt-0.5 shrink-0" style={{ color: accentColor }} />
                <p className="text-sm" style={{ color: mutedColor }}>{step}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div 
        className="px-4 py-2 flex items-center justify-between text-xs"
        style={{ 
          backgroundColor: isDark ? '#0f0f1a' : '#f8fafc',
          color: mutedColor,
        }}
      >
        <span>
          Updated {format(new Date(project.updated_at), 'MMM d, h:mm a')}
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          Live
        </span>
      </div>
    </div>
  );
}
