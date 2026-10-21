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
        <title>Code Analyzer V2 | PermitPilot</title>
        <meta
          name="description"
          content="Evidence-grounded Code Analyzer V2 with structured drawing extraction, Code RAG, independent verification, and reviewer learning."
        />
      </Helmet>

      <div className="space-y-6">
        <PageHeader
          eyebrow="Evidence-grounded review"
          title="Code Analyzer V2"
          body="PermitPilot's six-layer analyzer with structured drawing extraction, hybrid Code RAG, specialized review, independent verification, and reviewer learning."
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
          <ErrorBoundary fallbackTitle="Failed to load compliance analyzer">
            <AIComplianceAnalyzer />
          </ErrorBoundary>
        </motion.div>
      </div>
    </>
  );
}
