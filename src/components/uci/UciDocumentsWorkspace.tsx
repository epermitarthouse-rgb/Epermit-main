import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { formatUciUserError } from "@/lib/uciApi";
import {
  classificationReviewTone,
  confidenceTone,
  formatDocumentRoleLabel,
  getCoordinationDocumentRegistry,
  getCoordinationProviderRequirements,
  overrideCoordinationDocumentRole,
  registerCoordinationDocument,
  syncCoordinationDocumentRegistry,
  UCI_DOCUMENT_ROLES,
  type UciDocumentRegistryEntry,
  type UciProviderRequirementsResponse,
} from "@/lib/uciDocumentRegistry";
import { UciDocumentCoveragePanel } from "@/components/uci/UciDocumentCoveragePanel";
import { toast } from "sonner";

export function UciDocumentsWorkspace({
  coordinationId,
  projectId,
  userId,
  externalApplicationId,
  externalApplicationTitle,
  mutedClass,
  toolbarOutlineButtonClass,
  resolvePortalDocumentIndex,
}: {
  coordinationId: string;
  projectId: string;
  userId: string;
  externalApplicationId: string | null;
  externalApplicationTitle?: string | null;
  mutedClass: string;
  toolbarOutlineButtonClass: string;
  resolvePortalDocumentIndex?: (fileName: string) => number | null;
}) {
  const [registry, setRegistry] = useState<UciDocumentRegistryEntry[]>([]);
  const [needsReview, setNeedsReview] = useState<UciDocumentRegistryEntry[]>([]);
  const [providerRequirements, setProviderRequirements] =
    useState<UciProviderRequirementsResponse | null>(null);
  const [loadBusy, setLoadBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAll = useCallback(async () => {
    if (!coordinationId) return;
    setLoadBusy(true);
    try {
      const [registryResult, requirementsResult] = await Promise.all([
        getCoordinationDocumentRegistry(coordinationId),
        getCoordinationProviderRequirements(coordinationId),
      ]);
      setRegistry(registryResult.documents);
      setNeedsReview(registryResult.needs_review);
      setProviderRequirements(requirementsResult);
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to load documents workspace"));
    } finally {
      setLoadBusy(false);
    }
  }, [coordinationId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSync = async () => {
    if (!coordinationId) return;
    setSyncBusy(true);
    try {
      await syncCoordinationDocumentRegistry(coordinationId);
      await loadAll();
      toast.success("Document registry synced and classified");
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Registry sync failed"));
    } finally {
      setSyncBusy(false);
    }
  };

  const handleUpload = async (files: FileList | File[]) => {
    if (!coordinationId || !projectId || !userId) return;
    const fileArray = Array.from(files);
    if (!fileArray.length) return;
    setUploadBusy(true);
    try {
      for (const file of fileArray) {
        const storagePath = `${projectId}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
        const { error: uploadError } = await supabase.storage
          .from("project-documents")
          .upload(storagePath, file, { upsert: false });
        if (uploadError) throw uploadError;

        const { data: docRow, error: insertError } = await supabase
          .from("project_documents")
          .insert({
            project_id: projectId,
            user_id: userId,
            file_name: file.name,
            file_path: storagePath,
            file_size: file.size,
            file_type: file.type || "application/octet-stream",
            document_type: "other",
            description: `Documents workspace upload · coordination ${coordinationId}`,
          })
          .select("id")
          .single();
        if (insertError || !docRow?.id) throw insertError ?? new Error("Insert failed");

        await registerCoordinationDocument(coordinationId, {
          project_document_id: docRow.id,
          provenance: "manual_upload",
        });
      }
      await loadAll();
      toast.success(
        fileArray.length === 1
          ? "Document uploaded and classified"
          : `${fileArray.length} documents uploaded and classified`,
      );
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Upload failed"));
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRoleChange = async (entry: UciDocumentRegistryEntry, manualRole: string) => {
    if (!coordinationId) return;
    setRoleBusy(entry.project_document_id);
    try {
      await overrideCoordinationDocumentRole(coordinationId, entry.project_document_id, {
        manual_role: manualRole,
      });
      await loadAll();
      toast.success("Classification updated");
    } catch (e: unknown) {
      toast.error(formatUciUserError(e, "Failed to update classification"));
    } finally {
      setRoleBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Provider requirements</CardTitle>
            <CardDescription>
              Template slots resolved against the project document registry
              {providerRequirements?.provider_slug
                ? ` · ${providerRequirements.provider_slug}`
                : ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {providerRequirements ? (
              <Badge variant={providerRequirements.readiness.complete ? "default" : "secondary"}>
                {providerRequirements.readiness.label} ready
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarOutlineButtonClass}
              disabled={syncBusy || loadBusy}
              onClick={() => void handleSync()}
            >
              {syncBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Reclassify all
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadBusy && !providerRequirements ? (
            <p className={cn("text-sm", mutedClass)}>Loading provider requirements…</p>
          ) : providerRequirements?.slots.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slot</TableHead>
                  <TableHead>Matched document</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Signature</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providerRequirements.slots.map((slot) => (
                  <TableRow key={slot.key}>
                    <TableCell className="font-medium">{slot.label}</TableCell>
                    <TableCell className="text-sm">
                      {slot.matched_file_name ?? (
                        <span className={mutedClass}>Missing</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {slot.matched_effective_role ? (
                        <Badge variant="outline">
                          {formatDocumentRoleLabel(slot.matched_effective_role)}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {slot.signature_required
                        ? slot.signature_status ?? "required"
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={slot.ready ? "default" : "destructive"}>
                        {slot.ready ? "Ready" : "Incomplete"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className={cn("text-sm", mutedClass)}>
              No provider template requirements configured for this coordination record.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Project documents</CardTitle>
            <CardDescription>
              All project documents — manual uploads, portal harvest, email, and UCI-generated
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(event) => {
                if (event.target.files?.length) {
                  void handleUpload(event.target.files);
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={toolbarOutlineButtonClass}
              disabled={uploadBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploadBusy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileUp className="mr-2 h-4 w-4" />
              )}
              Upload files
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadBusy && registry.length === 0 ? (
            <p className={cn("text-sm", mutedClass)}>Loading project documents…</p>
          ) : registry.length === 0 ? (
            <p className={cn("text-sm", mutedClass)}>
              No project documents yet. Upload files or sync from portal harvest.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Stages</TableHead>
                  <TableHead>Provenance</TableHead>
                  <TableHead>Classification</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registry.map((entry) => (
                  <TableRow key={entry.project_document_id}>
                    <TableCell className="max-w-[220px] truncate text-sm">
                      {entry.project_document?.file_name ?? entry.project_document_id}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={entry.effective_role ?? "other"}
                        disabled={roleBusy === entry.project_document_id}
                        onValueChange={(value) => void handleRoleChange(entry, value)}
                      >
                        <SelectTrigger className="h-8 w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {UCI_DOCUMENT_ROLES.map((role) => (
                            <SelectItem key={role} value={role}>
                              {formatDocumentRoleLabel(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={confidenceTone(entry.role_confidence)}>
                        {entry.role_confidence}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {entry.stage_consumers?.length
                        ? entry.stage_consumers.map((s) => `S${s}`).join(", ")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs capitalize">
                      {entry.provenance.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={classificationReviewTone(entry.classification_review)}>
                        {entry.classification_review.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {needsReview.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Needs review</CardTitle>
            <CardDescription>
              {needsReview.length} document{needsReview.length === 1 ? "" : "s"} need classification
              review or manual role assignment
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {needsReview.map((entry) => (
              <div
                key={`review-${entry.project_document_id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {entry.project_document?.file_name ?? entry.project_document_id}
                  </p>
                  <p className={cn("text-xs", mutedClass)}>
                    Detected: {formatDocumentRoleLabel(entry.detected_role)} ·{" "}
                    {entry.role_confidence} confidence
                  </p>
                </div>
                <Badge variant={classificationReviewTone(entry.classification_review)}>
                  {entry.classification_review.replace(/_/g, " ")}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {externalApplicationId ? (
        <UciDocumentCoveragePanel
          coordinationId={coordinationId}
          externalApplicationId={externalApplicationId}
          externalApplicationTitle={externalApplicationTitle}
          mutedClass={mutedClass}
          toolbarOutlineButtonClass={toolbarOutlineButtonClass}
          resolvePortalDocumentIndex={resolvePortalDocumentIndex}
        />
      ) : null}
    </div>
  );
}
