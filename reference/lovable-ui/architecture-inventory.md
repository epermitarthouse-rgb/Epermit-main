# Architecture Inventory

_Hand-curated documentation of every route, page, entry point, and functional surface. Cross-checked against `src/App.tsx`, `src/components/permitpilot/data.ts`, and `src/pages/*`. Audited 2026-07-24; feat IA snapshot 2026-08-05. Mirror of `/architecture-inventory` (`src/pages/ArchitectureInventory.tsx`)._

## Summary

| Metric | Count |
|---|---:|
| Total rows | 90 |
| Declared routes | 89 |
| Unique page files | 89 |
| Nested routes | 3 |
| Dynamic routes | 2 |
| Redirects/aliases | 2 |
| Public pages | 4 |
| Auth-required pages | 85 |
| Admin/staff pages | 10 |
| Role-gated pages | 9 |
| Direct-URL-only pages | 42 |
| Always-visible in sidebar | 26 |
| Status: Working | 16 |
| Status: Partial | 4 |
| Status: Mock | 65 |
| Status: Placeholder | 5 |
| Backend: Fully connected | 8 |
| Backend: Partially connected | 3 |
| Backend: UI only | 16 |
| Pages with modals | 8 |
| Pages with tabs | 5 |

## Main Table

| Area | Parent | Name | Route | Type | Params | Entry Points | Secondary Entries | Auth | Context | Purpose | Functionality | Actions | Tabs | Modals | Data Source | Backend | Status | Visibility | Source File | Route File | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Public | — | Home | / | static | none | sidebar → Help & Support › Pricing & Overview; header → Home; direct URL | logo click | public | none | Marketing / landing | Product overview and CTAs | navigate | — | Contact form | static | UI only | Working | always visible | src/pages/Home.tsx | src/App.tsx | Rendered inside PermitPilotShell. |
| Public | — | Login | /login | static | none | auth redirect; direct URL | sign-out flow | public | none | Sign in | Email/password + rejection reason surfacing | submit | — | — | Supabase | Fully connected | Working | always visible | src/pages/Login.tsx | src/App.tsx | Blocks rejected members with toast. |
| Public | — | Sign up | /signup | static | none | Login → Sign up link | direct URL | public | none | Register / request access | Creates auth user pending admin approval | submit | — | — | Supabase | Fully connected | Working | always visible | src/pages/Signup.tsx | src/App.tsx | Not linked from sidebar. |
| Public | — | Contact | /contact | static | none | Home CTA | direct URL | public | none | Inbound contact | Submits to contact_submissions + edge fn send-contact-email | submit | — | — | Supabase + edge function | Fully connected | Working | direct URL only | src/pages/Contact.tsx | src/App.tsx | Not in sidebar. |
| Command | — | Dashboard (layout) | /dashboard | nested | ?project= | sidebar → Command › Dashboard; header → Home | unmatched-route redirect | signed-in | optional selected project | Portfolio overview shell | Renders tabs (Operations/UCI) and outlet | navigate, filter | Operations (index), Utility Coordination (uci) | New Workflow (via header) | static mock | Mock | Mock | always visible | src/pages/Dashboard.tsx | src/App.tsx | Fallback destination for '*'. |
| Command | Dashboard | Dashboard · Operations | /dashboard (index) | nested | none | Dashboard tab | direct URL | signed-in | optional selected project | KPI + portfolio table | View KPIs, alerts, project rows | view only, navigate | — | — | static mock | Mock | Mock | always visible | src/pages/Dashboard.tsx (DashboardOverview) | src/App.tsx | Fabricated demo data. |
| Command | Dashboard | Dashboard · UCI | /dashboard/uci | nested | none | Dashboard tab → Utility Coordination | direct URL | signed-in | none | UCI overview inside dashboard | View UCI KPIs | view only | — | — | static mock | Mock | Mock | always visible | src/pages/UciDashboard.tsx | src/App.tsx | Same component as /uci but NOT role-gated here. |
| Command | — | Projects | /projects | static | none | sidebar → Command › Projects | dashboard link | signed-in | none | Project list | Browse mock project cards | navigate | — | — | static mock | Mock | Mock | always visible | src/pages/Projects.tsx | src/App.tsx |  |
| Command | Projects | New Project (Portal Credentials) | /projects/new | static | none | Projects → New | direct URL | signed-in | none | Onboard project + portal creds | Enter credentials | create | — | — | local state | UI only | Placeholder | direct URL only | src/pages/ProjectSetupCredentials.tsx | src/App.tsx |  |
| Command | Projects | Project Timeline | /projects/:id/timeline | dynamic | :id | Project Workspace → Timeline | direct URL | signed-in | selected project (:id) | Milestone timeline | View milestones | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/ProjectTimeline.tsx | src/App.tsx |  |
| Command | Projects | Project Gantt | /projects/:id/gantt | dynamic | :id | Project Workspace → Gantt | direct URL | signed-in | selected project (:id) | Gantt chart view | View schedule | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/ProjectGantt.tsx | src/App.tsx |  |
| Command | Projects | Project Workspace (Alpha) | /projects/alpha | static | none | CommandCenter → Open project | direct URL | signed-in | hard-coded 'alpha' project | Single project workspace demo | View project tabs | navigate | — | — | static mock | Mock | Mock | direct URL only | src/pages/ProjectWorkspace.tsx | src/App.tsx | No dynamic route for arbitrary project ids. |
| Command | — | Mission Control | /mission-control | static | none | direct URL | — | signed-in | none | Master ops dashboard | View operations | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/MissionControl.tsx | src/App.tsx |  |
| Command | — | Command Center | /command-center | static | none | direct URL | — | signed-in | none | Executive command dashboard | Navigate to project workspace | navigate | — | — | static mock | Mock | Mock | direct URL only | src/pages/CommandCenter.tsx | src/App.tsx |  |
| Command | — | Permit Queue | /permit-queue | static | none | sidebar → Command › Permit Queue | direct URL | signed-in | none | Filing queue | Browse permits | view only | — | — | static mock | Mock | Mock | always visible | src/pages/PermitQueue.tsx | src/App.tsx | Sidebar shows badge 18. |
| Command | — | Critical Path | /critical-path | static | none | direct URL | — | signed-in | none | Critical-path analysis | View chart | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/CriticalPath.tsx | src/App.tsx |  |
| Command | — | Feasibility | /feasibility | static | none | direct URL | — | signed-in | none | Phase-0 feasibility | Overview cards | navigate | — | — | static mock | Mock | Mock | direct URL only | src/pages/Feasibility.tsx | src/App.tsx |  |
| Command | Feasibility | Site Feasibility | /feasibility/site | static | none | Feasibility → Site | direct URL | signed-in | none | Site analysis | Interactive scoring | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/SiteFeasibility.tsx | src/App.tsx |  |
| Onboarding | — | Client Authorization (LOA) | /onboarding/authorization | static | none | sidebar → Onboarding › Client Authorization (LOA) | /delivery/authorization (aliased) | signed-in client | none | Sign LOA | Typed/drawn signature → PDF + storage | create, submit | — | Signature dialog | Supabase + Storage | Fully connected | Working | always visible | src/pages/OnboardingAuthorization.tsx | src/App.tsx |  |
| Delivery | — | Client Authorization (LOA) | /delivery/authorization | redirect | none | sidebar → Delivery › Client Authorization (LOA) | direct URL | signed-in client | none | Alias of onboarding LOA | Sign LOA | create, submit | — | — | Supabase | Fully connected | Working | always visible | src/pages/OnboardingAuthorization.tsx | src/App.tsx | Duplicate route alias — inconsistency risk. |
| Delivery | — | Operations Board | /operations | static | none | sidebar → Delivery › Operations Board | direct URL | signed-in | none | Monday-style board | Task groups | view only, filter | Reimbursables, Scope & Pricing, PM Workflows | — | static mock | Mock | Mock | always visible | src/pages/OperationsBoard.tsx | src/App.tsx |  |
| Delivery | — | Permit Filing (Guided Flow) | /matrix/guided | static | none | sidebar → Delivery › Permit Filing | direct URL | signed-in | none | Guided filing wizard | Step through packet | submit | steps | — | static mock | Mock | Mock | always visible | src/pages/GuidedFlow.tsx | src/App.tsx |  |
| Delivery | — | Response Matrix | /matrix/response | static | none | sidebar → Delivery › Response Matrix | direct URL | signed-in | none | Comment reconciliation | Draft/respond | edit | — | — | static mock | Mock | Mock | always visible | src/pages/ResponseMatrix.tsx | src/App.tsx |  |
| Delivery | — | Portal Harvest | /portals/harvest | static | none | sidebar → Delivery › Portal Harvest | direct URL | signed-in | none | Portal scraping status | View harvest runs | view only | — | — | static mock | Mock | Mock | always visible | src/pages/PortalHarvest.tsx | src/App.tsx |  |
| Delivery | — | Master Matrix | /matrix | static | none | direct URL | — | signed-in | none | Umbrella matrix | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/MasterMatrix.tsx | src/App.tsx |  |
| Delivery | Matrix | Unified Matrix | /matrix/unified | static | none | direct URL | — | signed-in | none | Unified task matrix | View grouped tasks | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/UnifiedMatrix.tsx | src/App.tsx |  |
| Delivery | Matrix | AI Workflow | /matrix/ai-workflow | static | none | header → New Workflow button | direct URL | signed-in | none | AI-orchestrated workflow lanes | Create/manage lanes | create, edit | lanes | New Workflow dialog | local state + localStorage | UI only | Partial | direct URL only | src/pages/AiWorkflow.tsx | src/App.tsx | Persists to localStorage only. |
| Delivery | — | Raze Permit | /raze | static | none | direct URL | — | signed-in | none | Demolition permit workflow | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/RazePermit.tsx | src/App.tsx |  |
| Intelligence | — | DesignCheck (Compliance) | /compliance | static | none | sidebar → Intelligence › DesignCheck | direct URL | signed-in | none | Compliance overview | View findings | view only | — | — | static mock | Mock | Mock | always visible | src/pages/Compliance.tsx | src/App.tsx | Sidebar badge 8. |
| Intelligence | Compliance | Compliance Intelligence | /compliance/intelligence | static | none | direct URL | — | signed-in | none | Scoring dashboard | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/ComplianceIntelligence.tsx | src/App.tsx |  |
| Intelligence | Compliance | Code Analyzer | /compliance/analyzer | static | none | sidebar → Intelligence › Code Analyzer | direct URL | signed-in | none | Upload drawings for AI analysis | Upload, presets, edit notes, run analysis | upload, create, edit, delete, export | — | Preset notes editor | Supabase edge function analyze-compliance-drawings | Partially connected | Partial | always visible | src/pages/ComplianceAnalyzer.tsx | src/App.tsx | Presets persist locally. |
| Intelligence | Compliance | Internal Prescreen | /compliance/prescreen | static | none | direct URL | — | staff/admin | none | Staff prescreen | Review | review | — | — | static mock | Mock | Mock | direct URL only | src/pages/InternalPrescreen.tsx | src/App.tsx |  |
| Intelligence | — | Agent Center | /agents | static | none | direct URL | — | signed-in | none | AI agent registry | View agents | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/AgentCenter.tsx | src/App.tsx |  |
| Intelligence | — | Document Vault | /documents | static | none | direct URL | — | signed-in | none | Document library | Browse files | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/DocumentVault.tsx | src/App.tsx |  |
| Intelligence | — | Content Studio | /content-studio | static | none | direct URL | — | signed-in | none | Content authoring | Compose | edit | — | — | local state | UI only | Placeholder | direct URL only | src/pages/ContentStudio.tsx | src/App.tsx |  |
| Intelligence | — | Platform Architecture | /architecture | static | none | direct URL | — | signed-in | none | Architecture reference | View diagrams | view only | — | — | static | UI only | Working | direct URL only | src/pages/PlatformArchitecture.tsx | src/App.tsx | Different from /architecture-inventory. |
| Utility Coordination | — | UCI Hub | /uci | static | none | sidebar → Intelligence › Utility Coordination | dashboard/uci tab | role-gated (admin/staff/client) | none | UCI landing | View UCI KPIs | navigate | — | — | static mock | Mock | Mock | role-based | src/pages/UciDashboard.tsx (via RequireUciAccess) | src/App.tsx | Same component reused at /dashboard/uci unguarded. |
| Utility Coordination | UCI | UCI · Submissions | /uci/submissions | static | none | sidebar → Intelligence › UCI · Submissions | direct URL | role-gated | none | Submission tracker | View submissions | view only | — | — | static mock | Mock | Mock | role-based | src/pages/UciSubmissions.tsx | src/App.tsx |  |
| Utility Coordination | UCI | UCI · Inbox / Communications | /uci/communications | static | none | sidebar → Intelligence › UCI · Inbox | direct URL | role-gated | none | Utility comms inbox | View messages | view only | — | — | static mock | Mock | Mock | role-based | src/pages/UciCommunications.tsx | src/App.tsx |  |
| Utility Coordination | UCI | UCI · Class of Service | /uci/class-of-service | static | none | sidebar → Intelligence › UCI · Class of Service | direct URL | role-gated | none | Class-of-service catalog | Browse | view only | — | — | static mock | Mock | Mock | role-based | src/pages/UciClassOfService.tsx | src/App.tsx |  |
| Utility Coordination | UCI | UCI · CIAC & Refunds | /uci/ciac | static | none | sidebar → Intelligence › UCI · CIAC & Refunds | direct URL | role-gated | none | CIAC deposits | Browse | view only | — | — | static mock | Mock | Mock | role-based | src/pages/UciCiac.tsx | src/App.tsx |  |
| Utility Coordination | UCI | UCI · Energization | /uci/energization | static | none | sidebar → Intelligence › UCI · Energization | direct URL | role-gated | none | Energization tracking | View | view only | — | — | static mock | Mock | Mock | role-based | src/pages/UciEnergization.tsx | src/App.tsx |  |
| Utility Coordination | UCI | UCI · Miss Utility 811 | /uci/miss-utility | static | none | sidebar → Intelligence › UCI · Miss Utility 811 | direct URL | admin/staff only | none | 811 tickets | View | view only | — | — | static mock | Mock | Mock | role-based | src/pages/UciMissUtility.tsx | src/App.tsx |  |
| Utility Coordination | UCI | UCI · Knowledge Graph | /uci/knowledge-graph | static | none | sidebar → Intelligence › UCI · Knowledge Graph | direct URL | admin/staff only | none | Utility knowledge graph | Explore graph | view only | — | — | static mock | Mock | Mock | role-based | src/pages/UciKnowledgeGraph.tsx | src/App.tsx |  |
| Utility Coordination | UCI | UCI Application Builder | /uci/application-builder | static | none | sidebar → Intelligence › UCI Builder | direct URL | admin/staff only | none | Assemble UCI packet | Compose fields | create, edit | — | — | local state | UI only | Placeholder | role-based | src/pages/UciApplicationBuilder.tsx | src/App.tsx |  |
| Utility Coordination | — | Jurisdiction Map | /utility-map | static | none | sidebar → Intelligence › Jurisdiction Map | direct URL | signed-in | none | Utility map view | Explore map | view only | — | — | static | Mock | Mock | always visible | src/pages/UtilityMap.tsx | src/App.tsx |  |
| Utility Coordination | — | Provider Compare | /utility/provider-map | static | none | sidebar → Intelligence › Provider Compare | direct URL | signed-in | none | Provider comparison | Compare providers | filter | — | — | src/data/utilityProviders.ts + edge fn utility-recommendations | Partially connected | Partial | always visible | src/pages/UtilityProviderMap.tsx | src/App.tsx |  |
| Utility Coordination | — | Cross-Utility Conflict Hunter | /utility/conflict-hunter | static | none | direct URL | — | signed-in | none | Conflict detection | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/CrossUtilityConflictHunter.tsx | src/App.tsx |  |
| Utility Coordination | — | Easement / ROW Manager | /utility/easements | static | none | direct URL | — | signed-in | none | Easement tracking | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/EasementRowManager.tsx | src/App.tsx |  |
| Utility Coordination | — | Load Profile Analyzer | /utility/load-profile | static | none | direct URL | — | signed-in | none | Load analysis | Analyze load | upload, view | — | — | local state + Supabase | Partially connected | Partial | direct URL only | src/pages/LoadProfileAnalyzer.tsx | src/App.tsx | Has vitest coverage. |
| Utility Coordination | — | Meter Set Choreographer | /utility/meter-set | static | none | direct URL | — | signed-in | none | Meter set sequencing | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/MeterSetChoreographer.tsx | src/App.tsx |  |
| Utility Coordination | — | Long-Lead Equipment | /scheduling/long-lead | static | none | direct URL | — | signed-in | none | Equipment ETA tracker | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/LongLeadEquipment.tsx | src/App.tsx |  |
| Utility Coordination | — | Predictive Schedule Impact | /scheduling/predictive-impact | static | none | direct URL | — | signed-in | none | Schedule risk model | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/PredictiveScheduleImpact.tsx | src/App.tsx |  |
| Utility Coordination | — | Inspector Release Tracker | /inspections/release-tracker | static | none | direct URL | — | signed-in | none | Inspection release status | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/InspectorReleaseTracker.tsx | src/App.tsx |  |
| Utility Coordination | — | Special Inspections | /inspections/special | static | none | direct URL | — | signed-in | none | Special inspection log | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/SpecialInspections.tsx | src/App.tsx |  |
| Utility Coordination | — | Final CO Inspections | /inspections/final-co | static | none | direct URL | — | signed-in | none | Final CO tracking | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/FinalInspections.tsx | src/App.tsx |  |
| Field | — | SIR | /sir | static | none | direct URL | — | signed-in | none | Site Investigation Report | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/Sir.tsx | src/App.tsx |  |
| Field | SIR | SIR Workspace | /sir/workspace | static | none | direct URL | — | signed-in | none | Workspace | Edit report | edit | — | — | static mock | Mock | Mock | direct URL only | src/pages/SirWorkspace.tsx | src/App.tsx |  |
| Field | SIR | SIR Annex | /sir/annex | static | none | direct URL | — | signed-in | none | Annex sections | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/SirAnnex.tsx | src/App.tsx |  |
| Field | SIR | SIR Executive | /sir/executive | static | none | direct URL | — | signed-in | none | Executive rollup | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/SirExecutive.tsx | src/App.tsx |  |
| Field | SIR | SIR Sync | /sir/sync | static | none | direct URL | — | signed-in | none | Sync field evidence | Sync | submit | — | — | static mock | Mock | Mock | direct URL only | src/pages/SirSync.tsx | src/App.tsx |  |
| Field | — | Field Studio | /field/studio | static | none | direct URL | — | signed-in | none | Field content authoring | Edit | edit | — | — | static mock | Mock | Mock | direct URL only | src/pages/FieldStudio.tsx | src/App.tsx |  |
| Field | — | Mobile Survey | /mobile/survey | static | none | direct URL | — | signed-in | none | Mobile survey entry | Enter data | create | — | — | local state | UI only | Mock | mobile only | src/pages/MobileSurvey.tsx | src/App.tsx |  |
| Field | — | Mobile Camera | /mobile/camera | static | none | direct URL | — | signed-in | none | Photo capture | Capture | upload | — | — | local state | UI only | Mock | mobile only | src/pages/MobileCamera.tsx | src/App.tsx |  |
| Field | — | Mobile Map | /mobile/map | static | none | direct URL | — | signed-in | none | Mobile map | View | view only | — | — | static | UI only | Mock | mobile only | src/pages/MobileMap.tsx | src/App.tsx |  |
| Closeout | — | Closeout | /closeout | static | none | direct URL | — | signed-in | none | Project closeout hub | View | navigate | — | — | static mock | Mock | Mock | direct URL only | src/pages/Closeout.tsx | src/App.tsx |  |
| Closeout | Closeout | Closeout Archive | /closeout/archive | static | none | direct URL | — | signed-in | none | Archive | Browse | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/CloseoutArchive.tsx | src/App.tsx |  |
| Closeout | Closeout | Closeout Tracker | /closeout/tracker | static | none | direct URL | — | signed-in | none | Closeout tracker | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/CloseoutTracker.tsx | src/App.tsx |  |
| Closeout | Closeout | Post-Mortem | /closeout/post-mortem | static | none | direct URL | — | signed-in | none | Post-mortem hub | View | navigate | — | — | static mock | Mock | Mock | direct URL only | src/pages/PostMortem.tsx | src/App.tsx |  |
| Closeout | Post-Mortem | Post-Mortem Analytics | /closeout/post-mortem/analytics | static | none | direct URL | — | signed-in | none | Analytics | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/PostMortemAnalytics.tsx | src/App.tsx |  |
| Closeout | Post-Mortem | Post-Mortem Financial | /closeout/post-mortem/financial | static | none | direct URL | — | signed-in | none | Financial impact | View | view only | — | — | static mock | Mock | Mock | direct URL only | src/pages/PostMortemFinancial.tsx | src/App.tsx |  |
| Resources | — | Checklists | /checklists | static | none | sidebar → Resources › Checklists | direct URL | signed-in | none | Checklist history | View | view only | — | — | static mock | Mock | Mock | always visible | src/pages/Checklists.tsx | src/App.tsx |  |
| Resources | — | Reference Library | /reference | static | none | sidebar → Resources › Reference Library; Help & Support › Documentation | direct URL | signed-in | none | Reference hub | Browse docs | navigate | — | — | static | UI only | Working | always visible | src/pages/ReferenceLibrary.tsx | src/App.tsx |  |
| Resources | Reference | Utility Coverage | /reference/utility-coverage | static | none | sidebar → Resources › Utility Coverage | direct URL | signed-in | none | Provider coverage matrix | Browse | view only | — | — | src/data/utilityProviders.ts | UI only | Working | always visible | src/pages/UtilityCoverage.tsx | src/App.tsx | Reference data with caveat. |
| Resources | Reference | Glossary | /reference/glossary | static | none | sidebar → Resources › Glossary | direct URL | signed-in | none | Terminology | Search terms | filter | — | — | static | UI only | Working | always visible | src/pages/Glossary.tsx | src/App.tsx |  |
| Resources | — | Analytics & Reporting | /portfolio/executive | static | none | sidebar → Resources › Analytics & Reporting | direct URL | signed-in | none | Executive portfolio KPIs | View charts | view only | — | — | static mock | Mock | Mock | always visible | src/pages/PortfolioExecutive.tsx | src/App.tsx |  |
| Resources | — | Messages | /messages | static | none | sidebar → Resources › Messages; Help & Support › Support | direct URL | signed-in | none | Message threads | View messages | view only | — | — | static mock | Mock | Mock | always visible | src/pages/Messages.tsx | src/App.tsx | Badge 4. |
| Settings | — | Settings | /settings | static | none | sidebar → Help & Support › Settings | avatar menu | signed-in | none | User settings | Update preferences | edit | — | — | local state | UI only | Placeholder | always visible | src/pages/Settings.tsx | src/App.tsx |  |
| Administration | — | Admin Console | /admin | static | none | direct URL (role: admin) | — | admin | none | Admin hub | Navigate to admin surfaces | navigate | — | — | static mock | Mock | Mock | role-based | src/pages/AdminConsole.tsx | src/App.tsx |  |
| Administration | Admin | Authorizations | /admin/authorizations | static | none | AdminConsole card; direct URL | — | admin | none | Review LOA submissions | Search, view, export CSV | review, export | — | Detail dialog | Supabase (client_authorizations) | Fully connected | Working | role-based | src/pages/AdminAuthorizations.tsx | src/App.tsx |  |
| Administration | Admin | Members | /admin/members | static | none | AdminConsole card; direct URL | — | admin | none | Invite/approve members | Invite, approve, reject, list | create, approve, reject | Invitations, Members, Pending | Invite dialog | Supabase (workspace_invitations, user_roles) | Fully connected | Working | role-based | src/pages/AdminMembers.tsx | src/App.tsx |  |
| Administration | Admin | Audit Log | /admin/audit | static | none | AdminConsole card; direct URL | — | admin | none | Access audit | View + export | view, export | — | — | Supabase (access_audit) | Fully connected | Working | role-based | src/pages/AdminAuditLog.tsx | src/App.tsx |  |
| Administration | Admin | Invoicing | /admin/invoicing | static | none | direct URL | — | admin | none | QuickBooks invoicing | View invoices | view only | — | — | static mock | Mock | Mock | role-based | src/pages/AdminInvoicing.tsx | src/App.tsx |  |
| Administration | Admin | Past Performance | /admin/past-performance | static | none | direct URL | — | admin | none | Performance history | View | view only | — | — | static mock | Mock | Mock | role-based | src/pages/AdminPastPerformance.tsx | src/App.tsx |  |
| Administration | Admin | CRM | /admin/crm | static | none | direct URL | — | admin | none | Client CRM | View | view only | — | — | static mock | Mock | Mock | role-based | src/pages/AdminCrm.tsx | src/App.tsx |  |
| Administration | Admin | Milestone Billing | /admin/milestone-billing | static | none | direct URL | — | admin | none | Billing milestones | View | view only | — | — | static mock | Mock | Mock | role-based | src/pages/MilestoneBilling.tsx | src/App.tsx |  |
| Administration | Admin | Endpoints | /admin/endpoints | static | none | direct URL | — | admin | none | API endpoints registry | View | view only | — | — | static | UI only | Placeholder | role-based | src/pages/AdminEndpoints.tsx | src/App.tsx |  |
| Demo | — | McDonald's Executive Demo | /demo/mcdonalds | static | none | sidebar → Command › Demo; header → Sparkles button | direct URL | signed-in | none | Sales/exec demo | Guided tour with spotlights | navigate | — | GuidedTour overlay | static mock | Mock | Working | always visible | src/pages/DemoMcDonalds.tsx | src/App.tsx |  |
| Internal | — | Architecture Inventory (this page) | /architecture-inventory | static | none | direct URL | — | signed-in | none | Internal architecture reference | Search/filter/export this inventory | filter, export | — | — | static (hand-curated) | UI only | Working | direct URL only | src/pages/ArchitectureInventory.tsx | src/App.tsx | Not linked in sidebar. |
| Internal | — | Unmatched → /dashboard | * | redirect | none | any unmatched URL | — | n/a | none | 404 fallback | Navigate replace to /dashboard | navigate | — | — | n/a | UI only | Working | hidden | src/App.tsx | src/App.tsx | Masks true 404s. |

## Navigation Tree

```text
Public
  ├─ Home — /
  ├─ Login — /login
  ├─ Sign up — /signup
  ├─ Contact — /contact [direct URL only]
Command
  ├─ Dashboard (layout) — /dashboard
  ├─ Dashboard · Operations — /dashboard (index)
  ├─ Dashboard · UCI — /dashboard/uci
  ├─ Projects — /projects
  ├─ New Project (Portal Credentials) — /projects/new [direct URL only]
  ├─ Project Timeline — /projects/:id/timeline [direct URL only]
  ├─ Project Gantt — /projects/:id/gantt [direct URL only]
  ├─ Project Workspace (Alpha) — /projects/alpha [direct URL only]
  ├─ Mission Control — /mission-control [direct URL only]
  ├─ Command Center — /command-center [direct URL only]
  ├─ Permit Queue — /permit-queue
  ├─ Critical Path — /critical-path [direct URL only]
  ├─ Feasibility — /feasibility [direct URL only]
  ├─ Site Feasibility — /feasibility/site [direct URL only]
Onboarding
  ├─ Client Authorization (LOA) — /onboarding/authorization
Delivery
  ├─ Client Authorization (LOA) — /delivery/authorization
  ├─ Operations Board — /operations
  ├─ Permit Filing (Guided Flow) — /matrix/guided
  ├─ Response Matrix — /matrix/response
  ├─ Portal Harvest — /portals/harvest
  ├─ Master Matrix — /matrix [direct URL only]
  ├─ Unified Matrix — /matrix/unified [direct URL only]
  ├─ AI Workflow — /matrix/ai-workflow [direct URL only]
  ├─ Raze Permit — /raze [direct URL only]
Intelligence
  ├─ DesignCheck (Compliance) — /compliance
  ├─ Compliance Intelligence — /compliance/intelligence [direct URL only]
  ├─ Code Analyzer — /compliance/analyzer
  ├─ Internal Prescreen — /compliance/prescreen [direct URL only]
  ├─ Agent Center — /agents [direct URL only]
  ├─ Document Vault — /documents [direct URL only]
  ├─ Content Studio — /content-studio [direct URL only]
  ├─ Platform Architecture — /architecture [direct URL only]
Utility Coordination
  ├─ UCI Hub — /uci [role-gated (admin/staff/client)]
  ├─ UCI · Submissions — /uci/submissions [role-gated]
  ├─ UCI · Inbox / Communications — /uci/communications [role-gated]
  ├─ UCI · Class of Service — /uci/class-of-service [role-gated]
  ├─ UCI · CIAC & Refunds — /uci/ciac [role-gated]
  ├─ UCI · Energization — /uci/energization [role-gated]
  ├─ UCI · Miss Utility 811 — /uci/miss-utility
  ├─ UCI · Knowledge Graph — /uci/knowledge-graph
  ├─ UCI Application Builder — /uci/application-builder
  ├─ Jurisdiction Map — /utility-map
  ├─ Provider Compare — /utility/provider-map
  ├─ Cross-Utility Conflict Hunter — /utility/conflict-hunter [direct URL only]
  ├─ Easement / ROW Manager — /utility/easements [direct URL only]
  ├─ Load Profile Analyzer — /utility/load-profile [direct URL only]
  ├─ Meter Set Choreographer — /utility/meter-set [direct URL only]
  ├─ Long-Lead Equipment — /scheduling/long-lead [direct URL only]
  ├─ Predictive Schedule Impact — /scheduling/predictive-impact [direct URL only]
  ├─ Inspector Release Tracker — /inspections/release-tracker [direct URL only]
  ├─ Special Inspections — /inspections/special [direct URL only]
  ├─ Final CO Inspections — /inspections/final-co [direct URL only]
Field
  ├─ SIR — /sir [direct URL only]
  ├─ SIR Workspace — /sir/workspace [direct URL only]
  ├─ SIR Annex — /sir/annex [direct URL only]
  ├─ SIR Executive — /sir/executive [direct URL only]
  ├─ SIR Sync — /sir/sync [direct URL only]
  ├─ Field Studio — /field/studio [direct URL only]
  ├─ Mobile Survey — /mobile/survey
  ├─ Mobile Camera — /mobile/camera
  ├─ Mobile Map — /mobile/map
Closeout
  ├─ Closeout — /closeout [direct URL only]
  ├─ Closeout Archive — /closeout/archive [direct URL only]
  ├─ Closeout Tracker — /closeout/tracker [direct URL only]
  ├─ Post-Mortem — /closeout/post-mortem [direct URL only]
  ├─ Post-Mortem Analytics — /closeout/post-mortem/analytics [direct URL only]
  ├─ Post-Mortem Financial — /closeout/post-mortem/financial [direct URL only]
Resources
  ├─ Checklists — /checklists
  ├─ Reference Library — /reference
  ├─ Utility Coverage — /reference/utility-coverage
  ├─ Glossary — /reference/glossary
  ├─ Analytics & Reporting — /portfolio/executive
  ├─ Messages — /messages
Settings
  ├─ Settings — /settings
Administration
  ├─ Admin Console — /admin [admin]
  ├─ Authorizations — /admin/authorizations [admin]
  ├─ Members — /admin/members [admin]
  ├─ Audit Log — /admin/audit [admin]
  ├─ Invoicing — /admin/invoicing [admin]
  ├─ Past Performance — /admin/past-performance [admin]
  ├─ CRM — /admin/crm [admin]
  ├─ Milestone Billing — /admin/milestone-billing [admin]
  ├─ Endpoints — /admin/endpoints [admin]
Demo
  ├─ McDonald's Executive Demo — /demo/mcdonalds
Internal
  ├─ Architecture Inventory (this page) — /architecture-inventory [direct URL only]
  ├─ Unmatched → /dashboard — *
```

## Route Map

| Route | Component | Auth | Status |
|---|---|---|---|
| `/` | src/pages/Home.tsx | public | Working |
| `/login` | src/pages/Login.tsx | public | Working |
| `/signup` | src/pages/Signup.tsx | public | Working |
| `/contact` | src/pages/Contact.tsx | public | Working |
| `/dashboard` | src/pages/Dashboard.tsx | signed-in | Mock |
| `/dashboard (index)` | src/pages/Dashboard.tsx (DashboardOverview) | signed-in | Mock |
| `/dashboard/uci` | src/pages/UciDashboard.tsx | signed-in | Mock |
| `/projects` | src/pages/Projects.tsx | signed-in | Mock |
| `/projects/new` | src/pages/ProjectSetupCredentials.tsx | signed-in | Placeholder |
| `/projects/:id/timeline` | src/pages/ProjectTimeline.tsx | signed-in | Mock |
| `/projects/:id/gantt` | src/pages/ProjectGantt.tsx | signed-in | Mock |
| `/projects/alpha` | src/pages/ProjectWorkspace.tsx | signed-in | Mock |
| `/mission-control` | src/pages/MissionControl.tsx | signed-in | Mock |
| `/command-center` | src/pages/CommandCenter.tsx | signed-in | Mock |
| `/permit-queue` | src/pages/PermitQueue.tsx | signed-in | Mock |
| `/critical-path` | src/pages/CriticalPath.tsx | signed-in | Mock |
| `/feasibility` | src/pages/Feasibility.tsx | signed-in | Mock |
| `/feasibility/site` | src/pages/SiteFeasibility.tsx | signed-in | Mock |
| `/onboarding/authorization` | src/pages/OnboardingAuthorization.tsx | signed-in client | Working |
| `/delivery/authorization` | src/pages/OnboardingAuthorization.tsx | signed-in client | Working |
| `/operations` | src/pages/OperationsBoard.tsx | signed-in | Mock |
| `/matrix/guided` | src/pages/GuidedFlow.tsx | signed-in | Mock |
| `/matrix/response` | src/pages/ResponseMatrix.tsx | signed-in | Mock |
| `/portals/harvest` | src/pages/PortalHarvest.tsx | signed-in | Mock |
| `/matrix` | src/pages/MasterMatrix.tsx | signed-in | Mock |
| `/matrix/unified` | src/pages/UnifiedMatrix.tsx | signed-in | Mock |
| `/matrix/ai-workflow` | src/pages/AiWorkflow.tsx | signed-in | Partial |
| `/raze` | src/pages/RazePermit.tsx | signed-in | Mock |
| `/compliance` | src/pages/Compliance.tsx | signed-in | Mock |
| `/compliance/intelligence` | src/pages/ComplianceIntelligence.tsx | signed-in | Mock |
| `/compliance/analyzer` | src/pages/ComplianceAnalyzer.tsx | signed-in | Partial |
| `/compliance/prescreen` | src/pages/InternalPrescreen.tsx | staff/admin | Mock |
| `/agents` | src/pages/AgentCenter.tsx | signed-in | Mock |
| `/documents` | src/pages/DocumentVault.tsx | signed-in | Mock |
| `/content-studio` | src/pages/ContentStudio.tsx | signed-in | Placeholder |
| `/architecture` | src/pages/PlatformArchitecture.tsx | signed-in | Working |
| `/uci` | src/pages/UciDashboard.tsx (via RequireUciAccess) | role-gated (admin/staff/client) | Mock |
| `/uci/submissions` | src/pages/UciSubmissions.tsx | role-gated | Mock |
| `/uci/communications` | src/pages/UciCommunications.tsx | role-gated | Mock |
| `/uci/class-of-service` | src/pages/UciClassOfService.tsx | role-gated | Mock |
| `/uci/ciac` | src/pages/UciCiac.tsx | role-gated | Mock |
| `/uci/energization` | src/pages/UciEnergization.tsx | role-gated | Mock |
| `/uci/miss-utility` | src/pages/UciMissUtility.tsx | admin/staff only | Mock |
| `/uci/knowledge-graph` | src/pages/UciKnowledgeGraph.tsx | admin/staff only | Mock |
| `/uci/application-builder` | src/pages/UciApplicationBuilder.tsx | admin/staff only | Placeholder |
| `/utility-map` | src/pages/UtilityMap.tsx | signed-in | Mock |
| `/utility/provider-map` | src/pages/UtilityProviderMap.tsx | signed-in | Partial |
| `/utility/conflict-hunter` | src/pages/CrossUtilityConflictHunter.tsx | signed-in | Mock |
| `/utility/easements` | src/pages/EasementRowManager.tsx | signed-in | Mock |
| `/utility/load-profile` | src/pages/LoadProfileAnalyzer.tsx | signed-in | Partial |
| `/utility/meter-set` | src/pages/MeterSetChoreographer.tsx | signed-in | Mock |
| `/scheduling/long-lead` | src/pages/LongLeadEquipment.tsx | signed-in | Mock |
| `/scheduling/predictive-impact` | src/pages/PredictiveScheduleImpact.tsx | signed-in | Mock |
| `/inspections/release-tracker` | src/pages/InspectorReleaseTracker.tsx | signed-in | Mock |
| `/inspections/special` | src/pages/SpecialInspections.tsx | signed-in | Mock |
| `/inspections/final-co` | src/pages/FinalInspections.tsx | signed-in | Mock |
| `/sir` | src/pages/Sir.tsx | signed-in | Mock |
| `/sir/workspace` | src/pages/SirWorkspace.tsx | signed-in | Mock |
| `/sir/annex` | src/pages/SirAnnex.tsx | signed-in | Mock |
| `/sir/executive` | src/pages/SirExecutive.tsx | signed-in | Mock |
| `/sir/sync` | src/pages/SirSync.tsx | signed-in | Mock |
| `/field/studio` | src/pages/FieldStudio.tsx | signed-in | Mock |
| `/mobile/survey` | src/pages/MobileSurvey.tsx | signed-in | Mock |
| `/mobile/camera` | src/pages/MobileCamera.tsx | signed-in | Mock |
| `/mobile/map` | src/pages/MobileMap.tsx | signed-in | Mock |
| `/closeout` | src/pages/Closeout.tsx | signed-in | Mock |
| `/closeout/archive` | src/pages/CloseoutArchive.tsx | signed-in | Mock |
| `/closeout/tracker` | src/pages/CloseoutTracker.tsx | signed-in | Mock |
| `/closeout/post-mortem` | src/pages/PostMortem.tsx | signed-in | Mock |
| `/closeout/post-mortem/analytics` | src/pages/PostMortemAnalytics.tsx | signed-in | Mock |
| `/closeout/post-mortem/financial` | src/pages/PostMortemFinancial.tsx | signed-in | Mock |
| `/checklists` | src/pages/Checklists.tsx | signed-in | Mock |
| `/reference` | src/pages/ReferenceLibrary.tsx | signed-in | Working |
| `/reference/utility-coverage` | src/pages/UtilityCoverage.tsx | signed-in | Working |
| `/reference/glossary` | src/pages/Glossary.tsx | signed-in | Working |
| `/portfolio/executive` | src/pages/PortfolioExecutive.tsx | signed-in | Mock |
| `/messages` | src/pages/Messages.tsx | signed-in | Mock |
| `/settings` | src/pages/Settings.tsx | signed-in | Placeholder |
| `/admin` | src/pages/AdminConsole.tsx | admin | Mock |
| `/admin/authorizations` | src/pages/AdminAuthorizations.tsx | admin | Working |
| `/admin/members` | src/pages/AdminMembers.tsx | admin | Working |
| `/admin/audit` | src/pages/AdminAuditLog.tsx | admin | Working |
| `/admin/invoicing` | src/pages/AdminInvoicing.tsx | admin | Mock |
| `/admin/past-performance` | src/pages/AdminPastPerformance.tsx | admin | Mock |
| `/admin/crm` | src/pages/AdminCrm.tsx | admin | Mock |
| `/admin/milestone-billing` | src/pages/MilestoneBilling.tsx | admin | Mock |
| `/admin/endpoints` | src/pages/AdminEndpoints.tsx | admin | Placeholder |
| `/demo/mcdonalds` | src/pages/DemoMcDonalds.tsx | signed-in | Working |
| `/architecture-inventory` | src/pages/ArchitectureInventory.tsx | signed-in | Working |
| `*` | src/App.tsx | n/a | Working |

## Entry-Point Matrix

| Name | Route | Primary Entry | Secondary Entries |
|---|---|---|---|
| Home | `/` | sidebar → Help & Support › Pricing & Overview; header → Home; direct URL | logo click |
| Login | `/login` | auth redirect; direct URL | sign-out flow |
| Sign up | `/signup` | Login → Sign up link | direct URL |
| Contact | `/contact` | Home CTA | direct URL |
| Dashboard (layout) | `/dashboard` | sidebar → Command › Dashboard; header → Home | unmatched-route redirect |
| Dashboard · Operations | `/dashboard (index)` | Dashboard tab | direct URL |
| Dashboard · UCI | `/dashboard/uci` | Dashboard tab → Utility Coordination | direct URL |
| Projects | `/projects` | sidebar → Command › Projects | dashboard link |
| New Project (Portal Credentials) | `/projects/new` | Projects → New | direct URL |
| Project Timeline | `/projects/:id/timeline` | Project Workspace → Timeline | direct URL |
| Project Gantt | `/projects/:id/gantt` | Project Workspace → Gantt | direct URL |
| Project Workspace (Alpha) | `/projects/alpha` | CommandCenter → Open project | direct URL |
| Mission Control | `/mission-control` | direct URL | — |
| Command Center | `/command-center` | direct URL | — |
| Permit Queue | `/permit-queue` | sidebar → Command › Permit Queue | direct URL |
| Critical Path | `/critical-path` | direct URL | — |
| Feasibility | `/feasibility` | direct URL | — |
| Site Feasibility | `/feasibility/site` | Feasibility → Site | direct URL |
| Client Authorization (LOA) | `/onboarding/authorization` | sidebar → Onboarding › Client Authorization (LOA) | /delivery/authorization (aliased) |
| Client Authorization (LOA) | `/delivery/authorization` | sidebar → Delivery › Client Authorization (LOA) | direct URL |
| Operations Board | `/operations` | sidebar → Delivery › Operations Board | direct URL |
| Permit Filing (Guided Flow) | `/matrix/guided` | sidebar → Delivery › Permit Filing | direct URL |
| Response Matrix | `/matrix/response` | sidebar → Delivery › Response Matrix | direct URL |
| Portal Harvest | `/portals/harvest` | sidebar → Delivery › Portal Harvest | direct URL |
| Master Matrix | `/matrix` | direct URL | — |
| Unified Matrix | `/matrix/unified` | direct URL | — |
| AI Workflow | `/matrix/ai-workflow` | header → New Workflow button | direct URL |
| Raze Permit | `/raze` | direct URL | — |
| DesignCheck (Compliance) | `/compliance` | sidebar → Intelligence › DesignCheck | direct URL |
| Compliance Intelligence | `/compliance/intelligence` | direct URL | — |
| Code Analyzer | `/compliance/analyzer` | sidebar → Intelligence › Code Analyzer | direct URL |
| Internal Prescreen | `/compliance/prescreen` | direct URL | — |
| Agent Center | `/agents` | direct URL | — |
| Document Vault | `/documents` | direct URL | — |
| Content Studio | `/content-studio` | direct URL | — |
| Platform Architecture | `/architecture` | direct URL | — |
| UCI Hub | `/uci` | sidebar → Intelligence › Utility Coordination | dashboard/uci tab |
| UCI · Submissions | `/uci/submissions` | sidebar → Intelligence › UCI · Submissions | direct URL |
| UCI · Inbox / Communications | `/uci/communications` | sidebar → Intelligence › UCI · Inbox | direct URL |
| UCI · Class of Service | `/uci/class-of-service` | sidebar → Intelligence › UCI · Class of Service | direct URL |
| UCI · CIAC & Refunds | `/uci/ciac` | sidebar → Intelligence › UCI · CIAC & Refunds | direct URL |
| UCI · Energization | `/uci/energization` | sidebar → Intelligence › UCI · Energization | direct URL |
| UCI · Miss Utility 811 | `/uci/miss-utility` | sidebar → Intelligence › UCI · Miss Utility 811 | direct URL |
| UCI · Knowledge Graph | `/uci/knowledge-graph` | sidebar → Intelligence › UCI · Knowledge Graph | direct URL |
| UCI Application Builder | `/uci/application-builder` | sidebar → Intelligence › UCI Builder | direct URL |
| Jurisdiction Map | `/utility-map` | sidebar → Intelligence › Jurisdiction Map | direct URL |
| Provider Compare | `/utility/provider-map` | sidebar → Intelligence › Provider Compare | direct URL |
| Cross-Utility Conflict Hunter | `/utility/conflict-hunter` | direct URL | — |
| Easement / ROW Manager | `/utility/easements` | direct URL | — |
| Load Profile Analyzer | `/utility/load-profile` | direct URL | — |
| Meter Set Choreographer | `/utility/meter-set` | direct URL | — |
| Long-Lead Equipment | `/scheduling/long-lead` | direct URL | — |
| Predictive Schedule Impact | `/scheduling/predictive-impact` | direct URL | — |
| Inspector Release Tracker | `/inspections/release-tracker` | direct URL | — |
| Special Inspections | `/inspections/special` | direct URL | — |
| Final CO Inspections | `/inspections/final-co` | direct URL | — |
| SIR | `/sir` | direct URL | — |
| SIR Workspace | `/sir/workspace` | direct URL | — |
| SIR Annex | `/sir/annex` | direct URL | — |
| SIR Executive | `/sir/executive` | direct URL | — |
| SIR Sync | `/sir/sync` | direct URL | — |
| Field Studio | `/field/studio` | direct URL | — |
| Mobile Survey | `/mobile/survey` | direct URL | — |
| Mobile Camera | `/mobile/camera` | direct URL | — |
| Mobile Map | `/mobile/map` | direct URL | — |
| Closeout | `/closeout` | direct URL | — |
| Closeout Archive | `/closeout/archive` | direct URL | — |
| Closeout Tracker | `/closeout/tracker` | direct URL | — |
| Post-Mortem | `/closeout/post-mortem` | direct URL | — |
| Post-Mortem Analytics | `/closeout/post-mortem/analytics` | direct URL | — |
| Post-Mortem Financial | `/closeout/post-mortem/financial` | direct URL | — |
| Checklists | `/checklists` | sidebar → Resources › Checklists | direct URL |
| Reference Library | `/reference` | sidebar → Resources › Reference Library; Help & Support › Documentation | direct URL |
| Utility Coverage | `/reference/utility-coverage` | sidebar → Resources › Utility Coverage | direct URL |
| Glossary | `/reference/glossary` | sidebar → Resources › Glossary | direct URL |
| Analytics & Reporting | `/portfolio/executive` | sidebar → Resources › Analytics & Reporting | direct URL |
| Messages | `/messages` | sidebar → Resources › Messages; Help & Support › Support | direct URL |
| Settings | `/settings` | sidebar → Help & Support › Settings | avatar menu |
| Admin Console | `/admin` | direct URL (role: admin) | — |
| Authorizations | `/admin/authorizations` | AdminConsole card; direct URL | — |
| Members | `/admin/members` | AdminConsole card; direct URL | — |
| Audit Log | `/admin/audit` | AdminConsole card; direct URL | — |
| Invoicing | `/admin/invoicing` | direct URL | — |
| Past Performance | `/admin/past-performance` | direct URL | — |
| CRM | `/admin/crm` | direct URL | — |
| Milestone Billing | `/admin/milestone-billing` | direct URL | — |
| Endpoints | `/admin/endpoints` | direct URL | — |
| McDonald's Executive Demo | `/demo/mcdonalds` | sidebar → Command › Demo; header → Sparkles button | direct URL |
| Architecture Inventory (this page) | `/architecture-inventory` | direct URL | — |
| Unmatched → /dashboard | `*` | any unmatched URL | — |

## Orphaned Pages & Structural Risks

- **Direct-URL-only routes (no sidebar link):** 42. Discoverable only via typed URL.
- **Alias routes:** `/delivery/authorization` ⇄ `/onboarding/authorization` (same component), `/uci` ⇄ `/dashboard/uci` (same component, but `/dashboard/uci` bypasses `RequireUciAccess`).
- **404 masking:** unmatched routes redirect to `/dashboard` via `<Route path="*" element={<Navigate to="/dashboard" replace />} />` — real 404s are hidden.
- **Dynamic id gap:** `/projects/:id/timeline` and `/projects/:id/gantt` have no list-to-detail navigation; only the hard-coded `/projects/alpha` is reachable.
- **Orphaned page files:** none — every file in `src/pages/*` is registered in `src/App.tsx`.

### Direct-URL-only routes (42)

- `/contact` — Contact (src/pages/Contact.tsx)
- `/projects/new` — New Project (Portal Credentials) (src/pages/ProjectSetupCredentials.tsx)
- `/projects/:id/timeline` — Project Timeline (src/pages/ProjectTimeline.tsx)
- `/projects/:id/gantt` — Project Gantt (src/pages/ProjectGantt.tsx)
- `/projects/alpha` — Project Workspace (Alpha) (src/pages/ProjectWorkspace.tsx)
- `/mission-control` — Mission Control (src/pages/MissionControl.tsx)
- `/command-center` — Command Center (src/pages/CommandCenter.tsx)
- `/critical-path` — Critical Path (src/pages/CriticalPath.tsx)
- `/feasibility` — Feasibility (src/pages/Feasibility.tsx)
- `/feasibility/site` — Site Feasibility (src/pages/SiteFeasibility.tsx)
- `/matrix` — Master Matrix (src/pages/MasterMatrix.tsx)
- `/matrix/unified` — Unified Matrix (src/pages/UnifiedMatrix.tsx)
- `/matrix/ai-workflow` — AI Workflow (src/pages/AiWorkflow.tsx)
- `/raze` — Raze Permit (src/pages/RazePermit.tsx)
- `/compliance/intelligence` — Compliance Intelligence (src/pages/ComplianceIntelligence.tsx)
- `/compliance/prescreen` — Internal Prescreen (src/pages/InternalPrescreen.tsx)
- `/agents` — Agent Center (src/pages/AgentCenter.tsx)
- `/documents` — Document Vault (src/pages/DocumentVault.tsx)
- `/content-studio` — Content Studio (src/pages/ContentStudio.tsx)
- `/architecture` — Platform Architecture (src/pages/PlatformArchitecture.tsx)
- `/utility/conflict-hunter` — Cross-Utility Conflict Hunter (src/pages/CrossUtilityConflictHunter.tsx)
- `/utility/easements` — Easement / ROW Manager (src/pages/EasementRowManager.tsx)
- `/utility/load-profile` — Load Profile Analyzer (src/pages/LoadProfileAnalyzer.tsx)
- `/utility/meter-set` — Meter Set Choreographer (src/pages/MeterSetChoreographer.tsx)
- `/scheduling/long-lead` — Long-Lead Equipment (src/pages/LongLeadEquipment.tsx)
- `/scheduling/predictive-impact` — Predictive Schedule Impact (src/pages/PredictiveScheduleImpact.tsx)
- `/inspections/release-tracker` — Inspector Release Tracker (src/pages/InspectorReleaseTracker.tsx)
- `/inspections/special` — Special Inspections (src/pages/SpecialInspections.tsx)
- `/inspections/final-co` — Final CO Inspections (src/pages/FinalInspections.tsx)
- `/sir` — SIR (src/pages/Sir.tsx)
- `/sir/workspace` — SIR Workspace (src/pages/SirWorkspace.tsx)
- `/sir/annex` — SIR Annex (src/pages/SirAnnex.tsx)
- `/sir/executive` — SIR Executive (src/pages/SirExecutive.tsx)
- `/sir/sync` — SIR Sync (src/pages/SirSync.tsx)
- `/field/studio` — Field Studio (src/pages/FieldStudio.tsx)
- `/closeout` — Closeout (src/pages/Closeout.tsx)
- `/closeout/archive` — Closeout Archive (src/pages/CloseoutArchive.tsx)
- `/closeout/tracker` — Closeout Tracker (src/pages/CloseoutTracker.tsx)
- `/closeout/post-mortem` — Post-Mortem (src/pages/PostMortem.tsx)
- `/closeout/post-mortem/analytics` — Post-Mortem Analytics (src/pages/PostMortemAnalytics.tsx)
- `/closeout/post-mortem/financial` — Post-Mortem Financial (src/pages/PostMortemFinancial.tsx)
- `/architecture-inventory` — Architecture Inventory (this page) (src/pages/ArchitectureInventory.tsx)

## Functional Status Matrix

### Working (16)

- `/` — Home — backend: UI only
- `/login` — Login — backend: Fully connected
- `/signup` — Sign up — backend: Fully connected
- `/contact` — Contact — backend: Fully connected
- `/onboarding/authorization` — Client Authorization (LOA) — backend: Fully connected
- `/delivery/authorization` — Client Authorization (LOA) — backend: Fully connected
- `/architecture` — Platform Architecture — backend: UI only
- `/reference` — Reference Library — backend: UI only
- `/reference/utility-coverage` — Utility Coverage — backend: UI only
- `/reference/glossary` — Glossary — backend: UI only
- `/admin/authorizations` — Authorizations — backend: Fully connected
- `/admin/members` — Members — backend: Fully connected
- `/admin/audit` — Audit Log — backend: Fully connected
- `/demo/mcdonalds` — McDonald's Executive Demo — backend: Mock
- `/architecture-inventory` — Architecture Inventory (this page) — backend: UI only
- `*` — Unmatched → /dashboard — backend: UI only

### Partial (4)

- `/matrix/ai-workflow` — AI Workflow — backend: UI only
- `/compliance/analyzer` — Code Analyzer — backend: Partially connected
- `/utility/provider-map` — Provider Compare — backend: Partially connected
- `/utility/load-profile` — Load Profile Analyzer — backend: Partially connected

### Mock (65)

- `/dashboard` — Dashboard (layout) — backend: Mock
- `/dashboard (index)` — Dashboard · Operations — backend: Mock
- `/dashboard/uci` — Dashboard · UCI — backend: Mock
- `/projects` — Projects — backend: Mock
- `/projects/:id/timeline` — Project Timeline — backend: Mock
- `/projects/:id/gantt` — Project Gantt — backend: Mock
- `/projects/alpha` — Project Workspace (Alpha) — backend: Mock
- `/mission-control` — Mission Control — backend: Mock
- `/command-center` — Command Center — backend: Mock
- `/permit-queue` — Permit Queue — backend: Mock
- `/critical-path` — Critical Path — backend: Mock
- `/feasibility` — Feasibility — backend: Mock
- `/feasibility/site` — Site Feasibility — backend: Mock
- `/operations` — Operations Board — backend: Mock
- `/matrix/guided` — Permit Filing (Guided Flow) — backend: Mock
- `/matrix/response` — Response Matrix — backend: Mock
- `/portals/harvest` — Portal Harvest — backend: Mock
- `/matrix` — Master Matrix — backend: Mock
- `/matrix/unified` — Unified Matrix — backend: Mock
- `/raze` — Raze Permit — backend: Mock
- `/compliance` — DesignCheck (Compliance) — backend: Mock
- `/compliance/intelligence` — Compliance Intelligence — backend: Mock
- `/compliance/prescreen` — Internal Prescreen — backend: Mock
- `/agents` — Agent Center — backend: Mock
- `/documents` — Document Vault — backend: Mock
- `/uci` — UCI Hub — backend: Mock
- `/uci/submissions` — UCI · Submissions — backend: Mock
- `/uci/communications` — UCI · Inbox / Communications — backend: Mock
- `/uci/class-of-service` — UCI · Class of Service — backend: Mock
- `/uci/ciac` — UCI · CIAC & Refunds — backend: Mock
- `/uci/energization` — UCI · Energization — backend: Mock
- `/uci/miss-utility` — UCI · Miss Utility 811 — backend: Mock
- `/uci/knowledge-graph` — UCI · Knowledge Graph — backend: Mock
- `/utility-map` — Jurisdiction Map — backend: Mock
- `/utility/conflict-hunter` — Cross-Utility Conflict Hunter — backend: Mock
- `/utility/easements` — Easement / ROW Manager — backend: Mock
- `/utility/meter-set` — Meter Set Choreographer — backend: Mock
- `/scheduling/long-lead` — Long-Lead Equipment — backend: Mock
- `/scheduling/predictive-impact` — Predictive Schedule Impact — backend: Mock
- `/inspections/release-tracker` — Inspector Release Tracker — backend: Mock
- `/inspections/special` — Special Inspections — backend: Mock
- `/inspections/final-co` — Final CO Inspections — backend: Mock
- `/sir` — SIR — backend: Mock
- `/sir/workspace` — SIR Workspace — backend: Mock
- `/sir/annex` — SIR Annex — backend: Mock
- `/sir/executive` — SIR Executive — backend: Mock
- `/sir/sync` — SIR Sync — backend: Mock
- `/field/studio` — Field Studio — backend: Mock
- `/mobile/survey` — Mobile Survey — backend: UI only
- `/mobile/camera` — Mobile Camera — backend: UI only
- `/mobile/map` — Mobile Map — backend: UI only
- `/closeout` — Closeout — backend: Mock
- `/closeout/archive` — Closeout Archive — backend: Mock
- `/closeout/tracker` — Closeout Tracker — backend: Mock
- `/closeout/post-mortem` — Post-Mortem — backend: Mock
- `/closeout/post-mortem/analytics` — Post-Mortem Analytics — backend: Mock
- `/closeout/post-mortem/financial` — Post-Mortem Financial — backend: Mock
- `/checklists` — Checklists — backend: Mock
- `/portfolio/executive` — Analytics & Reporting — backend: Mock
- `/messages` — Messages — backend: Mock
- `/admin` — Admin Console — backend: Mock
- `/admin/invoicing` — Invoicing — backend: Mock
- `/admin/past-performance` — Past Performance — backend: Mock
- `/admin/crm` — CRM — backend: Mock
- `/admin/milestone-billing` — Milestone Billing — backend: Mock

### Placeholder (5)

- `/projects/new` — New Project (Portal Credentials) — backend: UI only
- `/content-studio` — Content Studio — backend: UI only
- `/uci/application-builder` — UCI Application Builder — backend: UI only
- `/settings` — Settings — backend: UI only
- `/admin/endpoints` — Endpoints — backend: UI only

## PermitPilot feat IA snapshot (2026-08-05)

_Source of truth for live sidebar: `src/components/layout/hybridNav.ts` + `UciSidebarNav` / `uciNavSections.ts`. This Lovable mirror inventory remains useful for route cataloging; the notes below record intentional PermitPilot IA on `feat/lovable-ui-replication`._

### Hybrid sidebar (shipped)

| Group | Items / notes |
|-------|----------------|
| **Command** | Dashboard, Projects, Permit Queue (Soon), **Demo → `/demo/mcdonalds`** (interactive `/demos` secondary) |
| **Onboarding** | Client Authorization (LOA) |
| **Delivery** | Permit Filing (`PERMIT_FILING_WIP` Start Pre-Flight), **Response Matrix** (comment-workflow entrance), Portal Harvest, Operations Board |
| **Intelligence** | DesignCheck, **Code Analyzer**, expandable **Utility Coordination** (Lovable-shaped children, **Soon-only** badges), Jurisdiction Map, Provider Compare, Permit Intelligence |
| **Resources** | Checklists, Reference Library, Utility Coverage (Soon), Glossary (Soon), Analytics, Messages (Soon), ROI, Tool Consolidation, Pricing |
| **Admin** | `defaultOpen: true` — Overview, Jurisdictions, Feature Flags, Shadow Mode, Architecture Replication, Authorizations/Members/Audit (preview Soon) |
| **Help & Support** | Documentation, FAQ, Contact, Design preview, Settings |

### Intentional IA (not missing product)

| Topic | Decision |
|-------|----------|
| **Comment Review** | Route `/comment-review` remains live; **not** in `hybridNav`. Enter via Response Matrix Upload & Parse / Review Parsed CTAs (+ Command Palette). |
| **Classified Comments** | `/classified-comments` **redirects** to Response Matrix; classify stays on Matrix. |
| **Permit Filing Pre-Flight** | Intentionally WIP/Soon (`PERMIT_FILING_WIP`); not a parity blocker vs main’s enabled button. |
| **UCI nav** | Primary children: Submissions, Inbox, Class of Service, CIAC & Refunds, Energization, Miss Utility 811, Knowledge Graph, UCI Builder — all **Soon** chrome. Hub child removed. Demoted modules (Load Profile, Meter Set, Conflict Hunter, Easement, Portfolio, Provider Map) remain as **hub tiles**. Partial support rendered as Coming Soon panels. |
| **Demos** | Primary Command › Demo = Lovable McDonald’s; interactive demos at `/demos`. |

### Related docs

- `docs/current-ui-inventory.json` — updated navigationItems / route notes (2026-08-05)
- `docs/audits/main-vs-feat-functional-parity-audit.md` — merge-readiness; intentional IA accepted
- Admin checklist UI: `/admin/architecture-replication`

---

## Architecture Replication Notes

### Public

Auth-adjacent surfaces. Only Login/Signup/Contact hit the backend; Home is a static marketing shell rendered inside PermitPilotShell.

### Command

Portfolio + project navigation. All dashboards and project detail views are mock. Introduce a `/projects/:id` list-to-detail pattern before wiring real data.

### Onboarding

LOA signing is fully backend-connected (Supabase + Storage + PDF). Replicate the typed/drawn signature capture pattern first — it is the reference implementation for real user data on this platform.

### Delivery

Mixed states: LOA alias is real; Operations Board / Matrix / Portal Harvest / Response Matrix are mock. AiWorkflow persists to localStorage only — swap to a workflows table before shipping.

### Intelligence

DesignCheck landing pages are mock; the Code Analyzer is the only surface that calls an edge function (`analyze-compliance-drawings`). Presets persist locally.

### Utility Coordination

All UCI subroutes are role-gated via `RequireUciAccess` and back onto static mock content. Provider Compare and Load Profile Analyzer touch the backend partially.

### Field

SIR family and Mobile* surfaces are mock UI shells. No offline sync, no photo persistence.

### Closeout

Fully mock hierarchy. No aggregation from upstream project data.

### Resources

Reference Library, Utility Coverage, and Glossary are real static content (utility provider dataset). Analytics & Messages are mock.

### Settings

Client-only placeholder. No preferences persist.

### Administration

Authorizations, Members, and Audit Log are fully backend-connected (Supabase + security-definer RPCs). Invoicing / Past Performance / CRM / Milestone Billing / Endpoints are mock.

### Demo

McDonald's executive demo with GuidedTour overlay. Static, illustrative only.

### Internal

This inventory and the catch-all `*` redirect. Not linked in sidebar.

