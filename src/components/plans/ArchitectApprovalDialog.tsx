import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  ShieldCheck,
  Lock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Stamp,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { usePlanMarkups } from "@/hooks/usePlanMarkups";
import { toast } from "sonner";

interface ArchitectApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onApproved?: () => void;
}

interface ArchitectProfile {
  id: string;
  user_id: string;
  seal_image_url: string | null;
  signature_image_url: string | null;
  license_number: string | null;
  license_state: string | null;
}

export function ArchitectApprovalDialog({
  open,
  onOpenChange,
  projectId,
  onApproved,
}: ArchitectApprovalDialogProps) {
  const { user } = useAuth();
  const { markups, approveAll, refetch } = usePlanMarkups(projectId);

  const [password, setPassword] = useState("");
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ArchitectProfile | null>(null);
  const [sealUrl, setSealUrl] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const pendingMarkups = markups.filter((m) => m.status === "pending");
  const approvedMarkups = markups.filter((m) => m.status === "approved");
  const totalMarkups = markups.length;

  const fetchArchitectProfile = useCallback(async () => {
    if (!user) return;
    setLoadingProfile(true);
    try {
      const { data, error } = await supabase
        .from("architect_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setProfile(data as ArchitectProfile);
        if (data.seal_image_url) {
          const { data: urlData } = await supabase.storage
            .from("project-documents")
            .createSignedUrl(data.seal_image_url, 3600);
          if (urlData) setSealUrl(urlData.signedUrl);
        }
      }
    } catch (err) {
      console.error("Error fetching architect profile:", err);
    } finally {
      setLoadingProfile(false);
    }
  }, [user]);

  useEffect(() => {
    if (open) {
      fetchArchitectProfile();
      setPassword("");
      setAuthError(null);
    }
  }, [open, fetchArchitectProfile]);

  const handleApprove = async () => {
    if (!user || !password.trim()) {
      setAuthError("Password is required");
      return;
    }

    setAuthenticating(true);
    setAuthError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: password,
      });

      if (signInError) {
        setAuthError("Authentication failed. Please check your password.");
        return;
      }

      await approveAll();
      await refetch();

      toast.success("All markups approved and sealed");
      onApproved?.();
      onOpenChange(false);
    } catch (err: any) {
      setAuthError(err.message || "Failed to approve markups");
    } finally {
      setAuthenticating(false);
    }
  };

  const hasProfile = profile && (profile.seal_image_url || profile.license_number);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-architect-approval">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Architect Approval
          </DialogTitle>
          <DialogDescription>
            Approve all pending plan markups for this project. This action requires password verification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge variant="outline" data-testid="badge-total-markups">
                {totalMarkups} Total
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={pendingMarkups.length > 0 ? "destructive" : "secondary"}
                data-testid="badge-pending-markups"
              >
                {pendingMarkups.length} Pending
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" data-testid="badge-approved-markups">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                {approvedMarkups.length} Approved
              </Badge>
            </div>
          </div>

          {pendingMarkups.length === 0 && (
            <Alert data-testid="alert-no-pending">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                All markups are already approved. No action needed.
              </AlertDescription>
            </Alert>
          )}

          {pendingMarkups.length > 0 && !hasProfile && (
            <Alert variant="destructive" data-testid="alert-no-profile">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No architect profile found. Please set up your seal and license in Settings before approving.
              </AlertDescription>
            </Alert>
          )}

          {sealUrl && (
            <div className="flex flex-col items-center gap-2">
              <Separator />
              <Label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Stamp className="h-4 w-4" />
                Seal Preview
              </Label>
              <div className="border rounded-md p-3 bg-muted/30 inline-flex items-center justify-center">
                <img
                  src={sealUrl}
                  alt="Architect seal"
                  className="max-h-24 max-w-36 object-contain opacity-60"
                  data-testid="img-approval-seal-preview"
                />
              </div>
              {profile?.license_number && (
                <span className="text-xs text-muted-foreground" data-testid="text-license-info">
                  License: {profile.license_number}
                  {profile.license_state ? ` (${profile.license_state})` : ""}
                </span>
              )}
            </div>
          )}

          {pendingMarkups.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label htmlFor="approval-password" className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-muted-foreground" />
                  Confirm Password
                </Label>
                <Input
                  id="approval-password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setAuthError(null);
                  }}
                  placeholder="Enter your account password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password.trim()) handleApprove();
                  }}
                  data-testid="input-approval-password"
                />
                {authError && (
                  <p className="text-sm text-destructive flex items-center gap-1" data-testid="text-auth-error">
                    <AlertCircle className="h-3 w-3" />
                    {authError}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-approval"
          >
            Cancel
          </Button>
          {pendingMarkups.length > 0 && (
            <Button
              onClick={handleApprove}
              disabled={authenticating || !password.trim()}
              data-testid="button-confirm-approval"
            >
              {authenticating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Approve {pendingMarkups.length} Markup{pendingMarkups.length !== 1 ? "s" : ""}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useApprovalGate(projectId: string | undefined) {
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const checkApprovalStatus = useCallback(async () => {
    if (!projectId) {
      setPendingCount(0);
      setLoading(false);
      return;
    }

    try {
      const { count, error } = await supabase
        .from("plan_markups")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "pending");

      if (error) throw error;
      setPendingCount(count || 0);
    } catch (err) {
      console.error("Error checking approval status:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    checkApprovalStatus();
  }, [checkApprovalStatus]);

  return {
    hasPendingMarkups: pendingCount > 0,
    pendingCount,
    loading,
    refetch: checkApprovalStatus,
    qualityCheckBlocked: pendingCount > 0,
  };
}

interface SealWatermarkProps {
  projectId: string;
  className?: string;
}

export function SealWatermark({ projectId, className }: SealWatermarkProps) {
  const [sealUrl, setSealUrl] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState(false);

  useEffect(() => {
    const checkApproval = async () => {
      const { count } = await supabase
        .from("plan_markups")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "approved");

      if (!count || count === 0) return;

      const { data: markupData } = await supabase
        .from("plan_markups")
        .select("approved_by")
        .eq("project_id", projectId)
        .eq("status", "approved")
        .not("approved_by", "is", null)
        .limit(1);

      if (!markupData || markupData.length === 0) return;

      const approvedBy = markupData[0].approved_by;
      if (!approvedBy) return;

      const { data: profileData } = await supabase
        .from("architect_profiles")
        .select("seal_image_url")
        .eq("user_id", approvedBy)
        .maybeSingle();

      if (!profileData?.seal_image_url) return;

      const { data: urlData } = await supabase.storage
        .from("project-documents")
        .createSignedUrl(profileData.seal_image_url, 3600);

      if (urlData) {
        setSealUrl(urlData.signedUrl);
        setIsApproved(true);
      }
    };

    checkApproval();
  }, [projectId]);

  if (!isApproved || !sealUrl) return null;

  return (
    <div
      className={`pointer-events-none absolute bottom-4 right-4 opacity-20 ${className || ""}`}
      data-testid="seal-watermark"
    >
      <img
        src={sealUrl}
        alt="Architect seal watermark"
        className="h-32 w-32 object-contain"
        data-testid="img-seal-watermark"
      />
    </div>
  );
}
