import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import {
  isPasswordRecoveryUrl,
  resetPasswordSchema,
} from "@/lib/authPasswordReset";
import { toast } from "sonner";

const RECOVERY_CHECK_MS = 2500;

export default function ResetPassword() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let resolved = false;

    const markReady = () => {
      if (cancelled || resolved) return;
      resolved = true;
      setRecoveryReady(true);
      setChecking(false);
    };

    const markInvalid = (message: string) => {
      if (cancelled || resolved) return;
      resolved = true;
      setRecoveryError(message);
      setChecking(false);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session) {
        markReady();
      }
    });

    const timeoutId = window.setTimeout(() => {
      if (!resolved) {
        markInvalid(
          "This password reset link is invalid or has expired. Request a new link from the sign-in page.",
        );
      }
    }, RECOVERY_CHECK_MS);

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || resolved) return;
      if (session && isPasswordRecoveryUrl()) {
        markReady();
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = resetPasswordSchema.safeParse({ newPassword, confirmPassword });
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

    try {
      const { error } = await supabase.auth.updateUser({
        password: parsed.data.newPassword,
      });
      if (error) throw error;

      await supabase.auth.signOut();
      toast.success("Password updated. Sign in with your new password.");
      navigate("/auth", { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setSaving(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (recoveryError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Reset link unavailable</h1>
          <p className="mt-3 text-sm text-muted-foreground">{recoveryError}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/auth/forgot-password">Request new link</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/auth">Back to sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!recoveryReady) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Choose a new password</h1>
            <p className="text-sm text-muted-foreground">
              Enter a new password for your PermitPilot account.
            </p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-2">
            <Label htmlFor="reset-new-password">New password</Label>
            <div className="relative">
              <Input
                id="reset-new-password"
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
            <Label htmlFor="reset-confirm-password">Confirm new password</Label>
            <div className="relative">
              <Input
                id="reset-confirm-password"
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
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            {errors.confirmPassword ? (
              <p className="text-xs text-destructive">{errors.confirmPassword}</p>
            ) : null}
          </div>

          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Update password
          </Button>
        </form>
      </div>
    </div>
  );
}
