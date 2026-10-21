import { Helmet } from "react-helmet-async";
import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Shield } from "lucide-react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SupabaseCodeAnalyzer as Analyzer } from "@/components/compliance/SupabaseCodeAnalyzer";
import { PageHeader, ServicePill } from "@/components/design/ProductPrimitives";
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
          action={
            <div className="flex flex-wrap gap-2">
              <ServicePill kind="permit">Permit expediting</ServicePill>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-primary">
                <Shield className="h-4 w-4" />
              </span>
            </div>
          }
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <ErrorBoundary fallbackTitle="Failed to load Code Analyzer">
            <Analyzer />
          </ErrorBoundary>
        </motion.div>
      </div>
    </>
  );
}
