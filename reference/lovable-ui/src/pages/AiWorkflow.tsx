import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Activity, AlertCircle, Bot, CheckCircle2, Cpu, GitBranch, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { z } from "zod";

const lanes = [
  { title: "Detection", icon: Activity, items: ["Portal harvest cycle", "DesignCheck OCR", "Calendar diff vs jurisdiction"] },
  { title: "Reasoning", icon: Cpu, items: ["Conflict classification", "Comment reconciliation", "Critical path recompute"] },
  { title: "Action", icon: Zap, items: ["Notify stakeholder", "Stage submittal", "Open ticket in CRM"] },
];

const runs = [
  { agent: "Utility Response Monitor", duration: "1.2s", at: "10:42:11", status: "ok", message: "Status change Approved on Ticket #88291" },
  { agent: "Comment Reconciler", duration: "4.8s", at: "10:41:02", status: "ok", message: "Linked 3 DOB comments to civil C-402" },
  { agent: "Deadline Enforcement", duration: "0.9s", at: "10:35:00", status: "warn", message: "3 permits expire within 7 days" },
  { agent: "Portal Monitor", duration: "12.4s", at: "10:28:00", status: "ok", message: "42 portals scanned · 0 new updates" },
];

const toneClass = { ok: "text-success", warn: "text-warning", err: "text-destructive" } as const;

type LaneKey = "Detection" | "Reasoning" | "Action";
type CustomWorkflow = { id: string; name: string; lane: LaneKey; description: string; createdAt: string };

const NAME_MAX = 60;
const DESC_MAX = 280;
const STORAGE_KEY = "commun-et:ai-workflows:custom";

const loadStoredWorkflows = (): CustomWorkflow[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const validLanes: LaneKey[] = ["Detection", "Reasoning", "Action"];
    return parsed.filter(
      (w): w is CustomWorkflow =>
        w &&
        typeof w.id === "string" &&
        typeof w.name === "string" &&
        typeof w.description === "string" &&
        typeof w.createdAt === "string" &&
        validLanes.includes(w.lane),
    );
  } catch {
    return [];
  }
};

const workflowSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(NAME_MAX, `Name must be ${NAME_MAX} characters or fewer`),
  description: z
    .string()
    .trim()
    .max(DESC_MAX, `Description must be ${DESC_MAX} characters or fewer`)
    .optional()
    .or(z.literal("")),
});

type FieldErrors = { name?: string; description?: string };

const AiWorkflow = () => {
  const [open, setOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [name, setName] = useState("");
  const [lane, setLane] = useState<LaneKey>("Detection");
  const [description, setDescription] = useState("");
  const [custom, setCustom] = useState<CustomWorkflow[]>([]);
  useEffect(() => {
    setCustom(loadStoredWorkflows());
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
    } catch {
      // ignore quota / access errors
    }
  }, [custom]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (values: { name: string; description: string }): FieldErrors => {
    const result = workflowSchema.safeParse(values);
    if (result.success) return {};
    const next: FieldErrors = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof FieldErrors;
      if (key && !next[key]) next[key] = issue.message;
    }
    return next;
  };

  const runValidation = (partial?: Partial<{ name: string; description: string }>) => {
    const values = {
      name: partial?.name ?? name,
      description: partial?.description ?? description,
    };
    const next = validate(values);
    setErrors(next);
    return next;
  };

  const reset = () => {
    setName("");
    setLane("Detection");
    setDescription("");
    setErrors({});
    setSubmitAttempted(false);
    setSubmitError(null);
    setSubmitting(false);
  };

  const handleCreate = async () => {
    setSubmitAttempted(true);
    setSubmitError(null);
    const fieldErrors = runValidation();
    if (Object.keys(fieldErrors).length > 0) {
      const msg = "Please fix the highlighted fields before saving.";
      setSubmitError(msg);
      toast.error("Workflow not created", { description: msg });
      return;
    }
    setSubmitting(true);
    try {
      const trimmed = name.trim();
      const validLanes: LaneKey[] = ["Detection", "Reasoning", "Action"];
      if (!validLanes.includes(lane)) {
        throw new Error(
          `"${lane}" is not a valid lane. Choose Detection, Reasoning, or Action.`,
        );
      }
      if (custom.some((w) => w.name.toLowerCase() === trimmed.toLowerCase() && w.lane === lane)) {
        throw new Error(`A workflow named "${trimmed}" already exists in the ${lane} lane.`);
      }
      const wf: CustomWorkflow = {
        id: crypto.randomUUID(),
        name: trimmed,
        lane,
        description: description.trim(),
        createdAt: new Date().toLocaleString(),
      };
      setCustom((prev) => [wf, ...prev]);
      toast.success(`Workflow "${trimmed}" created`, {
        description: `Assigned to the ${lane} lane.`,
      });
      reset();
      setOpen(false);
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Something went wrong creating this workflow. Please try again.";
      setSubmitError(message);
      toast.error("Workflow creation failed", { description: message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
  <div className="space-y-6">
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">AI Workflow Engine</div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Agent Orchestration</h1>
        <p className="mt-1 text-sm text-muted-foreground">7 agents online · 312 actions in last 24h</p>
      </div>
      <button type="button" onClick={() => setOpen(true)} className="pilot-button-primary">
        <Sparkles className="h-4 w-4" /> New Workflow
      </button>
    </header>

    <div className="grid gap-4 md:grid-cols-3">
      {lanes.map((lane) => (
        <section key={lane.title} className="pilot-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <lane.icon className="h-5 w-5 text-primary" />
            <h2 className="font-tight text-lg font-bold">{lane.title}</h2>
          </div>
          <ul className="space-y-2">
            {lane.items.map((it) => (
              <li key={it} className="flex items-center gap-2 rounded border border-border bg-muted/30 px-3 py-2 text-sm">
                <GitBranch className="h-3.5 w-3.5 text-pilot-teal" />
                {it}
              </li>
            ))}
            {custom.filter((w) => w.lane === lane.title).map((w) => (
              <li key={w.id} className="flex items-center gap-2 rounded border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="flex-1">
                  <span className="font-medium">{w.name}</span>
                  {w.description && (
                    <span className="ml-2 text-xs text-muted-foreground">{w.description}</span>
                  )}
                </span>
                <span className="pilot-kicker text-[10px] text-primary">New</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>

    <section className="pilot-card overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
        <h3 className="font-tight text-base font-bold">Recent Runs</h3>
        <span className="pilot-kicker text-muted-foreground">Live</span>
      </header>
      <ul className="divide-y divide-border">
        {runs.map((r) => (
          <li key={r.at} className="flex items-center gap-4 px-5 py-3 text-sm">
            <Bot className="h-4 w-4 text-primary" />
            <span className="w-56 font-medium">{r.agent}</span>
            <span className={cn("inline-flex items-center gap-1", toneClass[r.status as keyof typeof toneClass])}>
              <CheckCircle2 className="h-3.5 w-3.5" /> {r.duration}
            </span>
            <span className="flex-1 text-muted-foreground">{r.message}</span>
            <span className="font-data text-xs text-muted-foreground">{r.at}</span>
          </li>
        ))}
      </ul>
    </section>

    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Workflow</DialogTitle>
          <DialogDescription>
            Configure a new agent workflow and assign it to a lane.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="wf-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <span
                className={cn(
                  "font-data text-[11px] tabular-nums",
                  name.trim().length > NAME_MAX
                    ? "text-destructive"
                    : name.trim().length > NAME_MAX * 0.9
                    ? "text-warning"
                    : "text-muted-foreground",
                )}
              >
                {name.trim().length}/{NAME_MAX}
              </span>
            </div>
            <Input
              id="wf-name"
              placeholder="e.g. Fairfax Portal Watcher"
              value={name}
              maxLength={NAME_MAX + 20}
              onChange={(e) => {
                setName(e.target.value);
                if (submitAttempted) runValidation({ name: e.target.value });
              }}
              onBlur={() => runValidation()}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "wf-name-error" : undefined}
              className={cn(errors.name && "border-destructive focus-visible:ring-destructive")}
              autoFocus
            />
            {errors.name && (
              <p
                id="wf-name-error"
                role="alert"
                className="flex items-start gap-1.5 text-xs text-destructive"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {errors.name}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="wf-lane">Lane</Label>
            <Select value={lane} onValueChange={(v) => setLane(v as LaneKey)}>
              <SelectTrigger id="wf-lane">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Detection">Detection</SelectItem>
                <SelectItem value="Reasoning">Reasoning</SelectItem>
                <SelectItem value="Action">Action</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="wf-desc">Description (optional)</Label>
              <span
                className={cn(
                  "font-data text-[11px] tabular-nums",
                  description.trim().length > DESC_MAX
                    ? "text-destructive"
                    : description.trim().length > DESC_MAX * 0.9
                    ? "text-warning"
                    : "text-muted-foreground",
                )}
              >
                {description.trim().length}/{DESC_MAX}
              </span>
            </div>
            <Textarea
              id="wf-desc"
              placeholder="What should this workflow do?"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (submitAttempted) runValidation({ description: e.target.value });
              }}
              onBlur={() => runValidation()}
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? "wf-desc-error" : undefined}
              className={cn(
                "resize-none",
                errors.description && "border-destructive focus-visible:ring-destructive",
              )}
              rows={3}
            />
            {errors.description && (
              <p
                id="wf-desc-error"
                role="alert"
                className="flex items-start gap-1.5 text-xs text-destructive"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {errors.description}
              </p>
             )}
           </div>
           {submitError && (
             <div
               role="alert"
               aria-live="assertive"
               className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
             >
               <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
               <div className="space-y-0.5">
                 <div className="font-semibold">Couldn't create workflow</div>
                 <div className="text-destructive/90">{submitError}</div>
               </div>
             </div>
           )}
         </div>
         <DialogFooter>
           <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
             Cancel
           </Button>
           <Button
             onClick={handleCreate}
             disabled={submitting || (submitAttempted && Object.keys(errors).length > 0)}
           >
             {submitting ? "Creating…" : "Create Workflow"}
           </Button>
         </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
  );
};

export default AiWorkflow;