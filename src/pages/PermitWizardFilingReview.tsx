import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import { formatPermitFilingError } from "@/lib/permitFilingErrors";
import { FilingReviewPanel, type ReviewFiling } from "@/components/permit-wizard/FilingReviewPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageHeader } from "@/components/design/ProductPrimitives";
import { Button } from "@/components/ui/button";
import { PERMIT_FILING_BETA_LABEL, PERMIT_FILING_PREFLIGHT_ENABLED } from "@/components/permit-wizard/permitFilingWip";
import { Badge } from "@/components/ui/badge";

export default function PermitWizardFilingReview() {
  const { filingId } = useParams<{ filingId: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { setSelectedProjectId } = useSelectedProject();
  const [filing, setFiling] = useState<ReviewFiling | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchFiling = useCallback(async () => {
    if (!user || !filingId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const { data, error } = await supabase
        .from("permit_filings")
        .select("*")
        .eq("id", filingId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setFiling(null);
        setLoadError("Filing not found or you do not have access to this review.");
        return;
      }

      setFiling(data as ReviewFiling);
      if (data.project_id) {
        setSelectedProjectId(data.project_id);
      }
    } catch (err) {
      console.error("Failed to load filing review:", err);
      setFiling(null);
      setLoadError(formatPermitFilingError(err, "Unable to load filing review"));
    } finally {
      setLoading(false);
    }
  }, [user, filingId, setSelectedProjectId]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    void fetchFiling();
  }, [fetchFiling]);

  const handleBack = useCallback(() => {
    const params = new URLSearchParams();
    if (filing?.project_id) params.set("projectId", filing.project_id);
    if (filing?.id) params.set("filingId", filing.id);
    const query = params.toString();
    navigate(query ? `/permit-wizard-filing?${query}` : "/permit-wizard-filing");
  }, [navigate, filing?.project_id, filing?.id]);

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Permit Filing"
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            Pre-Submission Review
            {PERMIT_FILING_PREFLIGHT_ENABLED && (
              <Badge
                variant="outline"
                className="align-middle text-sm font-semibold border-primary/40 bg-primary/10 text-primary"
              >
                {PERMIT_FILING_BETA_LABEL}
              </Badge>
            )}
          </span>
        }
        description="Inspect the Pre-Flight approval package. Approve and portal submission remain gated until automated filing is production-ready."
      />

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={handleBack} data-testid="button-back-to-permit-filing">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Permit Filing
        </Button>
      </div>

      {loadError && !loading ? (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center space-y-4">
          <ClipboardCheck className="mx-auto h-12 w-12 text-destructive" />
          <div>
            <h3 className="font-semibold text-lg">Unable to load filing review</h3>
            <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">{loadError}</p>
          </div>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button variant="outline" onClick={handleBack}>
              Back to Permit Filing
            </Button>
            <Button onClick={() => void fetchFiling()} data-testid="button-retry-review-load">
              Retry
            </Button>
          </div>
        </div>
      ) : (
        <ErrorBoundary fallbackTitle="Unable to load filing review" onRetry={fetchFiling}>
          <FilingReviewPanel filing={filing} isLoading={loading} onBack={handleBack} />
        </ErrorBoundary>
      )}
    </div>
  );
}
