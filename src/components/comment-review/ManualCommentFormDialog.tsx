import { useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  COMMENT_REVIEW_DISCIPLINES,
  emptyManualCommentForm,
  formValuesToParsedRow,
  parsedRowToFormValues,
  type ManualCommentFormValues,
  type ParsedRow,
} from "@/lib/commentReviewUploadRow";

interface ManualCommentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  initialRow?: ParsedRow | null;
  disciplineOptions: string[];
  onSave: (row: ParsedRow, mode: "add" | "edit") => void;
}

export function ManualCommentFormDialog({
  open,
  onOpenChange,
  mode,
  initialRow,
  disciplineOptions,
  onSave,
}: ManualCommentFormDialogProps) {
  const [values, setValues] = useState<ManualCommentFormValues>(emptyManualCommentForm());

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialRow) {
      setValues(parsedRowToFormValues(initialRow));
      return;
    }
    if (mode === "add") {
      setValues(emptyManualCommentForm());
    }
  }, [open, mode, initialRow?._clientId]);

  const setField = <K extends keyof ManualCommentFormValues>(
    key: K,
    value: ManualCommentFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    const hasCommentText =
      values.original_text.trim().length > 0 || values.previous_comment_text.trim().length > 0;
    if (!hasCommentText) return;

    const row = formValuesToParsedRow(values, {
      row_source: mode === "add" ? "manual" : (initialRow?.row_source ?? "manual"),
      existing: initialRow ?? undefined,
    });
    onSave(row, mode);
    onOpenChange(false);
  };

  const options = [...new Set([...COMMENT_REVIEW_DISCIPLINES, ...disciplineOptions])];
  const disciplineValue = options.includes(values.discipline)
    ? values.discipline
    : values.discipline || "Architecture";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        key={mode === "edit" ? `edit-${initialRow?._clientId ?? "unknown"}` : "add"}
        className="max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add comment manually" : "Edit comment"}</DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Add a comment that was missed by document parsing. It will be saved when you approve."
              : "Update fields before approving. Changes are kept in the review list until you approve."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="manual-discipline">Discipline</Label>
            <Select value={disciplineValue} onValueChange={(v) => setField("discipline", v)}>
              <SelectTrigger id="manual-discipline">
                <SelectValue placeholder="Select discipline" />
              </SelectTrigger>
              <SelectContent>
                {options.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="manual-reviewer">Reviewer name</Label>
              <Input
                id="manual-reviewer"
                value={values.reviewer_name}
                onChange={(e) => setField("reviewer_name", e.target.value)}
                placeholder="e.g. Jane Smith"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-number">Comment number</Label>
              <Input
                id="manual-number"
                value={values.comment_number}
                onChange={(e) => setField("comment_number", e.target.value)}
                placeholder="e.g. 8"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="manual-comment">Comment text / reviewer comment</Label>
            <Textarea
              id="manual-comment"
              value={values.original_text}
              onChange={(e) => setField("original_text", e.target.value)}
              placeholder="Active reviewer comment text"
              rows={4}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="manual-previous">Previous comment text</Label>
            <Textarea
              id="manual-previous"
              value={values.previous_comment_text}
              onChange={(e) => setField("previous_comment_text", e.target.value)}
              placeholder="Prior cycle comment, if applicable"
              rows={3}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="manual-response">Existing response text</Label>
            <Textarea
              id="manual-response"
              value={values.existing_response_text}
              onChange={(e) => setField("existing_response_text", e.target.value)}
              placeholder="Applicant response already in the letter, if any"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="manual-code-ref">Code reference</Label>
              <Input
                id="manual-code-ref"
                value={values.code_reference}
                onChange={(e) => setField("code_reference", e.target.value)}
                placeholder="e.g. IBC 1004.3"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="manual-code-refs">Additional code references</Label>
              <Input
                id="manual-code-refs"
                value={values.code_references}
                onChange={(e) => setField("code_references", e.target.value)}
                placeholder="Comma-separated"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="manual-source-label">Source label (optional)</Label>
            <Input
              id="manual-source-label"
              value={values.source_label}
              onChange={(e) => setField("source_label", e.target.value)}
              placeholder="e.g. Page 3, Fire section"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="gold"
            onClick={handleSave}
            disabled={
              !values.original_text.trim() && !values.previous_comment_text.trim()
            }
          >
            {mode === "add" ? "Add to list" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
