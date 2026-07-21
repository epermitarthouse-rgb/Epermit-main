import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Mail,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  UserPlus,
  XCircle,
  Check,
  Search,
  RefreshCw,
  Clock,
  UserCheck,
  UserX,
  ClipboardList,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUserRole, type AppRole } from "@/hooks/useUserRole";
import { AccessDenied } from "@/components/AccessDenied";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  company: string | null;
  title: string | null;
  created_at: string;
  approval_status?: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
};

type RoleRow = { user_id: string; role: AppRole };

type Invitation = {
  id: string;
  email: string;
  role: AppRole;
  token: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  note: string | null;
  invited_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
};

type Member = {
  id: string;
  email: string;
  full_name: string;
  company: string;
  title: string;
  roles: AppRole[];
  created_at: string;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
};

const ROLES: AppRole[] = ["admin", "staff", "client"];

const roleBadgeClass: Record<AppRole, string> = {
  admin: "bg-primary/15 text-primary border-primary/30",
  staff: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  client: "bg-muted text-muted-foreground border-border",
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });

const AdminMembers = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { role: currentRole } = useUserRole();
  const [checkingRole, setCheckingRole] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"members" | "invitations" | "pending">("members");

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("client");
  const [inviteNote, setInviteNote] = useState("");
  const [inviteExpiresInDays, setInviteExpiresInDays] = useState<number>(30);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  // Share link dialog
  const [linkInvite, setLinkInvite] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);

  // Remove confirm
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [removing, setRemoving] = useState(false);

  // Approval workflow
  const [approvalRole, setApprovalRole] = useState<Record<string, AppRole>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Member | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(Boolean(data));
      setCheckingRole(false);
    })();
  }, [user, authLoading, navigate]);

  const loadAll = async () => {
    setLoading(true);
    const [profilesRes, rolesRes, invitesRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id,email,full_name,company,title,created_at,approval_status,rejection_reason")
        .order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id,role"),
      supabase
        .from("workspace_invitations")
        .select("*")
        .order("created_at", { ascending: false }),
    ]);

    if (profilesRes.error || rolesRes.error || invitesRes.error) {
      toast({
        title: "Failed to load members",
        description:
          profilesRes.error?.message ??
          rolesRes.error?.message ??
          invitesRes.error?.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const rolesByUser = new Map<string, AppRole[]>();
    (rolesRes.data as RoleRow[] | null)?.forEach((r) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });

    const merged: Member[] = ((profilesRes.data as ProfileRow[] | null) ?? []).map((p) => ({
      id: p.id,
      email: p.email ?? "",
      full_name: p.full_name ?? "",
      company: p.company ?? "",
      title: p.title ?? "",
      roles: rolesByUser.get(p.id) ?? [],
      created_at: p.created_at,
      approval_status: p.approval_status ?? "approved",
      rejection_reason: p.rejection_reason ?? null,
    }));

    setMembers(merged);
    setInvites((invitesRes.data as Invitation[] | null) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (isAdmin) void loadAll();
  }, [isAdmin]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.approval_status === "approved"),
    [members],
  );
  const pendingMembers = useMemo(
    () => members.filter((m) => m.approval_status === "pending"),
    [members],
  );

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activeMembers;
    return activeMembers.filter((m) =>
      [m.email, m.full_name, m.company, m.title].some((v) => v.toLowerCase().includes(q)),
    );
  }, [activeMembers, query]);

  const filteredPending = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pendingMembers;
    return pendingMembers.filter((m) =>
      [m.email, m.full_name, m.company, m.title].some((v) => v.toLowerCase().includes(q)),
    );
  }, [pendingMembers, query]);

  const filteredInvites = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invites;
    return invites.filter((i) => i.email.toLowerCase().includes(q));
  }, [invites, query]);

  const pendingCount = invites.filter((i) => i.status === "pending").length;
  const pendingApprovalsCount = pendingMembers.length;

  const approvePending = async (m: Member) => {
    const role = approvalRole[m.id] ?? "client";
    setProcessingId(m.id);
    const { error } = await supabase.rpc("approve_member", {
      _user_id: m.id,
      _role: role,
    });
    setProcessingId(null);
    if (error) {
      toast({ title: "Approval failed", description: error.message, variant: "destructive" });
      return;
    }
    setMembers((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? { ...x, approval_status: "approved", roles: [role], rejection_reason: null }
          : x,
      ),
    );
    toast({ title: "Member approved", description: `${m.email} → ${role}` });
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setProcessingId(rejectTarget.id);
    const { error } = await supabase.rpc("reject_member", {
      _user_id: rejectTarget.id,
      _reason: rejectReason.trim() || null,
    });
    setProcessingId(null);
    if (error) {
      toast({ title: "Rejection failed", description: error.message, variant: "destructive" });
      return;
    }
    setMembers((prev) =>
      prev.map((x) =>
        x.id === rejectTarget.id
          ? {
              ...x,
              approval_status: "rejected",
              roles: [],
              rejection_reason: rejectReason.trim() || null,
            }
          : x,
      ),
    );
    toast({ title: "Member rejected", description: rejectTarget.email });
    setRejectTarget(null);
    setRejectReason("");
  };

  const inviteLink = (token: string) =>
    `${window.location.origin}/login?invite=${token}`;

  const EXPIRY_OPTIONS: { label: string; days: number }[] = [
    { label: "7 days", days: 7 },
    { label: "14 days", days: 14 },
    { label: "30 days", days: 30 },
    { label: "90 days", days: 90 },
  ];

  const daysUntil = (iso: string) => {
    const diff = new Date(iso).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const expiryLabel = (iso: string) => {
    const d = daysUntil(iso);
    if (d < 0) return `Expired ${Math.abs(d)}d ago`;
    if (d === 0) return "Expires today";
    if (d === 1) return "Expires tomorrow";
    return `in ${d} days`;
  };

  const createInvite = async () => {
    setInviteError(null);
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError("Enter a valid email address.");
      return;
    }
    if (invites.some((i) => i.status === "pending" && i.email.toLowerCase() === email)) {
      setInviteError("A pending invitation already exists for this email.");
      return;
    }
    setSaving(true);
    const expiresAt = new Date(
      Date.now() + inviteExpiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("workspace_invitations")
      .insert({
        email,
        role: inviteRole,
        note: inviteNote.trim() || null,
        invited_by: user?.id ?? null,
        expires_at: expiresAt,
      })
      .select("*")
      .single();
    setSaving(false);
    if (error || !data) {
      setInviteError(error?.message ?? "Could not create invitation.");
      return;
    }
    setInvites((prev) => [data as Invitation, ...prev]);
    setInviteOpen(false);
    setInviteEmail("");
    setInviteRole("client");
    setInviteNote("");
    setInviteExpiresInDays(30);
    setLinkInvite(data as Invitation);
    toast({ title: "Invitation created", description: "Share the link with your invitee." });
  };

  const revokeInvite = async (id: string) => {
    const { error } = await supabase
      .from("workspace_invitations")
      .update({ status: "revoked" })
      .eq("id", id);
    if (error) {
      toast({ title: "Revoke failed", description: error.message, variant: "destructive" });
      return;
    }
    setInvites((prev) => prev.map((i) => (i.id === id ? { ...i, status: "revoked" } : i)));
    toast({ title: "Invitation revoked" });
  };

  const deleteInvite = async (id: string) => {
    const { error } = await supabase.from("workspace_invitations").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    setInvites((prev) => prev.filter((i) => i.id !== id));
  };

  const resendInvite = async (inv: Invitation, extraDays = 30) => {
    setResendingId(inv.id);
    // Rotate token so old links become invalid, extend expiration, re-activate if expired.
    const newToken =
      (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const newExpiry = new Date(
      Date.now() + extraDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await supabase
      .from("workspace_invitations")
      .update({ token: newToken, expires_at: newExpiry, status: "pending" })
      .eq("id", inv.id)
      .select("*")
      .single();
    setResendingId(null);
    if (error || !data) {
      toast({
        title: "Resend failed",
        description: error?.message ?? "Could not refresh invitation.",
        variant: "destructive",
      });
      return;
    }
    setInvites((prev) => prev.map((i) => (i.id === inv.id ? (data as Invitation) : i)));
    setLinkInvite(data as Invitation);
    toast({
      title: "Invitation refreshed",
      description: `New link generated, valid for ${extraDays} days.`,
    });
  };

  const changeRole = async (member: Member, nextRole: AppRole) => {
    if (member.roles.includes(nextRole) && member.roles.length === 1) return;
    // Replace roles: delete existing, insert single new role.
    const del = await supabase.from("user_roles").delete().eq("user_id", member.id);
    if (del.error) {
      toast({ title: "Role update failed", description: del.error.message, variant: "destructive" });
      return;
    }
    const ins = await supabase
      .from("user_roles")
      .insert({ user_id: member.id, role: nextRole });
    if (ins.error) {
      toast({ title: "Role update failed", description: ins.error.message, variant: "destructive" });
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.id === member.id ? { ...m, roles: [nextRole] } : m)),
    );
    toast({ title: "Role updated", description: `${member.email} → ${nextRole}` });
  };

  const removeMember = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", removeTarget.id);
    setRemoving(false);
    if (error) {
      toast({ title: "Remove failed", description: error.message, variant: "destructive" });
      return;
    }
    setMembers((prev) => prev.map((m) => (m.id === removeTarget.id ? { ...m, roles: [] } : m)));
    toast({
      title: "Access revoked",
      description: `${removeTarget.email} no longer has workspace roles.`,
    });
    setRemoveTarget(null);
  };

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(inviteLink(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
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
        pageLabel="Workspace Members"
        allowedRoles={["admin"]}
        currentRole={currentRole}
        hint="Only workspace administrators can invite, promote, or remove members."
      />
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Admin · Access</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Workspace Members
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite new teammates, adjust their role, and revoke access. Invitations use a shareable
            link and auto-activate the assigned role on sign-up.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin" className="pilot-button-ghost">
            <ArrowLeft className="h-4 w-4" /> Admin Console
          </Link>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="pilot-button-primary"
          >
            <UserPlus className="h-4 w-4" /> Invite member
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-5">
        {[
          { label: "Active members", value: activeMembers.filter((m) => m.roles.length).length },
          { label: "Admins", value: members.filter((m) => m.roles.includes("admin")).length },
          { label: "Staff", value: members.filter((m) => m.roles.includes("staff")).length },
          { label: "Pending approvals", value: pendingApprovalsCount },
          { label: "Pending invitations", value: pendingCount },
        ].map((s) => (
          <div key={s.label} className="pilot-card p-4">
            <div className="pilot-kicker text-muted-foreground">{s.label}</div>
            <div className="mt-1 font-display text-3xl font-semibold">{s.value}</div>
          </div>
        ))}
      </div>

      <section className="pilot-card overflow-hidden">
        <header className="flex flex-col gap-3 border-b border-border bg-muted/30 px-5 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex rounded-md border border-border bg-background p-0.5 text-xs">
            {(["members", "pending", "invitations"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "rounded px-3 py-1.5 font-medium capitalize transition",
                  tab === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "members" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Members (
                    {activeMembers.filter((m) => m.roles.length).length})
                  </span>
                ) : t === "pending" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <ClipboardList className="h-3.5 w-3.5" /> Pending approvals (
                    {pendingApprovalsCount})
                    {pendingApprovalsCount > 0 && tab !== "pending" ? (
                      <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
                    ) : null}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> Invitations ({invites.length})
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === "members" ? "Search name, email, company…" : "Search email…"}
              className="h-8 w-64 pl-8 text-xs"
            />
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : tab === "members" ? (
          filteredMembers.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No members match your search.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left">Member</th>
                    <th className="px-5 py-2 text-left">Company</th>
                    <th className="px-5 py-2 text-left">Role</th>
                    <th className="px-5 py-2 text-left">Joined</th>
                    <th className="px-5 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredMembers.map((m) => {
                    const isSelf = m.id === user?.id;
                    return (
                      <tr key={m.id} className="hover:bg-muted/20">
                        <td className="px-5 py-3">
                          <div className="font-medium">
                            {m.full_name || <span className="text-muted-foreground">—</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">{m.email}</div>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {m.company || "—"}
                          {m.title ? (
                            <div className="text-xs opacity-70">{m.title}</div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3">
                          {m.roles.length === 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                              No access
                            </span>
                          ) : (
                            <select
                              value={m.roles[0]}
                              onChange={(e) => changeRole(m, e.target.value as AppRole)}
                              disabled={isSelf}
                              className={cn(
                                "rounded-md border bg-background px-2 py-1 text-xs font-medium capitalize",
                                roleBadgeClass[m.roles[0]],
                                isSelf && "opacity-60",
                              )}
                              title={isSelf ? "You can't change your own role" : undefined}
                            >
                              {ROLES.map((r) => (
                                <option key={r} value={r} className="bg-background text-foreground">
                                  {r}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {fmtDate(m.created_at)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setRemoveTarget(m)}
                            disabled={isSelf || m.roles.length === 0}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-destructive/60 hover:text-destructive disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : tab === "pending" ? (
          filteredPending.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No pending approvals. New signups without an invitation will appear here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left">Requester</th>
                    <th className="px-5 py-2 text-left">Company</th>
                    <th className="px-5 py-2 text-left">Signed up</th>
                    <th className="px-5 py-2 text-left">Grant role</th>
                    <th className="px-5 py-2 text-right">Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredPending.map((m) => {
                    const chosen = approvalRole[m.id] ?? "client";
                    const busy = processingId === m.id;
                    return (
                      <tr key={m.id} className="hover:bg-muted/20">
                        <td className="px-5 py-3">
                          <div className="font-medium">
                            {m.full_name || <span className="text-muted-foreground">—</span>}
                          </div>
                          <div className="text-xs text-muted-foreground">{m.email}</div>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {m.company || "—"}
                          {m.title ? (
                            <div className="text-xs opacity-70">{m.title}</div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">
                          {fmtDate(m.created_at)}
                        </td>
                        <td className="px-5 py-3">
                          <select
                            value={chosen}
                            onChange={(e) =>
                              setApprovalRole((prev) => ({
                                ...prev,
                                [m.id]: e.target.value as AppRole,
                              }))
                            }
                            className={cn(
                              "rounded-md border bg-background px-2 py-1 text-xs font-medium capitalize",
                              roleBadgeClass[chosen],
                            )}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r} className="bg-background text-foreground">
                                {r}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => approvePending(m)}
                              disabled={busy}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-60"
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <UserCheck className="h-3.5 w-3.5" />
                              )}
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRejectTarget(m);
                                setRejectReason("");
                              }}
                              disabled={busy}
                              className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/20 disabled:opacity-60"
                            >
                              <UserX className="h-3.5 w-3.5" /> Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : filteredInvites.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No invitations yet. Click <span className="font-medium">Invite member</span> to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 text-left">Email</th>
                  <th className="px-5 py-2 text-left">Role</th>
                  <th className="px-5 py-2 text-left">Status</th>
                  <th className="px-5 py-2 text-left">Expires</th>
                  <th className="px-5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredInvites.map((inv) => {
                  const expired = new Date(inv.expires_at) < new Date();
                  const effectiveStatus =
                    inv.status === "pending" && expired ? "expired" : inv.status;
                  return (
                    <tr key={inv.id} className="hover:bg-muted/20">
                      <td className="px-5 py-3">
                        <div className="font-medium">{inv.email}</div>
                        {inv.note ? (
                          <div className="text-xs text-muted-foreground">{inv.note}</div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                            roleBadgeClass[inv.role],
                          )}
                        >
                          {inv.role}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                            effectiveStatus === "pending" &&
                              "border-amber-500/40 bg-amber-500/10 text-amber-300",
                            effectiveStatus === "accepted" &&
                              "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
                            effectiveStatus === "revoked" &&
                              "border-border bg-muted text-muted-foreground",
                            effectiveStatus === "expired" &&
                              "border-destructive/40 bg-destructive/10 text-destructive",
                          )}
                        >
                          {effectiveStatus}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">
                        <div>{fmtDate(inv.expires_at)}</div>
                        <div
                          className={cn(
                            "flex items-center gap-1 text-[11px]",
                            expired
                              ? "text-destructive"
                              : daysUntil(inv.expires_at) <= 3
                                ? "text-amber-400"
                                : "opacity-70",
                          )}
                        >
                          <Clock className="h-3 w-3" />
                          {expiryLabel(inv.expires_at)}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          {effectiveStatus === "pending" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => setLinkInvite(inv)}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-primary"
                              >
                                <Copy className="h-3.5 w-3.5" /> Link
                              </button>
                              <button
                                type="button"
                                onClick={() => resendInvite(inv, 30)}
                                disabled={resendingId === inv.id}
                                title="Rotate token and extend by 30 days"
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-primary disabled:opacity-60"
                              >
                                {resendingId === inv.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" />
                                )}
                                Resend
                              </button>
                              <button
                                type="button"
                                onClick={() => revokeInvite(inv.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-destructive/60 hover:text-destructive"
                              >
                                <XCircle className="h-3.5 w-3.5" /> Revoke
                              </button>
                            </>
                          ) : effectiveStatus === "expired" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => resendInvite(inv, 30)}
                                disabled={resendingId === inv.id}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-primary/60 hover:text-primary disabled:opacity-60"
                              >
                                {resendingId === inv.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5" />
                                )}
                                Resend
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteInvite(inv.id)}
                                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-destructive/60 hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => deleteInvite(inv.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition hover:border-destructive/60 hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" /> Invite workspace member
            </DialogTitle>
            <DialogDescription>
              We'll generate a shareable invite link. The invited email will auto-activate the
              selected role the moment they sign up.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Email address
              </label>
              <Input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
                type="email"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Role</label>
              <div className="flex rounded-md border border-border bg-background p-0.5">
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setInviteRole(r)}
                    className={cn(
                      "flex-1 rounded px-3 py-1.5 text-xs font-medium capitalize transition",
                      inviteRole === r
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Note (optional)
              </label>
              <Textarea
                value={inviteNote}
                onChange={(e) => setInviteNote(e.target.value)}
                placeholder="e.g. External QA reviewer for Project Atlas"
                maxLength={280}
                rows={3}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Link expires in
              </label>
              <div className="flex rounded-md border border-border bg-background p-0.5">
                {EXPIRY_OPTIONS.map((opt) => (
                  <button
                    key={opt.days}
                    type="button"
                    onClick={() => setInviteExpiresInDays(opt.days)}
                    className={cn(
                      "flex-1 rounded px-3 py-1.5 text-xs font-medium transition",
                      inviteExpiresInDays === opt.days
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {inviteError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {inviteError}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setInviteOpen(false)}
              className="pilot-button-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createInvite}
              disabled={saving}
              className="pilot-button-primary disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Create invitation
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share link dialog */}
      <Dialog open={Boolean(linkInvite)} onOpenChange={(o) => !o && setLinkInvite(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share invitation link</DialogTitle>
            <DialogDescription>
              Send this link to <span className="font-medium">{linkInvite?.email}</span>. When they
              sign up with that email, the{" "}
              <span className="font-medium capitalize">{linkInvite?.role}</span> role is applied
              automatically.
            </DialogDescription>
          </DialogHeader>
          {linkInvite ? (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
                <code className="flex-1 truncate text-xs">{inviteLink(linkInvite.token)}</code>
                <button
                  type="button"
                  onClick={() => copyLink(linkInvite.token)}
                  className="pilot-button-primary h-8 px-2 text-xs"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Expires {fmtDate(linkInvite.expires_at)}. Revoke it any time from the Invitations
                tab.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              onClick={() => setLinkInvite(null)}
              className="pilot-button-ghost"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirm */}
      <Dialog open={Boolean(removeTarget)} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove workspace access?</DialogTitle>
            <DialogDescription>
              This revokes all roles for <span className="font-medium">{removeTarget?.email}</span>.
              Their sign-in account remains, but they lose access to protected surfaces immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRemoveTarget(null)}
              className="pilot-button-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={removeMember}
              disabled={removing}
              className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Remove access
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject signup dialog */}
      <Dialog
        open={Boolean(rejectTarget)}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject membership request?</DialogTitle>
            <DialogDescription>
              <span className="font-medium">{rejectTarget?.email}</span> will not receive any
              workspace role. Their sign-in account remains, but every protected surface stays
              blocked. You can add an optional reason for the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Reason (optional)
            </label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="e.g. Not a member of our team"
            />
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
              className="pilot-button-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmReject}
              disabled={processingId === rejectTarget?.id}
              className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {processingId === rejectTarget?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserX className="h-4 w-4" />
              )}
              Reject request
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminMembers;