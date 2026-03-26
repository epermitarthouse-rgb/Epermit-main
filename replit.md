# Insight|DesignCheck (PermitPilot / Epermit)

## Overview
Insight|DesignCheck (PermitPilot / Epermit) is a web application that streamlines permit management for architects, contractors, and project owners. It centralizes project tracking, uses AI for comment analysis, enables e-permit submission, manages inspections, and automates reporting. The platform aims to boost efficiency, provide jurisdiction intelligence, and integrate financial tools.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
-   **Framework:** React 18 with TypeScript and Vite 5.
-   **UI/UX:** shadcn/ui (Radix UI primitives) and Tailwind CSS, supporting light/dark modes. Design follows a Commun-ET dark obsidian theme.
-   **State Management:** TanStack React Query for server state; React hooks for local state; `SelectedProjectContext` for persistent project selection.
-   **Forms:** React Hook Form with Zod for validation.
-   **PWA & Mobile:** Full PWA support and Capacitor 8 for potential native mobile applications.

### Backend (Supabase)
-   **Database:** Postgres with raw SQL migrations.
-   **Authentication:** Supabase Auth with user profiles and subscription tiers.
-   **Edge Functions:** Deno-based serverless functions for AI pipelines (comment parsing, classification, auto-drafting), e-permit submission, and Stripe checkout.
-   **Storage:** Used for inspection photos and document uploads.
-   **Security:** Row Level Security (RLS) based on user ownership, project roles, and admin status.

### Scraper Service
-   **Technology:** Node.js/Express with Playwright for browser automation, supporting multi-portal types (ProjectDox, Accela).
-   **Functionality:** Extracts project data, PDFs, files, and comments, syncing to Supabase. Handles dynamic portal routing, credential matching, and robust file downloads with size guardrails.
-   **AI Compliance Analysis:** Uses OpenAI GPT-4o Vision to analyze architectural drawings for building code compliance, supporting jurisdiction-specific amendments.
-   **Data Sync:** Merges newly scraped data with existing `portal_data` to prevent data loss.
-   **Browser Resilience:** Implements mini-resets, target-closed recovery, and extended timeouts to prevent crashes during long scrapes. Includes duplicate file detection via MD5 hashing and junk URL filtering.

### Shadow Mode
-   **Purpose:** Evaluates AI agent performance without impacting production data, logging predictions to `shadow_predictions`.
-   **Features:** Includes a dashboard for performance monitoring and audit trails, employing a sequential pipeline of agents.
-   **Safety:** Implements a circuit breaker to disable agents if failure rates exceed thresholds.

### Plan Markup Workflow
-   **Purpose:** Integrates a "Plan Markup" step into the response matrix.
-   **Features:** Multi-page PDF viewer (`PlanViewer`), comment panel grouped by page (`CommentPlanPanel`), SVG overlay for revision clouds (`RevisionCloudOverlay`), and architect approval with digital seal (`ArchitectApprovalDialog`).
-   **Export:** Generates revised PDFs with revision clouds, seal stamps, and revision blocks (`stampedPdfExport`).

### Branded Response Package Export
-   **Purpose:** Exports response packages with company branding and selectable templates.
-   **Templates:** Offers Formal Letter, Technical Memo, and Simple Table templates with customizable branding.

### Multi-Round Draft Management
-   **Purpose:** Supports saving and resuming response package drafts across multiple review rounds.
-   **Features:** Auto-incrementing rounds, comment snapshots, and comparison of changes between rounds.

### Multi-Municipality Permit Filing System
-   **Purpose:** Autonomous permit filing across multiple jurisdictions using a 9-agent pipeline.
-   **Support:** Integrates with Accela Citizen Access, Liferay/Momentum, ASP.NET WebForms, and Tyler EnerGov platforms.
-   **Architecture:** Consists of Pre-Flight Agents, a Human Gate, Execution Agents, and Post-Submission monitoring.

### Jurisdiction Map & Intelligence
-   **Purpose:** Interactive Mapbox-powered map displaying jurisdiction permit data and intelligence.
-   **Data:** Stores permit volumes, review timelines, and portal URLs.

### Auth & Roles
-   Manages user authentication, subscription tiers, project access, and admin privileges.

### Background Scrape
-   **Functionality:** Global `ScrapeContext` manages scraping state, allowing non-blocking polling and progress tracking via a floating progress bar and header indicator. Includes re-attachment logic for active sessions and mechanisms to re-initialize browser sessions upon crashes. Files are uploaded to Supabase Storage with PDF validation and duplicate detection.

### Data Fetching Optimization
-   **Strategy:** Utilizes explicit column selection in `useProjects` and other data hooks to avoid fetching large `portal_data` JSONB by default, enhancing performance.
-   **Database Indexes:** Implemented for `agent_runs`, `shadow_predictions`, and `parsed_comments` to improve query performance.

### AccelaProjectView (March 2026)
- **Component**: `src/components/portal/AccelaProjectView.tsx` — dedicated UI for Accela portal records (Baltimore, DC DOB, Fairfax).
- **Detection**: `PortalDataViewer.tsx` checks `portalData.portalType === "accela"` and renders `AccelaProjectView` instead of the generic tab viewer.
- **Layout**: Top bar with record status + expiration date color-coded badges, left sidebar with processing status timeline (green check/grey clock icons), main tabbed content area.
- **Tabs**: Files (with Supabase viewUrl links, failed download badges), Inspections (upcoming/completed sections, empty state), Links (related records with status), Plan Review (key/value display), Payments (fee table).
- **Data mapping**: Reads from `tabs.status.departments`, `tabs.attachments.tables`, `tabs.inspections.tables`, `tabs.relatedRecords.tables`, `tabs.payments.tables`, `tabs.reports.pdfs`.
- **Status badge colors**: Amber for expired, green for approved/issued, grey for closed, blue for pending/in-review, red for denied.

## External Dependencies

-   **Supabase:** Primary backend for database, authentication, edge functions, and storage.
-   **OpenAI:** Powers AI functionalities within Supabase Edge Functions for compliance analysis and content generation.
-   **Stripe:** Handles subscription billing and checkout processes.
-   **Resend:** Manages transactional email delivery.
-   **Mapbox:** Provides interactive mapping capabilities for jurisdiction intelligence.
-   **Playwright:** Used by the scraper service for robust web automation and data extraction.
-   **Capacitor:** For potential native iOS/Android application builds.
-   **PDF Libraries:** `jsPDF` for client-side PDF generation and `pdfjs-dist` for parsing and rendering PDFs.