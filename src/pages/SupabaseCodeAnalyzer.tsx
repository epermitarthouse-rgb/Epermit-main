import { Helmet } from "react-helmet-async";
import { Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SupabaseCodeAnalyzer as Analyzer } from "@/components/compliance/SupabaseCodeAnalyzer";
import { PageHeader } from "@/components/design/ProductPrimitives";
import { isSupabaseAnalyzerEnabled } from "@/lib/supabaseAnalyzer/featureFlag";

export default function SupabaseCodeAnalyzer() {
  if (!isSupabaseAnalyzerEnabled()) {
    return <Navigate to="/code-compliance" replace />;
  }

  return (
    <>
      <Helmet>
        <title>Code Analyzer | PermitPilot</title>
        <meta
          name="description"
          content="Upload permit drawing sheets, track analysis progress, and review saved drawing observations."
        />
      </Helmet>
      <div className="space-y-6">
        <PageHeader
          eyebrow="Permit drawing review"
          title="Code Analyzer"
          body="Analyze complete permit drawing sets sheet by sheet, track progress, and organize review observations and code references."
        />
        <ErrorBoundary fallbackTitle="Failed to load Code Analyzer">
          <Analyzer />
        </ErrorBoundary>
      </div>
    </>
  );
}
