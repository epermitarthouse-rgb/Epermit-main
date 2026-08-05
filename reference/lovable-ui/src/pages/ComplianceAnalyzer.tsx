import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  AlertCircle,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronsUpDown,
  Download,
  FileSearch,
  FileText,
  Layers,
  Loader2,
  MapPin,
  Bookmark,
  BookmarkPlus,
  Trash2,
  Play,
  Pencil,
  Copy,
  StickyNote,
  Upload as UploadIcon,
  Shield,
  Sparkles,
  Table as TableIcon,
  Upload,
  X,
  Wind,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useActiveProject } from "@/state/activeProject";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { exportFindingsCsv, exportFindingsPdf } from "@/lib/exportFindings";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  codeYears,
  defaultCodeYearFor,
  isHvhz,
  jurisdictionGroups,
  projectTypeGroups,
  type Group,
} from "@/components/permitpilot/compliance-taxonomy";

const STORAGE_KEY = "commun-et:compliance-analyzer";
const PRESETS_KEY = "commun-et:compliance-analyzer:presets";
const NOTES_MAX = 500;

type Preset = {
  id: string;
  name: string;
  projectId: string;
  jurisdiction: string;
  projectType: string;
  codeYear: string;
  notes?: string;
  savedAt: string;
};

const loadPresets = (): Preset[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === "string" && typeof p.name === "string") : [];
  } catch {
    return [];
  }
};

type GroupedComboProps = {
  value: string;
  onChange: (next: string) => void;
  groups: Group[];
  placeholder: string;
  searchPlaceholder: string;
};

const GroupedCombo = ({ value, onChange, groups, placeholder, searchPlaceholder }: GroupedComboProps) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-left text-sm text-foreground transition-colors hover:border-primary/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 flex-none text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[260px] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>No matches.</CommandEmpty>
            {groups.map((g) => (
              <CommandGroup key={g.region} heading={g.region}>
                {g.items.map((item) => (
                  <CommandItem
                    key={item}
                    value={item}
                    onSelect={() => {
                      onChange(item);
                      setOpen(false);
                    }}
                    className="data-[selected=true]:bg-primary/15 data-[selected=true]:text-primary"
                  >
                    {item}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

type Finding = { id: string; severity: "critical" | "warn" | "info"; code: string; title: string; page: string; suggestion: string };

const SEED_FINDINGS: Finding[] = [
  { id: "F-001", severity: "critical", code: "IBC 1006.3.1", title: "Exit width insufficient at corridor C1.", page: "A-301", suggestion: "Widen to 44\" min or split corridor into two egress paths." },
  { id: "F-002", severity: "critical", code: "ADA 404.2.3", title: "Door clearance < 32\" at vestibule.", page: "A-104", suggestion: "Replace 30\" leaf with 36\" leaf or relocate strike." },
  { id: "F-003", severity: "warn", code: "IECC C402.1.4", title: "Roof R-value 30 < prescriptive 38 (CZ4A).", page: "A-501", suggestion: "Spec R-38 polyiso or add tapered insulation layer." },
  { id: "F-004", severity: "warn", code: "IPC 410.2", title: "Fixture count short by 2 (occupant load 312).", page: "P-101", suggestion: "Add 1 WC + 1 lav in unisex set per Table 422.1." },
  { id: "F-005", severity: "info", code: "NFPA 13 6.2", title: "Sprinkler density assumption noted; confirm with FEMS.", page: "FP-201", suggestion: "Attach hydraulic calc; tag as informational." },
];

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
const MAX_FILES = 6;
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB per file — keeps request under gateway limits

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("Read error"));
    r.readAsDataURL(file);
  });

const sevMeta = {
  critical: { label: "Critical", tone: "border-destructive text-destructive bg-destructive/10", Icon: AlertTriangle },
  warn: { label: "Warning", tone: "border-warning text-warning bg-warning/10", Icon: AlertTriangle },
  info: { label: "Info", tone: "border-primary text-primary bg-primary/10", Icon: BookOpen },
} as const;

const ComplianceAnalyzer = () => {
  const [params, setParams] = useSearchParams();
  const enhanced = params.get("view") === "enhanced";
  const { active, projects } = useActiveProject();

  const persisted = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as { jurisdiction?: string; projectType?: string; codeYear?: string; projectId?: string }) : null;
    } catch {
      return null;
    }
  }, []);

  const [projectId, setProjectId] = useState<string>(persisted?.projectId ?? "");
  const [jurisdiction, setJurisdiction] = useState<string>(persisted?.jurisdiction ?? "General IBC (International Building Code)");
  const [projectType, setProjectType] = useState<string>(persisted?.projectType ?? "Commercial (General)");
  const [codeYear, setCodeYear] = useState<string>(persisted?.codeYear ?? defaultCodeYearFor("General IBC (International Building Code)"));

  // Update default code year when jurisdiction changes (unless user has manually overridden).
  const [yearTouched, setYearTouched] = useState(false);
  useEffect(() => {
    if (!yearTouched) setCodeYear(defaultCodeYearFor(jurisdiction));
  }, [jurisdiction, yearTouched]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ projectId, jurisdiction, projectType, codeYear }),
      );
    } catch {
      /* ignore */
    }
  }, [projectId, jurisdiction, projectType, codeYear]);

  const hvhz = isHvhz(jurisdiction);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const presetImportRef = useRef<HTMLInputElement | null>(null);
  const [queued, setQueued] = useState<File[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [findings, setFindings] = useState<Finding[]>(SEED_FINDINGS);
  const [pagesReviewed, setPagesReviewed] = useState<number>(42);
  const [summary, setSummary] = useState<string>("");
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [presetQuery, setPresetQuery] = useState("");
  const [notesEditor, setNotesEditor] = useState<
    | { mode: "edit"; preset: Preset; value: string }
    | { mode: "create"; draft: Omit<Preset, "notes">; value: string }
    | null
  >(null);
  const filteredPresets = useMemo(() => {
    const q = presetQuery.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.notes?.toLowerCase().includes(q) ?? false) ||
      p.jurisdiction.toLowerCase().includes(q) ||
      p.projectType.toLowerCase().includes(q),
    );
  }, [presets, presetQuery]);
  const persistPresets = (next: Preset[]) => {
    setPresets(next);
    try {
      window.localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    } catch {
      /* ignore quota errors */
    }
  };

  const applyPreset = (p: Preset) => {
    setProjectId(p.projectId);
    setJurisdiction(p.jurisdiction);
    setProjectType(p.projectType);
    setCodeYear(p.codeYear);
    setYearTouched(true); // don't let the jurisdiction effect override
    toast({ title: "Preset loaded", description: `"${p.name}" applied. Ready to re-run.` });
  };

  const saveCurrentAsPreset = () => {
    const suggested = `${jurisdiction.split("(")[0].trim()} · ${projectType.split("(")[0].trim()}`.slice(0, 60);
    const raw = window.prompt("Name this preset", suggested);
    const name = raw?.trim();
    if (!name) return;
    const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const draft: Omit<Preset, "notes"> = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      projectId,
      jurisdiction,
      projectType,
      codeYear,
      savedAt: new Date().toISOString(),
    };
    setNotesEditor({ mode: "create", draft, value: existing?.notes ?? "" });
  };

  const deletePreset = (id: string) => {
    persistPresets(presets.filter((p) => p.id !== id));
  };

  const renamePreset = (p: Preset) => {
    const raw = window.prompt("Rename preset", p.name);
    const name = raw?.trim();
    if (!name || name === p.name) return;
    const clash = presets.find((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      toast({ title: "Name already in use", description: `"${name}" is taken by another preset.`, variant: "destructive" });
      return;
    }
    persistPresets(presets.map((x) => (x.id === p.id ? { ...x, name } : x)));
    toast({ title: "Preset renamed", description: `Now called "${name}".` });
  };

  const editPresetNotes = (p: Preset) => {
    setNotesEditor({ mode: "edit", preset: p, value: p.notes ?? "" });
  };

  const commitNotesEditor = () => {
    if (!notesEditor) return;
    const trimmed = notesEditor.value.trim();
    if (trimmed.length > NOTES_MAX) {
      toast({
        title: "Notes too long",
        description: `Trim to ${NOTES_MAX} characters or fewer (currently ${trimmed.length}).`,
        variant: "destructive",
      });
      return;
    }
    const notes = trimmed || undefined;
    if (notesEditor.mode === "edit") {
      const p = notesEditor.preset;
      persistPresets(presets.map((x) => (x.id === p.id ? { ...x, notes } : x)));
      toast({ title: notes ? "Notes updated" : "Notes cleared" });
    } else {
      const draft = notesEditor.draft;
      const existing = presets.find((p) => p.id === draft.id);
      const next: Preset = { ...draft, notes };
      const list = existing
        ? presets.map((p) => (p.id === existing.id ? next : p))
        : [next, ...presets].slice(0, 20);
      persistPresets(list);
      toast({
        title: existing ? "Preset updated" : "Preset saved",
        description: `"${draft.name}" is available in the Presets menu.`,
      });
    }
    setNotesEditor(null);
  };

  const duplicatePreset = (p: Preset) => {
    const base = `${p.name} (copy)`;
    let name = base;
    let n = 2;
    while (presets.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      name = `${p.name} (copy ${n++})`;
    }
    const copy: Preset = {
      ...p,
      id: crypto.randomUUID(),
      name,
      notes: p.notes,
      savedAt: new Date().toISOString(),
    };
    persistPresets([copy, ...presets].slice(0, 20));
    toast({ title: "Preset duplicated", description: `Created "${name}". Edit filters and save again to customize.` });
  };

  const exportPresets = () => {
    if (presets.length === 0) {
      toast({ title: "No presets to export", description: "Save at least one preset first." });
      return;
    }
    const payload = {
      kind: "commun-et.compliance-analyzer.presets",
      version: 1,
      exportedAt: new Date().toISOString(),
      presets,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `compliance-presets-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Presets exported", description: `${presets.length} preset(s) written to JSON.` });
  };

  const importPresetsFromFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { kind?: string; presets?: unknown } | unknown;
      const raw = Array.isArray(parsed)
        ? parsed
        : (parsed as { presets?: unknown })?.presets;
      if (!Array.isArray(raw)) throw new Error("File does not contain a presets array.");
      const REQUIRED = ["name", "projectId", "jurisdiction", "projectType", "codeYear"] as const;
      const cleaned: Preset[] = [];
      for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        if (!REQUIRED.every((k) => typeof obj[k] === "string" && (obj[k] as string).length > 0)) continue;
        cleaned.push({
          id: typeof obj.id === "string" ? (obj.id as string) : crypto.randomUUID(),
          name: obj.name as string,
          projectId: obj.projectId as string,
          jurisdiction: obj.jurisdiction as string,
          projectType: obj.projectType as string,
          codeYear: obj.codeYear as string,
          notes:
            typeof obj.notes === "string" && (obj.notes as string).trim()
              ? (obj.notes as string).slice(0, NOTES_MAX)
              : undefined,
          savedAt: typeof obj.savedAt === "string" ? (obj.savedAt as string) : new Date().toISOString(),
        });
      }
      if (cleaned.length === 0) throw new Error("No valid presets found in file.");

      const existingIds = new Set(presets.map((p) => p.id));
      const existingNames = new Set(presets.map((p) => p.name.toLowerCase()));
      let added = 0;
      let renamed = 0;
      const merged = [...presets];
      for (const p of cleaned) {
        let entry = { ...p };
        if (existingIds.has(entry.id)) entry.id = crypto.randomUUID();
        if (existingNames.has(entry.name.toLowerCase())) {
          let n = 2;
          let candidate = `${entry.name} (imported)`;
          while (existingNames.has(candidate.toLowerCase())) candidate = `${entry.name} (imported ${n++})`;
          entry.name = candidate;
          renamed++;
        }
        merged.unshift(entry);
        existingIds.add(entry.id);
        existingNames.add(entry.name.toLowerCase());
        added++;
      }
      persistPresets(merged.slice(0, 20));
      toast({
        title: "Presets imported",
        description: `${added} added${renamed ? ` · ${renamed} renamed to avoid conflicts` : ""}.`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid JSON file.";
      toast({ title: "Import failed", description: message, variant: "destructive" });
    }
  };

  const acceptFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    const kept: File[] = [];
    for (const f of incoming) {
      if (!ACCEPTED_TYPES.includes(f.type as typeof ACCEPTED_TYPES[number])) {
        toast({ title: "Unsupported file", description: `${f.name} — use PNG, JPEG, WebP, or PDF.`, variant: "destructive" });
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        toast({ title: "File too large", description: `${f.name} exceeds 15 MB.`, variant: "destructive" });
        continue;
      }
      kept.push(f);
    }
    setQueued((prev) => [...prev, ...kept].slice(0, MAX_FILES));
  };

  const runAnalysis = async () => {
    if (queued.length === 0) {
      toast({ title: "No files queued", description: "Add at least one drawing sheet to analyze." });
      return;
    }
    setAnalyzing(true);
    try {
      const files = await Promise.all(
        queued.map(async (f) => ({ name: f.name, mimeType: f.type, dataUrl: await readAsDataUrl(f) })),
      );
      const { data, error } = await supabase.functions.invoke("analyze-compliance-drawings", {
        body: { jurisdiction, projectType, codeYear, hvhz, files },
      });
      if (error) throw error;
      const payload = data as { findings: Finding[]; pagesReviewed?: number; summary?: string };
      setFindings(payload.findings ?? []);
      setPagesReviewed(payload.pagesReviewed ?? files.length);
      setSummary(payload.summary ?? "");
      setRanAt(new Date());
      toast({
        title: "Analysis complete",
        description: `${payload.findings?.length ?? 0} findings across ${payload.pagesReviewed ?? files.length} page(s).`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Analysis failed", description: message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  const runPreset = async (p: Preset) => {
    applyPreset(p);
    if (queued.length === 0) {
      toast({
        title: `Preset "${p.name}" loaded`,
        description: "Upload drawings, then click Re-Run Analyzer.",
      });
      return;
    }
    setAnalyzing(true);
    try {
      const files = await Promise.all(
        queued.map(async (f) => ({ name: f.name, mimeType: f.type, dataUrl: await readAsDataUrl(f) })),
      );
      const { data, error } = await supabase.functions.invoke("analyze-compliance-drawings", {
        body: {
          jurisdiction: p.jurisdiction,
          projectType: p.projectType,
          codeYear: p.codeYear,
          hvhz,
          files,
        },
      });
      if (error) throw error;
      const payload = data as { findings: Finding[]; pagesReviewed?: number; summary?: string };
      setFindings(payload.findings ?? []);
      setPagesReviewed(payload.pagesReviewed ?? files.length);
      setSummary(payload.summary ?? "");
      setRanAt(new Date());
      toast({
        title: `Preset "${p.name}" complete`,
        description: `${payload.findings?.length ?? 0} findings across ${payload.pagesReviewed ?? files.length} page(s).`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Analysis failed", description: message, variant: "destructive" });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">AI Code Compliance Analyzer</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">DesignCheck™ Analyzer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {findings.length} findings across 8 review agents{ranAt ? ` · run ${ranAt.toLocaleTimeString()}` : " · seeded sample"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border bg-card p-0.5 text-xs">
            {(["v3", "enhanced"] as const).map((v) => {
              const active = (v === "enhanced") === enhanced;
              return (
                <button key={v} onClick={() => setParams(v === "enhanced" ? { view: "enhanced" } : {}, { replace: true })} className={cn("rounded px-3 py-1.5 transition-colors", active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {v === "enhanced" ? "v3.1 Enhanced" : "v3 Classic"}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => fileInputRef.current?.click()} className="pilot-button-ghost">
            <Upload className="h-4 w-4" /> Upload Set
          </button>
          <button type="button" onClick={runAnalysis} disabled={analyzing || queued.length === 0} className="pilot-button-primary disabled:opacity-60">
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {analyzing ? "Analyzing…" : "Re-Run Analyzer"}
          </button>
        </div>
      </header>

      {/* Analyzer setup — jurisdiction / project type / code year + upload */}
      <section className="pilot-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              <span className="pilot-kicker text-primary">AI Compliance</span>
            </div>
            <h2 className="mt-1 font-display text-2xl font-semibold text-foreground">
              Upload drawings for automated code review
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Select jurisdiction, project type, and adopted code year, then drop your architectural
              drawings. Findings are cross-linked to the Reference Library and to the active
              project's Response Matrix.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="pilot-button-ghost">
                  <Bookmark className="h-4 w-4" /> Presets
                  {presets.length > 0 && (
                    <span className="ml-1 rounded-full border border-border bg-muted px-1.5 font-data text-[10px] text-muted-foreground">
                      {presets.length}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel>Saved Presets</DropdownMenuLabel>
                {presets.length > 0 && (
                  <div className="px-2 pb-2">
                    <div className="relative">
                      <FileSearch className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        value={presetQuery}
                        onChange={(e) => setPresetQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Search name or notes…"
                        className="w-full rounded border border-border bg-background py-1 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                )}
                {presets.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground">
                    No presets yet. Configure filters and click "Save current".
                  </div>
                )}
                {presets.length > 0 && filteredPresets.length === 0 && (
                  <div className="px-2 py-3 text-xs text-muted-foreground">
                    No presets match "{presetQuery}".
                  </div>
                )}
                {filteredPresets.map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={(e) => { e.preventDefault(); applyPreset(p); }}
                    className="flex items-start gap-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {p.jurisdiction.split("(")[0].trim()} · {p.projectType.split("(")[0].trim()} · {p.codeYear}
                      </div>
                      {p.notes && (
                        <div className="mt-1 flex items-start gap-1 text-[11px] italic text-muted-foreground/90">
                          <StickyNote className="mt-0.5 h-3 w-3 shrink-0 text-primary/70" />
                          <span className="line-clamp-2 whitespace-normal">{p.notes}</span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Run preset ${p.name}`}
                      title="Run preset"
                      disabled={analyzing}
                      onClick={(e) => { e.stopPropagation(); runPreset(p); }}
                      className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 font-data text-[10px] uppercase tracking-wider text-primary hover:bg-primary/20 disabled:opacity-50"
                    >
                      <Play className="h-3 w-3" /> Run
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename preset ${p.name}`}
                      title="Rename"
                      onClick={(e) => { e.stopPropagation(); renamePreset(p); }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Edit notes for preset ${p.name}`}
                      title={p.notes ? "Edit notes" : "Add notes"}
                      onClick={(e) => { e.stopPropagation(); editPresetNotes(p); }}
                      className={cn(
                        "rounded p-1 hover:bg-muted hover:text-foreground",
                        p.notes ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      <StickyNote className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Duplicate preset ${p.name}`}
                      title="Duplicate"
                      onClick={(e) => { e.stopPropagation(); duplicatePreset(p); }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete preset ${p.name}`}
                      onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); saveCurrentAsPreset(); }}>
                  <BookmarkPlus className="mr-2 h-4 w-4 text-primary" /> Save current as preset…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); exportPresets(); }}>
                  <Download className="mr-2 h-4 w-4" /> Export presets (JSON)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); presetImportRef.current?.click(); }}>
                  <UploadIcon className="mr-2 h-4 w-4" /> Import presets…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input
              ref={presetImportRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importPresetsFromFile(f);
                e.target.value = "";
              }}
            />
            <span className="hidden rounded-full border border-pilot-teal/30 bg-pilot-teal/10 px-2.5 py-1 font-data text-[10px] uppercase tracking-wider text-pilot-teal md:inline-flex">
              Active project: {active.id}
            </span>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 pilot-kicker text-foreground/80">
              <Building2 className="h-3.5 w-3.5 text-primary" /> Project
            </label>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">No project (analysis won't be saved)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.id} · {p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 pilot-kicker text-foreground/80">
              <MapPin className="h-3.5 w-3.5 text-primary" /> Jurisdiction
            </label>
            <GroupedCombo
              value={jurisdiction}
              onChange={setJurisdiction}
              groups={jurisdictionGroups}
              placeholder="Select jurisdiction…"
              searchPlaceholder="Search jurisdictions…"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 pilot-kicker text-foreground/80">
              <Layers className="h-3.5 w-3.5 text-primary" /> Project Type
              {hvhz && (
                <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 font-data text-[9px] uppercase tracking-wider text-warning">
                  <Wind className="h-2.5 w-2.5" /> HVHZ
                </span>
              )}
            </label>
            <GroupedCombo
              value={projectType}
              onChange={setProjectType}
              groups={projectTypeGroups}
              placeholder="Select project type…"
              searchPlaceholder="Search project types…"
            />
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 pilot-kicker text-foreground/80">
              <Calendar className="h-3.5 w-3.5 text-primary" /> Code Year
            </label>
            <select
              value={codeYear}
              onChange={(e) => { setYearTouched(true); setCodeYear(e.target.value); }}
              className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              {codeYears.map((y) => <option key={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={(e) => { e.preventDefault(); acceptFiles(e.dataTransfer.files); }}
          className="mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background/40 py-10 text-center transition-colors hover:border-primary/60 hover:bg-primary/5"
        >
          <Upload className="h-7 w-7 text-primary/80" />
          <p className="text-sm font-medium text-foreground">Drop your drawings here or click to browse</p>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG, WebP, or PDF · up to {MAX_FILES} files · 15 MB each
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES.join(",")}
            className="hidden"
            onChange={(e) => { acceptFiles(e.target.files); e.target.value = ""; }}
          />
        </div>

        {queued.length > 0 && (
          <ul className="mt-4 space-y-2">
            {queued.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2 text-sm">
                <FileSearch className="h-4 w-4 text-primary" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="font-data text-xs text-muted-foreground">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                <button
                  type="button"
                  onClick={() => setQueued((prev) => prev.filter((_, idx) => idx !== i))}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${f.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={runAnalysis}
            disabled={analyzing || queued.length === 0}
            className="pilot-button-primary disabled:opacity-60"
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {analyzing ? "Analyzing…" : "Analyze for Compliance"}
          </button>
        </div>

        {summary && (
          <p className="mt-4 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {summary}
          </p>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {[{l:"Critical", v: findings.filter(f=>f.severity==="critical").length, t:"text-destructive"},{l:"Warnings", v: findings.filter(f=>f.severity==="warn").length, t:"text-warning"},{l:"Info", v: findings.filter(f=>f.severity==="info").length, t:"text-primary"},{l:"Pages Reviewed", v: 42, t:"text-foreground"}].map((k) => (
          <div key={k.l} className="pilot-card p-4">
            <div className="pilot-kicker">{k.l}</div>
            <div className={cn("mt-1 font-display text-3xl font-semibold", k.t)}>{k.l === "Pages Reviewed" ? pagesReviewed : k.v}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="pilot-card overflow-hidden">
          <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-3">
            <FileSearch className="h-4 w-4 text-primary" />
            <h2 className="font-tight text-base font-bold">Findings</h2>
            <span className="pilot-kicker text-muted-foreground">{findings.length} total</span>
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={findings.length === 0}
                    className="pilot-button-ghost disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" /> Export
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    onSelect={() => {
                      exportFindingsPdf(findings, {
                        projectLabel: projectId
                          ? `${projectId} · ${projects.find((p) => p.id === projectId)?.name ?? ""}`
                          : `Active · ${active.id}`,
                        jurisdiction,
                        projectType,
                        codeYear,
                        hvhz,
                        pagesReviewed,
                        summary,
                        ranAt,
                      });
                      toast({ title: "PDF ready", description: "Download started." });
                    }}
                  >
                    <FileText className="mr-2 h-4 w-4 text-primary" /> Download PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      exportFindingsCsv(findings, {
                        projectLabel: projectId
                          ? `${projectId} · ${projects.find((p) => p.id === projectId)?.name ?? ""}`
                          : `Active · ${active.id}`,
                        jurisdiction,
                        projectType,
                        codeYear,
                        hvhz,
                        pagesReviewed,
                        summary,
                        ranAt,
                      });
                      toast({ title: "CSV ready", description: "Download started." });
                    }}
                  >
                    <TableIcon className="mr-2 h-4 w-4 text-primary" /> Download CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <ul className="divide-y divide-border">
            {findings.map((f) => {
              const meta = sevMeta[f.severity];
              return (
                <li key={f.id} className="p-5">
                  <div className="flex items-start gap-3">
                    <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 pilot-kicker", meta.tone)}>
                      <meta.Icon className="h-3 w-3" /> {meta.label}
                    </span>
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-data text-xs text-muted-foreground">{f.code}</span>
                        <span className="font-data text-xs text-muted-foreground">· sheet {f.page}</span>
                      </div>
                      <p className="mt-1 font-medium text-foreground">{f.title}</p>
                      {enhanced && (
                        <div className="mt-2 rounded border border-border bg-muted/30 p-2 text-xs">
                          <span className="pilot-kicker text-pilot-teal">AI Remediation</span>
                          <p className="mt-1 text-muted-foreground">{f.suggestion}</p>
                        </div>
                      )}
                    </div>
                    <button className="pilot-button-ghost"><CheckCircle2 className="h-4 w-4" /> Accept</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="pilot-card p-5">
          <h3 className="flex items-center gap-2 font-tight text-base font-bold">
            <Layers className="h-4 w-4 text-primary" /> Reviewer Agents
          </h3>
          <ul className="mt-3 space-y-2 text-sm">
            {["Zoning Overlay","Fire/Life Safety","Accessibility","Energy Code","Stormwater","Utility Clearance","Historic District","Submission Completeness"].map((a) => (
              <li key={a} className="flex items-center gap-2 rounded border border-border bg-muted/30 px-2 py-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" /> {a}
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <Dialog open={notesEditor !== null} onOpenChange={(o) => { if (!o) setNotesEditor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {notesEditor?.mode === "create"
                ? `Add notes for "${notesEditor.draft.name}"`
                : notesEditor?.mode === "edit"
                ? `Notes for "${notesEditor.preset.name}"`
                : "Preset notes"}
            </DialogTitle>
            <DialogDescription>
              Optional — why is this preset useful? Leave blank to clear.
            </DialogDescription>
          </DialogHeader>
          {notesEditor && (() => {
            const len = notesEditor.value.trim().length;
            const over = len > NOTES_MAX;
            return (
              <div className="space-y-2">
                <Textarea
                  autoFocus
                  value={notesEditor.value}
                  onChange={(e) =>
                    setNotesEditor({ ...notesEditor, value: e.target.value.slice(0, NOTES_MAX + 50) })
                  }
                  placeholder="e.g. Coastal HVHZ variant used for Miami-Dade townhome remodels."
                  className={cn("min-h-[120px] resize-none", over && "border-destructive focus-visible:ring-destructive")}
                  aria-invalid={over}
                  aria-describedby={over ? "notes-error" : undefined}
                />
                <div className="flex items-center justify-between text-[11px]">
                  <span className={cn("text-muted-foreground", over && "text-destructive")}>
                    {over ? `Trim ${len - NOTES_MAX} char(s) to save.` : "Plain text only."}
                  </span>
                  <span
                    className={cn(
                      "font-data tabular-nums",
                      over ? "text-destructive" : len > NOTES_MAX * 0.9 ? "text-warning" : "text-muted-foreground",
                    )}
                  >
                    {len}/{NOTES_MAX}
                  </span>
                </div>
                {over && (
                  <div
                    id="notes-error"
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Notes exceed the {NOTES_MAX}-character limit by{" "}
                      <span className="font-data font-semibold">{len - NOTES_MAX}</span>. Remove the extra
                      characters to save.
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <button
              type="button"
              className="pilot-button-ghost disabled:opacity-60"
              disabled={!notesEditor || notesEditor.value.length === 0}
              onClick={() => notesEditor && setNotesEditor({ ...notesEditor, value: "" })}
            >
              Clear notes
            </button>
            <button type="button" className="pilot-button-ghost" onClick={() => setNotesEditor(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="pilot-button-primary disabled:opacity-60"
              disabled={!!notesEditor && notesEditor.value.trim().length > NOTES_MAX}
              onClick={commitNotesEditor}
            >
              {notesEditor?.mode === "create" ? "Save preset" : "Save notes"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ComplianceAnalyzer;