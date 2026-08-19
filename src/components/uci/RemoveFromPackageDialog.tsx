import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { PACKAGE_DOCUMENT_REMOVAL_LOCKED_MESSAGE } from "@/lib/projectDestructiveSafety";

interface RemoveFromPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slotLabel: string;
  locked?: boolean;
  loading?: boolean;
  onConfirm: () => Promise<void> | void;
}

export function RemoveFromPackageDialog({
  open,
  onOpenChange,
  slotLabel,
  locked = false,
  loading = false,
  onConfirm,
}: RemoveFromPackageDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove from package</AlertDialogTitle>
          <AlertDialogDescription>
            {locked ? (
              PACKAGE_DOCUMENT_REMOVAL_LOCKED_MESSAGE
            ) : (
              <>
                Remove <span className="font-medium text-foreground">{slotLabel}</span> from
                this application package only. The source document on the project is
                preserved. This does not delete files from storage.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          {!locked ? (
            <AlertDialogAction onClick={() => void onConfirm()} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove from package
            </AlertDialogAction>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Hook-friendly pending slot state for Remove from package confirm. */
export function useRemoveFromPackageConfirm() {
  const [pendingSlot, setPendingSlot] = useState<{
    key: string;
    label: string;
  } | null>(null);

  return {
    pendingSlot,
    openConfirm: (key: string, label?: string) =>
      setPendingSlot({ key, label: label?.trim() || key.replace(/_/g, " ") }),
    closeConfirm: () => setPendingSlot(null),
  };
}
