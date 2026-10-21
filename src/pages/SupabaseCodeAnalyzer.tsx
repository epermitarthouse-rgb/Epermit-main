import { Helmet } from "react-helmet-async";
import { ShieldCheck } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SupabaseCodeAnalyzer as Analyzer } from "@/components/compliance/SupabaseCodeAnalyzer";
import { PageHeader, ServicePill } from "@/components/design/ProductPrimitives";

export default function SupabaseCodeAnalyzer() {
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
          body="Analyze complete permit drawing sets sheet by sheet, track processing progress, and organize review observations and suggested references."
          action={
            <div className="flex items-center gap-2">
              <ServicePill kind="permit">Permit expediting</ServicePill>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-primary">
                <ShieldCheck className="h-4 w-4" />
              </span>
            </div>
          }
        />
        <ErrorBoundary fallbackTitle="Failed to load Code Analyzer">
          <Analyzer />
        </ErrorBoundary>
      </div>
    </>
  );
}
