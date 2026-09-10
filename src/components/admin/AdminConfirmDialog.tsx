import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

type AdminConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  requireTypedConfirm?: boolean;
  showReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => Promise<void>;
};

export function AdminConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  requireTypedConfirm = true,
  showReason = true,
  reasonLabel = "Reason (optional)",
  onConfirm,
}: AdminConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const canConfirm = !requireTypedConfirm || typed === "CONFIRM";

  const handleClose = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setTyped("");
      setReason("");
    }
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    if (!canConfirm || busy) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setTyped("");
      setReason("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {showReason ? (
            <div className="space-y-2">
              <Label htmlFor="admin-confirm-reason">{reasonLabel}</Label>
              <Textarea
                id="admin-confirm-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Document why this change is being made"
              />
            </div>
          ) : null}
          {requireTypedConfirm ? (
            <div className="space-y-2">
              <Label htmlFor="admin-confirm-typed">
                Type <span className="font-mono font-semibold">CONFIRM</span> to proceed
              </Label>
              <Input
                id="admin-confirm-typed"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void handleConfirm()} disabled={!canConfirm || busy}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Working…
              </>
            ) : (
              confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
