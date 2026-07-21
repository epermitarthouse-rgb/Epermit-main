import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { PermitPilotShell } from "./components/permitpilot/PermitPilotShell";
import { ActiveProjectProvider } from "./state/activeProject";
import Login from "./pages/Login";
import Dashboard, { DashboardOverview } from "./pages/Dashboard";
import UciDashboard from "./pages/UciDashboard";
import Projects from "./pages/Projects";
import ProjectSetupCredentials from "./pages/ProjectSetupCredentials";
import MissionControl from "./pages/MissionControl";
import PermitQueue from "./pages/PermitQueue";
import ProjectWorkspace from "./pages/ProjectWorkspace";
import CommandCenter from "./pages/CommandCenter";
import Feasibility from "./pages/Feasibility";
import SiteFeasibility from "./pages/SiteFeasibility";
import ProjectTimeline from "./pages/ProjectTimeline";
import ProjectGantt from "./pages/ProjectGantt";
import CriticalPath from "./pages/CriticalPath";
import AgentCenter from "./pages/AgentCenter";
import Messages from "./pages/Messages";
import DocumentVault from "./pages/DocumentVault";
import UtilityMap from "./pages/UtilityMap";
import Compliance from "./pages/Compliance";
import ComplianceIntelligence from "./pages/ComplianceIntelligence";
import PlatformArchitecture from "./pages/PlatformArchitecture";
import ContentStudio from "./pages/ContentStudio";
import AdminConsole from "./pages/AdminConsole";
import AdminAuthorizations from "./pages/AdminAuthorizations";
import AdminMembers from "./pages/AdminMembers";
import AdminAuditLog from "./pages/AdminAuditLog";
import DemoMcDonalds from "./pages/DemoMcDonalds";
import OperationsBoard from "./pages/OperationsBoard";
import Settings from "./pages/Settings";
import MasterMatrix from "./pages/MasterMatrix";
import UnifiedMatrix from "./pages/UnifiedMatrix";
import GuidedFlow from "./pages/GuidedFlow";
import AiWorkflow from "./pages/AiWorkflow";
import ResponseMatrix from "./pages/ResponseMatrix";
import ComplianceAnalyzer from "./pages/ComplianceAnalyzer";
import InternalPrescreen from "./pages/InternalPrescreen";
import PortalHarvest from "./pages/PortalHarvest";
import RazePermit from "./pages/RazePermit";
import MobileSurvey from "./pages/MobileSurvey";
import MobileCamera from "./pages/MobileCamera";
import MobileMap from "./pages/MobileMap";
import FieldStudio from "./pages/FieldStudio";
import Sir from "./pages/Sir";
import SirWorkspace from "./pages/SirWorkspace";
import SirAnnex from "./pages/SirAnnex";
import SirExecutive from "./pages/SirExecutive";
import SirSync from "./pages/SirSync";
import SpecialInspections from "./pages/SpecialInspections";
import FinalInspections from "./pages/FinalInspections";
import Closeout from "./pages/Closeout";
import CloseoutArchive from "./pages/CloseoutArchive";
import CloseoutTracker from "./pages/CloseoutTracker";
import PostMortem from "./pages/PostMortem";
import PostMortemAnalytics from "./pages/PostMortemAnalytics";
import PostMortemFinancial from "./pages/PostMortemFinancial";
import AdminInvoicing from "./pages/AdminInvoicing";
import ReferenceLibrary from "./pages/ReferenceLibrary";
import UtilityCoverage from "./pages/UtilityCoverage";
import Glossary from "./pages/Glossary";
import Home from "./pages/Home";
import { RequireUciAccess } from "./components/RequireUciAccess";
import AdminPastPerformance from "./pages/AdminPastPerformance";
import AdminCrm from "./pages/AdminCrm";
import CrossUtilityConflictHunter from "./pages/CrossUtilityConflictHunter";
import EasementRowManager from "./pages/EasementRowManager";
import LoadProfileAnalyzer from "./pages/LoadProfileAnalyzer";
import UtilityProviderMap from "./pages/UtilityProviderMap";
import MeterSetChoreographer from "./pages/MeterSetChoreographer";
import LongLeadEquipment from "./pages/LongLeadEquipment";
import PredictiveScheduleImpact from "./pages/PredictiveScheduleImpact";
import InspectorReleaseTracker from "./pages/InspectorReleaseTracker";
import UciApplicationBuilder from "./pages/UciApplicationBuilder";
import UciSubmissions from "./pages/UciSubmissions";
import UciCommunications from "./pages/UciCommunications";
import UciClassOfService from "./pages/UciClassOfService";
import UciCiac from "./pages/UciCiac";
import UciEnergization from "./pages/UciEnergization";
import UciMissUtility from "./pages/UciMissUtility";
import UciKnowledgeGraph from "./pages/UciKnowledgeGraph";
import PortfolioExecutive from "./pages/PortfolioExecutive";
import MilestoneBilling from "./pages/MilestoneBilling";
import ChecklistHistory from "./pages/Checklists";
import Contact from "./pages/Contact";
import AdminEndpoints from "./pages/AdminEndpoints";
import Signup from "./pages/Signup";
import OnboardingAuthorization from "./pages/OnboardingAuthorization";
import { AuthProvider } from "./hooks/useAuth";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
         <ActiveProjectProvider>
         <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route element={<PermitPilotShell />}>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Dashboard />}>
              <Route index element={<DashboardOverview />} />
              <Route path="uci" element={<UciDashboard />} />
            </Route>
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/new" element={<ProjectSetupCredentials />} />
            <Route path="/projects/:id/timeline" element={<ProjectTimeline />} />
            <Route path="/projects/:id/gantt" element={<ProjectGantt />} />
            <Route path="/mission-control" element={<MissionControl />} />
            <Route path="/command-center" element={<CommandCenter />} />
            <Route path="/feasibility" element={<Feasibility />} />
            <Route path="/feasibility/site" element={<SiteFeasibility />} />
            <Route path="/critical-path" element={<CriticalPath />} />
            <Route path="/permit-queue" element={<PermitQueue />} />
            <Route path="/projects/alpha" element={<ProjectWorkspace />} />
            <Route path="/agents" element={<AgentCenter />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/documents" element={<DocumentVault />} />
            <Route path="/utility-map" element={<UtilityMap />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route path="/compliance/intelligence" element={<ComplianceIntelligence />} />
            <Route path="/architecture" element={<PlatformArchitecture />} />
            <Route path="/content-studio" element={<ContentStudio />} />
            <Route path="/admin" element={<AdminConsole />} />
            <Route path="/admin/authorizations" element={<AdminAuthorizations />} />
            <Route path="/admin/members" element={<AdminMembers />} />
            <Route path="/admin/audit" element={<AdminAuditLog />} />
            <Route path="/admin/invoicing" element={<AdminInvoicing />} />
            <Route path="/admin/past-performance" element={<AdminPastPerformance />} />
            <Route path="/admin/crm" element={<AdminCrm />} />
            <Route path="/admin/milestone-billing" element={<MilestoneBilling />} />
            <Route path="/portfolio/executive" element={<PortfolioExecutive />} />
            <Route path="/utility/conflict-hunter" element={<CrossUtilityConflictHunter />} />
            <Route path="/utility/easements" element={<EasementRowManager />} />
            <Route path="/utility/load-profile" element={<LoadProfileAnalyzer />} />
            <Route path="/utility/provider-map" element={<UtilityProviderMap />} />
            <Route path="/utility/meter-set" element={<MeterSetChoreographer />} />
            <Route path="/scheduling/long-lead" element={<LongLeadEquipment />} />
            <Route path="/scheduling/predictive-impact" element={<PredictiveScheduleImpact />} />
            <Route path="/inspections/release-tracker" element={<InspectorReleaseTracker />} />
            <Route path="/uci/application-builder" element={<RequireUciAccess><UciApplicationBuilder /></RequireUciAccess>} />
            <Route path="/uci/submissions" element={<RequireUciAccess><UciSubmissions /></RequireUciAccess>} />
            <Route path="/uci/communications" element={<RequireUciAccess><UciCommunications /></RequireUciAccess>} />
            <Route path="/uci/class-of-service" element={<RequireUciAccess><UciClassOfService /></RequireUciAccess>} />
            <Route path="/uci/ciac" element={<RequireUciAccess><UciCiac /></RequireUciAccess>} />
            <Route path="/uci/energization" element={<RequireUciAccess><UciEnergization /></RequireUciAccess>} />
            <Route path="/uci/miss-utility" element={<RequireUciAccess><UciMissUtility /></RequireUciAccess>} />
            <Route path="/uci/knowledge-graph" element={<RequireUciAccess><UciKnowledgeGraph /></RequireUciAccess>} />
            <Route path="/uci" element={<RequireUciAccess><UciDashboard /></RequireUciAccess>} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/matrix" element={<MasterMatrix />} />
            <Route path="/matrix/unified" element={<UnifiedMatrix />} />
            <Route path="/matrix/guided" element={<GuidedFlow />} />
            <Route path="/matrix/ai-workflow" element={<AiWorkflow />} />
            <Route path="/matrix/response" element={<ResponseMatrix />} />
            <Route path="/compliance/analyzer" element={<ComplianceAnalyzer />} />
            <Route path="/compliance/prescreen" element={<InternalPrescreen />} />
            <Route path="/portals/harvest" element={<PortalHarvest />} />
            <Route path="/raze" element={<RazePermit />} />
            <Route path="/mobile/survey" element={<MobileSurvey />} />
            <Route path="/mobile/camera" element={<MobileCamera />} />
            <Route path="/mobile/map" element={<MobileMap />} />
            <Route path="/field/studio" element={<FieldStudio />} />
            <Route path="/sir" element={<Sir />} />
            <Route path="/sir/workspace" element={<SirWorkspace />} />
            <Route path="/sir/annex" element={<SirAnnex />} />
            <Route path="/sir/executive" element={<SirExecutive />} />
            <Route path="/sir/sync" element={<SirSync />} />
            <Route path="/inspections/special" element={<SpecialInspections />} />
            <Route path="/inspections/final-co" element={<FinalInspections />} />
            <Route path="/closeout" element={<Closeout />} />
            <Route path="/closeout/archive" element={<CloseoutArchive />} />
            <Route path="/closeout/tracker" element={<CloseoutTracker />} />
            <Route path="/closeout/post-mortem" element={<PostMortem />} />
            <Route path="/closeout/post-mortem/analytics" element={<PostMortemAnalytics />} />
            <Route path="/closeout/post-mortem/financial" element={<PostMortemFinancial />} />
            <Route path="/reference" element={<ReferenceLibrary />} />
            <Route path="/reference/utility-coverage" element={<UtilityCoverage />} />
            <Route path="/reference/glossary" element={<Glossary />} />
            <Route path="/checklists" element={<ChecklistHistory />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/admin/endpoints" element={<AdminEndpoints />} />
            <Route path="/onboarding/authorization" element={<OnboardingAuthorization />} />
            <Route path="/delivery/authorization" element={<OnboardingAuthorization />} />
            <Route path="/demo/mcdonalds" element={<DemoMcDonalds />} />
            <Route path="/operations" element={<OperationsBoard />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
         </Routes>
         </ActiveProjectProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
