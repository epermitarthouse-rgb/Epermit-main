import { useCallback, useState } from "react";
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
  AlertCircle,
  CheckCircle2,
  FileImage,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { commentReviewToolbarBtn } from "@/lib/commentReviewToolbar";
import type { PendingUploadFile } from "@/lib/commentReviewBatchUpload";
import { pendingFileStatusDisplay } from "@/lib/commentReviewBatchProcess";
import {
  COMMENT_REVIEW_DISCIPLINES,
  PASTED_COMMENTS_SOURCE_LABEL,
} from "@/lib/commentReviewUploadRow";
import type { ProjectDocument } from "@/types/document";

export type CommentInputMethod = "upload" | "paste";

interface ParserSummary {
  total: number;
  by_discipline: Record<string, number>;
}

interface CommentReviewInputPanelProps {
  inputMethod: CommentInputMethod;
  onInputMethodChange: (method: CommentInputMethod) => void;
  supportedFormatsHint: string;
  commentLetters: ProjectDocument[];
  selectedLetter: ProjectDocument | null;
  sourceDocumentId: string | null;
  onSelectLetter: (docId: string) => void;
  savedManualLetterCount: number;
  imagePreview: string | null;
  originalUploadFile: File | null;
  pendingUploadFiles: PendingUploadFile[];
  onRequestRemovePendingBatchFile: (id: string) => void;
  isFileUploadInFlight?: (fileRowId: string) => boolean;
  pendingRemovalFileId: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFilesDropped: (files: File[]) => void;
  fileSelectionError: string | null;
  isSpreadsheetFile: (file: File) => boolean;
  formatLetterDate: (iso: string) => string;
  parseStatus: string | null;
  lastParseMethod: string | null;
  parserSummary: ParserSummary | null;
  uploadRowsCount: number;
  parsing: boolean;
  saving: boolean;
  canParseLetter: boolean;
  parseButtonLabel: string;
  onParseDocument: () => void;
  onClearSaved: () => void;
  onDeleteSavedLetter: () => void;
  disciplineOptions: string[];
  onParsePasted: (payload: {
    text: string;
    sourceLabel: string;
    discipline: string;
  }) => Promise<void>;
  onAddPastedSingle: (payload: {
    text: string;
    sourceLabel: string;
    discipline: string;
  }) => void;
}

function PendingFileStatusIcon({ status }: { status: PendingUploadFile["status"] }) {
  if (status === "success") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
  }
  if (status === "failed") {
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  }
  if (status === "pending") {
    return null;
  }
  return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teal" />;
}

function isPendingFileRowProcessing(
  item: PendingUploadFile,
  parsing: boolean,
): boolean {
  return (
    parsing &&
    (item.status === "uploading" ||
      item.status === "converting" ||
      item.status === "extracting" ||
      item.status === "parsing")
  );
}

export function CommentReviewInputPanel({
  inputMethod,
  onInputMethodChange,
  supportedFormatsHint,
  commentLetters,
  selectedLetter,
  sourceDocumentId,
  onSelectLetter,
  savedManualLetterCount,
  imagePreview,
  originalUploadFile,
  pendingUploadFiles,
  onRequestRemovePendingBatchFile,
  isFileUploadInFlight,
  pendingRemovalFileId,
  fileInputRef,
  onFileChange,
  onFilesDropped,
  fileSelectionError,
  isSpreadsheetFile,
  formatLetterDate,
  parseStatus,
  lastParseMethod,
  parserSummary,
  uploadRowsCount,
  parsing,
  saving,
  canParseLetter,
  parseButtonLabel,
  onParseDocument,
  onClearSaved,
  onDeleteSavedLetter,
  disciplineOptions,
  onParsePasted,
  onAddPastedSingle,
}: CommentReviewInputPanelProps) {
  const [pastedText, setPastedText] = useState("");
  const [pasteSourceLabel, setPasteSourceLabel] = useState("");
  const [pasteDiscipline, setPasteDiscipline] = useState("Architecture");
  const [dragActive, setDragActive] = useState(false);

  const disciplineSelectOptions = [
    ...new Set([...COMMENT_REVIEW_DISCIPLINES, ...disciplineOptions]),
  ];
  const hasPastedText = pastedText.trim().length > 0;
  const resolvedPasteSourceLabel =
    pasteSourceLabel.trim() || PASTED_COMMENTS_SOURCE_LABEL;

  const methodChipClass = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
      active
        ? "bg-background text-foreground shadow-sm dark:bg-obsidian-raised dark:text-ink-primary-dark"
        : "text-muted-foreground hover:text-foreground",
    );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length > 0) {
        onFilesDropped(files);
      }
    },
    [onFilesDropped],
  );

  const showSingleFilePreview =
    pendingUploadFiles.length === 0 &&
    (imagePreview || originalUploadFile || selectedLetter);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-ink-primary-light dark:text-ink-primary-dark">
          Add comments
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Upload one or more comment letters, or paste reviewer comments directly.
        </p>
      </div>

      <div
        className="inline-flex rounded-lg border border-border/50 bg-muted/15 p-0.5 dark:bg-obsidian-sunken/50"
        role="tablist"
        aria-label="Comment input method"
      >
        <button
          type="button"
          role="tab"
          aria-selected={inputMethod === "upload"}
          className={methodChipClass(inputMethod === "upload")}
          onClick={() => onInputMethodChange("upload")}
        >
          Upload document
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={inputMethod === "paste"}
          className={methodChipClass(inputMethod === "paste")}
          onClick={() => onInputMethodChange("paste")}
        >
          Paste comments
        </button>
      </div>

      {inputMethod === "upload" ? (
        <div className="space-y-3">
          {commentLetters.length > 0 ? (
            <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2 dark:bg-obsidian-sunken/30">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Saved letter
                </span>
                {commentLetters.length > 1 ? (
                  <Select
                    value={sourceDocumentId ?? undefined}
                    onValueChange={onSelectLetter}
                  >
                    <SelectTrigger className="h-7 max-w-[200px] text-xs border-border/50">
                      <SelectValue placeholder="Select letter" />
                    </SelectTrigger>
                    <SelectContent>
                      {commentLetters.map((letter) => (
                        <SelectItem key={letter.id} value={letter.id} className="text-xs">
                          {letter.file_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
              {selectedLetter ? (
                <div className="mt-1.5 space-y-2">
                  <div className="space-y-0.5 text-[11px] text-muted-foreground">
                    <p className="truncate text-foreground/90">{selectedLetter.file_name}</p>
                    <p>
                      {formatLetterDate(selectedLetter.created_at)}
                      {savedManualLetterCount > 0
                        ? ` · ${savedManualLetterCount} saved comment${savedManualLetterCount !== 1 ? "s" : ""}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={onDeleteSavedLetter}
                    disabled={parsing || saving || !sourceDocumentId}
                    size="sm"
                    className={cn(commentReviewToolbarBtn.dangerOutline, "h-7 w-full text-[11px]")}
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete saved letter and comments
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div
            className={cn(
              "rounded-xl border border-dashed px-4 py-5 transition-colors dark:border-obsidian-raised/80 dark:bg-obsidian-sunken/20",
              dragActive
                ? "border-teal bg-teal/5 dark:bg-teal/10"
                : "border-border/60 bg-muted/10",
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex min-h-[100px] flex-col items-center justify-center text-center">
              {showSingleFilePreview ? (
                <>
                  {imagePreview ? (
                    <img
                      src={imagePreview}
                      alt="Letter preview"
                      className="mb-2 max-h-[140px] w-auto rounded border object-contain"
                    />
                  ) : originalUploadFile ? (
                    <div className="mb-2 space-y-1">
                      {isSpreadsheetFile(originalUploadFile) ? (
                        <FileSpreadsheet className="mx-auto h-8 w-8 text-teal/80" />
                      ) : (
                        <FileImage className="mx-auto h-8 w-8 text-teal/80" />
                      )}
                      <p className="max-w-[220px] truncate text-xs font-medium">
                        {originalUploadFile.name}
                      </p>
                    </div>
                  ) : selectedLetter ? (
                    <div className="mb-2 space-y-1">
                      {/\.(xlsx|csv)$/i.test(selectedLetter.file_name) ? (
                        <FileSpreadsheet className="mx-auto h-8 w-8 text-teal/80" />
                      ) : (
                        <FileImage className="mx-auto h-8 w-8 text-teal/80" />
                      )}
                      <p className="max-w-[220px] truncate text-xs font-medium">
                        {selectedLetter.file_name}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : pendingUploadFiles.length > 0 ? (
                <Upload className="mb-2 h-8 w-8 text-teal/70" />
              ) : (
                <Upload className="mb-2 h-8 w-8 text-teal/70" />
              )}
              <p className="text-[11px] text-muted-foreground">
                {dragActive
                  ? "Drop files here"
                  : "Choose or drag one or more files"}
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,.doc,application/msword,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,text/csv,.csv,application/csv"
                onChange={onFileChange}
                className="mt-2 max-w-[220px] text-xs"
              />
            </div>
          </div>

          {pendingUploadFiles.length > 0 ? (
            <ul className="space-y-1.5 rounded-lg border border-border/40 bg-muted/5 px-3 py-2 dark:bg-obsidian-sunken/20">
              <li className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Selected files ({pendingUploadFiles.length})
              </li>
              {pendingUploadFiles.map((item) => {
                const rowProcessing =
                  isPendingFileRowProcessing(item, parsing) ||
                  (isFileUploadInFlight?.(item.id) ?? false);
                const rowRemoving = pendingRemovalFileId === item.id;
                const canRemove = !rowProcessing && !rowRemoving;

                return (
                <li
                  key={item.id}
                  className="flex items-start gap-2 rounded-md border border-border/30 bg-background/50 px-2 py-1.5 text-xs dark:bg-obsidian/40"
                >
                  <PendingFileStatusIcon status={item.status} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate font-medium" title={item.file.name}>
                      {item.file.name}
                    </p>
                    <p
                      className={cn(
                        "text-[11px]",
                        item.status === "failed"
                          ? "text-destructive"
                          : item.status === "success"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-muted-foreground",
                      )}
                    >
                      {pendingFileStatusDisplay(item)}
                      {item.parseMethod && item.status === "success" ? (
                        <span className="text-muted-foreground/70"> · {item.parseMethod}</span>
                      ) : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Remove ${item.file.name} from batch`}
                    disabled={!canRemove}
                    onClick={() => onRequestRemovePendingBatchFile(item.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </li>
                );
              })}
            </ul>
          ) : null}

          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {supportedFormatsHint}
          </p>

          {fileSelectionError ? (
            <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
              {fileSelectionError}
            </p>
          ) : null}

          {parseStatus ? (
            <p className="text-xs text-muted-foreground">
              {parseStatus}
              {lastParseMethod ? (
                <span className="text-muted-foreground/70"> · {lastParseMethod}</span>
              ) : null}
            </p>
          ) : null}

          {parserSummary && parserSummary.total > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Last parse: {parserSummary.total} comment{parserSummary.total !== 1 ? "s" : ""}
            </p>
          ) : savedManualLetterCount > 0 && uploadRowsCount === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {savedManualLetterCount} comment{savedManualLetterCount !== 1 ? "s" : ""} saved for
              this letter. Re-parse to refresh the review list.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Button
              variant="gold"
              onClick={onParseDocument}
              disabled={parsing || saving || !canParseLetter}
              size="sm"
              className={commentReviewToolbarBtn.primary}
            >
              {parsing ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              {parsing ? "Parsing…" : parseButtonLabel}
            </Button>
            {(originalUploadFile || sourceDocumentId) && savedManualLetterCount > 0 ? (
              <Button
                variant="ghost"
                onClick={onClearSaved}
                disabled={parsing || saving || !sourceDocumentId}
                size="sm"
                className={commentReviewToolbarBtn.ghost}
              >
                Clear saved comments
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste reviewer comments here…"
            rows={10}
            className="min-h-[200px] resize-y rounded-xl border-border/60 bg-background/50 text-sm leading-relaxed dark:bg-obsidian-sunken/30"
          />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="inline-paste-discipline" className="text-[11px] text-muted-foreground">
                Default discipline
              </Label>
              <Select value={pasteDiscipline} onValueChange={setPasteDiscipline}>
                <SelectTrigger id="inline-paste-discipline" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {disciplineSelectOptions.map((d) => (
                    <SelectItem key={d} value={d} className="text-xs">
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="inline-paste-source" className="text-[11px] text-muted-foreground">
                Source label
              </Label>
              <Input
                id="inline-paste-source"
                value={pasteSourceLabel}
                onChange={(e) => setPasteSourceLabel(e.target.value)}
                placeholder={PASTED_COMMENTS_SOURCE_LABEL}
                className="h-8 text-xs"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Button
              variant="gold"
              size="sm"
              disabled={!hasPastedText || parsing}
              className={commentReviewToolbarBtn.primary}
              onClick={() =>
                void onParsePasted({
                  text: pastedText.trim(),
                  sourceLabel: resolvedPasteSourceLabel,
                  discipline: pasteDiscipline,
                }).then(() => setPastedText(""))
              }
            >
              {parsing ? <Loader2 className="animate-spin" /> : null}
              Parse pasted comments
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPastedText || parsing}
              className={commentReviewToolbarBtn.secondary}
              onClick={() => {
                onAddPastedSingle({
                  text: pastedText.trim(),
                  sourceLabel: resolvedPasteSourceLabel,
                  discipline: pasteDiscipline,
                });
                setPastedText("");
              }}
            >
              Add as single comment
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
