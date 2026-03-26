import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { HeroSection } from "@/components/home/HeroSection";
import { ProductTourSection } from "@/components/home/ProductTourSection";
import { MarketDataSection } from "@/components/home/MarketDataSection";
import { WorkflowStepsSection } from "@/components/home/WorkflowStepsSection";
import { AIToolsSection } from "@/components/home/AIToolsSection";
import { LifecycleToolsSection } from "@/components/home/LifecycleToolsSection";
import { PersonaSection } from "@/components/home/PersonaSection";
import { TestimonialsSection } from "@/components/home/TestimonialsSection";
import { CaseStudiesSection } from "@/components/home/CaseStudiesSection";
import { HomeROICalculator } from "@/components/home/HomeROICalculator";
import { CompetitiveAnalysisSection } from "@/components/home/CompetitiveAnalysisSection";
import { FAQSection } from "@/components/home/FAQSection";
import { SocialProofSection } from "@/components/home/SocialProofSection";
import JurisdictionCoverageMap from "@/components/home/JurisdictionCoverageMap";
import { JurisdictionSearchWidget } from "@/components/home/JurisdictionSearchWidget";
import { CTASection } from "@/components/home/CTASection";
import { PageTransition } from "@/components/animations/PageTransition";
import { ScrollToTop } from "@/components/ui/ScrollToTop";
import { ScrollProgress } from "@/components/ui/ScrollProgress";

const Index = () => {
  const location = useLocation();

  // Handle hash-based navigation for smooth scrolling
  useEffect(() => {
    if (location.hash) {
      const sectionId = location.hash.replace("#", "");
      setTimeout(() => {
        const element = document.getElementById(sectionId);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 100);
    }
  }, [location.hash]);

  return (
    <Layout>
      <ScrollProgress />
      <PageTransition>
        <HeroSection />
        <div id="social-proof">
          <SocialProofSection />
        </div>
        <div id="search">
          <JurisdictionSearchWidget />
        </div>
        <div id="market-data">
          <MarketDataSection />
        </div>
        <div id="coverage-map">
          <JurisdictionCoverageMap />
        </div>
        <div id="comparison">
          <CompetitiveAnalysisSection />
        </div>
        <div id="product-tour">
          <ProductTourSection />
        </div>
        <div id="roi-calculator">
          <HomeROICalculator />
        </div>
        <div id="how-it-works">
          <WorkflowStepsSection />
        </div>
        <div id="ai-tools">
          <AIToolsSection />
        </div>
        <div id="lifecycle">
          <LifecycleToolsSection />
        </div>
        <div id="personas">
          <PersonaSection />
        </div>
        <div id="case-studies">
          <CaseStudiesSection />
        </div>
        <div id="testimonials">
          <TestimonialsSection />
        </div>
        <div id="faq">
          <FAQSection />
        </div>
        <div id="cta">
          <CTASection />
        </div>
      </PageTransition>
      <ScrollToTop />
    </Layout>
  );
};

export default Index;
