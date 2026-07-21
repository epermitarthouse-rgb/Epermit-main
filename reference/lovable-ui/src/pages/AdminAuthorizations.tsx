import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FileSignature,
  Loader2,
  ShieldCheck,
  Search,
  Download,
  ExternalLink,
  Eye,
  ArrowLeft,
  Fingerprint,
  Clock,
  Mail,
  Building2,
  MapPin,
  User as UserIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { AccessDenied } from "@/components/AccessDenied";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type LoaRow = {
  id: string;
  user_id: string;
  owner_entity: string;
  project_address: string;
  additional_parties: string | null;
  signer_name: string;
  signer_title: string;
  signer_company: string;
  signer_email: string;
  signer_phone: string | null;
  effective_date: string;
  authorization_scope: string;
  signature_method: "typed" | "drawn";
  typed_signature: string | null;
  signature_image_path: string | null;
  acknowledged: boolean;
  ip_address: string | null;
  user_agent: string | null;
  signed_at: string;
  created_at: string;
};

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const AdminAuthorizations = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { role: currentRole } = useUserRole();
  const [checkingRole, setCheckingRole] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<LoaRow[]>([]);
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<"all" | "typed" | "drawn">("all");
  const [selected, setSelected] = useState<LoaRow | null>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [sigLoading, setSigLoading] = useState(false);

  // Auth + admin gate
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (error) {
        toast({
          title: "Role check failed",
          description: error.message,
          variant: "destructive",
        });
      }
      setIsAdmin(Boolean(data));
      setCheckingRole(false);
    })();
  }, [user, authLoading, navigate, toast]);

  // Load LOAs
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("client_authorizations")
        .select("*")
        .order("signed_at", { ascending: false });
      if (error) {
        toast({
          title: "Failed to load authorizations",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setRows((data ?? []) as LoaRow[]);
      }
      setLoading(false);
    })();
  }, [isAdmin, toast]);

  // Signed URL for drawn signature preview
  useEffect(() => {
    setSignatureUrl(null);
    if (!selected || selected.signature_method !== "drawn" || !selected.signature_image_path) return;
    setSigLoading(true);
    supabase.storage
      .from("signatures")
      .createSignedUrl(selected.signature_image_path, 300)
      .then(({ data, error }) => {
        if (error) {
          toast({
            title: "Signature preview unavailable",
            description: error.message,
            variant: "destructive",
          });
        } else {
          setSignatureUrl(data?.signedUrl ?? null);
        }
        setSigLoading(false);
      });
  }, [selected, toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (methodFilter !== "all" && r.signature_method !== methodFilter) return false;
      if (!q) return true;
      return (
        r.signer_name.toLowerCase().includes(q) ||
        r.signer_email.toLowerCase().includes(q) ||
        r.signer_company.toLowerCase().includes(q) ||
        r.owner_entity.toLowerCase().includes(q) ||
        r.project_address.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q)
      );
    });
  }, [rows, query, methodFilter]);

  const stats = useMemo(() => {
    const total = rows.length;
    const typed = rows.filter((r) => r.signature_method === "typed").length;
    const drawn = rows.filter((r) => r.signature_method === "drawn").length;
    const uniqueSigners = new Set(rows.map((r) => r.signer_email.toLowerCase())).size;
    return { total, typed, drawn, uniqueSigners };
  }, [rows]);

  const exportCsv = () => {
    if (!filtered.length) return;
    const header = [
      "id",
      "signed_at",
      "effective_date",
      "signer_name",
      "signer_title",
      "signer_company",
      "signer_email",
      "signer_phone",
      "owner_entity",
      "project_address",
      "additional_parties",
      "signature_method",
      "signature_reference",
      "ip_address",
      "user_agent",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")].concat(
      filtered.map((r) =>
        [
          r.id,
          r.signed_at,
          r.effective_date,
          r.signer_name,
          r.signer_title,
          r.signer_company,
          r.signer_email,
          r.signer_phone ?? "",
          r.owner_entity,
          r.project_address,
          r.additional_parties ?? "",
          r.signature_method,
          r.signature_method === "typed"
            ? `typed:${r.typed_signature ?? ""}`
            : r.signature_image_path ?? "",
          r.ip_address ?? "",
          r.user_agent ?? "",
        ]
          .map(esc)
          .join(","),
      ),
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `client-authorizations-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  if (authLoading || checkingRole) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <AccessDenied
        pageLabel="Client Authorizations"
        allowedRoles={["admin"]}
        currentRole={currentRole}
        hint="Reviewing signed Letters of Authorization is limited to workspace administrators."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Admin · Compliance</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Client Authorizations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review every executed Letter of Authorization with signer details, timestamps, and
            signature references.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin" className="pilot-button-ghost">
            <ArrowLeft className="h-4 w-4" /> Admin Console
          </Link>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!filtered.length}
            className="pilot-button-primary disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: "Executed LOAs", value: stats.total },
          { label: "Unique Signers", value: stats.uniqueSigners },
          { label: "Typed Signatures", value: stats.typed },
          { label: "Drawn Signatures", value: stats.drawn },
        ].map((s) => (
          <div key={s.label} className="pilot-card p-4">
            <div className="pilot-kicker text-muted-foreground">{s.label}</div>
            <div className="mt-1 font-display text-3xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      <section className="pilot-card overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-border bg-muted/30 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <h2 className="flex items-center gap-2 font-tight text-base font-bold">
            <FileSignature className="h-4 w-4 text-primary" /> Signed Authorizations
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search signer, company, address…"
                className="h-8 w-64 pl-8 text-xs"
              />
            </div>
            <div className="flex rounded-md border border-border bg-background p-0.5 text-xs">
              {(["all", "typed", "drawn"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethodFilter(m)}
                  className={cn(
                    "rounded px-2.5 py-1 font-medium capitalize transition",
                    methodFilter === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "No client authorizations on file yet."
              : "No authorizations match the current filter."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Signed</th>
                  <th className="px-5 py-3 font-medium">Signer</th>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">Project</th>
                  <th className="px-5 py-3 font-medium">Method</th>
                  <th className="px-5 py-3 font-medium">Signature ref</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="whitespace-nowrap px-5 py-3 font-data text-xs text-muted-foreground">
                      {fmtDateTime(r.signed_at)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-foreground">{r.signer_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.signer_title} · {r.signer_email}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{r.signer_company}</td>
                    <td className="px-5 py-3">
                      <div className="text-foreground">{r.owner_entity}</div>
                      <div className="text-xs text-muted-foreground">{r.project_address}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                          r.signature_method === "drawn"
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        {r.signature_method}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-5 py-3 font-data text-xs text-muted-foreground">
                      {r.signature_method === "typed"
                        ? r.typed_signature
                        : r.signature_image_path}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelected(r)}
                        className="pilot-button-ghost h-8 px-3 text-xs"
                      >
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Letter of Authorization</DialogTitle>
            <DialogDescription>
              Full record and signature reference for this executed LOA.
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-5 text-sm">
              <div className="grid gap-4 md:grid-cols-2">
                <Field icon={UserIcon} label="Signer">
                  <div className="font-medium text-foreground">{selected.signer_name}</div>
                  <div className="text-xs text-muted-foreground">{selected.signer_title}</div>
                </Field>
                <Field icon={Building2} label="Company">
                  {selected.signer_company}
                </Field>
                <Field icon={Mail} label="Contact">
                  <div>{selected.signer_email}</div>
                  {selected.signer_phone && (
                    <div className="text-xs text-muted-foreground">{selected.signer_phone}</div>
                  )}
                </Field>
                <Field icon={Clock} label="Signed at">
                  <div className="font-data text-xs">{fmtDateTime(selected.signed_at)}</div>
                  <div className="text-xs text-muted-foreground">
                    Effective {selected.effective_date}
                  </div>
                </Field>
                <Field icon={Building2} label="Owner entity">
                  {selected.owner_entity}
                </Field>
                <Field icon={MapPin} label="Project address">
                  {selected.project_address}
                </Field>
                {selected.additional_parties && (
                  <div className="md:col-span-2">
                    <Field icon={UserIcon} label="Additional authorized parties">
                      {selected.additional_parties}
                    </Field>
                  </div>
                )}
                <div className="md:col-span-2">
                  <Field icon={ShieldCheck} label="Authorization scope">
                    <span className="text-xs">{selected.authorization_scope}</span>
                  </Field>
                </div>
              </div>

              <div className="rounded-md border border-border bg-muted/30 p-4">
                <div className="pilot-kicker mb-2 text-muted-foreground">
                  Signature ({selected.signature_method})
                </div>
                {selected.signature_method === "typed" ? (
                  <div className="font-display text-2xl italic">
                    {selected.typed_signature}
                  </div>
                ) : sigLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading signature…
                  </div>
                ) : signatureUrl ? (
                  <div className="space-y-2">
                    <img
                      src={signatureUrl}
                      alt="Client signature"
                      className="max-h-40 rounded border border-border bg-white p-2"
                    />
                    <a
                      href={signatureUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Open in new tab <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">Signature not available.</div>
                )}
                <div className="mt-3 grid gap-1 font-data text-[11px] text-muted-foreground">
                  <div>
                    <span className="text-foreground">Reference:</span>{" "}
                    {selected.signature_method === "typed"
                      ? `typed:${selected.typed_signature ?? ""}`
                      : selected.signature_image_path ?? "—"}
                  </div>
                  <div>
                    <span className="text-foreground">Record ID:</span> {selected.id}
                  </div>
                  <div>
                    <span className="text-foreground">User ID:</span> {selected.user_id}
                  </div>
                </div>
              </div>

              <div className="grid gap-2 rounded-md border border-border p-4 text-xs text-muted-foreground md:grid-cols-2">
                <div className="flex items-start gap-2">
                  <Fingerprint className="mt-0.5 h-3.5 w-3.5 text-primary" />
                  <div>
                    <div className="text-foreground">IP address</div>
                    <div className="font-data">{selected.ip_address ?? "—"}</div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Fingerprint className="mt-0.5 h-3.5 w-3.5 text-primary" />
                  <div>
                    <div className="text-foreground">User agent</div>
                    <div className="break-all font-data">{selected.user_agent ?? "—"}</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Field = ({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof FileSignature;
  label: string;
  children: React.ReactNode;
}) => (
  <div>
    <div className="pilot-kicker flex items-center gap-1.5 text-muted-foreground">
      <Icon className="h-3 w-3" /> {label}
    </div>
    <div className="mt-1">{children}</div>
  </div>
);

export default AdminAuthorizations;
