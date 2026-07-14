import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Users, Mail, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { TEAM_ROLE_LABELS, TeamRole } from '@/types/team';
import {
  InvitationPreview,
  InvitationStatus,
  inviteAuthRedirectPath,
  isInvitationTokenFormatValid,
  normalizeInviteEmail,
  parseInviteErrorMessage,
  validateInvitationAccept,
} from '@/lib/projectTeamInvitationLogic';

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [acting, setActing] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!token || !isInvitationTokenFormatValid(token)) {
      setPreview({ valid: false, reason: 'invalid_token' });
      setLoadingPreview(false);
      return;
    }

    setLoadingPreview(true);
    try {
      const { data, error } = await supabase.rpc('preview_project_team_invitation', {
        p_accept_token: token,
      });
      if (error) throw error;
      setPreview(data as InvitationPreview);
    } catch (err) {
      console.error('Preview error:', err);
      setPreview({ valid: false, reason: 'error' });
    } finally {
      setLoadingPreview(false);
    }
  }, [token]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const userEmailMatches =
    user?.email &&
    preview?.invited_email &&
    normalizeInviteEmail(user.email) === normalizeInviteEmail(preview.invited_email);

  const handleAccept = async () => {
    if (!token || !user?.email || !preview?.invited_email) return;

    const validation = validateInvitationAccept({
      invitation: {
        status: (preview.status || 'pending') as InvitationStatus,
        expiresAt: preview.expires_at || new Date().toISOString(),
        invitedEmail: preview.invited_email,
        role: (preview.role || 'viewer') as TeamRole,
        projectId: 'preview-only',
      },
      userEmail: user.email,
      now: new Date(),
    });

    if (!validation.ok) {
      toast.error(validation.message);
      return;
    }

    setActing(true);
    try {
      const { data, error } = await supabase.rpc('accept_project_team_invitation', {
        p_accept_token: token,
      });
      if (error) throw error;

      const result = data as { project_id?: string; role?: string };
      setAccepted(true);
      toast.success(`You joined as ${TEAM_ROLE_LABELS[(result.role as TeamRole) || 'viewer']}`);

      if (result.project_id) {
        setTimeout(() => navigate('/projects', { replace: true }), 1500);
      }
    } catch (err) {
      toast.error(parseInviteErrorMessage(err));
    } finally {
      setActing(false);
    }
  };

  const handleDecline = async () => {
    if (!token) return;
    setActing(true);
    try {
      const { error } = await supabase.rpc('decline_project_team_invitation', {
        p_accept_token: token,
      });
      if (error) throw error;
      setDeclined(true);
      toast.success('Invitation declined');
    } catch (err) {
      toast.error(parseInviteErrorMessage(err));
    } finally {
      setActing(false);
    }
  };

  const authRedirect = token ? inviteAuthRedirectPath(token) : '/dashboard';

  if (loadingPreview || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!preview || preview.reason === 'not_found' || preview.reason === 'invalid_token') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold">Invitation not found</h1>
          <p className="text-muted-foreground text-sm">
            This invitation link is invalid or has been removed.
          </p>
          <Button asChild variant="outline">
            <Link to="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-semibold">Welcome to the team!</h1>
          <p className="text-muted-foreground text-sm">
            You now have access to <strong>{preview.project_name}</strong>.
          </p>
          <Button onClick={() => navigate('/projects')}>Open projects</Button>
        </div>
      </div>
    );
  }

  if (declined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md text-center space-y-4">
          <XCircle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold">Invitation declined</h1>
          <Button asChild variant="outline">
            <Link to="/dashboard">Go to dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  const isExpired = preview.is_expired || preview.status === 'expired';
  const isInactive = preview.status !== 'pending' || isExpired;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-lg w-full rounded-xl border border-border bg-card p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-semibold">Project team invitation</h1>
        </div>

        <div className="space-y-3 text-sm">
          <p>
            <span className="text-muted-foreground">Project:</span>{' '}
            <strong>{preview.project_name}</strong>
          </p>
          <p>
            <span className="text-muted-foreground">Invited by:</span>{' '}
            {preview.inviter_name}
          </p>
          <p className="flex items-center gap-2">
            <span className="text-muted-foreground">Role:</span>
            <Badge variant="secondary">
              {TEAM_ROLE_LABELS[(preview.role as TeamRole) || 'viewer']}
            </Badge>
          </p>
          <p className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span>{preview.invited_email}</span>
          </p>
          {preview.expires_at && (
            <p className="text-muted-foreground text-xs">
              Expires {new Date(preview.expires_at).toLocaleDateString()}
            </p>
          )}
        </div>

        {isInactive ? (
          <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            This invitation is {preview.status === 'revoked' ? 'revoked' : preview.status}.
            Contact the project owner for a new invite.
          </div>
        ) : !user ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sign in or create an account with <strong>{preview.invited_email}</strong> to
              accept this invitation.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/auth" state={{ from: { pathname: authRedirect } }}>
                  Sign in
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link
                  to="/auth"
                  state={{
                    from: { pathname: authRedirect },
                    inviteEmail: preview.invited_email,
                    authView: 'signup',
                  }}
                >
                  Create account
                </Link>
              </Button>
            </div>
          </div>
        ) : !userEmailMatches ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              You are signed in as <strong>{user.email}</strong>, but this invitation was sent
              to <strong>{preview.invited_email}</strong>. Sign in with the invited email to
              continue.
            </div>
            <Button asChild variant="outline">
              <Link to="/auth" state={{ from: { pathname: authRedirect } }}>
                Switch account
              </Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleAccept} disabled={acting}>
              {acting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Accept invitation
            </Button>
            <Button variant="outline" onClick={handleDecline} disabled={acting}>
              Decline
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
