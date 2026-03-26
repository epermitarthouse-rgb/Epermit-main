import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Building2,
  MapPin,
  Calendar,
  DollarSign,
  Ruler,
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  Shield,
  ArrowLeft,
  Eye,
} from 'lucide-react';
import { format } from 'date-fns';
import { Project, PROJECT_STATUS_CONFIG, PROJECT_TYPE_LABELS, ProjectStatus } from '@/types/project';

interface PortalData {
  project: Project;
  inspections: any[];
  recentActivity: any[];
}

const STATUS_PROGRESS: Record<ProjectStatus, number> = {
  draft: 10,
  submitted: 30,
  in_review: 60,
  corrections: 50,
  approved: 100,
};

export default function ClientPortal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProjectData = async () => {
      if (!token) {
        setError('Invalid share link');
        setLoading(false);
        return;
      }

      try {
        // First, get the share link and validate it
        const { data: shareLink, error: linkError } = await supabase
          .from('project_share_links')
          .select('*')
          .eq('token', token)
          .single();

        if (linkError || !shareLink) {
          setError('This share link is invalid or has been removed.');
          setLoading(false);
          return;
        }

        // Check if link is active
        if (!shareLink.is_active) {
          setError('This share link has been deactivated.');
          setLoading(false);
          return;
        }

        // Check if link is expired
        if (shareLink.expires_at && new Date(shareLink.expires_at) < new Date()) {
          setError('This share link has expired.');
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

        // Fetch project data (using service role would be ideal, but we'll use anon key)
        const { data: project, error: projectError } = await supabase
          .from('projects')
          .select('*')
          .eq('id', shareLink.project_id)
          .single();

        if (projectError || !project) {
          setError('Project not found.');
          setLoading(false);
          return;
        }

        // Fetch inspections
        const { data: inspections } = await supabase
          .from('inspections')
          .select('*')
          .eq('project_id', shareLink.project_id)
          .order('scheduled_date', { ascending: false })
          .limit(5);

        // Fetch recent activity
        const { data: recentActivity } = await supabase
          .from('project_activity')
          .select('*')
          .eq('project_id', shareLink.project_id)
          .order('created_at', { ascending: false })
          .limit(10);

        setData({
          project: project as Project,
          inspections: inspections || [],
          recentActivity: recentActivity || [],
        });
      } catch (err: any) {
        console.error('Error fetching portal data:', err);
        setError('An error occurred while loading the project.');
      } finally {
        setLoading(false);
      }
    };

    fetchProjectData();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Loading project status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md w-full mx-4">
          <CardHeader className="text-center">
            <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-2" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild variant="outline">
              <Link to="/">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Go to Home
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { project, inspections, recentActivity } = data;
  const statusConfig = PROJECT_STATUS_CONFIG[project.status];

  return (
    <div className="min-h-screen bg-gradient-to-b from-muted/30 to-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="font-semibold">Project Status Portal</h1>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  Secure view-only access
                </p>
              </div>
            </div>
            <Badge variant="outline" className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              View Only
            </Badge>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Project Header Card */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div>
                <CardTitle className="text-2xl">{project.name}</CardTitle>
                {project.permit_number && (
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <FileText className="h-4 w-4" />
                    Permit #{project.permit_number}
                  </CardDescription>
                )}
              </div>
              <Badge className={`${statusConfig.bgColor} ${statusConfig.color} border-0 text-sm px-3 py-1`}>
                {statusConfig.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            {/* Progress Bar */}
            <div className="space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{STATUS_PROGRESS[project.status]}%</span>
              </div>
              <Progress value={STATUS_PROGRESS[project.status]} className="h-2" />
            </div>

            {/* Project Info Grid */}
            <div className="grid sm:grid-cols-2 gap-4">
              {project.project_type && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Project Type</p>
                    <p className="font-medium">{PROJECT_TYPE_LABELS[project.project_type]}</p>
                  </div>
                </div>
              )}
              {(project.address || project.city) && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Location</p>
                    <p className="font-medium">
                      {project.city}{project.state && `, ${project.state}`}
                    </p>
                  </div>
                </div>
              )}
              {project.estimated_value && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Estimated Value</p>
                    <p className="font-medium">${project.estimated_value.toLocaleString()}</p>
                  </div>
                </div>
              )}
              {project.square_footage && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Ruler className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Size</p>
                    <p className="font-medium">{project.square_footage.toLocaleString()} sq ft</p>
                  </div>
                </div>
              )}
              {project.deadline && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Deadline</p>
                    <p className="font-medium">{format(new Date(project.deadline), 'MMMM d, yyyy')}</p>
                  </div>
                </div>
              )}
              {project.jurisdiction && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Jurisdiction</p>
                    <p className="font-medium">{project.jurisdiction}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Timeline Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">Created</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(project.created_at), 'MMMM d, yyyy')}
                  </p>
                </div>
              </div>
              {project.submitted_at && (
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <FileText className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Submitted</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(project.submitted_at), 'MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
              )}
              {project.approved_at && (
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Approved</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(project.approved_at), 'MMMM d, yyyy')}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Inspections Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle className="h-5 w-5" />
                Recent Inspections
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inspections.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No inspections scheduled yet
                </p>
              ) : (
                <div className="space-y-3">
                  {inspections.slice(0, 5).map((inspection) => (
                    <div
                      key={inspection.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/30"
                    >
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {inspection.inspection_type.replace(/_/g, ' ')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(inspection.scheduled_date), 'MMM d, yyyy')}
                        </p>
                      </div>
                      <Badge
                        variant={
                          inspection.status === 'passed'
                            ? 'default'
                            : inspection.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                        }
                        className="capitalize"
                      >
                        {inspection.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No recent activity
              </p>
            ) : (
              <div className="space-y-3">
                {recentActivity.slice(0, 10).map((activity) => (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/30"
                  >
                    <div className="h-2 w-2 rounded-full bg-primary mt-2" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{activity.title}</p>
                      {activity.description && (
                        <p className="text-xs text-muted-foreground">{activity.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(activity.created_at), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-muted-foreground">
          <p>This is a secure, view-only portal for project stakeholders.</p>
          <p className="mt-1">Last updated: {format(new Date(project.updated_at), 'MMMM d, yyyy h:mm a')}</p>
        </div>
      </main>
    </div>
  );
}
