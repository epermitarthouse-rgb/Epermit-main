import { useState, type ComponentType } from "react";
import {
  Bell,
  Building2,
  Database,
  Eraser,
  FileEdit,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Mail,
  Phone,
  PenTool,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Stamp,
  Trash2,
  Upload,
  User,
} from "lucide-react";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useActiveProject } from "@/state/activeProject";
import { cn } from "@/lib/utils";

type TabId =
  | "profile"
  | "security"
  | "notifications"
  | "portals"
  | "architect"
  | "branding"
  | "cleanup";

const tabs: { id: TabId; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "profile", label: "Profile", Icon: User },
  { id: "security", label: "Security", Icon: KeyRound },
  { id: "notifications", label: "Notifications", Icon: Bell },
  { id: "portals", label: "Portal Credentials", Icon: ShieldCheck },
  { id: "architect", label: "Architect", Icon: Stamp },
  { id: "branding", label: "Export Branding", Icon: FileEdit },
  { id: "cleanup", label: "Clean Up Data", Icon: Eraser },
];

const inputCls =
  "w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40";

const Field = ({
  label,
  Icon,
  children,
  hint,
}: {
  label: string;
  Icon?: ComponentType<{ className?: string }>;
  children: React.ReactNode;
  hint?: string;
}) => (
  <div className="space-y-1.5">
    <label className="flex items-center gap-1.5 pilot-kicker text-foreground/80">
      {Icon && <Icon className="h-3.5 w-3.5 text-primary" />}
      {label}
    </label>
    {children}
    {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
  </div>
);

const Section = ({
  Icon,
  title,
  subtitle,
  children,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <section className="pilot-card p-6">
    <header className="mb-5">
      <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-foreground">
        <Icon className="h-5 w-5 text-primary" />
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </header>
    {children}
  </section>
);

const UploadTile = ({ label }: { label: string }) => (
  <button
    type="button"
    className="group flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background/40 px-4 py-10 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
  >
    <Upload className="h-6 w-6 text-primary/80 transition-transform group-hover:-translate-y-0.5" />
    {label}
  </button>
);

const Settings = () => {
  const [demoMode, setDemoMode] = useDemoMode();
  const { credentials } = useActiveProject();
  const [tab, setTab] = useState<TabId>("profile");

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Account</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Manage your profile, security, notifications, portals, branding, and data cleanup — for
            both permit expediting and utility coordination work.
          </p>
        </div>
        <button className="pilot-button-primary"><Save className="h-4 w-4" /> Save Changes</button>
      </header>

      <section className={cn("pilot-card p-5 transition-colors", demoMode && "border-primary/60 bg-primary/5")}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-primary/10 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-tight text-lg font-bold text-foreground">Presentation Mode</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Freezes AI-backed surfaces to the pre-approved demo copy for deterministic pitches.
                Turn off after the presentation to resume live AI generation.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn("font-data text-[11px] uppercase tracking-wider", demoMode ? "text-primary" : "text-muted-foreground")}>
              {demoMode ? "Demo · On" : "Live AI"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={demoMode}
              onClick={() => setDemoMode(!demoMode)}
              className={cn(
                "relative inline-flex h-6 w-11 flex-none items-center rounded-full border transition-colors",
                demoMode ? "border-primary bg-primary" : "border-border bg-muted",
              )}
            >
              <span className={cn("inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform", demoMode ? "translate-x-6" : "translate-x-1")} />
            </button>
          </div>
        </div>
      </section>

      <nav className="pilot-card flex flex-wrap gap-1 p-1.5">
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <t.Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "profile" && (
        <Section Icon={User} title="Profile" subtitle="Basic identity used across exports, invitations, and audit logs.">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Display name"><input className={inputCls} defaultValue="Ian Swain" /></Field>
            <Field label="Role"><input className={inputCls} defaultValue="Managing Director" /></Field>
            <Field label="Company"><input className={inputCls} defaultValue="Commun-ET" /></Field>
            <Field label="Email"><input className={inputCls} defaultValue="iswain@commun-et.com" /></Field>
            <Field label="Phone"><input className={inputCls} defaultValue="(202) 555-0199" /></Field>
            <Field label="Time zone"><input className={inputCls} defaultValue="America/New_York" /></Field>
          </div>
        </Section>
      )}

      {tab === "security" && (
        <Section Icon={KeyRound} title="Security" subtitle="Authentication, session, and API access.">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Two-factor authentication" hint="Authenticator app enrolled">
              <input className={inputCls} defaultValue="Authenticator app" readOnly />
            </Field>
            <Field label="Session timeout"><input className={inputCls} defaultValue="30 minutes" /></Field>
            <Field label="Password" hint="Last changed 42 days ago">
              <button className="pilot-button-ghost w-full justify-center">Change password</button>
            </Field>
            <Field label="API keys" hint="2 active keys · rotate every 90 days">
              <button className="pilot-button-ghost w-full justify-center">Manage API keys</button>
            </Field>
          </div>
        </Section>
      )}

      {tab === "notifications" && (
        <Section Icon={Bell} title="Notifications" subtitle="Delivery channels for critical-path, agent, and portal events.">
          <div className="divide-y divide-border">
            {[
              { label: "Critical path alerts", detail: "Blockers on permit or utility milestones", value: "Email + SMS" },
              { label: "Agent escalations", detail: "AI agent needs operator decision", value: "Email" },
              { label: "Portal comment received", detail: "New reviewer comment from jurisdiction portal", value: "Email + In-app" },
              { label: "Utility markup received", detail: "Provider returns a markup or condition", value: "Email + In-app" },
              { label: "Weekly digest", detail: "Monday 7:00 AM local time", value: "On" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <div className="font-medium text-foreground">{row.label}</div>
                  <div className="text-xs text-muted-foreground">{row.detail}</div>
                </div>
                <span className="font-data text-xs text-primary">{row.value}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {tab === "portals" && (
        <Section
          Icon={ShieldCheck}
          title="Portal Credentials"
          subtitle="Unified credential vault for jurisdiction permit portals and utility provider portals."
        >
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button className="pilot-button-primary"><Plus className="h-4 w-4" /> Add Credential</button>
            <div className="ml-auto flex gap-1 rounded-md border border-border p-0.5 text-xs">
              {["All", "Permit portal", "Utility portal"].map((f) => (
                <button key={f} className="rounded px-2.5 py-1 text-muted-foreground hover:text-foreground">
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border pilot-kicker text-muted-foreground">
                  <th className="py-2 font-data">Portal</th>
                  <th className="font-data">Type</th>
                  <th className="font-data">Username</th>
                  <th className="font-data">URL</th>
                  <th className="font-data">Added</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {credentials.map((c) => {
                  const isUtility = /energy|gas|wssc|verizon|comcast|dominion|pepco|water/i.test(c.portalName);
                  return (
                    <tr key={c.id} className="hover:bg-muted/20">
                      <td className="py-3 font-medium text-foreground">{c.portalName}</td>
                      <td>
                        <span className={cn("inline-flex rounded-full border px-2 py-0.5 pilot-kicker", isUtility ? "border-pilot-teal/30 bg-pilot-teal/10 text-pilot-teal" : "border-primary/30 bg-primary/10 text-primary")}>
                          {isUtility ? "Utility" : "Permit"}
                        </span>
                      </td>
                      <td className="text-muted-foreground">{c.username}</td>
                      <td className="max-w-[220px] truncate font-data text-xs text-muted-foreground">{c.portalUrl}</td>
                      <td className="font-data text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="text-right">
                        <button className="rounded-md border border-border p-1.5 text-muted-foreground hover:border-destructive hover:text-destructive" aria-label="Remove">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {tab === "architect" && (
        <Section
          Icon={Stamp}
          title="Architect Profile"
          subtitle="Upload your architect seal and signature for plan markup approvals and stamped exports."
        >
          <div className="grid gap-6">
            <Field label="Architect Seal" Icon={ImageIcon} hint="PNG, SVG, or JPEG. Max 5MB.">
              <UploadTile label="Click to upload seal image" />
            </Field>
            <Field label="Signature" Icon={PenTool} hint="PNG or JPEG. Max 5MB.">
              <UploadTile label="Click to upload signature image" />
            </Field>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="License Number">
                <input className={inputCls} placeholder="e.g., AR-12345" />
              </Field>
              <Field label="License State">
                <select className={inputCls} defaultValue="">
                  <option value="" disabled>Select state</option>
                  {["DC","MD","VA","FL","NY","CA","TX","PA","NJ","GA","IL","WA","CO","AZ"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Disciplines Stamped" hint="Applies your seal to matching Comment Review disciplines.">
              <div className="flex flex-wrap gap-2">
                {["Architectural","Structural","MEP","Fire/Life Safety","Accessibility","Civil"].map((d) => (
                  <label key={d} className="inline-flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1 text-xs text-foreground hover:border-primary">
                    <input type="checkbox" className="accent-primary" defaultChecked={d === "Architectural"} />
                    {d}
                  </label>
                ))}
              </div>
            </Field>
            <div>
              <button className="pilot-button-primary"><Save className="h-4 w-4" /> Save License Info</button>
            </div>
          </div>
        </Section>
      )}

      {tab === "branding" && (
        <Section
          Icon={FileEdit}
          title="Export Branding"
          subtitle="Configure company branding for exported response packages. Your company name is pulled from your Profile tab."
        >
          <div className="grid gap-6">
            <Field label="Company Logo" Icon={ImageIcon} hint="PNG, JPG, or SVG. Max 2MB. Recommended: 200×50px.">
              <button className="pilot-button-ghost"><Upload className="h-4 w-4" /> Upload Logo</button>
            </Field>
            <Field label="Logo URL" Icon={Link2} hint="Or paste a direct URL to your logo image.">
              <input className={inputCls} placeholder="https://example.com/logo.png" />
            </Field>
            <Field label="Company Address" Icon={Building2}>
              <textarea className={cn(inputCls, "min-h-[90px] resize-y")} placeholder={"123 Main Street\nSuite 100\nCity, State ZIP"} />
            </Field>
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Company Phone" Icon={Phone}><input className={inputCls} placeholder="(555) 123-4567" /></Field>
              <Field label="Company Email" Icon={Mail}><input className={inputCls} placeholder="info@yourcompany.com" /></Field>
            </div>
            <Field label="Company Website" Icon={Globe}>
              <input className={inputCls} placeholder="https://www.yourcompany.com" />
            </Field>
            <Field label="Default Sign-off" Icon={FileEdit} hint="Used as the closing line in exported response packages.">
              <input className={inputCls} defaultValue="Respectfully submitted," />
            </Field>
            <Field label="Apply branding to utility coordination exports" hint="When on, provider response letters use the same branding.">
              <label className="inline-flex cursor-pointer items-center gap-3">
                <span className="text-sm text-foreground">Include on utility responses</span>
                <input type="checkbox" defaultChecked className="h-4 w-8 accent-primary" />
              </label>
            </Field>
            <div>
              <button className="pilot-button-primary"><Save className="h-4 w-4" /> Save Branding Settings</button>
            </div>
          </div>
        </Section>
      )}

      {tab === "cleanup" && (
        <Section
          Icon={Eraser}
          title="Clean Up Data"
          subtitle="Remove duplicate projects or empty test projects for your account. Covers both permit and utility records."
        >
          <div className="space-y-6">
            <div>
              <h3 className="font-tight text-base font-bold text-foreground">Remove Duplicate Projects</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                For each permit number or utility service ID with multiple projects, keeps the most
                recently checked and deletes the rest (including their comments and markups).
              </p>
              <button className="mt-3 pilot-button-primary"><Database className="h-4 w-4" /> Remove Duplicate Projects</button>
            </div>
            <div className="border-t border-border pt-6">
              <h3 className="font-tight text-base font-bold text-foreground">Clear Test Data</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Deletes all projects that have no portal data, no permit number, and no utility
                service request (empty test entries).
              </p>
              <button className="mt-3 pilot-button-primary"><Trash2 className="h-4 w-4" /> Clear Test Data</button>
            </div>
          </div>
        </Section>
      )}

      <p className="text-xs text-muted-foreground">
        Data residency (US-East), retention (7 years), and PII redaction are managed at the
        workspace level — contact your Commun-ET admin to change.
      </p>
    </div>
  );
};

export default Settings;