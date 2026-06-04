import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_MICROSOFT_MAILBOX,
  getMicrosoftAuthorizeUrl,
  getMicrosoftMailboxStatus,
  testMicrosoftMailboxRead,
} from "@/lib/microsoftMailboxApi";
import { cn } from "@/lib/utils";
import { EDITORIAL_FORM_CARD } from "@/components/layout/editorialPageChrome";

export function MicrosoftMailboxConnector() {
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [status, setStatus] = useState<{
    connected: boolean;
    mailbox_email?: string | null;
    last_connected_at?: string | null;
    last_checked_at?: string | null;
  } | null>(null);

  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const st = await getMicrosoftMailboxStatus();
      setStatus(st);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load Microsoft mailbox status");
      setStatus({ connected: false });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const connect = async () => {
    setBusy(true);
    try {
      const url = await getMicrosoftAuthorizeUrl(DEFAULT_MICROSOFT_MAILBOX);
      window.open(url, "_blank", "noopener,noreferrer");
      toast.message("Continue Microsoft sign-in in the new tab, then refresh status here.");
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
          Connect <span className="font-mono text-xs">{DEFAULT_MICROSOFT_MAILBOX}</span> via Microsoft Graph for
          optional PEPCO email MFA automation. Tokens are encrypted on the PermitPilot scraper backend.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.mailbox_email ? (
          <p className="text-sm">
            Mailbox:{" "}
            <span className="font-semibold">{status.mailbox_email}</span>
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
