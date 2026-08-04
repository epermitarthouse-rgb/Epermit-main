import { useState } from "react";
import { Mail, Phone, MapPin, Send, CalendarClock } from "lucide-react";
import { z } from "zod";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const contactSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: z.string().trim().email("Invalid email").max(255),
  company: z.string().trim().max(120).optional(),
  message: z.string().trim().min(5, "Message is too short").max(2000),
});

type FormState = z.infer<typeof contactSchema>;

const initial: FormState = { firstName: "", lastName: "", email: "", company: "", message: "" };

const Contact = () => {
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((s) => ({ ...s, [key]: value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = contactSchema.safeParse(form);
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setErrors(Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, v?.[0] ?? ""])));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const { error } = await supabase.functions.invoke("send-contact-email", { body: parsed.data });
      if (error) throw error;
      toast({ title: "Message sent", description: "We'll respond within 24 hours." });
      setForm(initial);
    } catch (err) {
      toast({ title: "Could not send", description: "Please try again shortly.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-1 focus:ring-primary/40";

  return (
    <div className="space-y-6">
      <header className="text-center">
        <div className="pilot-kicker text-primary">Support</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Contact Us</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Get in touch with our team — we typically respond within 24 hours.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <form onSubmit={onSubmit} className="pilot-card p-6">
          <div className="pilot-kicker text-primary">Send a Message</div>
          <h2 className="mt-1 font-display text-2xl font-semibold">How can we help?</h2>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="pilot-kicker text-foreground/80">First Name</label>
              <input className={inputCls} value={form.firstName} onChange={(e) => update("firstName", e.target.value)} placeholder="John" />
              {errors.firstName && <p className="mt-1 text-xs text-destructive">{errors.firstName}</p>}
            </div>
            <div>
              <label className="pilot-kicker text-foreground/80">Last Name</label>
              <input className={inputCls} value={form.lastName} onChange={(e) => update("lastName", e.target.value)} placeholder="Doe" />
              {errors.lastName && <p className="mt-1 text-xs text-destructive">{errors.lastName}</p>}
            </div>
          </div>

          <div className="mt-4">
            <label className="pilot-kicker text-foreground/80">Email</label>
            <input className={inputCls} value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="john@company.com" />
            {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email}</p>}
          </div>

          <div className="mt-4">
            <label className="pilot-kicker text-foreground/80">Company (optional)</label>
            <input className={inputCls} value={form.company ?? ""} onChange={(e) => update("company", e.target.value)} placeholder="Acme Construction" />
          </div>

          <div className="mt-4">
            <label className="pilot-kicker text-foreground/80">Message</label>
            <textarea
              className={`${inputCls} min-h-[140px] resize-y`}
              value={form.message}
              onChange={(e) => update("message", e.target.value)}
              placeholder="Tell us about your permit management needs…"
            />
            {errors.message && <p className="mt-1 text-xs text-destructive">{errors.message}</p>}
          </div>

          <button type="submit" disabled={submitting} className="pilot-button-primary mt-5 w-full justify-center disabled:opacity-60">
            <Send className="h-4 w-4" /> {submitting ? "Sending…" : "Send Message"}
          </button>
        </form>

        <div className="space-y-4">
          <div className="pilot-card p-6">
            <div className="pilot-kicker text-primary">Reach Us</div>
            <ul className="mt-4 space-y-4 text-sm">
              <li className="flex items-start gap-3">
                <span className="rounded-md border border-border bg-muted/40 p-2 text-primary"><Mail className="h-4 w-4" /></span>
                <div>
                  <div className="font-medium">Email</div>
                  <a href="mailto:hello@commun-et.com" className="text-muted-foreground hover:text-primary">hello@commun-et.com</a>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="rounded-md border border-border bg-muted/40 p-2 text-primary"><Phone className="h-4 w-4" /></span>
                <div>
                  <div className="font-medium">Phone</div>
                  <a href="tel:+15551234567" className="text-muted-foreground hover:text-primary">(555) 123-4567</a>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="rounded-md border border-border bg-muted/40 p-2 text-primary"><MapPin className="h-4 w-4" /></span>
                <div>
                  <div className="font-medium">Office</div>
                  <div className="text-muted-foreground">123 Main St, Suite 100<br />San Francisco, CA 94105</div>
                </div>
              </li>
            </ul>
          </div>

          <div className="pilot-card p-6">
            <div className="pilot-kicker text-primary">Need immediate help?</div>
            <p className="mt-2 text-sm text-muted-foreground">
              Schedule a free 15-minute consultation with our permit experts.
            </p>
            <a
              href="mailto:hello@commun-et.com?subject=Consultation%20Request"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium transition hover:border-primary hover:text-primary"
            >
              <CalendarClock className="h-4 w-4" /> Book a Call
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contact;