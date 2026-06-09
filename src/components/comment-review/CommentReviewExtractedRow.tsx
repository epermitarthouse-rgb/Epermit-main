import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import {
  uploadRowCommentPreview,
  uploadRowSourceLabel,
  type ParsedRow,
} from "@/lib/commentReviewUploadRow";

interface CommentReviewExtractedRowProps {
  row: ParsedRow;
  onEdit: (row: ParsedRow) => void;
  onDelete: (clientId: string) => void;
  disabled?: boolean;
}

export function CommentReviewExtractedRow({
  row,
  onEdit,
  onDelete,
  disabled = false,
}: CommentReviewExtractedRowProps) {
  const preview = uploadRowCommentPreview(row);
  const codeRef =
    row.code_reference?.trim() ||
    (row.code_references && row.code_references.length > 0
      ? row.code_references[0]
      : null);

  return (
    <div className="group flex items-start gap-2 rounded-lg border border-border/60 bg-card/40 px-2.5 py-2 transition-colors hover:border-border/80 hover:bg-muted/25 dark:border-obsidian-raised/80 dark:bg-obsidian-sunken/30 dark:hover:bg-obsidian-raised/25">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <Badge
            variant="outline"
            className={
              row.row_source === "manual"
                ? "h-[18px] rounded-full border-amber-500/35 bg-amber-500/10 px-1.5 text-[9px] font-medium text-amber-800 dark:text-amber-300"
                : "h-[18px] rounded-full border-teal/35 bg-teal/10 px-1.5 text-[9px] font-medium text-teal"
            }
          >
            {uploadRowSourceLabel(row)}
          </Badge>
          {row.discipline ? (
            <Badge
              variant="outline"
              className="h-[18px] rounded-full border-border/70 bg-muted/30 px-1.5 text-[9px] font-medium text-foreground"
            >
              {row.discipline}
            </Badge>
          ) : null}
          {codeRef ? (
            <Badge
              variant="outline"
              className="h-[18px] max-w-[160px] truncate rounded-full border-border/70 bg-muted/20 px-1.5 font-mono text-[9px] font-normal text-ink-secondary-light dark:text-ink-secondary-dark"
              title={codeRef}
            >
              {codeRef}
            </Badge>
          ) : null}
          {row.comment_number?.trim() ? (
            <span className="text-[9px] font-mono uppercase tracking-wide text-ink-tertiary-light dark:text-ink-tertiary-dark">
              #{row.comment_number.trim()}
            </span>
          ) : null}
        </div>

        <p
          className="text-[13px] leading-snug text-ink-primary-light line-clamp-2 dark:text-ink-primary-dark"
          title={preview}
        >
          {preview}
        </p>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-ink-tertiary-light dark:text-ink-tertiary-dark">
          {row.reviewer_name?.trim() ? (
            <span>{row.reviewer_name.trim()}</span>
          ) : null}
          {row.source_page != null ? <span>Page {row.source_page}</span> : null}
          {row.source_label?.trim() ? (
            <span className="truncate max-w-[200px]" title={row.source_label}>
              {row.source_label}
            </span>
          ) : null}
          {row._savedCommentId ? <span>Saved · pending re-approval</span> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 opacity-80 transition-opacity group-hover:opacity-100">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md text-ink-tertiary-light hover:bg-muted/60 hover:text-foreground dark:text-ink-tertiary-dark"
          onClick={() => onEdit(row)}
          disabled={disabled}
          aria-label="Edit comment"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md text-destructive/60 hover:bg-destructive/10 hover:text-destructive"
          onClick={() => onDelete(row._clientId)}
          disabled={disabled}
          aria-label="Remove comment"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
