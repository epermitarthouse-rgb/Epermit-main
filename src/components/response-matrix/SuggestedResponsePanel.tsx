import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  effectiveResponseStatus,
  nextStatusAfterDraftSave,
  responseStatusBadgeClass,
  type ResponseApprovalFields,
  type ResponseApprovalStatus,
} from "@/lib/responseApproval";
import { Loader2, CheckCircle2, RotateCcw, MessageSquareWarning } from "lucide-react";
import type { ResponseApprovalRow } from "@/lib/responseApproval";

interface SuggestedResponsePanelProps {
  row: ResponseApprovalRow;
  isAutoDrafting: boolean;
  userId: string | undefined;
  canApprove: boolean;
  approverName?: string | null;
  editorName?: string | null;
  onRowUpdated: (id: string, patch: Partial<ResponseApprovalRow>) => void;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "";
  try {
    return format(new Date(value), "MMM d, yyyy h:mm a");
  } catch {
    return value;
  }
}

async function fetchProfileName(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("full_name, company_name")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.full_name?.trim() || data?.company_name?.trim() || null;
}

export function SuggestedResponsePanel({
  row,
  isAutoDrafting,
  userId,
  canApprove,
  approverName,
  editorName,
  onRowUpdated,
}: SuggestedResponsePanelProps) {
  const status = effectiveResponseStatus(row);
  const hasResponse = Boolean(row.response_text?.trim());
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(row.response_text ?? "");
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [changeRequestOpen, setChangeRequestOpen] = useState(false);
  const [changeRequestNote, setChangeRequestNote] = useState("");
  const [requestingChanges, setRequestingChanges] = useState(false);
  const [resolvedApproverName, setResolvedApproverName] = useState(approverName ?? null);
  const [resolvedEditorName, setResolvedEditorName] = useState(editorName ?? null);

  useEffect(() => {
    setDraftText(row.response_text ?? "");
    if (!editing) {
      setDraftText(row.response_text ?? "");
    }
  }, [row.response_text, row.id, editing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (approverName) {
        setResolvedApproverName(approverName);
        return;
      }
      const name = await fetchProfileName(row.approved_by);
      if (!cancelled) setResolvedApproverName(name);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.approved_by, approverName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (editorName) {
        setResolvedEditorName(editorName);
        return;
      }
      const name = await fetchProfileName(row.last_edited_by);
      if (!cancelled) setResolvedEditorName(name);
    })();
    return () => {
      cancelled = true;
    };
  }, [row.last_edited_by, editorName]);

  const applyRowPatch = useCallback(
    (patch: Partial<ResponseApprovalRow>) => {
      onRowUpdated(row.id, patch);
    },
    [onRowUpdated, row.id],
  );

  const saveDraft = useCallback(async () => {
    if (!userId) {
      toast.error("Sign in to save changes");
      return;
    }
    const trimmed = draftText.trim();
    if (!trimmed) {
      toast.error("Response cannot be empty. Enter text before saving.");
      return;
    }

    setSaving(true);
    try {
      const nextStatus = nextStatusAfterDraftSave(row, trimmed);
      const payload = {
        response_text: draftText,
        response_status: nextStatus,
      };

      let query = supabase.from("parsed_comments").update(payload).eq("id", row.id);
      if (row.last_edited_at) {
        query = query.eq("last_edited_at", row.last_edited_at);
      } else {
        query = query.is("last_edited_at", null);
      }

      const { data, error } = await query
        .select(
          "response_text, response_status, approved_at, approved_by, last_edited_at, last_edited_by, change_request_note, ai_generated_response_text",
        )
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        const { data: fresh, error: freshError } = await supabase
          .from("parsed_comments")
          .select(
            "response_text, response_status, approved_at, approved_by, last_edited_at, last_edited_by, change_request_note, ai_generated_response_text",
          )
          .eq("id", row.id)
          .maybeSingle();
        if (!freshError && fresh) {
          applyRowPatch(fresh as Partial<ResponseApprovalRow>);
        }
        toast.error("This response was updated elsewhere. Loaded the latest version.");
        setEditing(false);
        return;
      }

      applyRowPatch(data as Partial<ResponseApprovalRow>);
      setEditing(false);
      toast.success("Draft saved");
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to save draft");
    } finally {
      setSaving(false);
    }
  }, [applyRowPatch, draftText, row, userId]);

  const cancelEdit = useCallback(() => {
    setDraftText(row.response_text ?? "");
    setEditing(false);
  }, [row.response_text]);

  const approveResponse = useCallback(async () => {
    if (!userId) {
      toast.error("Sign in to approve responses");
      return;
    }
    if (!canApprove) {
      toast.error("Only project owners and admins can approve responses");
      return;
    }

    const textToApprove = editing ? draftText : row.response_text ?? "";
    if (!textToApprove.trim()) {
      toast.error("Cannot approve a blank response");
      return;
    }

    setApproving(true);
    try {
      if (editing) {
        const nextStatus = nextStatusAfterDraftSave(row, textToApprove);
        const savePayload = {
          response_text: textToApprove,
          response_status: nextStatus,
        };
        let saveQuery = supabase.from("parsed_comments").update(savePayload).eq("id", row.id);
        if (row.last_edited_at) {
          saveQuery = saveQuery.eq("last_edited_at", row.last_edited_at);
        } else {
          saveQuery = saveQuery.is("last_edited_at", null);
        }
        const { data: saved, error: saveError } = await saveQuery
          .select("last_edited_at")
          .maybeSingle();
        if (saveError) throw saveError;
        if (!saved) {
          toast.error("This response was updated elsewhere. Refresh and try again.");
          return;
        }
        setEditing(false);
      }

      const { data, error } = await supabase
        .from("parsed_comments")
        .update({
          response_text: textToApprove,
          response_status: "Approved" satisfies ResponseApprovalStatus,
          change_request_note: null,
        })
        .eq("id", row.id)
        .select(
          "response_text, response_status, approved_at, approved_by, last_edited_at, last_edited_by, change_request_note",
        )
        .single();

      if (error) throw error;
      applyRowPatch(data as Partial<ResponseApprovalRow>);
      toast.success("Response approved");
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApproving(false);
    }
  }, [applyRowPatch, canApprove, draftText, editing, row, userId]);

  const submitChangeRequest = useCallback(async () => {
    if (!userId) {
      toast.error("Sign in to request changes");
      return;
    }
    if (!canApprove) {
      toast.error("Only project owners and admins can request changes");
      return;
    }
    if (!hasResponse) {
      toast.error("No response to review yet");
      return;
    }

    setRequestingChanges(true);
    try {
      const note = changeRequestNote.trim() || null;
      const { data, error } = await supabase
        .from("parsed_comments")
        .update({
          response_status: "Changes Requested",
          change_request_note: note,
        })
        .eq("id", row.id)
        .select(
          "response_status, change_request_note, approved_at, approved_by",
        )
        .single();

      if (error) throw error;
      applyRowPatch(data as Partial<ResponseApprovalRow>);
      setChangeRequestOpen(false);
      setChangeRequestNote("");
      toast.success("Changes requested");
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to save change request");
    } finally {
      setRequestingChanges(false);
    }
  }, [applyRowPatch, canApprove, changeRequestNote, hasResponse, row.id, userId]);

  const reopenResponse = useCallback(async () => {
    if (!userId) {
      toast.error("Sign in to reopen responses");
      return;
    }
    if (!canApprove) {
      toast.error("Only project owners and admins can reopen approved responses");
      return;
    }

    setReopening(true);
    try {
      const { data, error } = await supabase
        .from("parsed_comments")
        .update({
          response_status: "Draft",
          change_request_note: null,
        })
        .eq("id", row.id)
        .select(
          "response_status, approved_at, approved_by, change_request_note",
        )
        .single();

      if (error) throw error;
      applyRowPatch(data as Partial<ResponseApprovalRow>);
      toast.success("Response reopened for editing");
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to reopen response");
    } finally {
      setReopening(false);
    }
  }, [applyRowPatch, canApprove, row.id, userId]);

  const showApprovalControls = hasResponse && !isAutoDrafting;
  const statusLabel = status ?? (isAutoDrafting ? "Generating…" : "No response");

  return (
    <section
      className={cn(
        "rounded-lg border p-4 space-y-3",
        "border-teal/35 bg-teal/5 dark:bg-teal/10",
      )}
      data-testid={`suggested-response-panel-${row.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-mono uppercase tracking-[0.14em] text-ink-secondary-light dark:text-ink-secondary-dark">
            Suggested response
          </h4>
          {status && (
            <Badge
              variant="outline"
              className={cn("text-[10px] font-medium", responseStatusBadgeClass(status))}
              data-testid={`response-status-badge-${row.id}`}
            >
              {statusLabel}
            </Badge>
          )}
          {!status && !isAutoDrafting && (
            <Badge variant="outline" className="text-[10px] text-ink-tertiary-light">
              No response
            </Badge>
          )}
        </div>
        {row.last_edited_at && (
          <span className="text-[10px] text-ink-tertiary-light">
            Last saved {formatTimestamp(row.last_edited_at)}
            {resolvedEditorName ? ` · ${resolvedEditorName}` : ""}
          </span>
        )}
      </div>

      {row.change_request_note?.trim() ? (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100"
          data-testid={`change-request-note-${row.id}`}
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-1">
            <MessageSquareWarning className="h-3.5 w-3.5" />
            Reviewer note
          </div>
          <p className="whitespace-pre-wrap break-words">{row.change_request_note}</p>
        </div>
      ) : null}

      {status === "Approved" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>
            Approved{resolvedApproverName ? ` by ${resolvedApproverName}` : ""}
            {row.approved_at ? ` · ${formatTimestamp(row.approved_at)}` : ""}
          </span>
        </div>
      )}

      {editing || !hasResponse ? (
        <Textarea
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          placeholder={isAutoDrafting ? "Drafting…" : "Official response…"}
          disabled={isAutoDrafting || saving}
          className="min-h-[120px] resize-y border-cream-sunken bg-cream text-ink-primary-light dark:bg-obsidian dark:text-ink-primary-dark whitespace-pre-wrap"
          data-testid={`response-textarea-${row.id}`}
        />
      ) : (
        <p className="text-sm text-ink-primary-light dark:text-ink-primary-dark whitespace-pre-wrap break-words leading-relaxed">
          {row.response_text}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {editing ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="gold"
              disabled={saving || isAutoDrafting}
              onClick={() => void saveDraft()}
              data-testid={`save-draft-${row.id}`}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Save Draft
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={cancelEdit}
              data-testid={`cancel-edit-${row.id}`}
            >
              Cancel
            </Button>
          </>
        ) : hasResponse ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            disabled={isAutoDrafting}
            onClick={() => {
              setDraftText(row.response_text ?? "");
              setEditing(true);
            }}
            data-testid={`edit-response-${row.id}`}
          >
            Edit response
          </Button>
        ) : null}

        <span className="text-xs text-ink-tertiary-light tabular-nums sm:ml-auto">
          {(editing ? draftText : row.response_text ?? "").length} chars
        </span>
      </div>

      {showApprovalControls && !editing && (
        <div className="flex flex-col gap-2 pt-1 border-t border-teal/20 sm:flex-row sm:flex-wrap">
          {status !== "Approved" ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="gold"
                disabled={!canApprove || approving || !hasResponse}
                onClick={() => void approveResponse()}
                data-testid={`approve-response-${row.id}`}
                title={!canApprove ? "Project owner or admin required" : undefined}
              >
                {approving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                Approve Response
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canApprove || requestingChanges}
                onClick={() => {
                  setChangeRequestNote(row.change_request_note ?? "");
                  setChangeRequestOpen(true);
                }}
                data-testid={`request-changes-${row.id}`}
              >
                Request Changes
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canApprove || reopening}
              onClick={() => void reopenResponse()}
              data-testid={`reopen-response-${row.id}`}
            >
              {reopening ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <RotateCcw className="h-4 w-4 mr-1.5" />
              )}
              Reopen
            </Button>
          )}
        </div>
      )}

      <Dialog open={changeRequestOpen} onOpenChange={setChangeRequestOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>
              Add an optional note for the editor. The current response text will be kept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`change-note-${row.id}`}>Note (optional)</Label>
            <Textarea
              id={`change-note-${row.id}`}
              value={changeRequestNote}
              onChange={(e) => setChangeRequestNote(e.target.value)}
              placeholder="Describe what should be revised…"
              className="min-h-[100px] resize-y"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setChangeRequestOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="gold"
              disabled={requestingChanges}
              onClick={() => void submitChangeRequest()}
            >
              {requestingChanges ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
