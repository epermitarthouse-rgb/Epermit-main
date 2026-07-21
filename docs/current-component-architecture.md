# PermitPilot — Current Component Architecture

> Audit date: 2026-07-21  
> Root: `src/components/` (~43 top-level folders, ~248 component files)

---

## 1. Layering model

```
pages/*                    → route-level composition
components/<feature>/*     → feature modules (domain UI)
components/layout/*        → shells, nav, headers
components/ui/*            → shadcn/Radix primitives
hooks/* + contexts/*       → state & data
lib/*                      → API clients, domain logic, PDF export
```

**Rule of thumb for UI replication:** replace visual components under `components/` and page chrome; keep `lib/*`, hooks that call APIs, and contexts that encode product logic unless an adapter layer is introduced.

---

## 2. Shared UI (`components/ui/`)

~56 shadcn-style primitives: button, input, form, dialog, sheet, drawer, sidebar, tabs, table, select, command, toast/sonner, chart, calendar, accordion, badge, card, etc.

**Custom shared (non-shadcn folder but cross-cutting):**

| Component | Path | Role |
|-----------|------|------|
| Typography / Section | `components/ui/Typography.tsx`, `Section.tsx` | Editorial layout helpers |
| ErrorBoundary | `components/ErrorBoundary.tsx` | Used on `/uci`, compliance |
| ThemeToggle | `components/ThemeToggle.tsx` | Light/dark/system |
| login.tsx | `components/ui/login.tsx` | Legacy; primary auth is `pages/Auth.tsx` |

---

## 3. Layout & navigation

| Component | Path | Used by |
|-----------|------|---------|
| DashboardLayout | `layout/DashboardLayout.tsx` | All protected routes |
| AppSidebar | `layout/AppSidebar.tsx` | Dashboard + legacy Layout |
| MobileBottomNav | `layout/MobileBottomNav.tsx` | Mobile chrome |
| MarketingLayout / MarketingHeader | `layout/MarketingLayout.tsx`, `MarketingHeader.tsx` | Public marketing |
| Layout / Header / Footer | `layout/Layout.tsx`, `Header.tsx`, `Footer.tsx` | Legacy public shell |
| PublicMarketingHeader / Layout | alternate marketing chrome | Partial overlap |
| EditorialPageHeader | `layout/EditorialPageHeader.tsx` | In-app page titles |
| CommandPalette | `navigation/CommandPalette.tsx` | ⌘K |
| AdminLayout / AdminPageShell | `admin/AdminLayout.tsx`, `AdminPageShell.tsx` | Admin |
| BaltimoreLayout | `baltimore/BaltimoreLayout.tsx` | Mock portal |

**Providers nested in DashboardLayout:** `SelectedProjectProvider`, `ScrapeProvider`, `SidebarProvider`.

---

## 4. Feature module map

| Folder | Representative components | Domain | Primary consumers |
|--------|---------------------------|--------|-------------------|
| `admin/` | JurisdictionManager, FeatureFlagsPanel, DripCampaignManager, AdminUnauthorized | Admin | `/admin/*` |
| `analytics/` | CycleTimeChart, JurisdictionTable, AnalyticsExport | Reporting | `/analytics` |
| `auth/` | ProtectedRoute, PublicOnlyRoute | Routing guards | `App.tsx` |
| `baltimore/` | BaltimoreNav, BaltimoreRecordsTable | Mock Accela | `/baltimore*` |
| `checklists/` | ScheduledReportsManager, ReportAnalyticsDashboard | Checklists | Checklist history / settings |
| `code-reference/` | CodeComparisonMatrix | Code library | `/code-reference` |
| `collaboration/` | CommentThread, ProjectChatSidebar, DocumentAnnotationCanvas | Team collab | Projects / documents |
| `comment-review/` | CommentReviewExtractedPanel, ManualCommentFormDialog | Comment intake | `/comment-review` |
| `compliance/` | AIComplianceAnalyzer | AI compliance | `/code-compliance` |
| `dashboard/` | AgentWorkflowStatus, ProjectHealthCard, DeadlineAlertsWidget | Home widgets | `/dashboard` |
| `demos/` | JurisdictionLookupDemo, PortalIntakeDemo, epds/* | Marketing demos | `/demos`, design preview |
| `documents/` | DocumentUploadDialog, ProjectDocumentsSection | Docs | Projects |
| `epermit/` | EPermitConfigDialog, EPermitStatusTracker | ePermit | Projects / filings |
| `fairfax/` | FairfaxRecordTabBar | Portal clone (unrouted) | Legacy/unlinked |
| `help/` | FloatingHelpWidget | Help | Layout |
| `home/` | HeroSection, JurisdictionCoverageMap | Marketing | Landing |
| `inspections/` | InspectionCalendar, PunchList, OfflineChecklistManager | Field | Projects |
| `jurisdictions/` | JurisdictionMap, JurisdictionComparisonTool, CoverageRequestForm | Intel | Jurisdiction pages |
| `lead-capture/` | LeadCaptureModal | Lead gen | App root |
| `marketing/` | MarketingHeroSection, FeaturesGrid | Marketing | Landing/pricing |
| `notifications/` | NotificationBell | Alerts | DashboardLayout header |
| `onboarding/` | OnboardingWizard, GettingStartedChecklist, FeatureTooltip | Onboarding | Dashboard |
| `permit-wizard/` | StartFilingDialog, DocumentChecklistCard, FilingReviewPanel | Filing | `/permit-wizard-filing` |
| `plans/` | PlanViewer, CommentPlanPanel | PDF plans | Comment/response flows |
| `portal/` | AccelaProjectView | Portal data render | PortalDataViewer |
| `projects/` | ProjectFormDialog, KanbanColumn, ShareProjectDialog, BillingInvoicePanel | Projects | `/projects` |
| `pwa/` | InstallPrompt, OfflineIndicator | PWA | App root |
| `response-matrix/` | SuggestedResponsePanel, ExportPackageDialog | Responses | `/response-matrix` |
| `scrape/` | ScrapeProgressPanel | Scrape UX | Header / portal |
| `settings/` | PortalCredentialsManager, MicrosoftMailboxConnector, ArchitectProfileManager | Settings | `/settings` |
| `shadow/` | ReviewTimer | Shadow mode | Admin shadow |
| `shovels/` | ShovelsPermitSearch | Permit intel | `/permit-intelligence` |
| `team/` | TeamMemberList, InviteTeamMemberDialog | Team | Projects |
| `uci/` | UciSetupWorkflow, LoadProfileWorkspace, UciD13WorkflowPanels, PepcoProjectList | UCI | `/uci` |
| `widgets/` | Embed-related widgets | Embeds | Client portal / embed |
| `animations/` | PageTransition, variants | Motion | Marketing / pages |

---

## 5. Shared vs page-specific

| Shared (reuse across routes) | Page-specific |
|------------------------------|---------------|
| `ui/*`, layout shells, ThemeToggle, NotificationBell, CommandPalette | Most of `uci/*` panels wired to UciDashboard |
| Project pickers / ActiveProjectBadge | Baltimore* pages |
| PortalCredentialsManager (settings + sidebar) | Admin drip / shadow dashboards |
| Document upload / plan viewers | ROI / Consolidation calculator page forms |
| ScrapeProgressPanel | Epds design-system sections |

---

## 6. Forms & UX state patterns

| Pattern | Where |
|---------|-------|
| RHF + zod | Auth, Settings, ProjectFormDialog, CoverageRequestForm |
| Controlled local state | Contact, calculators, many UCI inputs |
| Loading | Full-page `Loader2` (guards, Analytics, admin); skeletons (Dashboard, Projects, PortalDataViewer) |
| Errors | Sonner toast; UCI `formatUciUserError`; ErrorBoundary |
| Empty | Per-feature copy when no project / no comments / no portal_data |
| Partial / completed | Scrape progress panel; pipeline run statuses; UCI stage states |

---

## 7. Duplicate / legacy components

| Signal | Detail |
|--------|--------|
| Index vs CommunETLanding | Two landing implementations; only Commun-ET routed |
| Layout trio | DashboardLayout / MarketingLayout / Layout |
| fairfax vs baltimore | Parallel portal clones; Baltimore routed |
| Header variants | Header, MarketingHeader, PublicMarketingHeader |
| gold → orange aliases | Backward-compat color tokens in Tailwind/CSS |

---

## 8. Coupling notes for UI migration

Components tightly coupled to:

1. **Selected project context** — sidebar, scrape, UCI, portal data, projects
2. **ScrapeContext** — header indicator, cancel, Accela session clear on logout
3. **Hardcoded hrefs** — AppSidebar, MobileBottomNav, CommandPalette
4. **Status string maps** — UCI stages, scrape stages, comment `response_status`
5. **Direct Supabase in components** — AppSidebar credentials query, admin managers
6. **Scraper URL helpers** — AgentWorkflowStatus, AIComplianceAnalyzer, uci components via `uciApi`

When replacing visuals, prefer keeping these hooks/clients behind adapters rather than rewriting call sites page-by-page without a shared contract.
