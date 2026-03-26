import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Plus, PenLine, CheckCircle2, AlertTriangle } from "lucide-react";
import type { ResponsePackageDraft } from "@/hooks/useResponsePackageDrafts";

export interface ChangeItem {
  id: string;
  original_text: string;
  type: "new" | "modified" | "resolved";
  oldResponse?: string;
  newResponse?: string;
}

export interface RoundChanges {
  newComments: ChangeItem[];
  modifiedResponses: ChangeItem[];
  resolvedComments: ChangeItem[];
  comparedToRound: number;
}

export function computeRoundChanges(
  currentComments: Array<{
    id: string;
    original_text: string;
    status: string;
    response_text: string | null;
  }>,
  previousDraft: ResponsePackageDraft | null
): RoundChanges | null {
  if (!previousDraft || !previousDraft.comment_snapshot) return null;

  const snapshot = previousDraft.comment_snapshot;
  const snapshotIds = new Set(Object.keys(snapshot));

  const newComments: ChangeItem[] = [];
  const modifiedResponses: ChangeItem[] = [];
  const resolvedComments: ChangeItem[] = [];

  for (const comment of currentComments) {
    const prevResponse = snapshot[comment.id];

    if (prevResponse === undefined) {
      newComments.push({
        id: comment.id,
        original_text: comment.original_text,
        type: "new",
        newResponse: comment.response_text ?? "",
      });
      continue;
    }

    const currentResponse = comment.response_text ?? "";
    if (currentResponse !== prevResponse) {
      modifiedResponses.push({
        id: comment.id,
        original_text: comment.original_text,
        type: "modified",
        oldResponse: prevResponse,
        newResponse: currentResponse,
      });
    }

    const statusLower = (comment.status ?? "").toLowerCase();
    if (statusLower === "approved") {
      resolvedComments.push({
        id: comment.id,
        original_text: comment.original_text,
        type: "resolved",
      });
    }
  }

  return {
    newComments,
    modifiedResponses,
    resolvedComments,
    comparedToRound: previousDraft.round_number,
  };
}

export function getModifiedCommentIds(
  currentComments: Array<{
    id: string;
    response_text: string | null;
  }>,
  previousDraft: ResponsePackageDraft | null
): Set<string> {
  const ids = new Set<string>();
  if (!previousDraft?.comment_snapshot) return ids;

  const snapshot = previousDraft.comment_snapshot;

  for (const comment of currentComments) {
    const prevResponse = snapshot[comment.id];
    if (prevResponse === undefined) {
      ids.add(comment.id);
    } else {
      const currentResponse = comment.response_text ?? "";
      if (currentResponse !== prevResponse) {
        ids.add(comment.id);
      }
    }
  }

  return ids;
}

interface RoundChangeSummaryProps {
  changes: RoundChanges | null;
}

function ChangeItemRow({ item }: { item: ChangeItem }) {
  const preview = item.original_text.length > 100
    ? item.original_text.slice(0, 100) + "..."
    : item.original_text;

  return (
    <div className="py-2 space-y-1" data-testid={`change-item-${item.id}`}>
      <p className="text-xs text-foreground line-clamp-2">{preview}</p>
      {item.type === "modified" && item.oldResponse && item.newResponse && (
        <div className="flex flex-col gap-1 mt-1">
          <p className="text-[11px] text-muted-foreground line-through line-clamp-1">
            {item.oldResponse || "(empty)"}
          </p>
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 line-clamp-1">
            {item.newResponse || "(empty)"}
          </p>
        </div>
      )}
    </div>
  );
}

export function RoundChangeSummary({ changes }: RoundChangeSummaryProps) {
  const totalChanges = useMemo(() => {
    if (!changes) return 0;
    return changes.newComments.length + changes.modifiedResponses.length + changes.resolvedComments.length;
  }, [changes]);

  if (!changes) return null;

  if (totalChanges === 0) {
    return (
      <Card className="p-4 bg-muted/20" data-testid="panel-round-changes-empty">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <p className="text-sm text-muted-foreground">
            No changes since Round {changes.comparedToRound}.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3" data-testid="panel-round-changes">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <p className="text-sm font-medium">
            Changes Since Round {changes.comparedToRound}
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          {totalChanges} change{totalChanges !== 1 ? "s" : ""}
        </Badge>
      </div>

      {changes.newComments.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Plus className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-xs font-medium text-blue-700 dark:text-blue-400">
              New Comments ({changes.newComments.length})
            </span>
          </div>
          <div className="border rounded-md divide-y max-h-32 overflow-y-auto px-3">
            {changes.newComments.map((item) => (
              <ChangeItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {changes.modifiedResponses.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <PenLine className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Modified Responses ({changes.modifiedResponses.length})
            </span>
          </div>
          <div className="border rounded-md divide-y max-h-32 overflow-y-auto px-3">
            {changes.modifiedResponses.map((item) => (
              <ChangeItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}

      {changes.resolvedComments.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              Resolved ({changes.resolvedComments.length})
            </span>
          </div>
          <div className="border rounded-md divide-y max-h-32 overflow-y-auto px-3">
            {changes.resolvedComments.map((item) => (
              <ChangeItemRow key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
