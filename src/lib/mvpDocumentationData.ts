// MVP Documentation Data Structure

export interface RouteInfo {
  path: string;
  name: string;
  description: string;
  authRequired: boolean;
}

export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  description?: string;
}

export interface TableInfo {
  name: string;
  description: string;
  columns: TableColumn[];
  relationships?: string[];
}

export interface EdgeFunctionInfo {
  name: string;
  description: string;
  method: string;
  authRequired: boolean;
}

export interface FeatureInfo {
  category: string;
  features: {
    name: string;
    description: string;
  }[];
}

export interface SubscriptionTier {
  name: string;
  price: string;
  features: string[];
}

export interface EnumInfo {
  name: string;
  values: string[];
  description: string;
}

export interface HookInfo {
  name: string;
  description: string;
  returnType: string;
}

export interface ComponentInfo {
  category: string;
  components: string[];
}

export interface MVPDocumentation {
  appName: string;
  tagline: string;
  version: string;
  liveUrl: string;
  techStack: {
    category: string;
    technologies: string[];
  }[];
  routes: RouteInfo[];
  tables: TableInfo[];
  edgeFunctions: EdgeFunctionInfo[];
  features: FeatureInfo[];
  subscriptionTiers: SubscriptionTier[];
  enums: EnumInfo[];
  hooks: HookInfo[];
  components: ComponentInfo[];
  rlsPolicies: {
    name: string;
    description: string;
  }[];
}

export const mvpDocumentationData: MVPDocumentation = {
  appName: "PermitPilot (Insight|DesignCheck)",
  tagline: "AI-Powered Permit Management & Code Compliance Platform",
  version: "1.0.0 MVP",
  liveUrl: "https://review-resolve-ai.lovable.app",
  
  techStack: [
    {
      category: "Frontend",
      technologies: [
        "React 18.3.1 - UI Framework",
        "TypeScript - Type Safety",
        "Vite - Build Tool",
        "Tailwind CSS - Styling",
        "shadcn/ui - Component Library",
        "Framer Motion 12.x - Animations",
        "TanStack React Query 5.x - Data Fetching",
        "React Router DOM 6.x - Routing",
        "Recharts 2.x - Data Visualization"
      ]
    },
    {
      category: "Backend",
      technologies: [
        "Supabase - Backend as a Service",
        "PostgreSQL - Database",
        "Supabase Auth - Authentication",
        "Supabase Edge Functions - Serverless APIs",
        "Supabase Storage - File Storage",
        "Supabase Realtime - Real-time Subscriptions"
      ]
    },
    {
      category: "Integrations",
      technologies: [
        "Stripe - Payment Processing",
        "Mapbox GL - Interactive Maps",
        "ElevenLabs - Text-to-Speech",
        "Accela/CityView - E-Permit Integration",
        "Shovels API - Permit Data"
      ]
    },
    {
      category: "PWA & Mobile",
      technologies: [
        "vite-plugin-pwa - Progressive Web App",
        "Capacitor 8.x - Native Mobile",
        "Service Workers - Offline Support"
      ]
    }
  ],

  routes: [
    { path: "/", name: "Home", description: "Landing page with hero, features, testimonials, pricing preview", authRequired: false },
    { path: "/demos", name: "Demos", description: "Interactive feature demonstrations", authRequired: false },
    { path: "/pricing", name: "Pricing", description: "Subscription tier comparison and checkout", authRequired: false },
    { path: "/contact", name: "Contact", description: "Contact form and company information", authRequired: false },
    { path: "/roi-calculator", name: "ROI Calculator", description: "Calculate potential savings with the platform", authRequired: false },
    { path: "/consolidation-calculator", name: "Consolidation Calculator", description: "Lot consolidation analysis tool", authRequired: false },
    { path: "/auth", name: "Authentication", description: "Login, signup, and password reset", authRequired: false },
    { path: "/dashboard", name: "Dashboard", description: "Main user dashboard with widgets and overview", authRequired: true },
    { path: "/projects", name: "Projects", description: "Project management with Kanban and list views", authRequired: true },
    { path: "/analytics", name: "Analytics", description: "Project analytics, cycle times, cost tracking", authRequired: true },
    { path: "/code-compliance", name: "Code Compliance", description: "AI-powered code compliance analysis", authRequired: true },
    { path: "/code-reference", name: "Code Reference Library", description: "Building code reference database", authRequired: true },
    { path: "/permit-intelligence", name: "Permit Intelligence", description: "AI permit analysis and recommendations", authRequired: true },
    { path: "/jurisdictions/map", name: "Jurisdiction Map", description: "Interactive map of supported jurisdictions", authRequired: false },
    { path: "/jurisdictions/compare", name: "Jurisdiction Comparison", description: "Compare requirements across jurisdictions", authRequired: true },
    { path: "/admin", name: "Admin Panel", description: "System administration and user management", authRequired: true },
    { path: "/admin/jurisdictions", name: "Jurisdiction Admin", description: "Manage jurisdiction database", authRequired: true },
    { path: "/admin/feature-flags", name: "Feature Flags", description: "Toggle features on/off", authRequired: true },
    { path: "/client-portal/:token", name: "Client Portal", description: "Public project view for clients", authRequired: false },
    { path: "/embed/widget", name: "Embed Widget", description: "Embeddable jurisdiction search widget", authRequired: false },
    { path: "/install", name: "PWA Install", description: "Progressive Web App installation guide", authRequired: false },
    { path: "/state/:stateCode", name: "State Landing Page", description: "SEO landing pages for each state", authRequired: false },
    { path: "/mvp-documentation", name: "MVP Documentation", description: "Export MVP documentation as PDF", authRequired: false }
  ],

  tables: [
    {
      name: "projects",
      description: "Core project/permit tracking table",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()", description: "Primary key" },
        { name: "user_id", type: "UUID", nullable: false, description: "Owner reference" },
        { name: "name", type: "TEXT", nullable: false, description: "Project name" },
        { name: "description", type: "TEXT", nullable: true, description: "Project description" },
        { name: "status", type: "project_status", nullable: false, defaultValue: "draft", description: "Current status" },
        { name: "project_type", type: "project_type", nullable: true, description: "Type of project" },
        { name: "address", type: "TEXT", nullable: true, description: "Project address" },
        { name: "city", type: "TEXT", nullable: true, description: "City" },
        { name: "state", type: "TEXT", nullable: true, description: "State" },
        { name: "zip_code", type: "TEXT", nullable: true, description: "ZIP code" },
        { name: "jurisdiction", type: "TEXT", nullable: true, description: "Jurisdiction name" },
        { name: "permit_number", type: "TEXT", nullable: true, description: "Assigned permit number" },
        { name: "deadline", type: "TIMESTAMP", nullable: true, description: "Target completion date" },
        { name: "submitted_at", type: "TIMESTAMP", nullable: true, description: "Submission date" },
        { name: "approved_at", type: "TIMESTAMP", nullable: true, description: "Approval date" },
        { name: "estimated_value", type: "NUMERIC", nullable: true, description: "Project value" },
        { name: "square_footage", type: "NUMERIC", nullable: true, description: "Project size" },
        { name: "permit_fee", type: "NUMERIC", nullable: true, description: "Permit fees" },
        { name: "expeditor_cost", type: "NUMERIC", nullable: true, description: "Expeditor costs" },
        { name: "total_cost", type: "NUMERIC", nullable: true, description: "Total project cost" },
        { name: "rejection_count", type: "INTEGER", nullable: true, description: "Number of rejections" },
        { name: "rejection_reasons", type: "TEXT[]", nullable: true, description: "Array of rejection reasons" },
        { name: "notes", type: "TEXT", nullable: true, description: "Internal notes" },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ],
      relationships: ["project_documents", "project_team_members", "inspections", "punch_list_items"]
    },
    {
      name: "profiles",
      description: "User profile information",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false, description: "Auth user reference" },
        { name: "full_name", type: "TEXT", nullable: true },
        { name: "company_name", type: "TEXT", nullable: true },
        { name: "job_title", type: "TEXT", nullable: true },
        { name: "phone", type: "TEXT", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "project_documents",
      description: "Document storage and version control",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false, description: "Parent project" },
        { name: "user_id", type: "UUID", nullable: false, description: "Uploader" },
        { name: "file_name", type: "TEXT", nullable: false },
        { name: "file_path", type: "TEXT", nullable: false },
        { name: "file_size", type: "INTEGER", nullable: false },
        { name: "file_type", type: "TEXT", nullable: false },
        { name: "document_type", type: "document_type", nullable: false, defaultValue: "other" },
        { name: "description", type: "TEXT", nullable: true },
        { name: "version", type: "INTEGER", nullable: false, defaultValue: "1" },
        { name: "parent_document_id", type: "UUID", nullable: true, description: "For version tracking" },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ],
      relationships: ["document_annotations", "document_comments"]
    },
    {
      name: "project_team_members",
      description: "Team member assignments to projects",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "role", type: "team_role", nullable: false, defaultValue: "viewer" },
        { name: "added_by", type: "UUID", nullable: false },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "project_invitations",
      description: "Pending team invitations",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "email", type: "TEXT", nullable: false },
        { name: "role", type: "team_role", nullable: false, defaultValue: "viewer" },
        { name: "token", type: "TEXT", nullable: false },
        { name: "invited_by", type: "UUID", nullable: false },
        { name: "status", type: "TEXT", nullable: false, defaultValue: "pending" },
        { name: "expires_at", type: "TIMESTAMP", nullable: false },
        { name: "accepted_at", type: "TIMESTAMP", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "project_share_links",
      description: "Public sharing links for projects",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "token", type: "TEXT", nullable: false },
        { name: "created_by", type: "UUID", nullable: false },
        { name: "is_active", type: "BOOLEAN", nullable: false, defaultValue: "true" },
        { name: "expires_at", type: "TIMESTAMP", nullable: true },
        { name: "view_count", type: "INTEGER", nullable: false, defaultValue: "0" },
        { name: "last_viewed_at", type: "TIMESTAMP", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "project_activity",
      description: "Activity log for project events",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "activity_type", type: "activity_type", nullable: false },
        { name: "title", type: "TEXT", nullable: false },
        { name: "description", type: "TEXT", nullable: true },
        { name: "metadata", type: "JSONB", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "project_chat_messages",
      description: "Real-time project chat",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "content", type: "TEXT", nullable: false },
        { name: "mentions", type: "TEXT[]", nullable: true },
        { name: "reply_to_id", type: "UUID", nullable: true },
        { name: "edited_at", type: "TIMESTAMP", nullable: true },
        { name: "deleted_at", type: "TIMESTAMP", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "inspections",
      description: "Inspection scheduling and tracking",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "inspection_type", type: "inspection_type", nullable: false },
        { name: "status", type: "inspection_status", nullable: false, defaultValue: "scheduled" },
        { name: "scheduled_date", type: "TIMESTAMP", nullable: false },
        { name: "completed_date", type: "TIMESTAMP", nullable: true },
        { name: "inspector_name", type: "TEXT", nullable: true },
        { name: "inspector_notes", type: "TEXT", nullable: true },
        { name: "result_notes", type: "TEXT", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ],
      relationships: ["punch_list_items", "inspection_photos"]
    },
    {
      name: "punch_list_items",
      description: "Deficiency tracking from inspections",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "inspection_id", type: "UUID", nullable: true },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "title", type: "TEXT", nullable: false },
        { name: "description", type: "TEXT", nullable: true },
        { name: "location", type: "TEXT", nullable: true },
        { name: "priority", type: "punch_list_priority", nullable: false, defaultValue: "medium" },
        { name: "status", type: "punch_list_status", nullable: false, defaultValue: "open" },
        { name: "assigned_to", type: "TEXT", nullable: true },
        { name: "due_date", type: "DATE", nullable: true },
        { name: "resolved_at", type: "TIMESTAMP", nullable: true },
        { name: "resolved_by", type: "UUID", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ],
      relationships: ["inspection_photos"]
    },
    {
      name: "inspection_photos",
      description: "Photo documentation for inspections",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "project_id", type: "UUID", nullable: true },
        { name: "inspection_id", type: "UUID", nullable: true },
        { name: "punch_list_item_id", type: "UUID", nullable: true },
        { name: "checklist_item_id", type: "TEXT", nullable: true },
        { name: "file_name", type: "TEXT", nullable: false },
        { name: "file_path", type: "TEXT", nullable: false },
        { name: "file_size", type: "INTEGER", nullable: true },
        { name: "caption", type: "TEXT", nullable: true },
        { name: "location", type: "TEXT", nullable: true },
        { name: "taken_at", type: "TIMESTAMP", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "inspection_checklist_templates",
      description: "Reusable inspection checklist templates",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "name", type: "TEXT", nullable: false },
        { name: "description", type: "TEXT", nullable: true },
        { name: "inspection_type", type: "TEXT", nullable: false },
        { name: "categories", type: "JSONB", nullable: false, defaultValue: "[]" },
        { name: "visibility", type: "TEXT", nullable: false, defaultValue: "private" },
        { name: "is_default", type: "BOOLEAN", nullable: true, defaultValue: "false" },
        { name: "shared_at", type: "TIMESTAMP", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "document_annotations",
      description: "Drawing annotations on documents",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "document_id", type: "UUID", nullable: true },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "annotation_type", type: "TEXT", nullable: false },
        { name: "data", type: "JSONB", nullable: false, defaultValue: "{}" },
        { name: "color", type: "TEXT", nullable: true },
        { name: "stroke_width", type: "INTEGER", nullable: true },
        { name: "layer_order", type: "INTEGER", nullable: true },
        { name: "visible", type: "BOOLEAN", nullable: true, defaultValue: "true" },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "document_comments",
      description: "Comments and threads on documents",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "document_id", type: "UUID", nullable: true },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "content", type: "TEXT", nullable: false },
        { name: "position_x", type: "NUMERIC", nullable: true },
        { name: "position_y", type: "NUMERIC", nullable: true },
        { name: "parent_comment_id", type: "UUID", nullable: true },
        { name: "mentions", type: "TEXT[]", nullable: true },
        { name: "resolved", type: "BOOLEAN", nullable: true, defaultValue: "false" },
        { name: "resolved_by", type: "UUID", nullable: true },
        { name: "resolved_at", type: "TIMESTAMP", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "jurisdictions",
      description: "Jurisdiction database with requirements",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "name", type: "TEXT", nullable: false },
        { name: "state", type: "TEXT", nullable: false },
        { name: "city", type: "TEXT", nullable: true },
        { name: "county", type: "TEXT", nullable: true },
        { name: "address", type: "TEXT", nullable: true },
        { name: "phone", type: "TEXT", nullable: true },
        { name: "email", type: "TEXT", nullable: true },
        { name: "website_url", type: "TEXT", nullable: true },
        { name: "fee_schedule_url", type: "TEXT", nullable: true },
        { name: "submission_methods", type: "TEXT[]", nullable: true },
        { name: "accepted_file_formats", type: "TEXT[]", nullable: true },
        { name: "plan_review_sla_days", type: "INTEGER", nullable: true },
        { name: "permit_issuance_sla_days", type: "INTEGER", nullable: true },
        { name: "inspection_sla_days", type: "INTEGER", nullable: true },
        { name: "base_permit_fee", type: "NUMERIC", nullable: true },
        { name: "plan_review_fee", type: "NUMERIC", nullable: true },
        { name: "inspection_fee", type: "NUMERIC", nullable: true },
        { name: "expedited_available", type: "BOOLEAN", nullable: true },
        { name: "expedited_fee_multiplier", type: "NUMERIC", nullable: true },
        { name: "special_requirements", type: "TEXT", nullable: true },
        { name: "notes", type: "TEXT", nullable: true },
        { name: "reviewer_contacts", type: "JSONB", nullable: true },
        { name: "is_active", type: "BOOLEAN", nullable: true, defaultValue: "true" },
        { name: "is_high_volume", type: "BOOLEAN", nullable: true },
        { name: "residential_units_2024", type: "INTEGER", nullable: true },
        { name: "sf_1unit_units_2024", type: "INTEGER", nullable: true },
        { name: "duplex_units_2024", type: "INTEGER", nullable: true },
        { name: "mf_3plus_units_2024", type: "INTEGER", nullable: true },
        { name: "fips_place", type: "TEXT", nullable: true },
        { name: "data_source", type: "TEXT", nullable: true },
        { name: "last_verified_at", type: "TIMESTAMP", nullable: true },
        { name: "verified_by", type: "TEXT", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "jurisdiction_subscriptions",
      description: "User subscriptions to jurisdiction updates",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "jurisdiction_id", type: "UUID", nullable: false },
        { name: "jurisdiction_name", type: "TEXT", nullable: false },
        { name: "jurisdiction_state", type: "TEXT", nullable: false },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "jurisdiction_notifications",
      description: "Notifications for jurisdiction updates",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "jurisdiction_id", type: "UUID", nullable: false },
        { name: "jurisdiction_name", type: "TEXT", nullable: false },
        { name: "title", type: "TEXT", nullable: false },
        { name: "message", type: "TEXT", nullable: false },
        { name: "is_read", type: "BOOLEAN", nullable: false, defaultValue: "false" },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "mention_notifications",
      description: "Notifications for @mentions",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "mentioned_by", type: "UUID", nullable: false },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "reference_type", type: "TEXT", nullable: false },
        { name: "reference_id", type: "UUID", nullable: false },
        { name: "content_preview", type: "TEXT", nullable: true },
        { name: "is_read", type: "BOOLEAN", nullable: true, defaultValue: "false" },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "scheduled_notifications",
      description: "Scheduled notification queue",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "admin_user_id", type: "UUID", nullable: false },
        { name: "admin_email", type: "TEXT", nullable: false },
        { name: "jurisdiction_id", type: "UUID", nullable: false },
        { name: "jurisdiction_name", type: "TEXT", nullable: false },
        { name: "notification_title", type: "TEXT", nullable: false },
        { name: "notification_message", type: "TEXT", nullable: false },
        { name: "scheduled_for", type: "TIMESTAMP", nullable: false },
        { name: "status", type: "TEXT", nullable: false, defaultValue: "pending" },
        { name: "send_email", type: "BOOLEAN", nullable: true, defaultValue: "true" },
        { name: "processed_at", type: "TIMESTAMP", nullable: true },
        { name: "error_message", type: "TEXT", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "epermit_submissions",
      description: "E-permit system integration submissions",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "system", type: "epermit_system", nullable: false },
        { name: "environment", type: "TEXT", nullable: false, defaultValue: "sandbox" },
        { name: "permit_type", type: "TEXT", nullable: false },
        { name: "applicant_name", type: "TEXT", nullable: false },
        { name: "applicant_email", type: "TEXT", nullable: false },
        { name: "status", type: "epermit_status", nullable: false, defaultValue: "pending" },
        { name: "status_message", type: "TEXT", nullable: true },
        { name: "tracking_number", type: "TEXT", nullable: true },
        { name: "record_id", type: "TEXT", nullable: true },
        { name: "response_data", type: "JSONB", nullable: true },
        { name: "status_history", type: "JSONB", nullable: true },
        { name: "submitted_at", type: "TIMESTAMP", nullable: true },
        { name: "last_status_check", type: "TIMESTAMP", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "admin_activity_log",
      description: "Admin action audit trail",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "admin_user_id", type: "UUID", nullable: false },
        { name: "admin_email", type: "TEXT", nullable: false },
        { name: "action_type", type: "TEXT", nullable: false },
        { name: "jurisdiction_id", type: "UUID", nullable: true },
        { name: "jurisdiction_name", type: "TEXT", nullable: true },
        { name: "notification_title", type: "TEXT", nullable: true },
        { name: "notification_message", type: "TEXT", nullable: true },
        { name: "subscriber_count", type: "INTEGER", nullable: true },
        { name: "email_sent", type: "BOOLEAN", nullable: true },
        { name: "delivery_status", type: "TEXT", nullable: true },
        { name: "error_message", type: "TEXT", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "user_roles",
      description: "User role assignments",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "role", type: "app_role", nullable: false },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "coverage_requests",
      description: "Requests for new jurisdiction coverage",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "email", type: "TEXT", nullable: false },
        { name: "jurisdiction_name", type: "TEXT", nullable: false },
        { name: "state", type: "TEXT", nullable: false },
        { name: "city", type: "TEXT", nullable: true },
        { name: "county", type: "TEXT", nullable: true },
        { name: "company_name", type: "TEXT", nullable: true },
        { name: "project_type", type: "TEXT", nullable: true },
        { name: "estimated_permits_per_year", type: "INTEGER", nullable: true },
        { name: "notes", type: "TEXT", nullable: true },
        { name: "status", type: "TEXT", nullable: false, defaultValue: "pending" },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "saved_calculations",
      description: "Saved ROI and consolidation calculations",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "name", type: "TEXT", nullable: false },
        { name: "calculation_type", type: "TEXT", nullable: false },
        { name: "input_data", type: "JSONB", nullable: false },
        { name: "results_data", type: "JSONB", nullable: false },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "staff_assignments",
      description: "Staff time tracking on projects",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "project_id", type: "UUID", nullable: false },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "assigned_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "completed_at", type: "TIMESTAMP", nullable: true },
        { name: "hours_worked", type: "NUMERIC", nullable: true },
        { name: "notes", type: "TEXT", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "user_drip_campaigns",
      description: "Marketing email drip campaign tracking",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "user_id", type: "UUID", nullable: false },
        { name: "email", type: "TEXT", nullable: false },
        { name: "user_name", type: "TEXT", nullable: true },
        { name: "campaign_type", type: "TEXT", nullable: false, defaultValue: "onboarding" },
        { name: "is_active", type: "BOOLEAN", nullable: false, defaultValue: "true" },
        { name: "emails_sent", type: "INTEGER", nullable: false, defaultValue: "0" },
        { name: "last_email_sent_at", type: "TIMESTAMP", nullable: true },
        { name: "enrolled_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "completed_at", type: "TIMESTAMP", nullable: true },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    },
    {
      name: "email_branding_settings",
      description: "Email template branding configuration",
      columns: [
        { name: "id", type: "UUID", nullable: false, defaultValue: "gen_random_uuid()" },
        { name: "logo_url", type: "TEXT", nullable: true },
        { name: "primary_color", type: "TEXT", nullable: false, defaultValue: "#3b82f6" },
        { name: "header_text", type: "TEXT", nullable: false, defaultValue: "PermitPilot" },
        { name: "footer_text", type: "TEXT", nullable: false, defaultValue: "© 2024 PermitPilot. All rights reserved." },
        { name: "unsubscribe_text", type: "TEXT", nullable: false, defaultValue: "Unsubscribe from these emails" },
        { name: "created_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" },
        { name: "updated_at", type: "TIMESTAMP", nullable: false, defaultValue: "now()" }
      ]
    }
  ],

  edgeFunctions: [
    { name: "epermit-submit", description: "Submit permit applications to Accela/CityView e-permit systems", method: "POST", authRequired: true },
    { name: "send-epermit-status-email", description: "Send email notifications when permit status changes", method: "POST", authRequired: true },
    { name: "stripe-webhook", description: "Handle Stripe payment events (checkout, subscription changes)", method: "POST", authRequired: false },
    { name: "create-checkout", description: "Create Stripe checkout session for subscription", method: "POST", authRequired: true },
    { name: "customer-portal", description: "Generate Stripe customer portal link", method: "POST", authRequired: true },
    { name: "check-subscription", description: "Verify user subscription status", method: "GET", authRequired: true },
    { name: "shovels-api", description: "Proxy requests to Shovels permit data API", method: "POST", authRequired: true },
    { name: "get-mapbox-token", description: "Securely retrieve Mapbox access token", method: "GET", authRequired: false },
    { name: "analyze-drawing", description: "AI-powered drawing analysis for compliance", method: "POST", authRequired: true },
    { name: "elevenlabs-tts", description: "Text-to-speech synthesis using ElevenLabs", method: "POST", authRequired: true },
    { name: "send-contact-email", description: "Send contact form submissions", method: "POST", authRequired: false },
    { name: "send-welcome-email", description: "Send welcome email to new users", method: "POST", authRequired: true },
    { name: "send-deadline-reminders", description: "Cron job for deadline reminder emails", method: "POST", authRequired: false },
    { name: "send-inspection-reminders", description: "Cron job for inspection reminder emails", method: "POST", authRequired: false },
    { name: "send-jurisdiction-notification", description: "Send notifications to jurisdiction subscribers", method: "POST", authRequired: true },
    { name: "process-scheduled-notifications", description: "Process queued scheduled notifications", method: "POST", authRequired: false },
    { name: "process-drip-emails", description: "Process marketing drip campaign emails", method: "POST", authRequired: false },
    { name: "admin-drip-campaigns", description: "Manage drip campaign settings and enrollments", method: "POST", authRequired: true },
    { name: "validate-url", description: "Validate and check URLs for availability", method: "POST", authRequired: false }
  ],

  features: [
    {
      category: "Project Management",
      features: [
        { name: "Kanban Board", description: "Drag-and-drop project status management with 5 columns (Draft, Submitted, In Review, Corrections, Approved)" },
        { name: "List View", description: "Tabular view of all projects with sorting and filtering" },
        { name: "Project Details", description: "Comprehensive project information including address, jurisdiction, costs, timeline" },
        { name: "Status Tracking", description: "Automatic status transitions with timestamps" },
        { name: "Deadline Management", description: "Set and track project deadlines with reminders" },
        { name: "Rejection Tracking", description: "Track rejection counts and reasons for each project" },
        { name: "Cost Tracking", description: "Track permit fees, expeditor costs, and total project costs" }
      ]
    },
    {
      category: "Document Management",
      features: [
        { name: "File Upload", description: "Upload documents with drag-and-drop support" },
        { name: "Document Types", description: "Categorize documents (drawings, specs, calcs, site plans, etc.)" },
        { name: "Version Control", description: "Track document versions with parent-child relationships" },
        { name: "Annotations", description: "Draw annotations on documents with multiple tools (pen, shapes, text)" },
        { name: "Comments", description: "Add comments with @mentions and threaded replies" },
        { name: "Comment Resolution", description: "Mark comments as resolved and track resolution" }
      ]
    },
    {
      category: "Inspection Management",
      features: [
        { name: "Inspection Scheduling", description: "Schedule inspections with calendar integration" },
        { name: "Inspection Types", description: "13 predefined inspection types (foundation, framing, electrical, etc.)" },
        { name: "Status Tracking", description: "Track inspection status (scheduled, passed, failed, conditional)" },
        { name: "Checklist Templates", description: "Create and reuse inspection checklist templates" },
        { name: "Photo Documentation", description: "Attach photos to inspections and checklist items" },
        { name: "QR Codes", description: "Generate QR codes for quick checklist access on mobile" },
        { name: "Digital Signatures", description: "Capture inspector and contractor signatures" },
        { name: "Offline Support", description: "Complete checklists offline with sync when connected" },
        { name: "Punch Lists", description: "Generate and track punch list items from failed inspections" },
        { name: "Printable Checklists", description: "Print inspection checklists with photos and signatures" }
      ]
    },
    {
      category: "Team Collaboration",
      features: [
        { name: "Team Roles", description: "4 role levels (Owner, Admin, Editor, Viewer) with different permissions" },
        { name: "Invitations", description: "Invite team members via email with expiring tokens" },
        { name: "Client Sharing", description: "Generate public share links for client access" },
        { name: "Activity Timeline", description: "Track all project activity with timestamps" },
        { name: "Project Chat", description: "Real-time chat with @mentions and replies" },
        { name: "Mention Notifications", description: "Get notified when mentioned in comments or chat" }
      ]
    },
    {
      category: "Jurisdiction Intelligence",
      features: [
        { name: "Jurisdiction Database", description: "Comprehensive database of jurisdiction requirements" },
        { name: "Jurisdiction Comparison", description: "Side-by-side comparison of up to 4 jurisdictions" },
        { name: "Interactive Map", description: "Mapbox-powered map of jurisdiction coverage" },
        { name: "Fee Information", description: "Permit fees, plan review fees, inspection fees" },
        { name: "SLA Tracking", description: "Plan review, permit issuance, and inspection SLAs" },
        { name: "Subscription Alerts", description: "Subscribe to jurisdiction updates and get notified" },
        { name: "Coverage Requests", description: "Request coverage for new jurisdictions" }
      ]
    },
    {
      category: "Analytics & Reporting",
      features: [
        { name: "Dashboard Widgets", description: "Customizable dashboard with key metrics" },
        { name: "Cycle Time Analysis", description: "Track time from draft to approval" },
        { name: "Cost Analysis", description: "Analyze permit and expeditor costs" },
        { name: "Rejection Trends", description: "Identify common rejection reasons" },
        { name: "Jurisdiction Performance", description: "Compare performance across jurisdictions" },
        { name: "Project Type Breakdown", description: "Analyze projects by type" },
        { name: "Export Reports", description: "Export analytics data to CSV" }
      ]
    },
    {
      category: "AI Tools",
      features: [
        { name: "Code Compliance Analyzer", description: "AI-powered analysis of documents for code compliance" },
        { name: "Drawing Analysis", description: "Automated analysis of architectural drawings" },
        { name: "Pre-Submittal Detection", description: "Identify potential issues before submission" },
        { name: "Auto-Fill Forms", description: "AI-powered form auto-completion" },
        { name: "Text-to-Speech", description: "Voice narration of compliance reports" }
      ]
    },
    {
      category: "Integrations",
      features: [
        { name: "Stripe Payments", description: "Subscription billing with Stripe" },
        { name: "Mapbox Maps", description: "Interactive jurisdiction mapping" },
        { name: "Accela Integration", description: "Direct submission to Accela e-permit systems" },
        { name: "CityView Integration", description: "Direct submission to CityView e-permit systems" },
        { name: "Shovels API", description: "Access to permit intelligence data" },
        { name: "ElevenLabs TTS", description: "AI voice synthesis for reports" }
      ]
    },
    {
      category: "PWA & Mobile",
      features: [
        { name: "Progressive Web App", description: "Install as native app on mobile and desktop" },
        { name: "Offline Support", description: "Work offline with automatic sync" },
        { name: "Push Notifications", description: "Receive notifications on mobile devices" },
        { name: "Responsive Design", description: "Optimized for all screen sizes" },
        { name: "Capacitor Ready", description: "Build native iOS/Android apps" }
      ]
    }
  ],

  subscriptionTiers: [
    {
      name: "Free",
      price: "$0/month",
      features: [
        "Up to 3 active projects",
        "Basic document storage (100MB)",
        "Jurisdiction lookup",
        "Community support"
      ]
    },
    {
      name: "Starter",
      price: "$49/month",
      features: [
        "Up to 10 active projects",
        "Document storage (1GB)",
        "Inspection scheduling",
        "Basic analytics",
        "Email support"
      ]
    },
    {
      name: "Professional",
      price: "$99/month",
      features: [
        "Up to 50 active projects",
        "Document storage (10GB)",
        "Full inspection management",
        "Team collaboration (3 members)",
        "Advanced analytics",
        "Priority support"
      ]
    },
    {
      name: "Business",
      price: "$249/month",
      features: [
        "Unlimited projects",
        "Document storage (50GB)",
        "Full feature access",
        "Team collaboration (10 members)",
        "API access",
        "E-permit integration",
        "Custom reporting",
        "Dedicated support"
      ]
    },
    {
      name: "Enterprise",
      price: "Custom",
      features: [
        "Everything in Business",
        "Unlimited storage",
        "Unlimited team members",
        "Custom integrations",
        "On-premise deployment option",
        "SLA guarantees",
        "Dedicated account manager"
      ]
    }
  ],

  enums: [
    {
      name: "project_status",
      values: ["draft", "submitted", "in_review", "corrections", "approved"],
      description: "Project lifecycle stages"
    },
    {
      name: "project_type",
      values: ["new_construction", "renovation", "addition", "tenant_improvement", "demolition", "other"],
      description: "Categories of construction projects"
    },
    {
      name: "inspection_type",
      values: ["foundation", "framing", "electrical_rough", "electrical_final", "plumbing_rough", "plumbing_final", "mechanical_rough", "mechanical_final", "insulation", "drywall", "fire_safety", "final", "other"],
      description: "Types of construction inspections"
    },
    {
      name: "inspection_status",
      values: ["scheduled", "in_progress", "passed", "failed", "conditional", "cancelled"],
      description: "Inspection outcome states"
    },
    {
      name: "document_type",
      values: ["permit_drawing", "submittal_package", "structural_calcs", "site_plan", "floor_plan", "elevation", "specification", "inspection_report", "correspondence", "other"],
      description: "Document categorization"
    },
    {
      name: "team_role",
      values: ["owner", "admin", "editor", "viewer"],
      description: "Project team permission levels"
    },
    {
      name: "punch_list_priority",
      values: ["low", "medium", "high", "critical"],
      description: "Deficiency urgency levels"
    },
    {
      name: "punch_list_status",
      values: ["open", "in_progress", "resolved", "verified"],
      description: "Deficiency resolution states"
    },
    {
      name: "epermit_status",
      values: ["pending", "submitted", "under_review", "additional_info_required", "approved", "denied", "cancelled", "expired"],
      description: "E-permit submission states"
    },
    {
      name: "epermit_system",
      values: ["accela", "cityview"],
      description: "Supported e-permit platforms"
    },
    {
      name: "app_role",
      values: ["admin", "moderator", "user"],
      description: "Application-level user roles"
    },
    {
      name: "activity_type",
      values: ["project_created", "project_updated", "project_status_changed", "document_uploaded", "document_version_uploaded", "document_deleted", "team_member_invited", "team_member_joined", "team_member_removed", "team_member_role_changed", "inspection_scheduled", "inspection_updated", "inspection_passed", "inspection_failed", "inspection_cancelled", "punch_item_created", "punch_item_updated", "punch_item_resolved", "punch_item_verified", "comment_added"],
      description: "Types of tracked activities"
    }
  ],

  hooks: [
    { name: "useAuth", description: "Authentication state and methods (login, signup, logout)", returnType: "AuthContext" },
    { name: "useProjects", description: "CRUD operations for projects", returnType: "{ projects, createProject, updateProject, deleteProject }" },
    { name: "useProjectDocuments", description: "Document management for a project", returnType: "{ documents, uploadDocument, deleteDocument }" },
    { name: "useProjectTeam", description: "Team member management", returnType: "{ members, invitations, inviteMember, removeMember }" },
    { name: "useProjectActivity", description: "Activity timeline for a project", returnType: "{ activities, isLoading }" },
    { name: "useProjectChat", description: "Real-time chat messages", returnType: "{ messages, sendMessage, editMessage, deleteMessage }" },
    { name: "useProjectShareLinks", description: "Public share link management", returnType: "{ shareLinks, createLink, revokeLink }" },
    { name: "useInspections", description: "Inspection CRUD operations", returnType: "{ inspections, scheduleInspection, updateInspection }" },
    { name: "useInspectionPhotos", description: "Photo management for inspections", returnType: "{ photos, uploadPhoto, deletePhoto }" },
    { name: "useChecklistTemplates", description: "Inspection checklist template management", returnType: "{ templates, createTemplate, updateTemplate }" },
    { name: "useJurisdictions", description: "Jurisdiction data and search", returnType: "{ jurisdictions, searchJurisdictions }" },
    { name: "useDocumentAnnotations", description: "Drawing annotations on documents", returnType: "{ annotations, addAnnotation, updateAnnotation }" },
    { name: "useDocumentComments", description: "Comments on documents", returnType: "{ comments, addComment, resolveComment }" },
    { name: "useEPermitSubmissions", description: "E-permit submission tracking", returnType: "{ submissions, submitPermit, checkStatus }" },
    { name: "useAnalytics", description: "Analytics data fetching", returnType: "{ data, dateRange, setDateRange }" },
    { name: "useFeatureFlags", description: "Feature flag management", returnType: "{ flags, isEnabled }" },
    { name: "useOfflineStorage", description: "Offline data persistence", returnType: "{ saveOffline, loadOffline, syncOffline }" },
    { name: "useOnboarding", description: "User onboarding state", returnType: "{ currentStep, completeStep, isComplete }" },
    { name: "useTheme", description: "Theme management (light/dark)", returnType: "{ theme, setTheme }" },
    { name: "useMobile", description: "Mobile device detection", returnType: "{ isMobile }" }
  ],

  components: [
    {
      category: "Layout",
      components: ["Header", "Footer", "Layout", "NavLink", "ThemeToggle"]
    },
    {
      category: "Dashboard",
      components: ["DeadlineAlertsWidget", "InspectionsPunchListWidget"]
    },
    {
      category: "Projects",
      components: ["ProjectCard", "ProjectFormDialog", "ProjectDetailDialog", "KanbanColumn", "JurisdictionLookup", "SlaEstimateDisplay", "ShareProjectDialog", "DeleteProjectDialog"]
    },
    {
      category: "Documents",
      components: ["DocumentList", "DocumentUploadDialog", "DocumentVersionDialog", "DocumentAnnotationCanvas"]
    },
    {
      category: "Inspections",
      components: ["InspectionList", "InspectionCalendar", "ScheduleInspectionDialog", "RecordInspectionResultDialog", "PunchList", "GeneratePunchListDialog", "PrintableInspectionChecklist", "ChecklistQRCode", "ChecklistPhotoUpload", "OfflineChecklistManager", "SignaturePad"]
    },
    {
      category: "Collaboration",
      components: ["ProjectTeamSection", "TeamMemberList", "InviteTeamMemberDialog", "CommentThread", "ProjectChatSidebar", "ProjectActivitySection", "ActivityTimeline"]
    },
    {
      category: "Jurisdictions",
      components: ["JurisdictionMap", "JurisdictionComparisonTool", "CoverageRequestForm", "JurisdictionSearchWidget", "LiveJurisdictionCounter"]
    },
    {
      category: "Analytics",
      components: ["AnalyticsSummaryCards", "CycleTimeChart", "CostTrackingCard", "ProjectTypePieChart", "JurisdictionTable", "JurisdictionTrendsChart", "RejectionTrendsChart", "DateRangeFilter", "AnalyticsExport"]
    },
    {
      category: "AI Tools",
      components: ["AIComplianceAnalyzer", "AutoFillDemo", "PreSubmittalDetectionDemo", "InteractiveDrawingViewer", "JurisdictionLookupDemo"]
    },
    {
      category: "E-Permit",
      components: ["EPermitConfigDialog", "EPermitSubmitDialog", "EPermitStatusTracker"]
    },
    {
      category: "Admin",
      components: ["JurisdictionManager", "JurisdictionFormDialog", "JurisdictionCsvImportDialog", "FeatureFlagsPanel", "DripCampaignManager"]
    },
    {
      category: "Home/Marketing",
      components: ["HeroSection", "WorkflowStepsSection", "AIToolsSection", "LifecycleToolsSection", "ProductTourSection", "TestimonialsSection", "SocialProofSection", "FAQSection", "CTASection", "HomeROICalculator", "JurisdictionCoverageMap", "MarketDataSection", "PersonaSection", "CaseStudiesSection", "CompetitiveAnalysisSection"]
    },
    {
      category: "PWA",
      components: ["InstallPrompt", "OfflineIndicator"]
    },
    {
      category: "UI (shadcn)",
      components: ["Button", "Card", "Dialog", "Form", "Input", "Select", "Tabs", "Table", "Toast", "Tooltip", "Avatar", "Badge", "Calendar", "Checkbox", "Command", "DropdownMenu", "Popover", "Progress", "ScrollArea", "Sheet", "Skeleton", "Switch", "Textarea"]
    }
  ],

  rlsPolicies: [
    { name: "has_project_access", description: "Function that checks if user owns project or is a team member" },
    { name: "has_project_admin_access", description: "Function that checks if user is owner or admin of project" },
    { name: "has_role", description: "Function that checks if user has a specific app role (admin, moderator, user)" },
    { name: "Project Policies", description: "Users can only view/edit projects they own or are team members of" },
    { name: "Document Policies", description: "Documents accessible only to project team members" },
    { name: "Inspection Policies", description: "Inspections accessible only to project team members" },
    { name: "Team Member Policies", description: "Only project owners/admins can manage team members" },
    { name: "Jurisdiction Policies", description: "Public read access, admin-only write access" },
    { name: "Profile Policies", description: "Users can only access their own profile" }
  ]
};
