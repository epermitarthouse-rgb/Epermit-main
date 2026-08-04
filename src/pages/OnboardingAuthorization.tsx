import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SignatureCanvas } from "react-signature-canvas";
import { z } from "zod";
import { CheckCircle2, Eraser, FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import communEtLogo from "@/assets/commun-et-logo-transparent.webp";

const AUTHORIZATION_SCOPE =
  "Commun-ET LLC and all of its employees, officers, and duly authorized agents, representatives, and subcontractors";

const formSchema = z.object({
  owner_entity: z.string().trim().min(2).max(200),
  project_address: z.string().trim().min(5).max(500),
  additional_parties: z.string().trim().max(500).optional().or(z.literal("")),
  signer_name: z.string().trim().min(2).max(160),
  signer_title: z.string().trim().min(2).max(160),
  signer_company: z.string().trim().min(2).max(200),
  signer_email: z.string().trim().email().max(255),
  signer_phone: z.string().trim().max(40).optional().or(z.literal("")),
  effective_date: z.string().min(10).max(10),
});

type Profile = {
  full_name: string | null;
  title: string | null;
  company: string | null;
  phone: string | null;
  email: string;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Letter of Authorization UI (Lovable `/onboarding/authorization`).
 * Visual + client-side validation only — persistence requires PD-4
 * `client_authorizations` + signatures storage (not in PermitPilot yet).
 */
const OnboardingAuthorization = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [typedSignature, setTypedSignature] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sigEmpty, setSigEmpty] = useState(true);
  const sigPadRef = useRef<InstanceType<typeof SignatureCanvas> | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth", { replace: true });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data: p } = await supabase
        .from("profiles")
        .select("full_name,job_title,company_name,phone")
        .eq("user_id", user.id)
        .maybeSingle();
      if (p) {
        setProfile({
          full_name: p.full_name ?? null,
          title: p.job_title ?? null,
          company: p.company_name ?? null,
          phone: p.phone ?? null,
          email: user.email ?? "",
        });
      } else {
        setProfile({
          full_name: null,
          title: null,
          company: null,
          phone: null,
          email: user.email ?? "",
        });
      }
    })();
  }, [user]);

  const clearPad = () => {
    sigPadRef.current?.clear();
    setSigEmpty(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) return;
    if (!acknowledged) {
      toast({
        title: "Acknowledgement required",
        description: "Please confirm the authorization terms.",
        variant: "destructive",
      });
      return;
    }
    const form = new FormData(event.currentTarget);
    const parsed = formSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      toast({
        title: "Missing or invalid field",
        description: `${first.path.join(".")} — ${first.message}`,
        variant: "destructive",
      });
      return;
    }

    if (mode === "typed") {
      const t = typedSignature.trim();
      if (t.length < 2) {
        toast({
          title: "Signature required",
          description: "Type your full legal name to sign.",
          variant: "destructive",
        });
        return;
      }
      if (t.toLowerCase() !== parsed.data.signer_name.toLowerCase()) {
        toast({
          title: "Signature does not match",
          description: "Typed signature must match the signer name exactly.",
          variant: "destructive",
        });
        return;
      }
    } else if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
      toast({
        title: "Signature required",
        description: "Please draw your signature.",
        variant: "destructive",
      });
      return;
    }

    // No client_authorizations / signatures bucket in PermitPilot — do not fake a save.
    setSubmitting(true);
    try {
      toast({
        title: "Upcoming",
        description:
          "LOA signing is not connected yet. Requires client_authorizations + signatures storage (PD-4). Your form was not saved.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Redirecting to sign in…
      </div>
    );
  }

  return (
    <div className="container-page space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-4">
          <span className="inline-flex h-14 shrink-0 items-center justify-center">
            <img
              src={communEtLogo}
              alt="Commun-ET LLC"
              className="h-full w-auto max-w-full object-contain"
            />
          </span>
          <div>
            <div className="pilot-kicker text-primary">Onboarding · Client Authorization</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
              Letter of Authorization
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Executed electronically. Extends to Commun-ET LLC and all of its employees, officers,
              and authorized agents.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 md:items-end">
          <span className="inline-flex items-center rounded-md border border-border bg-muted/50 px-2 py-0.5 font-data text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Upcoming
          </span>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-data">{user?.email}</span>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form
          key={profile ? `signer-${profile.email}` : "signer-loading"}
          onSubmit={handleSubmit}
          className="pilot-card space-y-6 p-6"
        >
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="pilot-kicker text-primary">Property & Project</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="pilot-kicker">Property owner / entity</span>
                <input
                  name="owner_entity"
                  required
                  maxLength={200}
                  className="pilot-input mt-2 w-full"
                  placeholder="e.g. Golden Arch Realty Corporation"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="pilot-kicker">Project address</span>
                <textarea
                  name="project_address"
                  required
                  maxLength={500}
                  rows={2}
                  className="pilot-input mt-2 h-auto min-h-[2.5rem] w-full py-2"
                  placeholder="Street address, city, state, ZIP"
                />
              </label>
              <label className="block md:col-span-2">
                <span className="pilot-kicker">Additional parties (optional)</span>
                <input
                  name="additional_parties"
                  maxLength={500}
                  className="pilot-input mt-2 w-full"
                  placeholder="e.g. Tenant / franchisee entity"
                />
              </label>
            </div>
          </section>

          <section className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
            <div className="pilot-kicker text-primary">Authorization</div>
            <p className="mt-2">
              As a representative of the property owner named above, I hereby authorize{" "}
              <strong>{AUTHORIZATION_SCOPE}</strong> to act as agents on the property owner's behalf
              for the project at the address above, including but not limited to submitting permit
              applications, responding to jurisdictional comments, coordinating with utilities,
              requesting inspections, and executing routine permitting documents. This authorization
              is valid until further written notice.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <FileSignature className="h-4 w-4 text-primary" />
              <span className="pilot-kicker text-primary">Signer</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="pilot-kicker">Full name</span>
                <input
                  name="signer_name"
                  required
                  maxLength={160}
                  defaultValue={profile?.full_name ?? ""}
                  className="pilot-input mt-2 w-full"
                />
              </label>
              <label className="block">
                <span className="pilot-kicker">Title</span>
                <input
                  name="signer_title"
                  required
                  maxLength={160}
                  defaultValue={profile?.title ?? ""}
                  className="pilot-input mt-2 w-full"
                />
              </label>
              <label className="block">
                <span className="pilot-kicker">Company</span>
                <input
                  name="signer_company"
                  required
                  maxLength={200}
                  defaultValue={profile?.company ?? ""}
                  className="pilot-input mt-2 w-full"
                />
              </label>
              <label className="block">
                <span className="pilot-kicker">Phone</span>
                <input
                  name="signer_phone"
                  maxLength={40}
                  defaultValue={profile?.phone ?? ""}
                  className="pilot-input mt-2 w-full"
                />
              </label>
              <label className="block">
                <span className="pilot-kicker">Email</span>
                <input
                  name="signer_email"
                  type="email"
                  required
                  maxLength={255}
                  defaultValue={profile?.email ?? user?.email ?? ""}
                  className="pilot-input mt-2 w-full"
                />
              </label>
              <label className="block">
                <span className="pilot-kicker">Effective date</span>
                <input
                  name="effective_date"
                  type="date"
                  required
                  defaultValue={todayIso()}
                  className="pilot-input mt-2 w-full"
                />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-primary" />
                <span className="pilot-kicker text-primary">Signature</span>
              </div>
              <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
                {(["typed", "drawn"] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "rounded px-3 py-1.5 capitalize transition-colors",
                      mode === m
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {mode === "typed" ? (
              <div>
                <input
                  className="pilot-input w-full font-display text-2xl italic"
                  placeholder="Type your full legal name"
                  value={typedSignature}
                  onChange={(e) => setTypedSignature(e.target.value.slice(0, 160))}
                  maxLength={160}
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Must match the signer name exactly. Serves as your electronic signature under the
                  E-SIGN Act.
                </p>
              </div>
            ) : (
              <div>
                <div className="rounded-md border border-border bg-white">
                  <SignatureCanvas
                    ref={(el) => {
                      sigPadRef.current = el;
                    }}
                    penColor="#0b3d91"
                    clearOnResize={false}
                    canvasProps={{ className: "h-40 w-full rounded-md touch-none" }}
                    onEnd={() => setSigEmpty(false)}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Sign with mouse, stylus, or finger.</span>
                  <button
                    type="button"
                    onClick={clearPad}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <Eraser className="h-3 w-3" /> Clear
                  </button>
                </div>
                {sigEmpty && (
                  <p className="text-[11px] text-muted-foreground">Signature is empty.</p>
                )}
              </div>
            )}
          </section>

          <label className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              I acknowledge that I am an authorized representative of the property owner and I
              intend this electronic signature to be the legal equivalent of my handwritten
              signature. I understand this Letter of Authorization extends to {AUTHORIZATION_SCOPE}.
            </span>
          </label>

          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={submitting || !acknowledged}
              className="pilot-button-primary disabled:opacity-60"
              title="Upcoming — signing persistence not connected"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSignature className="h-4 w-4" />
              )}
              {submitting ? "Signing…" : "Sign & Execute"}
              <span className="ml-1 rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
                Upcoming
              </span>
            </button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="pilot-card p-5">
            <h3 className="flex items-center gap-2 font-tight text-base font-bold">
              <CheckCircle2 className="h-4 w-4 text-success" /> Executed LOAs
            </h3>
            <p className="mt-3 text-sm text-muted-foreground">
              None yet. Once signing is connected (PD-4), your Letters of Authorization will appear
              here.
            </p>
          </div>
          <div className="pilot-card p-5 text-xs leading-6 text-muted-foreground">
            <div className="pilot-kicker text-primary">Legal note</div>
            <p className="mt-2">
              Electronic signatures are captured with timestamp and browser fingerprint. This
              authorization remains in effect until revoked in writing.
            </p>
            <p className="mt-2 rounded border border-border bg-muted/30 p-2">
              <span className="font-semibold text-foreground">Upcoming:</span> persistence requires
              the <span className="font-data">client_authorizations</span> table and signatures
              storage bucket.
            </p>
            <Link to="/dashboard" className="mt-3 inline-flex text-primary hover:underline">
              Return to dashboard →
            </Link>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default OnboardingAuthorization;
