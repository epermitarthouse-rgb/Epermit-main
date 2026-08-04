import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CheckCircle2, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logAccessEvent } from "@/lib/accessAudit";
import logoAsset from "@/assets/commun-et-logo.jpg.asset.json";

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      toast({ title: "Missing details", description: "Enter your email and password.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setSubmitting(false);
      void logAccessEvent({
        event: "sign_in_failed",
        email,
        reason: error.message,
        path: "/login",
      });
      toast({ title: "Sign-in failed", description: error.message, variant: "destructive" });
      return;
    }
    // Block rejected members permanently
    const { data: profile } = await supabase
      .from("profiles")
      .select("approval_status,rejection_reason")
      .eq("id", data.user!.id)
      .maybeSingle();
    if (profile?.approval_status === "rejected") {
      await supabase.auth.signOut();
      setSubmitting(false);
      void logAccessEvent({
        event: "access_denied",
        email,
        userId: data.user?.id ?? null,
        reason: profile.rejection_reason ?? "Membership request rejected",
        path: "/login",
      });
      toast({
        title: "Access denied",
        description:
          profile.rejection_reason
            ? `Your request was rejected: ${profile.rejection_reason}`
            : "Your membership request was rejected. Contact your workspace admin.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(false);
    void logAccessEvent({
      event: "sign_in",
      email,
      userId: data.user?.id ?? null,
      path: "/login",
    });
    navigate("/onboarding/authorization");
  };

  return (
    <main className="min-h-screen bg-background text-foreground signal-grid">
      <div className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative hidden overflow-hidden border-r border-border p-10 lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-x-0 top-1/4 h-48 bg-primary/10 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <div className="rounded-md bg-white p-2 shadow-sm">
              <img src={logoAsset.url} alt="Commun-ET LLC" className="h-10 w-auto" />
            </div>
            <div>
              <div className="font-tight text-2xl font-black tracking-tight">PermitPilot</div>
              <div className="pilot-kicker">by Commun-ET LLC</div>
            </div>
          </div>
          <div className="relative max-w-2xl">
            <div className="pilot-kicker text-primary">Permitting · Utility Coordination · Results</div>
            <h1 className="mt-5 font-display text-6xl font-semibold leading-none tracking-tight">
              The operating layer for permit-critical work.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
              Mission control, DesignCheck agents, queue management, document intelligence, utility mapping, and closeout in one product shell.
            </p>
          </div>
          <div className="relative grid grid-cols-3 gap-3">
            {["Portal Harvest", "DesignCheck", "Agent Control"].map((item) => (
              <div key={item} className="pilot-card p-4">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <div className="mt-3 font-tight text-sm font-semibold">{item}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10">
          <div className="w-full max-w-md">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <div className="rounded-md bg-white p-2 shadow-sm">
                <img src={logoAsset.url} alt="Commun-ET LLC" className="h-8 w-auto" />
              </div>
              <div>
                <div className="font-tight text-xl font-black">PermitPilot</div>
                <div className="pilot-kicker">by Commun-ET LLC</div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="pilot-card-raised p-6 md:p-8">
              <div className="mb-7">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Lock className="h-6 w-6" />
                </div>
                <h2 className="mt-5 font-tight text-2xl font-black tracking-tight">Sign in</h2>
                <p className="mt-2 text-sm text-muted-foreground">Access the PermitPilot redesign workspace.</p>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="pilot-kicker">Email Address</span>
                  <input name="email" className="pilot-input mt-2 w-full" type="email" required autoComplete="email" />
                </label>
                <label className="block">
                  <span className="pilot-kicker">Password</span>
                  <input name="password" className="pilot-input mt-2 w-full" type="password" required autoComplete="current-password" />
                </label>
              </div>

              <button className="pilot-button-primary mt-6 w-full" type="submit" disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in"}
                <ArrowRight className="h-4 w-4" />
              </button>

              <Link to="/signup" className="pilot-button-ghost mt-3 w-full">
                <KeyRound className="h-4 w-4" />
                Create a client account
              </Link>

              <div className="mt-6 flex items-start gap-2 rounded-md border border-border bg-muted p-3 text-xs leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                Clients sign in to review projects and execute the Letter of Authorization.
              </div>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
};

export default Login;