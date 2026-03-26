import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LeadCaptureProvider } from "@/contexts/LeadCaptureContext";
import { LeadCaptureModal } from "@/components/lead-capture/LeadCaptureModal";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { ProtectedLayoutRoute } from "@/components/auth/ProtectedRoute";
import { PublicOnlyRoute } from "@/components/auth/PublicOnlyRoute";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { MarketingLayout } from "@/components/layout/MarketingLayout";

import LandingPage from "./pages/LandingPage";
import Demos from "./pages/Demos";
import Pricing from "./pages/Pricing";
import Contact from "./pages/Contact";
import FAQ from "./pages/FAQ";
import Auth from "./pages/Auth";
import Install from "./pages/Install";
import ClientPortal from "./pages/ClientPortal";
import EmbedWidget from "./pages/EmbedWidget";
import NotFound from "./pages/NotFound";

import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import Analytics from "./pages/Analytics";
import AdminPanel from "./pages/AdminPanel";
import JurisdictionAdmin from "./pages/JurisdictionAdmin";
import FeatureFlagsAdmin from "./pages/FeatureFlagsAdmin";
import ShadowModeDashboard from "./pages/ShadowModeDashboard";
import JurisdictionComparison from "./pages/JurisdictionComparison";
import JurisdictionMapPage from "./pages/JurisdictionMapPage";
import PermitIntelligence from "./pages/PermitIntelligence";
import CodeCompliance from "./pages/CodeCompliance";
import CodeReferenceLibrary from "./pages/CodeReferenceLibrary";
import ROICalculator from "./pages/ROICalculator";
import ConsolidationCalculator from "./pages/ConsolidationCalculator";
import StateLandingPage from "./pages/StateLandingPage";
import MVPDocumentation from "./pages/MVPDocumentation";
import APIDocumentation from "./pages/APIDocumentation";
import ChecklistHistory from "./pages/ChecklistHistory";
import Settings from "./pages/Settings";
import CommentReview from "./pages/CommentReview";
import ResponseMatrix from "./pages/ResponseMatrix";
import PortalDataViewer from "./pages/PortalDataViewer";
import ClassifiedComments from "./pages/ClassifiedComments";
import PermitWizardFiling from "./pages/PermitWizardFiling";
import BaltimorePortalHome from "./pages/baltimore/BaltimorePortalHome";
import BaltimorePermitsPage from "./pages/baltimore/BaltimorePermitsPage";
import BaltimoreRecordsListPage from "./pages/baltimore/BaltimoreRecordsListPage";
import BaltimoreRecordDetailPage from "./pages/baltimore/BaltimoreRecordDetailPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <AuthProvider>
          <LeadCaptureProvider>
            <Toaster />
            <Sonner />
            <OfflineIndicator />
            <InstallPrompt />
            <LeadCaptureModal />
            <BrowserRouter>
              <Routes>
                <Route
                  path="/"
                  element={
                    <PublicOnlyRoute>
                      <LandingPage />
                    </PublicOnlyRoute>
                  }
                />
                <Route path="/auth" element={<Auth />} />
                <Route
                  path="/demos"
                  element={
                    <MarketingLayout>
                      <Demos />
                    </MarketingLayout>
                  }
                />
                <Route
                  path="/pricing"
                  element={
                    <MarketingLayout>
                      <Pricing />
                    </MarketingLayout>
                  }
                />
                <Route
                  path="/contact"
                  element={
                    <MarketingLayout>
                      <Contact />
                    </MarketingLayout>
                  }
                />
                <Route
                  path="/faq"
                  element={
                    <MarketingLayout>
                      <FAQ />
                    </MarketingLayout>
                  }
                />
                <Route path="/install" element={<Install />} />
                <Route path="/portal/:token" element={<ClientPortal />} />
                <Route path="/embed/:token" element={<EmbedWidget />} />

                <Route element={<ProtectedLayoutRoute />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/projects" element={<Projects />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/jurisdictions/compare" element={<JurisdictionComparison />} />
                  <Route path="/jurisdiction-comparison" element={<JurisdictionComparison />} />
                  <Route path="/jurisdictions/map" element={<JurisdictionMapPage />} />
                  <Route path="/jurisdictions/:stateCode" element={<StateLandingPage />} />
                  <Route path="/permit-intelligence" element={<PermitIntelligence />} />
                  <Route path="/code-compliance" element={<CodeCompliance />} />
                  <Route path="/code-reference" element={<CodeReferenceLibrary />} />
                  <Route path="/roi-calculator" element={<ROICalculator />} />
                  <Route path="/consolidation-calculator" element={<ConsolidationCalculator />} />
                  <Route path="/admin" element={<AdminLayout />}>
                    <Route index element={<AdminPanel />} />
                    <Route path="jurisdictions" element={<JurisdictionAdmin />} />
                    <Route path="feature-flags" element={<FeatureFlagsAdmin />} />
                    <Route path="shadow-mode" element={<ShadowModeDashboard />} />
                  </Route>
                  <Route path="/mvp-documentation" element={<MVPDocumentation />} />
                  <Route path="/api-docs" element={<APIDocumentation />} />
                  <Route path="/checklist-history" element={<ChecklistHistory />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/comment-review" element={<CommentReview />} />
                  <Route path="/response-matrix" element={<ResponseMatrix />} />
                  <Route path="/classified-comments" element={<ClassifiedComments />} />
                  <Route path="/portal-data" element={<PortalDataViewer />} />
                  <Route path="/permit-wizard-filing" element={<PermitWizardFiling />} />
                  {/* Baltimore Accela portal clone (UI only, mock data) */}
                  <Route path="/baltimore" element={<BaltimorePortalHome />} />
                  <Route path="/baltimore/permits" element={<BaltimorePermitsPage />} />
                  <Route path="/baltimore/records" element={<BaltimoreRecordsListPage />} />
                  <Route path="/baltimore/records/:recordId" element={<BaltimoreRecordDetailPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </LeadCaptureProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
