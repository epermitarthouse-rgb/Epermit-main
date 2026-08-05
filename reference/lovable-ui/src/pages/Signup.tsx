import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { ArrowRight, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import logoAsset from "@/assets/commun-et-logo.jpg.asset.json";

const schema = z.object({
  full_name: z.string().trim().min(1, "Full name is required").max(120),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  company: z.string().trim().min(1, "Company is required").max(160),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email().max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const Signup = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = schema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      toast({ title: "Check your details", description: first.message, variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const { email, password, full_name, title, company, phone } = parsed.data;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding/authorization`,
        data: { full_name, title: title ?? "", company, phone: phone ?? "" },
      },
    });
    setSubmitting(false);
    if (error) {
      toast({ title: "Sign-up failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Account created",
      description: "Check your email to confirm, then sign the Letter of Authorization.",
    });
    navigate("/onboarding/authorization");
  };

  return (
    <main className="min-h-screen bg-background text-foreground signal-grid">
      <div className="mx-auto flex min-h-screen max-w-2xl items-center justify-center px-5 py-10">
        <div className="w-full">
          <div className="mb-6 flex items-center justify-center">
            <img src={logoAsset.url} alt="Commun-ET LLC" className="h-16 w-auto" />
          </div>
          <form onSubmit={handleSubmit} className="pilot-card-raised p-6 md:p-8">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
              <UserPlus className="h-6 w-6" />
            </div>
            <h2 className="font-tight text-2xl font-black tracking-tight">Create your client account</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              We use this to prefill your Letter of Authorization and keep an audit trail.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="pilot-kicker">Full name</span>
                <input name="full_name" required maxLength={120} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block">
                <span className="pilot-kicker">Title</span>
                <input name="title" maxLength={120} className="pilot-input mt-2 w-full" placeholder="e.g. Construction Manager" />
              </label>
              <label className="block md:col-span-2">
                <span className="pilot-kicker">Company</span>
                <input name="company" required maxLength={160} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block">
                <span className="pilot-kicker">Phone</span>
                <input name="phone" maxLength={40} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block">
                <span className="pilot-kicker">Email</span>
                <input name="email" type="email" required maxLength={255} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block md:col-span-2">
                <span className="pilot-kicker">Password</span>
                <input name="password" type="password" required minLength={8} maxLength={128} className="pilot-input mt-2 w-full" />
                <span className="mt-1 block text-[11px] text-muted-foreground">Minimum 8 characters.</span>
              </label>
            </div>

            <button className="pilot-button-primary mt-6 w-full" type="submit" disabled={submitting}>
              {submitting ? "Creating account…" : "Create account"}
              <ArrowRight className="h-4 w-4" />
            </button>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Already have an account?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
};

export default Signup;