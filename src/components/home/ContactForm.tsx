import { useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, Mail, CalendarClock, FileText, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Homepage contact form (Lovable Get-in-Touch layout).
 * Submits via the existing `send-contact-email` edge function contract:
 * `{ firstName, lastName, email, message }` — project type is prepended into `message`.
 */

const projectTypes = [
  "Permit Expediting",
  "Site Investigation Report",
  "Code Compliance / DesignCheck",
  "Utility Coordination",
  "Consulting Engagement",
  "Custom Build / Platform",
  "Other",
] as const;

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be under 100 characters"),
  email: z.string().trim().email("Enter a valid email").max(255, "Email must be under 255 characters"),
  projectType: z.enum(projectTypes, { errorMap: () => ({ message: "Choose a project type" }) }),
  message: z.string().trim().min(1, "Message is required").max(1000, "Keep it under 1000 characters"),
});

type FormState = { name: string; email: string; projectType: string; message: string };
const initial: FormState = { name: "", email: "", projectType: "", message: "" };

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "—" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export const ContactForm = () => {
  const [values, setValues] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<null | { name: string; projectType: string; email: string }>(null);
  const [unavailable, setUnavailable] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
    if (unavailable) setUnavailable(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUnavailable(false);
    const parsed = schema.safeParse(values);
    if (!parsed.success) {
      const next: Partial<Record<keyof FormState, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FormState;
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    const { firstName, lastName } = splitName(parsed.data.name);
    const messageWithType = `Project type: ${parsed.data.projectType}\n\n${parsed.data.message}`;

    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("send-contact-email", {
        body: {
          firstName,
          lastName,
          email: parsed.data.email,
          message: messageWithType,
        },
      });

      if (error) throw error;

      toast.success("Message received", {
        description: `Thanks ${parsed.data.name.split(" ")[0]} — we'll follow up within one business day.`,
      });
      setSubmitted({
        name: parsed.data.name,
        projectType: parsed.data.projectType,
        email: parsed.data.email,
      });
      setValues(initial);
    } catch (err) {
      console.error("send-contact-email failed", err);
      setUnavailable(true);
      toast.error("Not available right now", {
        description: "We couldn't send your message. Please try again later or email ian@commun-et.com.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const fieldBase =
    "w-full rounded-md border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary";

  if (submitted) {
    return (
      <ThankYou
        name={submitted.name}
        projectType={submitted.projectType}
        email={submitted.email}
        onReset={() => setSubmitted(null)}
      />
    );
  }

  return (
    <section id="contact" className="pilot-card overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[1fr_1.4fr]">
        <div className="border-b border-border bg-muted/30 p-8 md:border-b-0 md:border-r md:p-10">
          <div className="pilot-kicker text-primary">Get in Touch</div>
          <h2 className="mt-3 font-tight text-3xl font-black tracking-tight text-foreground">
            Tell us about your project.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Whether you need a permit unblocked, a second opinion on a stalled approval, or a
            custom intelligence build for your portfolio — share the basics and we'll follow up
            within one business day.
          </p>
          <ul className="mt-6 space-y-2 text-xs text-muted-foreground">
            <li>· Direct response from Ian or a senior expediter</li>
            <li>· No-obligation scoping call</li>
            <li>· NDA available on request</li>
          </ul>
        </div>

        <form onSubmit={onSubmit} noValidate className="p-8 md:p-10">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Name" error={errors.name}>
              <input
                type="text"
                value={values.name}
                onChange={(e) => update("name", e.target.value)}
                maxLength={100}
                autoComplete="name"
                placeholder="Jane Architect"
                className={`${fieldBase} ${errors.name ? "border-destructive" : "border-border"}`}
              />
            </Field>
            <Field label="Email" error={errors.email}>
              <input
                type="email"
                value={values.email}
                onChange={(e) => update("email", e.target.value)}
                maxLength={255}
                autoComplete="email"
                placeholder="you@firm.com"
                className={`${fieldBase} ${errors.email ? "border-destructive" : "border-border"}`}
              />
            </Field>
          </div>

          <div className="mt-5">
            <Field label="Project type" error={errors.projectType}>
              <select
                value={values.projectType}
                onChange={(e) => update("projectType", e.target.value)}
                className={`${fieldBase} ${errors.projectType ? "border-destructive" : "border-border"}`}
              >
                <option value="">Select a project type…</option>
                {projectTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-5">
            <Field label="Message" error={errors.message}>
              <textarea
                value={values.message}
                onChange={(e) => update("message", e.target.value)}
                maxLength={1000}
                rows={5}
                placeholder="Project address, jurisdiction, current status, what you need…"
                className={`${fieldBase} resize-y ${errors.message ? "border-destructive" : "border-border"}`}
              />
              <div className="mt-1 text-right font-data text-[10px] text-muted-foreground">
                {values.message.length}/1000
              </div>
            </Field>
          </div>

          {unavailable && (
            <p className="mt-4 text-sm font-medium text-destructive" role="alert">
              Not available right now. Your message was not sent — please try again later or email{" "}
              <a href="mailto:ian@commun-et.com" className="underline underline-offset-2">
                ian@commun-et.com
              </a>
              .
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              By submitting you agree to be contacted about your inquiry.
            </p>
            <button type="submit" disabled={submitting} className="pilot-button-primary disabled:opacity-60">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? "Sending…" : "Send Message"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

const Field = ({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="pilot-kicker mb-2 block">{label}</span>
    {children}
    {error && <span className="mt-1 block text-xs font-medium text-destructive">{error}</span>}
  </label>
);

export default ContactForm;

const ThankYou = ({
  name,
  projectType,
  email,
  onReset,
}: {
  name: string;
  projectType: string;
  email: string;
  onReset: () => void;
}) => {
  const firstName = name.split(" ")[0];
  const steps = [
    {
      icon: Mail,
      title: "Confirmation on its way",
      body: `We logged your ${projectType.toLowerCase()} inquiry and routed it to the Commun-ET team. Watch ${email} for a reply within one business day.`,
    },
    {
      icon: CalendarClock,
      title: "Scoping call (optional)",
      body: "If your project needs eyes-on right away, grab a 20-minute working session — no obligation.",
    },
    {
      icon: FileText,
      title: "Prep what you have",
      body: "Drawings, RFIs, jurisdiction comments, prior submittals — anything you can share speeds up the first response.",
    },
  ];
  return (
    <section id="contact" className="pilot-card overflow-hidden">
      <div className="grid gap-0 md:grid-cols-[1fr_1.4fr]">
        <div className="border-b border-border bg-muted/30 p-8 md:border-b-0 md:border-r md:p-10">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div className="pilot-kicker mt-5 text-primary">Message received</div>
          <h2 className="mt-3 font-tight text-3xl font-black tracking-tight text-foreground">
            Thanks, {firstName}.
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Your inquiry is in front of the Commun-ET team. We treat every project like the one
            holding up a groundbreaking — because it usually is.
          </p>
          <div className="mt-6 rounded-md border border-border bg-background/60 p-4 text-xs">
            <div className="pilot-kicker">Reference</div>
            <div className="mt-1 font-data text-foreground">{projectType}</div>
            <div className="mt-1 text-muted-foreground">{email}</div>
          </div>
        </div>

        <div className="p-8 md:p-10">
          <div className="pilot-kicker text-primary">What happens next</div>
          <ol className="mt-5 space-y-5">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
                  <s.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-data text-[11px] text-muted-foreground">0{i + 1}</span>
                    <h3 className="font-tight text-base font-bold text-foreground">{s.title}</h3>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-wrap gap-3 border-t border-border pt-6">
            <a
              href={`mailto:ian@commun-et.com?subject=Follow-up%20on%20${encodeURIComponent(projectType)}%20inquiry`}
              className="pilot-button-primary"
            >
              <CalendarClock className="h-4 w-4" /> Book a Working Session
            </a>
            <button type="button" onClick={onReset} className="pilot-button-ghost">
              Send another message <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
