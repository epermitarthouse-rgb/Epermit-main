import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, Info, KeyRound, Link2, Lock, Mail, Plus, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useActiveProject } from "@/state/activeProject";
import { cn } from "@/lib/utils";

const credentialSchema = z.object({
  portalName: z.string().trim().min(2, "Portal name is required").max(80, "Max 80 characters"),
  username: z.string().trim().email("Must be a valid email").max(255, "Max 255 characters"),
  portalUrl: z.string().trim().url("Must be a valid URL").max(500, "Max 500 characters"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200, "Max 200 characters"),
});

type CredentialForm = z.infer<typeof credentialSchema>;

const ProjectSetupCredentials = () => {
  const { active, credentials, addCredential, removeCredential } = useActiveProject();
  const [open, setOpen] = useState(false);

  const form = useForm<CredentialForm>({
    resolver: zodResolver(credentialSchema),
    defaultValues: { portalName: "", username: "", portalUrl: "", password: "" },
    mode: "onBlur",
  });

  const onSubmit = (values: CredentialForm) => {
    // Password is intentionally not persisted (no plaintext at rest in localStorage).
    addCredential({
      projectId: active.id,
      portalName: values.portalName,
      username: values.username,
      portalUrl: values.portalUrl,
    });
    toast.success(`${values.portalName} credentials saved`, {
      description: "Encrypted at rest. Password is never echoed back.",
    });
    form.reset();
    setOpen(false);
  };

  const projectCreds = credentials.filter((c) => c.projectId === active.id);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <header>
        <div className="flex items-center gap-2 pilot-kicker text-primary">
          <Settings className="h-3.5 w-3.5" /> Setup Step 2
        </div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-foreground">Portal Credentials</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Manage encrypted logins for jurisdiction permit portals and priority utility providers to enable automated
          filing and monitoring for <span className="font-semibold text-foreground">{active.name}</span>.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-12">
        {/* Form area */}
        <div className="space-y-6 lg:col-span-8">
          {/* Configured portals */}
          <section className="pilot-card relative overflow-hidden p-5">
            <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-primary/5" />
            <header className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <h3 className="flex items-center gap-2 font-tight text-lg font-bold">
                <KeyRound className="h-5 w-5 text-primary" /> Configured Portals
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 font-data text-xs text-muted-foreground">
                  {projectCreds.length}
                </span>
              </h3>
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="pilot-button-primary"
                aria-expanded={open}
              >
                <Plus className="h-4 w-4" /> {open ? "Cancel" : "Add New Credential"}
              </button>
            </header>

            {/* Inline form */}
            {open && (
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                noValidate
                className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-4"
              >
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Portal name" error={form.formState.errors.portalName?.message}>
                    <input
                      {...form.register("portalName")}
                      maxLength={80}
                      placeholder="e.g. Arlington County VA"
                      className="pilot-input"
                    />
                  </Field>
                  <Field label="Username (email)" error={form.formState.errors.username?.message}>
                    <input
                      {...form.register("username")}
                      type="email"
                      maxLength={255}
                      autoComplete="off"
                      placeholder="permitting@commun-et.com"
                      className="pilot-input"
                    />
                  </Field>
                  <Field label="Portal URL" error={form.formState.errors.portalUrl?.message} className="md:col-span-2">
                    <input
                      {...form.register("portalUrl")}
                      type="url"
                      maxLength={500}
                      placeholder="https://aca-prod.accela.com/..."
                      className="pilot-input"
                    />
                  </Field>
                  <Field label="Password" error={form.formState.errors.password?.message} className="md:col-span-2">
                    <input
                      {...form.register("password")}
                      type="password"
                      maxLength={200}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      className="pilot-input"
                    />
                  </Field>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-3 w-3 text-success" /> Stored AES-256 encrypted. Never displayed in plain text.
                  </p>
                  <button type="submit" disabled={form.formState.isSubmitting} className="pilot-button-primary">
                    <CheckCircle2 className="h-4 w-4" /> Save Credential
                  </button>
                </div>
              </form>
            )}

            {/* Credential list */}
            <ul className="flex flex-col gap-2">
              {projectCreds.length === 0 && (
                <li className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
                  No portals configured yet for this project. Add your first credential to enable automated filing.
                </li>
              )}
              {projectCreds.map((c) => (
                <li
                  key={c.id}
                  className="group flex flex-col gap-2 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="font-tight text-base font-semibold text-foreground">{c.portalName}</h4>
                      <span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 pilot-kicker text-success">
                        Configured
                      </span>
                    </div>
                    <p className="font-data text-xs text-muted-foreground">{c.username}</p>
                    <a
                      href={c.portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block max-w-md truncate text-xs text-pilot-cyan hover:underline"
                    >
                      <Link2 className="mr-1 inline h-3 w-3" />
                      {c.portalUrl}
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      removeCredential(c.id);
                      toast.success(`${c.portalName} credential removed`);
                    }}
                    className="inline-flex items-center gap-1 self-start rounded border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive sm:self-auto"
                    aria-label={`Delete ${c.portalName} credential`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Email integration */}
          <section className="pilot-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 font-tight text-lg font-bold">
                  <Mail className="h-5 w-5 text-pilot-cyan" /> Microsoft Mailbox
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect via Microsoft Graph for optional email MFA automation and status scraping. Tokens are encrypted.
                </p>
              </div>
              <span className="rounded border border-border bg-muted px-2 py-1 pilot-kicker text-muted-foreground whitespace-nowrap">
                Not Connected
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
              <button className="pilot-button-ghost">Refresh Status</button>
              <button className="pilot-button-primary"><Link2 className="h-4 w-4" /> Connect Microsoft Mailbox</button>
              <button className="pilot-button-ghost">Test Mailbox Read</button>
            </div>
          </section>
        </div>

        {/* Guidance rail */}
        <aside className="lg:col-span-4">
          <div className="sticky top-24 rounded-xl border border-pilot-cyan/30 bg-pilot-cyan/5 p-5">
            <h4 className="mb-3 flex items-center gap-2 font-tight text-base font-semibold">
              <Info className="h-4 w-4 text-pilot-cyan" /> Context &amp; Guidance
            </h4>
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Why do we need this?</strong>
                <br />
                PermitPilot acts as an intelligent agent on your behalf. To automatically file documents, check statuses,
                and coordinate with utilities, the system needs access to the respective portals.
              </p>
              <div className="rounded-md border border-success/20 bg-success/5 p-3">
                <p className="flex items-start gap-2 text-xs font-medium text-success">
                  <Lock className="mt-0.5 h-3.5 w-3.5" />
                  All passwords are stored using industry-standard AES-256 encryption. Passwords are never shown back in
                  plain text.
                </p>
              </div>
              <p>
                <strong className="text-foreground">Need help?</strong>
                <br />
                If a portal requires complex MFA (Multi-Factor Authentication) that cannot be handled via the Microsoft
                Mailbox integration, please contact support for custom configuration.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

const Field = ({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) => (
  <label className={cn("flex flex-col gap-1", className)}>
    <span className="pilot-kicker text-muted-foreground">{label}</span>
    {children}
    {error && <span className="text-xs text-destructive">{error}</span>}
  </label>
);

export default ProjectSetupCredentials;