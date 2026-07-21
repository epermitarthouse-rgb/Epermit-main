import { useEffect } from "react";
import { AIComplianceAnalyzer } from "@/components/compliance/AIComplianceAnalyzer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageHeader, ServicePill } from "@/components/design/ProductPrimitives";
import { motion } from "framer-motion";
import { Helmet } from "react-helmet-async";
import { useGettingStarted } from "@/hooks/useGettingStarted";
import { Shield } from "lucide-react";

export default function CodeCompliance() {
  const { completeItem } = useGettingStarted();

  useEffect(() => {
    completeItem("check_compliance");
  }, [completeItem]);

  return (
    <>
      <Helmet>
        <title>AI Code Compliance Check | PermitPulse</title>
        <meta
          name="description"
          content="Analyze architectural drawings for building code violations using AI. Get instant compliance checks with code citations and suggested fixes."
        />
      </Helmet>

      <div className="space-y-6">
        <PageHeader
          eyebrow="Code Compliance Analyzer"
          title="AI Code Compliance Analyzer"
          body="Upload architectural drawings and analyze them for building code violations. Get feedback with code citations and suggested fixes — powered by live PermitPilot analysis, not mock findings."
          action={
            <div className="flex flex-wrap gap-2">
              <ServicePill kind="permit">Permit expediting</ServicePill>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-primary">
                <Shield className="h-4 w-4" />
              </span>
            </div>
          }
        />

        <div className="pilot-card p-4 sm:p-6">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <ErrorBoundary fallbackTitle="Failed to load compliance analyzer">
              <AIComplianceAnalyzer />
            </ErrorBoundary>
          </motion.div>
        </div>
      </div>
    </>
  );
}
