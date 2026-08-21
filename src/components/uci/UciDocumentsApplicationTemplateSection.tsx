import { useCallback, useEffect, useRef, useState } from "react";
import { FileJson, FileUp, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatUciUserError,
  getCoordinationApplicationTemplateStatus,
  saveCoordinationApplicationTemplate,
  type UciApplicationTemplateStatus,
} from "@/lib/uciApi";
import { formatApplicationTemplateSource } from "@/lib/uciApplicationPrep";
import { cn } from "@/lib/utils";

type UciDocumentsApplicationTemplateSectionProps = {
  coordinationId: string;
  mutedClass?: string;
  toolbarOutlineButtonClass?: string;
  activeRequiredSlotCount?: number | null;
  onTemplateSaved?: () => void | Promise<void>;
};

export function UciDocumentsApplicationTemplateSection({
  coordinationId,
  mutedClass,
  toolbarOutlineButtonClass,
  activeRequiredSlotCount,
  onTemplateSaved,
}: UciDocumentsApplicationTemplateSectionProps) {
  const [status, setStatus] = useState<UciApplicationTemplateStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pendingManifest, setPendingManifest] = useState<Record<string, unknown> | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStatus = useCallback(async () => {
    if (!coordinationId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getCoordinationApplicationTemplateStatus(coordinationId);
      setStatus(next);
    } catch (err: unknown) {
      setError(formatUciUserError(err, "Failed to load application template"));
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [coordinationId]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const activeTemplate = status?.active_template ?? null;
  const templateMissing = status?.status === "missing" || status?.template_available === false;
  const providerSlug = status?.provider_slug ?? "utility";
  const requiredSlots =
    pendingManifest && Array.isArray(pendingManifest.required_documents)
      ? pendingManifest.required_documents.length
      : null;

  const handleFileSelect = async (files: FileList | null) => {
    setParseError(null);
    setPendingManifest(null);
    setPendingFileName(null);
    const file = files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const manifest = JSON.parse(text) as Record<string, unknown>;
      if (!Array.isArray(manifest.required_documents) || !Array.isArray(manifest.required_fields)) {
        setParseError("Template must include required_documents and required_fields arrays.");
        return;
      }
      setPendingManifest(manifest);
      setPendingFileName(file.name);
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        setParseError("Invalid JSON — upload a valid application template manifest.");
      } else {
        setParseError(formatUciUserError(err, "Failed to read template file"));
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleActivate = async () => {
    if (!pendingManifest) return;
    setParseError(null);
    setSaveBusy(true);
    try {
      await saveCoordinationApplicationTemplate(coordinationId, { manifest: pendingManifest });
      setPendingManifest(null);
      setPendingFileName(null);
      await refreshStatus();
      await onTemplateSaved?.();
    } catch (err: unknown) {
      setParseError(formatUciUserError(err, "Failed to activate application template"));
    } finally {
      setSaveBusy(false);
    }
  };

  const manifestProviderSlug =
    pendingManifest?.provider_slug != null ? String(pendingManifest.provider_slug) : null;
  const providerMismatch =
    manifestProviderSlug &&
    providerSlug &&
    manifestProviderSlug.toLowerCase() !== providerSlug.toLowerCase();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileJson className="h-4 w-4" aria-hidden />
            Provider / application template
          </CardTitle>
          <CardDescription>
            Upload a JSON application template for this coordination run. Requirements appear after
            activation — not stored as project documents.
          </CardDescription>
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-xs text-destructive">{error}</p> : null}

        {activeTemplate && !templateMissing ? (
          <div className="rounded-md border border-border/70 bg-muted/20 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Active template</Badge>
              <span className="text-sm font-medium">{activeTemplate.label || "Manual template"}</span>
              {activeTemplate.version ? (
                <span className={cn("text-xs", mutedClass)}>v{activeTemplate.version}</span>
              ) : status?.version ? (
                <span className={cn("text-xs", mutedClass)}>v{status.version}</span>
              ) : null}
            </div>
            <p className={cn("text-xs", mutedClass)}>
              Source: {formatApplicationTemplateSource(activeTemplate.source || status?.source)} ·
              Provider {activeTemplate.provider_slug || providerSlug}
              {activeRequiredSlotCount != null && activeRequiredSlotCount > 0
                ? ` · ${activeRequiredSlotCount} required slots`
                : ""}
            </p>
          </div>
        ) : (
          <p className={cn("text-sm", mutedClass)}>
            No active template for this coordination. Upload{" "}
            <code className="text-xs">dominion-electric-full-demo-v2.json</code> (or equivalent) to
            configure provider document requirements.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => void handleFileSelect(event.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={toolbarOutlineButtonClass}
            disabled={saveBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            {saveBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 h-4 w-4" />
            )}
            Upload template JSON
          </Button>
          {pendingManifest ? (
            <Button
              type="button"
              size="sm"
              disabled={saveBusy || Boolean(providerMismatch)}
              onClick={() => void handleActivate()}
            >
              {saveBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Activate template
            </Button>
          ) : null}
        </div>

        {pendingFileName ? (
          <p className={cn("text-xs", mutedClass)}>
            Selected: {pendingFileName}
            {requiredSlots != null ? ` · ${requiredSlots} required document slots` : ""}
          </p>
        ) : null}

        {providerMismatch ? (
          <p className="text-xs text-destructive">
            Template provider &quot;{manifestProviderSlug}&quot; does not match coordination provider
            &quot;{providerSlug}&quot;. Fix the manifest or confirm the correct provider before
            activating.
          </p>
        ) : null}

        {parseError ? <p className="text-xs text-destructive">{parseError}</p> : null}

        <p className={cn("text-xs", mutedClass)}>
          Advanced: paste or edit JSON in Application Prep. Clean reset clears this run&apos;s template
          activation; global provider records are preserved.
        </p>
      </CardContent>
    </Card>
  );
}
