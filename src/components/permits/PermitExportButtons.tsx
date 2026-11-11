import { useMutation } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRequireAdmin } from "@/hooks/useRequireAdmin";
import { useToast } from "@/hooks/use-toast";
import { exportDcPermitsZip, exportPermitJson, triggerBrowserDownload } from "@/lib/permitExport";

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

/** Renders nothing for non-admins. The export itself re-checks admin server-side and reads through RLS. */
export function AdminExportButton({ isAdmin, label, busy, onClick }: { isAdmin: boolean; label: string; busy: boolean; onClick: () => void }) {
  if (!isAdmin) return null;
  return (
    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClick} data-admin-export>
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
      {busy ? "Preparing export…" : label}
    </Button>
  );
}

export function PermitJsonExportButton({ permitId }: { permitId: string }) {
  const { isAdmin } = useRequireAdmin();
  const { toast } = useToast();
  const run = useMutation({
    mutationFn: () => exportPermitJson(permitId),
    onSuccess: ({ fileName, text }) => {
      triggerBrowserDownload(fileName, text, "application/json");
      toast({ title: "Permit exported", description: fileName });
    },
    onError: (e) => toast({ title: "Export failed", description: errorText(e), variant: "destructive" }),
  });
  return <AdminExportButton isAdmin={isAdmin} label="Export JSON" busy={run.isPending} onClick={() => run.mutate()} />;
}

export function DcZipExportButton() {
  const { isAdmin } = useRequireAdmin();
  const { toast } = useToast();
  const run = useMutation({
    mutationFn: () => exportDcPermitsZip(),
    onSuccess: ({ fileName, bytes, permitCount }) => {
      triggerBrowserDownload(fileName, bytes, "application/zip");
      toast({ title: `${permitCount} DC permits exported`, description: fileName });
    },
    onError: (e) => toast({ title: "Export failed", description: errorText(e), variant: "destructive" }),
  });
  return <AdminExportButton isAdmin={isAdmin} label="Export all DC permits (ZIP)" busy={run.isPending} onClick={() => run.mutate()} />;
}
