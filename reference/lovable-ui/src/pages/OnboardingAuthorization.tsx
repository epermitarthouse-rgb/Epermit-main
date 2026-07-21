import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import SignatureCanvas from "react-signature-canvas";
import { z } from "zod";
import { CheckCircle2, Eraser, FileSignature, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import logoAsset from "@/assets/commun-et-logo.jpg.asset.json";

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

type SignedLoa = {
  id: string;
  owner_entity: string;
  project_address: string;
  signer_name: string;
  signed_at: string;
  signature_method: "typed" | "drawn";
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const OnboardingAuthorization = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [signedLoas, setSignedLoas] = useState<SignedLoa[]>([]);
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [typedSignature, setTypedSignature] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sigEmpty, setSigEmpty] = useState(true);
  const sigPadRef = useRef<SignatureCanvas | null>(null);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login", { replace: true });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const [{ data: p }, { data: docs }] = await Promise.all([
        supabase.from("profiles").select("full_name,title,company,phone,email").eq("id", user.id).maybeSingle(),
        supabase
          .from("client_authorizations")
          .select("id,owner_entity,project_address,signer_name,signed_at,signature_method")
          .order("signed_at", { ascending: false }),
      ]);
      if (p) setProfile(p as Profile);
      if (docs) setSignedLoas(docs as SignedLoa[]);
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
      toast({ title: "Acknowledgement required", description: "Please confirm the authorization terms.", variant: "destructive" });
      return;
    }
    const form = new FormData(event.currentTarget);
    const parsed = formSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      toast({ title: "Missing or invalid field", description: `${first.path.join(".")} — ${first.message}`, variant: "destructive" });
      return;
    }

    let signatureImagePath: string | null = null;
    let typed: string | null = null;

    if (mode === "typed") {
      const t = typedSignature.trim();
      if (t.length < 2) {
        toast({ title: "Signature required", description: "Type your full legal name to sign.", variant: "destructive" });
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
      typed = t;
    } else {
      if (!sigPadRef.current || sigPadRef.current.isEmpty()) {
        toast({ title: "Signature required", description: "Please draw your signature.", variant: "destructive" });
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === "drawn" && sigPadRef.current) {
        const dataUrl = sigPadRef.current.getTrimmedCanvas().toDataURL("image/png");
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${user.id}/${crypto.randomUUID()}.png`;
        const { error: upErr } = await supabase.storage.from("signatures").upload(path, blob, {
          contentType: "image/png",
          upsert: false,
        });
        if (upErr) throw upErr;
        signatureImagePath = path;
      }

      const ua = navigator.userAgent;
      const { error: insErr, data: inserted } = await supabase
        .from("client_authorizations")
        .insert({
          user_id: user.id,
          owner_entity: parsed.data.owner_entity,
          project_address: parsed.data.project_address,
          additional_parties: parsed.data.additional_parties || null,
          signer_name: parsed.data.signer_name,
          signer_title: parsed.data.signer_title,
          signer_company: parsed.data.signer_company,
          signer_email: parsed.data.signer_email,
          signer_phone: parsed.data.signer_phone || null,
          effective_date: parsed.data.effective_date,
          authorization_scope: AUTHORIZATION_SCOPE,
          signature_method: mode,
          typed_signature: typed,
          signature_image_path: signatureImagePath,
          acknowledged: true,
          user_agent: ua,
        })
        .select("id,owner_entity,project_address,signer_name,signed_at,signature_method")
        .single();
      if (insErr) throw insErr;

      toast({ title: "Letter of Authorization signed", description: "A record has been saved to your account." });
      setSignedLoas((prev) => [inserted as SignedLoa, ...prev]);
      setAcknowledged(false);
      setTypedSignature("");
      clearPad();
      (event.currentTarget as HTMLFormElement).reset();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Signing failed", description: msg, variant: "destructive" });
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

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-4">
          <img src={logoAsset.url} alt="Commun-ET LLC" className="h-14 w-auto" />
          <div>
            <div className="pilot-kicker text-primary">Onboarding · Client Authorization</div>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Letter of Authorization</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Executed electronically. Extends to Commun-ET LLC and all of its employees, officers, and authorized agents.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-data">{user?.email}</span>
          <button type="button" onClick={() => signOut().then(() => navigate("/login"))} className="pilot-button-ghost">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <form onSubmit={handleSubmit} className="pilot-card space-y-6 p-6">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="pilot-kicker text-primary">Property & Project</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="pilot-kicker">Property owner / entity</span>
                <input name="owner_entity" required maxLength={200} className="pilot-input mt-2 w-full" placeholder="e.g. Golden Arch Realty Corporation" />
              </label>
              <label className="block md:col-span-2">
                <span className="pilot-kicker">Project address</span>
                <textarea name="project_address" required maxLength={500} rows={2} className="pilot-input mt-2 w-full" placeholder="Street address, city, state, ZIP" />
              </label>
              <label className="block md:col-span-2">
                <span className="pilot-kicker">Additional parties (optional)</span>
                <input name="additional_parties" maxLength={500} className="pilot-input mt-2 w-full" placeholder="e.g. Tenant / franchisee entity" />
              </label>
            </div>
          </section>

          <section className="rounded-md border border-primary/20 bg-primary/5 p-4 text-sm leading-6">
            <div className="pilot-kicker text-primary">Authorization</div>
            <p className="mt-2">
              As a representative of the property owner named above, I hereby authorize{" "}
              <strong>{AUTHORIZATION_SCOPE}</strong> to act as agents on the property owner's behalf for the project at the
              address above, including but not limited to submitting permit applications, responding to jurisdictional comments,
              coordinating with utilities, requesting inspections, and executing routine permitting documents. This
              authorization is valid until further written notice.
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
                <input name="signer_name" required maxLength={160} defaultValue={profile?.full_name ?? ""} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block">
                <span className="pilot-kicker">Title</span>
                <input name="signer_title" required maxLength={160} defaultValue={profile?.title ?? ""} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block">
                <span className="pilot-kicker">Company</span>
                <input name="signer_company" required maxLength={200} defaultValue={profile?.company ?? ""} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block">
                <span className="pilot-kicker">Phone</span>
                <input name="signer_phone" maxLength={40} defaultValue={profile?.phone ?? ""} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block">
                <span className="pilot-kicker">Email</span>
                <input name="signer_email" type="email" required maxLength={255} defaultValue={profile?.email ?? user?.email ?? ""} className="pilot-input mt-2 w-full" />
              </label>
              <label className="block">
                <span className="pilot-kicker">Effective date</span>
                <input name="effective_date" type="date" required defaultValue={todayIso()} className="pilot-input mt-2 w-full" />
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
                      mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
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
                  Must match the signer name exactly. Serves as your electronic signature under the E-SIGN Act.
                </p>
              </div>
            ) : (
              <div>
                <div className="rounded-md border border-border bg-white">
                  <SignatureCanvas
                    ref={(el) => { sigPadRef.current = el; }}
                    penColor="#0b3d91"
                    canvasProps={{ className: "h-40 w-full rounded-md" }}
                    onEnd={() => setSigEmpty(false)}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Sign with mouse, stylus, or finger.</span>
                  <button type="button" onClick={clearPad} className="inline-flex items-center gap-1 hover:text-foreground">
                    <Eraser className="h-3 w-3" /> Clear
                  </button>
                </div>
                {sigEmpty && <p className="text-[11px] text-muted-foreground">Signature is empty.</p>}
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
              I acknowledge that I am an authorized representative of the property owner and I intend this electronic
              signature to be the legal equivalent of my handwritten signature. I understand this Letter of Authorization
              extends to {AUTHORIZATION_SCOPE}.
            </span>
          </label>

          <div className="flex items-center justify-end gap-2">
            <button type="submit" disabled={submitting || !acknowledged} className="pilot-button-primary disabled:opacity-60">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
              {submitting ? "Signing…" : "Sign & Execute"}
            </button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="pilot-card p-5">
            <h3 className="flex items-center gap-2 font-tight text-base font-bold">
              <CheckCircle2 className="h-4 w-4 text-success" /> Executed LOAs
            </h3>
            {signedLoas.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                None yet. Once signed, your Letters of Authorization appear here.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {signedLoas.map((d) => (
                  <li key={d.id} className="rounded border border-border bg-muted/30 p-3 text-sm">
                    <div className="font-medium">{d.owner_entity}</div>
                    <div className="text-xs text-muted-foreground">{d.project_address}</div>
                    <div className="mt-1 flex items-center justify-between font-data text-[11px] text-muted-foreground">
                      <span>{d.signer_name} · {d.signature_method}</span>
                      <span>{new Date(d.signed_at).toLocaleDateString()}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="pilot-card p-5 text-xs leading-6 text-muted-foreground">
            <div className="pilot-kicker text-primary">Legal note</div>
            <p className="mt-2">
              Electronic signatures are captured with timestamp and browser fingerprint. This authorization remains in
              effect until revoked in writing.
            </p>
            <Link to="/dashboard" className="mt-3 inline-flex text-primary hover:underline">Return to dashboard →</Link>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default OnboardingAuthorization;