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

function attemptStatusLabel(status: string): string {
  if (status === "success") return "Succeeded";
  if (status === "failed") return "Failed";
  if (status === "skipped") return "Skipped";
  if (status === "not_available") return "Not available";
  return status;
}

export function PgcRetryFailedItemsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PortalFailedItem[];
  /** Controlled selection — owned by parent so remounts cannot select-all. */
  selectedIds: ReadonlySet<string>;
  onSelectedIdsChange: (next: Set<string>) => void;
  busy?: boolean;
  summaryLine?: string | null;
  onRetrySelected: (selected: PortalFailedItem[]) => void;
}) {
  const {
    open,
    onOpenChange,
    items: itemsProp,
    selectedIds,
    onSelectedIdsChange,
    busy,
    summaryLine,
    onRetrySelected,
  } = props;
  const items = Array.isArray(itemsProp) ? itemsProp : [];
  const groups = useMemo(() => groupFailedItemsByFolderAndType(items), [items]);
  const counts = useMemo(() => countRetryableFailedItems(items), [items]);
  const retryableIds = useMemo(
    () => items.filter((i) => i.retryable).map((i) => i.id),
    [items],
  );
  const retryableIdsKey = useMemo(() => retryableIds.join("\0"), [retryableIds]);
  const retryableIdsRef = useRef(retryableIds);
  retryableIdsRef.current = retryableIds;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const [historyOpenIds, setHistoryOpenIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) setHistoryOpenIds(new Set());
  }, [open]);

  // While open: only prune invalid IDs. Never expand to all (parent sets all on open).
  useEffect(() => {
    if (!open || busy) return;
    const next = syncFailedItemsSelection(
      selectedIdsRef.current,
      retryableIdsRef.current,
      { resetToAll: false },
    );
    const prev = selectedIdsRef.current;
    if (next.size === prev.size && [...next].every((id) => prev.has(id))) {
      return;
    }
    onSelectedIdsChange(next);
  }, [open, busy, retryableIdsKey, onSelectedIdsChange]);

  const toggle = (id: string, retryable: boolean) => {
    if (!retryable || busy) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(next);
  };

  const selectAllRetryable = () => onSelectedIdsChange(new Set(retryableIds));
  const clearSelection = () => onSelectedIdsChange(new Set());

  const selectedItems = items.filter((i) => selectedIds.has(i.id) && i.retryable);

  const handleRetryClick = () => {
    // Block double submit while start/scrape is pending.
    if (busy) return;
    // Snapshot at click time so later item/live-state updates cannot expand it.
    const snapshot = items.filter((i) => selectedIds.has(i.id) && i.retryable);
    if (snapshot.length === 0) return;
    onRetrySelected(snapshot);
  };

  const toggleHistory = (id: string) => {
    setHistoryOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-border bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Retry failed items</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {counts.total} failed item{counts.total === 1 ? "" : "s"} · {counts.retryable}{" "}
            retryable · {counts.notRetryable} not retryable. Each artifact is listed once
            (latest attempt). Older attempts stay under Attempt history.
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
                    const history = (item.attempts || []).slice(1);
                    const historyOpen = historyOpenIds.has(item.id);
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
                          {history.length > 0 ? (
                            <div className="pt-1">
                              <button
                                type="button"
                                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
                                onClick={() => toggleHistory(item.id)}
                              >
                                {historyOpen
                                  ? "Hide attempt history"
                                  : `Attempt history (${history.length})`}
                              </button>
                              {historyOpen ? (
                                <ul className="mt-1 space-y-1 border-l border-border pl-3">
                                  {history.map((attempt, idx) => (
                                    <li
                                      key={`${item.id}-hist-${idx}-${attempt.at || ""}`}
                                      className="text-[11px] text-muted-foreground"
                                    >
                                      <span className="font-medium text-foreground/80">
                                        {attemptStatusLabel(attempt.status)}
                                      </span>
                                      {" · "}
                                      {attempt.at
                                        ? new Date(attempt.at).toLocaleString()
                                        : "—"}
                                      {attempt.reason ? ` · ${attempt.reason}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ) : null}
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
