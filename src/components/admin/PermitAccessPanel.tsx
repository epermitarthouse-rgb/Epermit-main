import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AlertBanner, Panel, StatusPill, type StatusTone } from "@/components/design/ProductPrimitives";
import { formatTimestamp } from "@/components/permits/PermitRepositoryViews";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  listPermitAccess,
  setPermitSourceVisibleToAll,
  setPermitUserHidden,
  type PermitAccessState,
  type PermitAccessUser,
} from "@/lib/centralPermits";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const ACCESS_QUERY_KEY = ["permit-sync", "access"] as const;

export const ACCESS_STATE: Record<PermitAccessState, { label: string; tone: StatusTone }> = {
  admin: { label: "Platform admin", tone: "info" },
  default: { label: "Visible (default)", tone: "good" },
  grant: { label: "Visible (grant)", tone: "good" },
  hidden: { label: "Hidden", tone: "bad" },
  inactive: { label: "Inactive account", tone: "default" },
  none: { label: "No access", tone: "default" },
};

/** "Visible to all users by default" for one source (D-120). Off means only grants and admins read its permits. */
export function SourceVisibilitySwitch({ credentialId, checked, disabled, onChange }: {
  credentialId: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (visible: boolean) => void;
}) {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
      aria-label="Visible to all users by default"
      data-testid={`visible-all-${credentialId}`}
    />
  );
}

export function PermitAccessTable({ rows, busy, onToggle }: {
  rows: PermitAccessUser[];
  busy: boolean;
  onToggle: (user: PermitAccessUser) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Access</TableHead>
          <TableHead>Hidden since</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((u) => {
          const s = ACCESS_STATE[u.state] ?? ACCESS_STATE.none;
          return (
            <TableRow key={u.user_id}>
              <TableCell className="text-sm">
                {str(u.full_name) || <span className="font-mono text-xs text-muted-foreground">{u.user_id.slice(0, 8)}…</span>}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{str(u.company_name) || "—"}</TableCell>
              <TableCell><StatusPill tone={s.tone}>{s.label}</StatusPill></TableCell>
              <TableCell className="text-sm">{u.hidden ? formatTimestamp(u.hidden_at) : "—"}</TableCell>
              <TableCell className="text-right">
                {u.state === "admin" ? (
                  <span className="text-xs text-muted-foreground">Always sees permits</span>
                ) : (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => onToggle(u)}>
                    {u.hidden ? "Unhide" : "Hide"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          );
        })}
        {!rows.length ? (
          <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No users.</TableCell></TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

/** Which users can read a source's permits, with a hide / unhide toggle (audited server-side). */
export function PermitAccessPanel({ sources }: { sources: Row[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [picked, setPicked] = useState<string | null>(null);
  const credentialId = picked && sources.some((s) => str(s.credential_id) === picked) ? picked : str(sources[0]?.credential_id);
  const source = sources.find((s) => str(s.credential_id) === credentialId);
  const users = useQuery({
    queryKey: [...ACCESS_QUERY_KEY, credentialId],
    queryFn: () => listPermitAccess(credentialId),
    enabled: Boolean(credentialId),
  });
  const toggle = useMutation({
    mutationFn: (u: PermitAccessUser) => setPermitUserHidden({ userId: u.user_id, credentialId, hidden: !u.hidden }),
    onSuccess: (_changed, u) => {
      void qc.invalidateQueries({ queryKey: ACCESS_QUERY_KEY });
      toast({ title: u.hidden ? "Permits visible again" : "Permits hidden from this user" });
    },
    onError: (e) => toast({ title: "Action failed", description: errorText(e), variant: "destructive" }),
  });
  const visibleToAll = source?.visible_to_all === true;
  const setDefault = useMutation({
    mutationFn: (visible: boolean) => setPermitSourceVisibleToAll(credentialId, visible),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["permit-sync"] });
      toast({ title: "Default visibility saved" });
    },
    onError: (e) => toast({ title: "Action failed", description: errorText(e), variant: "destructive" }),
  });

  return (
    <Panel title="Who sees these permits" eyebrow="Default access and hidden users">
      {!sources.length ? (
        <p className="text-sm text-muted-foreground">No sources configured.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <Select value={credentialId} onValueChange={setPicked}>
              <SelectTrigger className="w-[320px]" aria-label="Source"><SelectValue /></SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={str(s.credential_id)} value={str(s.credential_id)}>
                    {str(s.adapter_key)} · {str(s.credential_id).slice(0, 8)}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm">
              <SourceVisibilitySwitch credentialId={credentialId} checked={visibleToAll} disabled={setDefault.isPending} onChange={(v) => setDefault.mutate(v)} />
              Visible to all users by default
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            {visibleToAll
              ? "Every active user, now and in the future, can read this source's permits. Hide it from a user below. Reading never allows a refresh."
              : "Only platform admins and users with a grant can read this source's permits."}
          </p>
          {users.error ? <AlertBanner tone="bad" title="Could not load users" detail={errorText(users.error)} /> : null}
          {users.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
            <PermitAccessTable rows={users.data ?? []} busy={toggle.isPending} onToggle={(u) => toggle.mutate(u)} />
          )}
        </div>
      )}
    </Panel>
  );
}
