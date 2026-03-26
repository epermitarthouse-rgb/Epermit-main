import { useEffect } from "react";
import { AIComplianceAnalyzer } from "@/components/compliance/AIComplianceAnalyzer";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { motion } from "framer-motion";
import { Helmet } from "react-helmet-async";
import { useGettingStarted } from "@/hooks/useGettingStarted";

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
      
      <div className="w-full max-w-4xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-6 sm:py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="max-w-4xl ml-0 mr-auto">
            <div className="text-center mb-8">
              <h1 className="text-3xl md:text-4xl font-bold mb-4">
                AI Code Compliance Analyzer
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Upload your architectural drawings and let AI analyze them for building code violations. 
                Get instant feedback with specific code citations and suggested fixes.
              </p>
            </div>
            
            <ErrorBoundary fallbackTitle="Failed to load compliance analyzer">
              <AIComplianceAnalyzer />
            </ErrorBoundary>
          </div>
        </motion.div>
      </div>
    </>
  );
}
