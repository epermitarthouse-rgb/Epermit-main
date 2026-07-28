import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import {
  countRetryableFailedItems,
  groupFailedItemsByFolderAndType,
  syncFailedItemsSelection,
  type FailedItemRetryLiveState,
  type PortalFailedItem,
} from "@/lib/portalHarvestFailedItems";
import { cn } from "@/lib/utils";

function artifactTypeLabel(t: PortalFailedItem["artifactType"]): string {
  if (t === "pdf") return "PDF";
  if (t === "excel") return "Excel";
  return "File";
}

function liveStateLabel(state?: FailedItemRetryLiveState | null): string | null {
  if (!state) return null;
  switch (state) {
    case "queued":
      return "Queued";
    case "retrying":
      return "Retrying";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "human_action_required":
      return "Human action required";
    default:
      return null;
  }
}

export function PgcRetryFailedItemsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PortalFailedItem[];
  busy?: boolean;
  summaryLine?: string | null;
  onRetrySelected: (selected: PortalFailedItem[]) => void;
}) {
  const { open, onOpenChange, items, busy, summaryLine, onRetrySelected } = props;
  const groups = useMemo(() => groupFailedItemsByFolderAndType(items), [items]);
  const counts = useMemo(() => countRetryableFailedItems(items), [items]);
  const retryableIds = useMemo(
    () => items.filter((i) => i.retryable).map((i) => i.id),
    [items],
  );
  // Stable key so liveState-only item updates don't look like a new ID set.
  const retryableIdsKey = useMemo(() => retryableIds.join("\0"), [retryableIds]);
  const retryableIdsRef = useRef(retryableIds);
  retryableIdsRef.current = retryableIds;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open) return;
    setSelectedIds((prev) =>
      syncFailedItemsSelection(prev, retryableIdsRef.current, {
        resetToAll: justOpened,
      }),
    );
  }, [open, retryableIdsKey]);

  const toggle = (id: string, retryable: boolean) => {
    if (!retryable || busy) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllRetryable = () => setSelectedIds(new Set(retryableIds));
  const clearSelection = () => setSelectedIds(new Set());

  const selectedItems = items.filter((i) => selectedIds.has(i.id) && i.retryable);

  const handleRetryClick = () => {
    // Snapshot selection at click time so later item/live-state updates cannot expand it.
    const snapshot = items.filter((i) => selectedIds.has(i.id) && i.retryable);
    onRetrySelected(snapshot);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-border bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Retry failed items</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {counts.total} failed item{counts.total === 1 ? "" : "s"} · {counts.retryable}{" "}
            retryable · {counts.notRetryable} not retryable. Pending files are not included —
            use Run Full Harvest when available.
          </p>
          {summaryLine ? (
            <p className="text-sm font-medium text-foreground">{summaryLine}</p>
          ) : null}
        </DialogHeader>

        <div className="flex flex-wrap gap-2 py-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || retryableIds.length === 0}
            onClick={selectAllRetryable}
          >
            Select all retryable
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || selectedIds.size === 0}
            onClick={clearSelection}
          >
            Clear selection
          </Button>
        </div>

        <div className="space-y-4">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failed items to review.</p>
          ) : (
            groups.map((group) => (
              <div
                key={`${group.folder}::${group.artifactType}`}
                className="rounded-lg border border-border bg-muted/20"
              >
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div className="text-sm font-medium text-foreground">{group.folder}</div>
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    {artifactTypeLabel(group.artifactType)}
                  </Badge>
                </div>
                <ul className="divide-y divide-border">
                  {group.items.map((item) => {
                    const live = liveStateLabel(item.liveState);
                    return (
                      <li key={item.id} className="flex gap-3 px-3 py-3">
                        <Checkbox
                          checked={selectedIds.has(item.id)}
                          disabled={!item.retryable || busy}
                          onCheckedChange={() => toggle(item.id, item.retryable)}
                          aria-label={`Select ${item.name}`}
                          className="mt-1"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="min-w-0 break-words text-sm font-medium text-foreground">
                              {item.name}
                            </span>
                            <Badge variant="outline" className="text-[10px] uppercase">
                              {artifactTypeLabel(item.artifactType)}
                            </Badge>
                            <Badge
                              variant={item.retryable ? "outline" : "destructive"}
                              className="text-[10px]"
                            >
                              {item.retryable ? "Retryable" : "Not retryable"}
                            </Badge>
                            {live ? (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px]",
                                  item.liveState === "succeeded" && "border-primary text-primary",
                                  item.liveState === "failed" && "border-destructive text-destructive",
                                )}
                              >
                                {live}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Folder: {item.folder} · Last attempt:{" "}
                            {item.lastAttempt
                              ? new Date(item.lastAttempt).toLocaleString()
                              : "—"}{" "}
                            · Retry count: {item.retryCount}
                          </p>
                          <p className="text-xs text-destructive break-words">
                            {item.failureReason}
                            {!item.retryable && item.notRetryableReason
                              ? ` — ${item.notRetryableReason}`
                              : ""}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || selectedItems.length === 0}
            onClick={handleRetryClick}
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Retrying…
              </>
            ) : (
              `Retry selected (${selectedItems.length})`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
