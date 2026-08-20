import { useCallback, useEffect, useMemo, useState } from "react";
import { FileJson, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  formatUciUserError,
  getCoordinationApplicationTemplateStatus,
  isUciApiError,
  saveCoordinationApplicationTemplate,
  type UciApplicationTemplateStatus,
} from "@/lib/uciApi";
import {
  buildManualApplicationTemplateStarter,
  formatApplicationTemplateSource,
} from "@/lib/uciApplicationPrep";
import { cn } from "@/lib/utils";

type UciApplicationTemplatePanelProps = {
  coordinationId: string;
  providerSlug?: string | null;
  utilityType?: string | null;
  checklistMode?: string | null;
  mutedClass?: string;
  onTemplateSaved?: () => void | Promise<void>;
  forceVisible?: boolean;
};

function pickActiveTemplate(
  status: UciApplicationTemplateStatus | null,
  packageResolution?: Record<string, unknown> | null,
): UciApplicationTemplateStatus["active_template"] | null {
  if (status?.active_template) return status.active_template;
  const embedded =
    packageResolution?.active_template &&
    typeof packageResolution.active_template === "object" &&
    !Array.isArray(packageResolution.active_template)
      ? (packageResolution.active_template as UciApplicationTemplateStatus["active_template"])
      : null;
  return embedded;
}

export function UciApplicationTemplatePanel({
  coordinationId,
  providerSlug,
  utilityType,
  checklistMode,
  mutedClass,
  onTemplateSaved,
  forceVisible = false,
}: UciApplicationTemplatePanelProps) {
  const [status, setStatus] = useState<UciApplicationTemplateStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftJson, setDraftJson] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!coordinationId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getCoordinationApplicationTemplateStatus(coordinationId, {
        checklist_mode: checklistMode || undefined,
      });
      setStatus(next);
    } catch (err: unknown) {
      setError(formatUciUserError(err, "Failed to load application template status"));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [coordinationId, checklistMode]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const effectiveProviderSlug = status?.provider_slug || providerSlug || "utility";
  const effectiveUtilityType = status?.utility_type || utilityType || "electric";
  const templateMissing = status?.status === "missing" || status?.template_available === false;
  const showPanel = forceVisible || templateMissing || status?.is_manual === true;

  const starterTemplate = useMemo(
    () =>
      buildManualApplicationTemplateStarter({
        providerSlug: effectiveProviderSlug,
        utilityType: effectiveUtilityType,
      }),
    [effectiveProviderSlug, effectiveUtilityType],
  );

  useEffect(() => {
    if (!draftJson && templateMissing) {
      setDraftJson(JSON.stringify(starterTemplate, null, 2));
    }
  }, [draftJson, starterTemplate, templateMissing]);

  const activeTemplate = pickActiveTemplate(status, null);

  const handleSave = async () => {
    setParseError(null);
    setSaveBusy(true);
    try {
      const manifest = JSON.parse(draftJson) as Record<string, unknown>;
      await saveCoordinationApplicationTemplate(coordinationId, { manifest });
      await refreshStatus();
      await onTemplateSaved?.();
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        setParseError("Template JSON is invalid — fix syntax and try again.");
      } else {
        setParseError(formatUciUserError(err, "Failed to save application template"));
      }
    } finally {
      setSaveBusy(false);
    }
  };

  if (!showPanel && !loading) {
    if (!activeTemplate) return null;
    return (
      <div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Active template</Badge>
          <span className="text-sm font-medium text-foreground">
            {activeTemplate.label || formatApplicationTemplateSource(activeTemplate.source)}
          </span>
          {activeTemplate.version ? (
            <span className={cn("text-xs", mutedClass)}>v{activeTemplate.version}</span>
          ) : null}
        </div>
        <p className={cn("text-xs", mutedClass)}>
          Source: {formatApplicationTemplateSource(activeTemplate.source)} · Provider{" "}
          {activeTemplate.provider_slug}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => {
            setDraftJson(JSON.stringify(starterTemplate, null, 2));
            void refreshStatus();
          }}
        >
          Replace manual template
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-3",
        templateMissing
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-border/70 bg-muted/20",
      )}
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <FileJson className="h-4 w-4 text-foreground" aria-hidden />
          <p className="text-sm font-semibold text-foreground">
            {templateMissing ? "Application template required" : "Manual application template"}
          </p>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
        </div>
        <p className={cn("text-xs", mutedClass)}>
          {templateMissing
            ? `No built-in application template exists for ${effectiveProviderSlug}. Upload or paste a manual template to continue Application Builder. Saved templates apply to future projects for this provider.`
            : "Update the provider template manifest below. Required documents and fields drive package assembly and document mapping."}
        </p>
      </div>

      {activeTemplate && !templateMissing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Active</Badge>
          <span className="text-sm">{activeTemplate.label}</span>
          {activeTemplate.version ? (
            <span className={cn("text-xs", mutedClass)}>v{activeTemplate.version}</span>
          ) : null}
          <span className={cn("text-xs", mutedClass)}>
            ({formatApplicationTemplateSource(activeTemplate.source)})
          </span>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <Textarea
        value={draftJson}
        onChange={(event) => setDraftJson(event.target.value)}
        rows={12}
        className="font-mono text-xs"
        placeholder="Paste application template JSON manifest..."
        spellCheck={false}
      />

      {parseError ? <p className="text-xs text-destructive">{parseError}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={saveBusy || !draftJson.trim()} onClick={() => void handleSave()}>
          {saveBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {templateMissing ? "Upload manual template" : "Save template update"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={saveBusy}
          onClick={() => setDraftJson(JSON.stringify(starterTemplate, null, 2))}
        >
          Reset starter manifest
        </Button>
      </div>
    </div>
  );
}

export function isApplicationTemplateMissingError(err: unknown): boolean {
  return isUciApiError(err) && err.code === "TEMPLATE_NOT_FOUND";
}
