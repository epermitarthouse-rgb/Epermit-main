import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ClipboardCopy,
  ExternalLink,
  FileText,
  Link2,
  PlayCircle,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertBanner } from "@/components/design/ProductPrimitives";
import { cn } from "@/lib/utils";

import {
  COMMENT_TYPES,
  COMPLETION_CHECK_KEYS,
  COMPLETION_CHECK_LABELS,
  IMPLEMENTATION_STATUSES,
  VERIFICATION_STATUSES,
  type ArchitectureMatrixRow,
  type CommentType,
  type CompletionCheckKey,
  type CompletionState,
  type ReplicationComment,
  type ReplicationItemOverlay,
} from "@/types/architectureReplication";
import {
  buildImplementationBrief,
  firstOpenableRoute,
} from "@/lib/architectureReplication";
import {
  implementationBadgeVariant,
  verificationBadgeVariant,
} from "./statusStyles";

export type MergedRow = {
  row: ArchitectureMatrixRow;
  overlay: ReplicationItemOverlay;
  completion: CompletionState;
};

interface ArchitectureReplicationDetailSheetProps {
  merged: MergedRow | null;
  comments: ReplicationComment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persistenceEnabled: boolean;
  onUpsert: (
    rowId: string,
    patch: Partial<ReplicationItemOverlay>,
  ) => Promise<{ ok: boolean; message?: string }>;
  onAddComment: (
    rowId: string,
    commentType: CommentType,
    commentText: string,
  ) => Promise<{ ok: boolean; message?: string }>;
}

function FieldRow({ label, value }: { label: string; value?: string | null }) {
  const display = value && value.trim() ? value : "—";
  return (
    <div className="border-b border-border/50 py-2 last:border-0">
      <p className="pilot-kicker">{label}</p>
      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{display}</p>
    </div>
  );
}

function SectionHeading({
  index,
  title,
  description,
}: {
  index: number;
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-3 mt-8 flex items-baseline gap-2 first:mt-0">
      <span className="font-mono text-xs font-semibold text-muted-foreground">
        {String(index).padStart(2, "0")}
      </span>
      <div>
        <h3 className="font-tight text-sm font-bold uppercase tracking-wide text-foreground">
          {title}
        </h3>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

function buildMarkdownDetails(row: ArchitectureMatrixRow, overlay: ReplicationItemOverlay): string {
  return [
    `# ${row.rowId} — ${row.lovable.name}`,
    "",
    "## Lovable reference",
    `- Area: ${row.lovable.area}`,
    `- Route: ${row.lovable.route}`,
    `- Purpose: ${row.lovable.purpose}`,
    `- Functionality: ${row.lovable.functionality}`,
    `- Source file: ${row.lovable.sourceFile}`,
    "",
    "## PermitPilot match",
    `- Match status: ${row.permitPilot.matchStatus}`,
    `- Feature: ${row.permitPilot.featureName}`,
    `- Route: ${row.permitPilot.route}`,
    `- Source files: ${row.permitPilot.sourceFiles}`,
    "",
    "## Preservation",
    row.work.preserve || "—",
    "",
    "## Replication work",
    `- Required frontend: ${row.work.requiredFrontend}`,
    `- Required backend: ${row.work.requiredBackend}`,
    `- Route decision: ${row.decisions.routeDecision}`,
    "",
    "## Checklist status",
    `- Implementation: ${overlay.implementation_status}`,
    `- Verification: ${overlay.verification_status}`,
    `- Owner: ${overlay.assigned_owner || "—"}`,
    `- Blocked: ${overlay.is_blocked ? `Yes — ${overlay.blocker_description || "no description"}` : "No"}`,
  ].join("\n");
}

export function ArchitectureReplicationDetailSheet({
  merged,
  comments,
  open,
  onOpenChange,
  persistenceEnabled,
  onUpsert,
  onAddComment,
}: ArchitectureReplicationDetailSheetProps) {
  const [draft, setDraft] = useState<ReplicationItemOverlay | null>(null);
  const [saving, setSaving] = useState(false);
  const [commentType, setCommentType] = useState<CommentType>("General");
  const [commentText, setCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    setDraft(merged ? { ...merged.overlay } : null);
  }, [merged]);

  const dirty = useMemo(() => {
    if (!merged || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(merged.overlay);
  }, [draft, merged]);

  if (!merged || !draft) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" />
      </Sheet>
    );
  }

  const { row } = merged;

  const updateDraft = (patch: Partial<ReplicationItemOverlay>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateCheck = (key: CompletionCheckKey, value: boolean) => {
    updateDraft({
      completion_checks: { ...(draft.completion_checks || {}), [key]: value },
    });
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await onUpsert(row.rowId, draft);
    setSaving(false);
    if (res.ok) {
      toast.success(`${row.rowId} saved.`);
    } else {
      toast.error(res.message || "Failed to save checklist item.");
    }
  };

  const handleDiscard = () => setDraft({ ...merged.overlay });

  const handleStartWork = async () => {
    const res = await onUpsert(row.rowId, { implementation_status: "In progress" });
    if (res.ok) {
      toast.success(`${row.rowId} marked In progress.`);
    } else {
      toast.error(res.message || "Failed to update status.");
    }
  };

  const handleOpenRoute = () => {
    const path = firstOpenableRoute(row.permitPilot.route);
    if (!path) {
      toast.info("No openable PermitPilot route found for this row.");
      return;
    }
    window.open(path, "_blank", "noopener,noreferrer");
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label);
    } catch {
      toast.error("Copy failed — clipboard is unavailable.");
    }
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim()) {
      toast.error("Comment text is required.");
      return;
    }
    setSubmittingComment(true);
    const res = await onAddComment(row.rowId, commentType, commentText);
    setSubmittingComment(false);
    if (res.ok) {
      setCommentText("");
      toast.success("Comment added.");
    } else {
      toast.error(res.message || "Failed to add comment.");
    }
  };

  const sortedComments = [...comments].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-muted-foreground">
              {row.rowId}
            </span>
            <Badge variant={row.rowKind === "lovable" ? "outline" : "secondary"}>
              {row.rowKind === "lovable" ? "Lovable" : "PP-only"}
            </Badge>
            <Badge variant={implementationBadgeVariant(draft.implementation_status)}>
              {draft.implementation_status}
            </Badge>
            <Badge variant={verificationBadgeVariant(draft.verification_status)}>
              {draft.verification_status}
            </Badge>
          </div>
          <SheetTitle className="mt-1">{row.lovable.name}</SheetTitle>
          <SheetDescription>
            {row.permitPilot.featureName} · {row.permitPilot.matchStatus}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={handleStartWork} disabled={!persistenceEnabled}>
            <PlayCircle className="h-3.5 w-3.5" /> Start work
          </Button>
          <Button size="sm" variant="outline" onClick={handleOpenRoute}>
            <ExternalLink className="h-3.5 w-3.5" /> Open PP route
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(row.lovable.route, "Copied Lovable route.")}
          >
            <Link2 className="h-3.5 w-3.5" /> Copy Lovable route
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              copy(
                [row.lovable.sourceFile, row.permitPilot.sourceFiles].filter(Boolean).join("\n"),
                "Copied source files.",
              )
            }
          >
            <ClipboardCopy className="h-3.5 w-3.5" /> Copy source files
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              copy(buildImplementationBrief(row, draft), `Copied implementation brief for ${row.rowId}.`)
            }
          >
            <FileText className="h-3.5 w-3.5" /> Copy brief
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => copy(buildMarkdownDetails(row, draft), "Copied markdown details.")}
          >
            <FileText className="h-3.5 w-3.5" /> Copy markdown
          </Button>
        </div>

        {!persistenceEnabled && (
          <AlertBanner
            tone="warn"
            title="Editing disabled"
            detail="Persistence is unavailable until the architecture_replication migration is applied. All fields below are read-only; the architecture matrix remains the source of truth."
            className="mt-4"
          />
        )}

        <ScrollArea className="mt-2 h-[calc(100vh-15rem)] pr-3">
          <SectionHeading index={1} title="Lovable reference" description="Read-only, from the architecture matrix." />
          <div className="rounded-lg border border-border/60 px-3">
            <FieldRow label="Area" value={row.lovable.area} />
            <FieldRow label="Route" value={row.lovable.route} />
            <FieldRow label="Entry points" value={row.lovable.entryPoints} />
            <FieldRow label="Auth" value={row.lovable.auth} />
            <FieldRow label="Purpose" value={row.lovable.purpose} />
            <FieldRow label="Functionality" value={row.lovable.functionality} />
            <FieldRow label="Actions" value={row.lovable.actions} />
            <FieldRow label="Data source" value={row.lovable.dataSource} />
            <FieldRow label="Backend" value={row.lovable.backend} />
            <FieldRow label="Source file" value={row.lovable.sourceFile} />
            <FieldRow label="Notes" value={row.lovable.notes} />
          </div>

          <SectionHeading index={2} title="PermitPilot match" description="Current PermitPilot behavior." />
          <div className="rounded-lg border border-border/60 px-3">
            <FieldRow label="Match status" value={row.permitPilot.matchStatus} />
            <FieldRow label="Feature name" value={row.permitPilot.featureName} />
            <FieldRow label="Route" value={row.permitPilot.route} />
            <FieldRow label="Source files" value={row.permitPilot.sourceFiles} />
            <FieldRow label="Nav entry" value={row.permitPilot.navEntry} />
            <FieldRow label="Auth" value={row.permitPilot.auth} />
            <FieldRow label="Backend endpoint" value={row.permitPilot.backendEndpoint} />
            <FieldRow label="Functional status" value={row.permitPilot.functionalStatus} />
            <FieldRow label="UI parity" value={row.permitPilot.uiParity} />
            <FieldRow label="Functional parity" value={row.permitPilot.functionalParity} />
          </div>

          <SectionHeading index={3} title="Preservation" description="What must not change during replication." />
          <div className="rounded-lg border border-border/60 px-3">
            <FieldRow label="Preserve" value={row.work.preserve} />
            <FieldRow label="Lovable-only" value={row.work.lovableOnly} />
            <FieldRow label="Do not replicate" value={row.work.doNotReplicate} />
            <FieldRow label="Fake-backend risk" value={row.work.fakeBackendRisk} />
          </div>

          <SectionHeading index={4} title="Replication work" description="Required work and routing decisions." />
          <div className="rounded-lg border border-border/60 px-3">
            <FieldRow label="Required frontend work" value={row.work.requiredFrontend} />
            <FieldRow label="Required backend work" value={row.work.requiredBackend} />
            <FieldRow label="Dependencies" value={row.work.dependencies} />
            <FieldRow label="Route decision" value={row.decisions.routeDecision} />
            <FieldRow label="Target route" value={row.decisions.targetRoute} />
            <FieldRow label="Nav placement" value={row.decisions.navPlacement} />
            <FieldRow label="Phase" value={row.work.phase} />
            <FieldRow label="Effort" value={row.work.effort} />
            <FieldRow label="Acceptance criteria" value={row.work.acceptanceCriteria} />
            <FieldRow label="Verification hook" value={row.work.verificationHook} />
            <FieldRow label="Audit notes" value={row.work.auditNotes} />
          </div>

          <SectionHeading
            index={5}
            title="Working checklist"
            description={persistenceEnabled ? "Editable — saved to the checklist overlay." : "Read-only until persistence is enabled."}
          />
          <div className="space-y-4 rounded-lg border border-border/60 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Implementation status</Label>
                <Select
                  value={draft.implementation_status}
                  onValueChange={(v) => updateDraft({ implementation_status: v as ReplicationItemOverlay["implementation_status"] })}
                  disabled={!persistenceEnabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {IMPLEMENTATION_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Verification status</Label>
                <Select
                  value={draft.verification_status}
                  onValueChange={(v) => updateDraft({ verification_status: v as ReplicationItemOverlay["verification_status"] })}
                  disabled={!persistenceEnabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VERIFICATION_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Assigned owner</Label>
                <Input
                  value={draft.assigned_owner || ""}
                  onChange={(e) => updateDraft({ assigned_owner: e.target.value || null })}
                  placeholder="Name or email"
                  disabled={!persistenceEnabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Implementation commit</Label>
                <Input
                  value={draft.implementation_commit || ""}
                  onChange={(e) => updateDraft({ implementation_commit: e.target.value || null })}
                  placeholder="Commit SHA or PR link"
                  disabled={!persistenceEnabled}
                />
              </div>
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id={`${row.rowId}-blocked`}
                checked={draft.is_blocked}
                onCheckedChange={(checked) => updateDraft({ is_blocked: checked === true })}
                disabled={!persistenceEnabled}
              />
              <Label htmlFor={`${row.rowId}-blocked`} className="cursor-pointer">
                Blocked
              </Label>
            </div>
            {draft.is_blocked && (
              <div className="space-y-1.5">
                <Label>Blocker description</Label>
                <Textarea
                  value={draft.blocker_description || ""}
                  onChange={(e) => updateDraft({ blocker_description: e.target.value || null })}
                  disabled={!persistenceEnabled}
                />
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Preview URL</Label>
                <Input
                  value={draft.preview_url || ""}
                  onChange={(e) => updateDraft({ preview_url: e.target.value || null })}
                  placeholder="https://…"
                  disabled={!persistenceEnabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Last tested at</Label>
                <Input
                  value={draft.last_tested_at || ""}
                  onChange={(e) => updateDraft({ last_tested_at: e.target.value || null })}
                  placeholder="YYYY-MM-DD"
                  disabled={!persistenceEnabled}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Test evidence</Label>
              <Textarea
                value={draft.test_evidence || ""}
                onChange={(e) => updateDraft({ test_evidence: e.target.value || null })}
                placeholder="Links to screenshots, recordings, or test runs"
                disabled={!persistenceEnabled}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Client approved at</Label>
                <Input
                  value={draft.client_approved_at || ""}
                  onChange={(e) => updateDraft({ client_approved_at: e.target.value || null })}
                  placeholder="YYYY-MM-DD"
                  disabled={!persistenceEnabled}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Client feedback</Label>
              <Textarea
                value={draft.client_feedback || ""}
                onChange={(e) => updateDraft({ client_feedback: e.target.value || null })}
                disabled={!persistenceEnabled}
              />
            </div>
          </div>

          <SectionHeading index={6} title="Completion checklist" description="All required items must be checked for the row to be Complete." />
          <div className="grid gap-2 rounded-lg border border-border/60 p-3 sm:grid-cols-2">
            {COMPLETION_CHECK_KEYS.map((key) => (
              <div key={key} className="flex items-start gap-2">
                <Checkbox
                  id={`${row.rowId}-${key}`}
                  checked={draft.completion_checks?.[key] === true}
                  onCheckedChange={(checked) => updateCheck(key, checked === true)}
                  disabled={!persistenceEnabled}
                />
                <Label htmlFor={`${row.rowId}-${key}`} className="cursor-pointer text-xs leading-snug">
                  {COMPLETION_CHECK_LABELS[key]}
                </Label>
              </div>
            ))}
          </div>

          <SectionHeading index={7} title="Comments" description="Append-only activity log for this row." />
          <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={commentType}
                onValueChange={(v) => setCommentType(v as CommentType)}
                disabled={!persistenceEnabled}
              >
                <SelectTrigger className="sm:w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Add a comment…"
                disabled={!persistenceEnabled}
                className="flex-1"
              />
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSubmitComment}
                disabled={!persistenceEnabled || submittingComment}
              >
                Add comment
              </Button>
            </div>

            <div className="space-y-2 pt-2">
              {sortedComments.length === 0 && (
                <p className="text-xs text-muted-foreground">No comments yet.</p>
              )}
              {sortedComments.map((c) => (
                <div key={c.id} className="rounded-md border border-border/50 bg-muted/30 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline">{c.comment_type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-foreground/90">{c.comment_text}</p>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>

        <div
          className={cn(
            "mt-4 flex items-center justify-end gap-2 border-t border-border/60 pt-3",
            !dirty && "opacity-60",
          )}
        >
          {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <Button size="sm" variant="outline" onClick={handleDiscard} disabled={!dirty || saving}>
            Discard
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!persistenceEnabled || !dirty || saving}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
