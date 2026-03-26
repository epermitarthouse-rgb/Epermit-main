import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  TEMPLATE_CONFIGS,
  type TemplateId,
  type CompanyBrandingData,
} from "@/lib/responsePackageTemplates";
import {
  useResponsePackageDrafts,
  type ResponsePackageDraft,
} from "@/hooks/useResponsePackageDrafts";
import {
  FileText,
  ClipboardList,
  Table2,
  FileDown,
  Loader2,
  Building2,
  Eye,
  Save,
  Plus,
  History,
  Send,
  CheckCircle2,
  Clock,
  Archive,
} from "lucide-react";
import {
  RoundChangeSummary,
  computeRoundChanges,
  type RoundChanges,
} from "@/components/response-matrix/RoundChangeSummary";
import { cn } from "@/lib/utils";

const TEMPLATE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FileText,
  ClipboardList,
  Table2,
};

interface ExportPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  comments?: Array<{ id: string; original_text?: string; status?: string; response_text: string | null }>;
}

function DraftStatusBadge({ status }: { status: string }) {
  if (status === "submitted") {
    return (
      <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
        <Send className="h-3 w-3 mr-1" />
        Submitted
      </Badge>
    );
  }
  if (status === "superseded") {
    return (
      <Badge variant="secondary" className="bg-muted text-muted-foreground">
        <Archive className="h-3 w-3 mr-1" />
        Superseded
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 border-amber-500/30">
      <Clock className="h-3 w-3 mr-1" />
      Draft
    </Badge>
  );
}

export function ExportPackageDialog({
  open,
  onOpenChange,
  projectId,
  comments,
}: ExportPackageDialogProps) {
  const { user } = useAuth();
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId>("letter");
  const [municipalityAddress, setMunicipalityAddress] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [roundLabel, setRoundLabel] = useState("");
  const [exporting, setExporting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [branding, setBranding] = useState<CompanyBrandingData | null>(null);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [showDraftList, setShowDraftList] = useState(false);

  const {
    drafts,
    loading: loadingDrafts,
    currentDraft,
    fetchDrafts,
    createDraft,
    updateDraft,
    startNewRound,
    markAsSubmitted,
    saveCommentSnapshot,
  } = useResponsePackageDrafts(projectId);

  const fetchBranding = useCallback(async () => {
    if (!user) return;
    setLoadingBranding(true);
    try {
      const { data } = await supabase
        .from("company_branding")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (data) {
        setBranding({
          logo_url: data.logo_url,
          company_name: data.company_name,
          company_address: data.company_address,
          company_phone: data.company_phone,
          company_email: data.company_email,
          company_website: data.company_website,
          default_signoff: data.default_signoff,
        });
      }

      if (!data) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("company_name")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profile?.company_name) {
          setBranding({ company_name: profile.company_name });
        }
      }
    } catch (err) {
      console.error("Failed to fetch branding:", err);
    } finally {
      setLoadingBranding(false);
    }
  }, [user]);

  useEffect(() => {
    if (open) {
      fetchBranding();
      fetchDrafts();
      setActiveDraftId(null);
      setShowDraftList(false);
    }
  }, [open, fetchBranding, fetchDrafts]);

  useEffect(() => {
    if (open && currentDraft && !activeDraftId) {
      loadDraftIntoForm(currentDraft);
    }
  }, [open, currentDraft, activeDraftId]);

  const loadDraftIntoForm = (draft: ResponsePackageDraft) => {
    setActiveDraftId(draft.id);
    setSelectedTemplate(draft.template);
    setMunicipalityAddress(draft.municipality_address ?? "");
    setCustomNotes(draft.custom_notes ?? "");
    setRoundLabel(draft.round_label ?? "");
    setShowDraftList(false);
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      if (activeDraftId) {
        const success = await updateDraft(activeDraftId, {
          template: selectedTemplate,
          municipality_address: municipalityAddress.trim() || null,
          custom_notes: customNotes.trim() || null,
          round_label: roundLabel.trim() || null,
        });
        if (success) toast.success("Draft saved");
      } else {
        const draft = await createDraft({
          template: selectedTemplate,
          municipality_address: municipalityAddress.trim() || null,
          custom_notes: customNotes.trim() || null,
          round_label: roundLabel.trim() || null,
        });
        if (draft) {
          setActiveDraftId(draft.id);
          toast.success("Draft created");
        }
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const handleNewRound = async () => {
    setSavingDraft(true);
    try {
      const draft = await startNewRound({
        template: selectedTemplate,
        municipality_address: municipalityAddress.trim() || null,
        custom_notes: "",
        round_label: undefined,
      });
      if (draft) {
        loadDraftIntoForm(draft);
        toast.success(`Started Round ${draft.round_number}`);
      }
    } finally {
      setSavingDraft(false);
    }
  };

  const handleExport = async (saveWithDraft: boolean) => {
    if (!projectId) return;
    setExporting(true);
    try {
      const body: Record<string, unknown> = {
        project_id: projectId,
        template: selectedTemplate,
      };
      if (selectedTemplate === "letter" && municipalityAddress.trim()) {
        body.municipality_address = municipalityAddress.trim();
      }
      if (customNotes.trim()) {
        body.custom_notes = customNotes.trim();
      }
      if (roundLabel.trim()) {
        body.round_label = roundLabel.trim();
      }

      const { data, error } = await supabase.functions.invoke(
        "export-response-package",
        { body }
      );
      if (error) throw error;

      const payload = data as {
        url?: string;
        file_path?: string;
        error?: string;
        missing_count?: number;
      };
      if (payload?.error) {
        if (
          payload.error === "Incomplete responses" &&
          typeof payload.missing_count === "number"
        ) {
          toast.error(
            `Project has ${payload.missing_count} comment(s) without responses. Run "Validate Completeness" first.`,
            { duration: 6000 }
          );
        } else {
          toast.error(payload.error);
        }
        return;
      }
      if (payload?.url) {
        window.open(payload.url, "_blank");

        if (saveWithDraft) {
          let draftId = activeDraftId;
          if (!draftId) {
            const draft = await createDraft({
              template: selectedTemplate,
              municipality_address: municipalityAddress.trim() || null,
              custom_notes: customNotes.trim() || null,
              round_label: roundLabel.trim() || null,
            });
            if (draft) draftId = draft.id;
          }
          if (draftId) {
            await updateDraft(draftId, {
              exported_pdf_url: payload.file_path ?? payload.url,
              template: selectedTemplate,
              municipality_address: municipalityAddress.trim() || null,
              custom_notes: customNotes.trim() || null,
              round_label: roundLabel.trim() || null,
            });
            if (comments && comments.length > 0) {
              await saveCommentSnapshot(draftId, comments);
            }
            setActiveDraftId(draftId);
          }
        }

        toast.success("Response package exported");
        onOpenChange(false);
      } else {
        toast.error("Export succeeded but no download URL returned");
      }
    } catch (e) {
      console.warn("Export response package failed:", e);
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleMarkSubmitted = async () => {
    if (!activeDraftId) return;
    const success = await markAsSubmitted(activeDraftId);
    if (success) {
      toast.success("Round marked as submitted to city");
      await fetchDrafts();
    }
  };

  const hasBranding = branding && (branding.logo_url || branding.company_name || branding.company_address);
  const activeDraft = drafts.find((d) => d.id === activeDraftId);
  const canMarkSubmitted = activeDraft && activeDraft.status === "draft" && activeDraft.exported_pdf_url;

  const lastSubmittedDraft = [...drafts]
    .filter((d) => d.status === "submitted" && d.comment_snapshot)
    .sort((a, b) => b.round_number - a.round_number)[0] ?? null;

  const roundChanges: RoundChanges | null = (() => {
    if (!lastSubmittedDraft || !comments) return null;
    const commentsWithInfo = comments.map((c) => ({
      id: c.id,
      original_text: c.original_text ?? "",
      status: c.status ?? "",
      response_text: c.response_text,
    }));
    return computeRoundChanges(commentsWithInfo, lastSubmittedDraft);
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5 text-muted-foreground" />
            Export Response Package
          </DialogTitle>
          <DialogDescription>
            Choose a template and customize your export before generating the
            PDF. Save drafts and manage review rounds.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                variant={showDraftList ? "default" : "outline"}
                size="sm"
                onClick={() => setShowDraftList(!showDraftList)}
                data-testid="button-toggle-draft-list"
              >
                <History className="h-4 w-4 mr-1" />
                Rounds ({drafts.length})
              </Button>
              {activeDraft && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Round {activeDraft.round_number}
                  </span>
                  <DraftStatusBadge status={activeDraft.status} />
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNewRound}
              disabled={savingDraft}
              data-testid="button-new-round"
            >
              <Plus className="h-4 w-4 mr-1" />
              New Round
            </Button>
          </div>

          {showDraftList && (
            <div className="space-y-2">
              {loadingDrafts ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : drafts.length === 0 ? (
                <div className="border rounded-md p-4 bg-muted/20 text-center">
                  <p className="text-sm text-muted-foreground">
                    No drafts yet. Save a draft or start a new round.
                  </p>
                </div>
              ) : (
                <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                  {drafts.map((draft) => (
                    <div
                      key={draft.id}
                      className={cn(
                        "flex items-center justify-between gap-2 p-3 cursor-pointer hover-elevate",
                        activeDraftId === draft.id && "bg-emerald-500/5"
                      )}
                      onClick={() => loadDraftIntoForm(draft)}
                      data-testid={`card-draft-${draft.id}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-medium shrink-0">
                          Round {draft.round_number}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          {draft.round_label || `Review Round ${draft.round_number}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <DraftStatusBadge status={draft.status} />
                        {draft.exported_pdf_url && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="round-label" className="text-sm font-medium">
              Round Label
            </Label>
            <Input
              id="round-label"
              value={roundLabel}
              onChange={(e) => setRoundLabel(e.target.value)}
              placeholder="e.g. 1st Review, 2nd Review - Corrections"
              data-testid="input-round-label"
            />
          </div>

          <div className="space-y-3">
            <Label className="text-sm font-medium">Select Template</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {TEMPLATE_CONFIGS.map((tmpl) => {
                const Icon = TEMPLATE_ICONS[tmpl.icon] ?? FileText;
                const isSelected = selectedTemplate === tmpl.id;
                return (
                  <Card
                    key={tmpl.id}
                    className={cn(
                      "cursor-pointer p-4 transition-all",
                      isSelected
                        ? "ring-2 ring-emerald-500 bg-emerald-500/5"
                        : "hover-elevate"
                    )}
                    onClick={() => setSelectedTemplate(tmpl.id)}
                    data-testid={`card-template-${tmpl.id}`}
                  >
                    <div className="flex flex-col items-center text-center gap-2">
                      <div
                        className={cn(
                          "flex items-center justify-center w-10 h-10 rounded-md",
                          isSelected
                            ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{tmpl.name}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                          {tmpl.description}
                        </p>
                      </div>
                      {isSelected && (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
                        >
                          Selected
                        </Badge>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          {selectedTemplate === "letter" && (
            <div className="space-y-2">
              <Label
                htmlFor="municipality-address"
                className="text-sm font-medium"
              >
                Municipality Address (optional)
              </Label>
              <Textarea
                id="municipality-address"
                value={municipalityAddress}
                onChange={(e) => setMunicipalityAddress(e.target.value)}
                placeholder={"City Planning Department\n123 Government Ave\nCity, State ZIP"}
                rows={3}
                data-testid="input-municipality-address"
              />
              <p className="text-xs text-muted-foreground">
                Address block for the formal letter header. Leave blank to omit.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="custom-notes" className="text-sm font-medium">
              Cover Notes (optional)
            </Label>
            <Textarea
              id="custom-notes"
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              placeholder="Additional notes or cover letter body text..."
              rows={3}
              data-testid="input-custom-notes"
            />
          </div>

          {roundChanges && (
            <>
              <Separator />
              <RoundChangeSummary changes={roundChanges} />
            </>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Branding Preview</Label>
            </div>
            {loadingBranding ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : hasBranding ? (
              <div className="border rounded-md p-4 bg-muted/20 space-y-2">
                <div className="flex items-start gap-4 flex-wrap">
                  {branding?.logo_url && (
                    <div className="border rounded-md p-1 bg-background shrink-0">
                      <img
                        src={branding.logo_url}
                        alt="Company logo"
                        className="max-h-10 max-w-[140px] object-contain"
                        data-testid="img-export-logo-preview"
                      />
                    </div>
                  )}
                  <div className="space-y-1 min-w-0">
                    {branding?.company_name && (
                      <p className="text-sm font-medium" data-testid="text-branding-company-name">
                        {branding.company_name}
                      </p>
                    )}
                    {branding?.company_address && (
                      <p className="text-xs text-muted-foreground whitespace-pre-line">
                        {branding.company_address}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {branding?.company_phone && (
                        <span>{branding.company_phone}</span>
                      )}
                      {branding?.company_email && (
                        <span>{branding.company_email}</span>
                      )}
                      {branding?.company_website && (
                        <span>{branding.company_website}</span>
                      )}
                    </div>
                  </div>
                </div>
                {branding?.default_signoff && (
                  <p className="text-xs italic text-muted-foreground pt-1 border-t">
                    Sign-off: "{branding.default_signoff}"
                  </p>
                )}
              </div>
            ) : (
              <div className="border rounded-md p-4 bg-muted/20 flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-muted">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    No branding configured
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Set up your company branding in Settings to include your logo
                    and contact info in exports.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <div className="flex items-center gap-2 flex-1 flex-wrap">
            {canMarkSubmitted && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkSubmitted}
                data-testid="button-mark-submitted"
              >
                <Send className="h-4 w-4 mr-1" />
                Mark Submitted
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={exporting || savingDraft}
              data-testid="button-cancel-export"
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleSaveDraft}
              disabled={exporting || savingDraft}
              data-testid="button-save-draft"
            >
              {savingDraft ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save as Draft
            </Button>
            <Button
              onClick={() => handleExport(true)}
              disabled={exporting || savingDraft}
              data-testid="button-confirm-export"
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="mr-2 h-4 w-4" />
              )}
              Export & Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
