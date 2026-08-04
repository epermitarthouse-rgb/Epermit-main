import { useEffect, useState } from "react";
import { Download, Save, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { exportCsv } from "@/lib/exportCsv";

export type CsvColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number;
  defaultSelected?: boolean;
};

type Props<T> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  filename: string;
  columns: CsvColumn<T>[];
  rows: T[];
  /** When set, the user's column selection is persisted in localStorage under this key. */
  storageKey?: string;
};

const PREF_PREFIX = "commun-et:csv-cols:";
const PRESET_PREFIX = "commun-et:csv-presets:";

type PresetMap = Record<string, Record<string, boolean>>;

const loadPresets = (storageKey: string | undefined): PresetMap => {
  if (!storageKey || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PRESET_PREFIX + storageKey);
    return raw ? (JSON.parse(raw) as PresetMap) : {};
  } catch {
    return {};
  }
};

const savePresetsToStorage = (storageKey: string | undefined, presets: PresetMap) => {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRESET_PREFIX + storageKey, JSON.stringify(presets));
  } catch {
    /* ignore */
  }
};

const loadPrefs = (storageKey: string | undefined): Record<string, boolean> | null => {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREF_PREFIX + storageKey);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : null;
  } catch {
    return null;
  }
};

const savePrefs = (storageKey: string | undefined, prefs: Record<string, boolean>) => {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREF_PREFIX + storageKey, JSON.stringify(prefs));
  } catch {
    /* ignore quota errors */
  }
};

export function CsvExportDialog<T>({
  open,
  onOpenChange,
  title = "Export to CSV",
  description = "Choose which columns to include.",
  filename,
  columns,
  rows,
  storageKey,
}: Props<T>) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [presets, setPresets] = useState<PresetMap>({});
  const [presetName, setPresetName] = useState("");
  const [activePreset, setActivePreset] = useState<string>("");

  useEffect(() => {
    if (open) {
      const stored = loadPrefs(storageKey);
      setSelected(
        Object.fromEntries(
          columns.map((c) => [
            c.key,
            stored && c.key in stored ? !!stored[c.key] : c.defaultSelected !== false,
          ]),
        ),
      );
      setPresets(loadPresets(storageKey));
      setActivePreset("");
      setPresetName("");
    }
  }, [open, columns, storageKey]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      savePrefs(storageKey, next);
      return next;
    });

  const setAll = (val: boolean) =>
    setSelected(() => {
      const next = Object.fromEntries(columns.map((c) => [c.key, val]));
      savePrefs(storageKey, next);
      return next;
    });

  const applyPreset = (name: string) => {
    const p = presets[name];
    if (!p) return;
    const next = Object.fromEntries(
      columns.map((c) => [c.key, name in presets && c.key in p ? !!p[c.key] : false]),
    );
    setSelected(next);
    savePrefs(storageKey, next);
    setActivePreset(name);
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const next = { ...presets, [name]: selected };
    setPresets(next);
    savePresetsToStorage(storageKey, next);
    setActivePreset(name);
    setPresetName("");
  };

  const deletePreset = (name: string) => {
    const { [name]: _, ...rest } = presets;
    setPresets(rest);
    savePresetsToStorage(storageKey, rest);
    if (activePreset === name) setActivePreset("");
  };

  const activeCols = columns.filter((c) => selected[c.key]);
  const canExport = activeCols.length > 0;

  const handleExport = () => {
    exportCsv(
      filename,
      activeCols.map((c) => c.label),
      rows.map((row) => activeCols.map((c) => c.value(row))),
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-b border-border pb-2 pilot-kicker text-muted-foreground">
          <span>{activeCols.length} of {columns.length} selected</span>
          <div className="flex gap-3">
            <button type="button" className="text-primary hover:underline" onClick={() => setAll(true)}>
              Select all
            </button>
            <button type="button" className="hover:text-foreground" onClick={() => setAll(false)}>
              Clear
            </button>
          </div>
        </div>

        {storageKey && (
          <div className="space-y-2 border-b border-border pb-3">
            <div className="pilot-kicker text-muted-foreground">Presets</div>
            {Object.keys(presets).length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {Object.keys(presets).map((name) => (
                  <li key={name} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => applyPreset(name)}
                      className={`rounded-l border border-border px-2 py-1 text-xs transition-colors ${
                        activePreset === name
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/40 hover:bg-muted"
                      }`}
                    >
                      {name}
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePreset(name)}
                      aria-label={`Delete preset ${name}`}
                      className="rounded-r border border-l-0 border-border bg-muted/40 px-1.5 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No saved presets yet.</p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    savePreset();
                  }
                }}
                placeholder="Preset name…"
                className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={savePreset}
                disabled={!presetName.trim()}
                className="pilot-button-ghost disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> Save
              </button>
            </div>
          </div>
        )}

        <ul className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {columns.map((c) => (
            <li key={c.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded border border-border bg-muted/30 p-2 text-sm transition-colors hover:bg-muted/60">
                <Checkbox
                  checked={!!selected[c.key]}
                  onCheckedChange={() => toggle(c.key)}
                />
                <span className="text-foreground">{c.label}</span>
              </label>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <button
            type="button"
            className="pilot-button-ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pilot-button-primary disabled:opacity-50"
            disabled={!canExport}
            onClick={handleExport}
          >
            <Download className="h-4 w-4" /> Export {rows.length} rows
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}