import { useEffect } from "react";
import { AIComplianceAnalyzer } from "@/components/compliance/AIComplianceAnalyzer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EditorialPageHeader } from "@/components/layout/EditorialPageHeader";
import { motion } from "framer-motion";
import { Helmet } from "react-helmet-async";
import { useGettingStarted } from "@/hooks/useGettingStarted";
import { Shield } from "lucide-react";

export default function CodeCompliance() {
  const { completeItem } = useGettingStarted();

  useEffect(() => {
    completeItem('check_compliance');
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
      
      <div className="min-h-full w-full bg-cream text-ink-primary-light">
        <EditorialPageHeader
          eyebrow="AI COMPLIANCE"
          align="center"
          title={
            <>
              <span className="italic text-gold">AI</span> Code Compliance Analyzer
            </>
          }
          description={
            <>
              Upload your architectural drawings and let AI analyze them for building code violations.{" "}
              Get instant feedback with specific code citations and suggested fixes.
            </>
          }
          icon={Shield}
          iconClassName="text-teal"
        />

        <div className="w-full max-w-4xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-6 sm:py-8 pb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
          >
            <div className="max-w-4xl ml-0 mr-auto">
              <ErrorBoundary fallbackTitle="Failed to load compliance analyzer">
                <AIComplianceAnalyzer />
              </ErrorBoundary>
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
}
