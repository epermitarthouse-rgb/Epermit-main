import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_MICROSOFT_MAILBOX,
  getMicrosoftAuthorizeUrl,
  getMicrosoftMailboxStatus,
  MICROSOFT_MAILBOX_SYNC_CHANNEL,
  MICROSOFT_MAILBOX_SYNC_STORAGE_KEY,
  parseMicrosoftMailboxSyncStorageValue,
  testMicrosoftMailboxRead,
  type MicrosoftMailboxStatus,
} from "@/lib/microsoftMailboxApi";
import { cn } from "@/lib/utils";
import { EDITORIAL_FORM_CARD } from "@/components/layout/editorialPageChrome";

const POST_CONNECT_POLL_MS = 2500;
const POST_CONNECT_POLL_MAX_MS = 120_000;

export function MicrosoftMailboxConnector() {
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [status, setStatus] = useState<MicrosoftMailboxStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollUntilRef = useRef<number>(0);
  const pollTimerRef = useRef<number | null>(null);

  const reload = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setBusy(true);
    try {
      const st = await getMicrosoftMailboxStatus();
      setStatus(st);
      setLoadError(null);
      return st;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not load Microsoft mailbox status";
      setLoadError(message);
      // Do not overwrite a known connected state with a false "Not connected" on transient API failure
      // (e.g. parallel scraper on :3002 briefly down while Vite on :5001 stays up).
      setStatus((prev) => (prev?.connected ? prev : { connected: false }));
      if (!opts?.quiet) toast.error(message);
      return null;
    } finally {
      if (!opts?.quiet) setBusy(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    pollUntilRef.current = 0;
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const schedulePollTick = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (Date.now() >= pollUntilRef.current) return;
    pollTimerRef.current = window.setTimeout(async () => {
      pollTimerRef.current = null;
      const st = await reload({ quiet: true });
      if (st?.connected) {
        stopPolling();
        toast.success(
          st.mailbox_email
            ? `Microsoft mailbox connected (${st.mailbox_email}).`
            : "Microsoft mailbox connected.",
        );
        return;
      }
      schedulePollTick();
    }, POST_CONNECT_POLL_MS);
  }, [reload, stopPolling]);

  const beginPostConnectPolling = useCallback(() => {
    pollUntilRef.current = Date.now() + POST_CONNECT_POLL_MAX_MS;
    schedulePollTick();
  }, [schedulePollTick]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const onVisibleOrFocus = () => {
      if (document.visibilityState === "hidden") return;
      void reload({ quiet: true });
    };
    window.addEventListener("focus", onVisibleOrFocus);
    document.addEventListener("visibilitychange", onVisibleOrFocus);

    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== MICROSOFT_MAILBOX_SYNC_STORAGE_KEY) return;
      if (!parseMicrosoftMailboxSyncStorageValue(ev.newValue)) return;
      beginPostConnectPolling();
      void reload({ quiet: true }).then((st) => {
        if (st?.connected) stopPolling();
      });
    };
    window.addEventListener("storage", onStorage);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(MICROSOFT_MAILBOX_SYNC_CHANNEL);
      channel.onmessage = (ev: MessageEvent) => {
        const data = ev?.data as { type?: string } | null;
        if (!data || data.type !== "connected") return;
        beginPostConnectPolling();
        void reload({ quiet: true }).then((st) => {
          if (st?.connected) stopPolling();
        });
      };
    } catch {
      channel = null;
    }

    return () => {
      window.removeEventListener("focus", onVisibleOrFocus);
      document.removeEventListener("visibilitychange", onVisibleOrFocus);
      window.removeEventListener("storage", onStorage);
      channel?.close();
      stopPolling();
    };
  }, [beginPostConnectPolling, reload, stopPolling]);

  const connect = async () => {
    setBusy(true);
    try {
      const url = await getMicrosoftAuthorizeUrl(DEFAULT_MICROSOFT_MAILBOX);
      window.open(url, "_blank", "noopener,noreferrer");
      beginPostConnectPolling();
      toast.message("Continue Microsoft sign-in in the new tab — status will refresh automatically.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start Microsoft OAuth");
    } finally {
      setBusy(false);
    }
  };

  const testRead = async () => {
    setTestBusy(true);
    try {
      const out = await testMicrosoftMailboxRead();
      toast.success(`Inbox reachable — checked ${String(out.messages_checked ?? 0)} recent message bucket(s).`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mailbox read test failed");
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <Card className={cn(EDITORIAL_FORM_CARD)}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Microsoft mailbox{" "}
          {status?.connected ? (
            <Badge variant="ai">Connected</Badge>
          ) : (
            <Badge variant="secondary">Not connected</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Connect your Microsoft 365 mailbox via Graph. Tokens are stored **per PermitPilot user** (encrypted on the scraper). Stage 4 email submissions will send as **your connected mailbox** (`/me/sendMail`) — not a hardcoded shared address. Optional shared ops mailboxes (e.g. for PEPCO MFA) are separate from Stage 4 From identity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.mailbox_email ? (
          <p className="text-sm">
            Mailbox:{" "}
            <span className="font-semibold">{status.mailbox_email}</span>
          </p>
        ) : null}
        {loadError ? (
          <p className="text-xs text-destructive">
            Status check failed ({loadError}). If you just connected Outlook, confirm the parallel scraper is running on port 3002, then refresh.
          </p>
        ) : null}
        {(status?.last_connected_at || status?.last_checked_at) && (
          <p className="text-xs text-muted-foreground">
            {status.last_connected_at ? <>Last linked: {status.last_connected_at}</> : null}
            {status.last_connected_at && status.last_checked_at ? " · " : null}
            {status.last_checked_at ? <>Last inbox check: {status.last_checked_at}</> : null}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void reload()} aria-busy={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Refresh status
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void connect()} aria-busy={busy}>
            Connect Microsoft Mailbox
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={testBusy || busy || !status?.connected}
            onClick={() => void testRead()}
            aria-busy={testBusy}
          >
            {testBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Test Mailbox Read
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
