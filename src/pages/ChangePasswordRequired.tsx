import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { isDeactivatedProfile, shouldForcePasswordChange } from "@/lib/profileSecurity";
import { toast } from "sonner";

const passwordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export default function ChangePasswordRequired() {
  const navigate = useNavigate();
  const {
    user,
    loading,
    profileSecurity,
    signOut,
    completeRequiredPasswordChange,
    refreshProfileSecurity,
  } = useAuth();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [profileUpdateWarning, setProfileUpdateWarning] = useState<string | null>(null);

  useEffect(() => {
    if (loading || profileSecurity.loading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (isDeactivatedProfile(profileSecurity)) {
      void signOut();
      navigate("/auth", { replace: true, state: { deactivated: true } });
      return;
    }
    if (!shouldForcePasswordChange(profileSecurity)) {
      navigate("/dashboard", { replace: true });
    }
  }, [user, loading, profileSecurity, navigate, signOut]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = passwordSchema.safeParse({ newPassword, confirmPassword });
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString();
        if (key) nextErrors[key] = issue.message;
      }
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    setErrors({});
    setProfileUpdateWarning(null);

    try {
      const { error: authError } = await supabase.auth.updateUser({
        password: parsed.data.newPassword,
      });
      if (authError) throw authError;

      const { error: profileError } = await completeRequiredPasswordChange();
      if (profileError) {
        setProfileUpdateWarning(
          "Your password was updated, but we could not clear the required-change flag. Try again or contact support.",
        );
        await refreshProfileSecurity();
        setSaving(false);
        return;
      }

      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated. Welcome to PermitPilot.");
      navigate("/dashboard", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setSaving(false);
    }
  };

  if (loading || profileSecurity.loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Change your password</h1>
            <p className="text-sm text-muted-foreground">
              You&apos;re using a temporary password created by an administrator. Set a new
              password to continue.
            </p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-2">
            <Label htmlFor="new-password">New password</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={saving}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2"
                onClick={() => setShowNewPassword((prev) => !prev)}
              >
                {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {errors.newPassword ? (
              <p className="text-xs text-destructive">{errors.newPassword}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={saving}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 h-7 -translate-y-1/2 px-2"
                onClick={() => setShowConfirmPassword((prev) => !prev)}
              >
                {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            {errors.confirmPassword ? (
              <p className="text-xs text-destructive">{errors.confirmPassword}</p>
            ) : null}
          </div>

          {profileUpdateWarning ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">{profileUpdateWarning}</p>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save new password
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
