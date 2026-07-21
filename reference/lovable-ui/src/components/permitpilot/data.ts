import {
  BarChart3,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  BookMarked,
  Cable,
  CheckSquare,
  ClipboardCheck,
  CloudCog,
  DollarSign,
  FileCheck2,
  FileSignature,
  FileSearch,
  FolderArchive,
  Gauge,
  GitCompare,
  LifeBuoy,
  LineChart,
  LucideIcon,
  Map,
  MessageSquare,
  Network,
  PlugZap,
  Radio,
  Settings,
  ShieldCheck,
  Sparkles,
  Sparkle,
  Ticket,
  WalletCards,
  Wrench,
} from "lucide-react";

export type NavItem = { label: string; path: string; icon: LucideIcon; badge?: string };

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Command",
    items: [
      { label: "Dashboard", path: "/dashboard", icon: Gauge },
      { label: "Projects", path: "/projects", icon: Briefcase },
      { label: "Permit Queue", path: "/permit-queue", icon: ClipboardCheck, badge: "18" },
      { label: "Demo", path: "/demo/mcdonalds", icon: Sparkle },
    ],
  },
  {
    label: "Onboarding",
    items: [
      { label: "Client Authorization (LOA)", path: "/onboarding/authorization", icon: FileSignature },
    ],
  },
  {
    label: "Delivery",
    items: [
      { label: "Client Authorization (LOA)", path: "/delivery/authorization", icon: FileSignature },
      { label: "Operations Board", path: "/operations", icon: WalletCards },
      { label: "Permit Filing", path: "/matrix/guided", icon: Sparkles },
      { label: "Response Matrix", path: "/matrix/response", icon: MessageSquare },
      { label: "Portal Harvest", path: "/portals/harvest", icon: CloudCog },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { label: "DesignCheck", path: "/compliance", icon: ShieldCheck, badge: "8" },
      { label: "Code Analyzer", path: "/compliance/analyzer", icon: FileSearch },
      { label: "Utility Coordination", path: "/uci", icon: Wrench },
      { label: "UCI · Submissions", path: "/uci/submissions", icon: Radio },
      { label: "UCI · Inbox", path: "/uci/communications", icon: MessageSquare },
      { label: "UCI · Class of Service", path: "/uci/class-of-service", icon: FileCheck2 },
      { label: "UCI · CIAC & Refunds", path: "/uci/ciac", icon: DollarSign },
      { label: "UCI · Energization", path: "/uci/energization", icon: PlugZap },
      { label: "UCI · Miss Utility 811", path: "/uci/miss-utility", icon: Ticket },
      { label: "UCI · Knowledge Graph", path: "/uci/knowledge-graph", icon: Network },
      { label: "Jurisdiction Map", path: "/utility-map", icon: Map },
      { label: "Provider Compare", path: "/utility/provider-map", icon: GitCompare },
      { label: "UCI Builder", path: "/uci/application-builder", icon: Cable },
    ],
  },
  {
    label: "Resources",
    items: [
      { label: "Checklists", path: "/checklists", icon: CheckSquare },
      { label: "Reference Library", path: "/reference", icon: BookOpen },
      { label: "Utility Coverage", path: "/reference/utility-coverage", icon: Building2 },
      { label: "Glossary", path: "/reference/glossary", icon: BookMarked },
      { label: "Analytics & Reporting", path: "/portfolio/executive", icon: BarChart3 },
      { label: "Messages", path: "/messages", icon: MessageSquare, badge: "4" },
    ],
  },
  {
    label: "Help & Support",
    items: [
      { label: "Pricing & Overview", path: "/", icon: WalletCards },
      { label: "Documentation", path: "/reference", icon: FolderArchive },
      { label: "Support", path: "/messages", icon: LifeBuoy },
      { label: "Settings", path: "/settings", icon: Settings },
    ],
  },
];

export type PermitPilotProject = {
  id: string;
  name: string;
  address: string;
  client: string;
  jurisdiction: string;
  phase: string;
  phaseIdx: number;
  status: string;
  risk: "Low" | "Medium" | "High";
  next: string;
  due: string;
  progress: number;
  owner: string;
  projectType: string;
  services: Array<"permit-expediting" | "utility-coordination">;
  serviceSummary: string;
  permitCount: number;
  utilityCount: number;
  openIssues: number;
  jurisdictionCluster: string;
  providers: string[];
  blockers: string[];
  queueHealth: string;
};

export const projects: PermitPilotProject[] = [
  {
    id: "PRJ-2023-089A",
    name: "Ballston Envelope Package",
    address: "75 North Quincy Street, Arlington, VA",
    client: "Crescent Development Group",
    jurisdiction: "Arlington County, VA",
    phase: "Permit filing in review",
    status: "Action Needed",
    risk: "High",
    next: "Upload signed VE letter and resubmit smoke control narrative",
    due: "Comments due in 2d",
    progress: 72,
    owner: "N. Okonkwo",
    phaseIdx: 2,
    projectType: "Residential tower envelope",
    services: ["permit-expediting", "utility-coordination"],
    serviceSummary: "Permit expediting + utility coordination",
    permitCount: 4,
    utilityCount: 2,
    openIssues: 7,
    jurisdictionCluster: "Northern Virginia cluster",
    providers: ["Dominion Energy", "Washington Gas"],
    blockers: ["Fire marshal routing", "Signed VE letter"],
    queueHealth: "Degraded due to county holiday staffing",
  },
  {
    id: "PRJ-2023-112C",
    name: "South Bay Fiber Expansion",
    address: "Santa Clara utility corridor",
    client: "Regional FiberCo",
    jurisdiction: "Santa Clara, CA",
    phase: "Utility coordination in engineering review",
    status: "Provider Review",
    risk: "Medium",
    next: "Confirm pad mount transformer schedule and trench conflict resolution",
    due: "Provider response due Fri",
    progress: 64,
    owner: "M. Torres",
    phaseIdx: 3,
    projectType: "Utility corridor expansion",
    services: ["utility-coordination"],
    serviceSummary: "Utility coordination",
    permitCount: 1,
    utilityCount: 5,
    openIssues: 4,
    jurisdictionCluster: "Bay Area multi-provider",
    providers: ["PG&E", "Comcast", "Regional FiberCo"],
    blockers: ["Transformer ETA variance", "Conduit clash at Node G-12"],
    queueHealth: "Stable with one long-lead risk",
  },
  {
    id: "PRJ-2023-045B",
    name: "Downtown Transit Hub",
    address: "Civic Center Station, Seattle, WA",
    client: "MetroWorks",
    jurisdiction: "Seattle, WA",
    phase: "Pre-submittal intelligence and package assembly",
    status: "AI Review",
    risk: "Low",
    next: "Lock the county intake packet and publish DesignCheck findings",
    due: "Internal review at 3:30 PM",
    progress: 81,
    owner: "D. Okafor",
    phaseIdx: 1,
    projectType: "Transit hub modernization",
    services: ["permit-expediting", "utility-coordination"],
    serviceSummary: "Integrated permit + utility delivery",
    permitCount: 6,
    utilityCount: 3,
    openIssues: 3,
    jurisdictionCluster: "Transit authority + city agencies",
    providers: ["Seattle City Light", "King County Utilities"],
    blockers: ["Plan review completeness", "Intake packet QA"],
    queueHealth: "Healthy with AI draft coverage at 94%",
  },
  {
    id: "PRJ-2023-177D",
    name: "Riverside Park Utilities",
    address: "East riverfront package",
    client: "Urban Parks Group",
    jurisdiction: "Austin, TX",
    phase: "Portal monitoring and agency follow-up",
    status: "Monitoring",
    risk: "Medium",
    next: "Track water tap receipt and upload county supplemental package",
    due: "Digest queued in 12m",
    progress: 43,
    owner: "A. Rivera",
    phaseIdx: 3,
    projectType: "Park utility upgrades",
    services: ["utility-coordination", "permit-expediting"],
    serviceSummary: "Utility-led with permitting dependencies",
    permitCount: 2,
    utilityCount: 4,
    openIssues: 5,
    jurisdictionCluster: "Austin parks + utilities",
    providers: ["Austin Water", "Austin Energy"],
    blockers: ["Water tap receipt", "Portal credential rotation"],
    queueHealth: "Monitoring with one credential risk",
  },
];

export const kpis = [
  { label: "Active client projects", value: "24", delta: "14 permit-led · 10 utility-led", icon: Building2 },
  { label: "Workflows in motion", value: "37", delta: "filings, provider tasks, review loops", icon: Bot },
  { label: "Open permit packages", value: "18", delta: "7 need operator action", icon: FileCheck2 },
  { label: "Utility coordination tasks", value: "29", delta: "6 at provider escalation", icon: Radio },
];

export const agents = [
  {
    name: "Portal harvest monitor",
    status: "Running",
    cadence: "Continuous",
    scope: "Watches county and provider portals for status changes, new comments, and outage windows.",
    lastRun: "2m ago",
    monitored: 42,
    actions: 156,
    icon: CloudCog,
  },
  {
    name: "Permit reviewer",
    status: "Reviewing",
    cadence: "On upload",
    scope: "Extracts review comments, tags citations, drafts responses, and flags missing package items.",
    lastRun: "11m ago",
    monitored: 19,
    actions: 34,
    icon: FileSearch,
  },
  {
    name: "Utility coordinator",
    status: "Running",
    cadence: "15 min",
    scope: "Tracks service requests, provider approvals, meter-set windows, and long-lead equipment blockers.",
    lastRun: "5m ago",
    monitored: 28,
    actions: 51,
    icon: Wrench,
  },
];

export const activityFeed = [
  { time: "10:42", actor: "Portal harvest monitor", body: "Fairfax outage window detected — switched IFC refresh to CSV fallback." },
  { time: "10:35", actor: "Utility coordinator", body: "Updated Dominion response ETA and pushed new task to Ballston utility queue." },
  { time: "10:21", actor: "Permit reviewer", body: "Classified 12 county comments and drafted 9 first-pass responses." },
  { time: "09:54", actor: "Deadline enforcement", body: "Queued reminders for three filings and two provider approvals due this week." },
];

export const tasks = [
  { title: "Upload signed VE letter", owner: "Permit expediting", urgency: "Critical", detail: "Needed to clear Ballston fire routing hold." },
  { title: "Confirm transformer ETA", owner: "Utility coordination", urgency: "High", detail: "Schedule variance threatens meter-set date." },
  { title: "Review response package", owner: "Response matrix", urgency: "High", detail: "Seven drafted responses need operator approval." },
  { title: "Rotate county portal credentials", owner: "Portal harvest", urgency: "Normal", detail: "Credential expires before the next weekly digest." },
];

export const permits = [
  { id: "PP-2419-ARL", project: "Ballston Envelope Package", type: "Building envelope", agency: "Arlington County", age: "2d", status: "Comments Due", risk: "High", service: "Permit expediting", nextStep: "Respond to IFC packet" },
  { id: "PP-5110-FX", project: "Transit Hub", type: "Transit renovation", agency: "City review", age: "5d", status: "Cleared IFC", risk: "Low", service: "Permit expediting", nextStep: "Prepare final submittal" },
  { id: "UCI-8821", project: "South Bay Fiber Expansion", type: "Electric service request", agency: "PG&E", age: "7d", status: "Provider Review", risk: "Medium", service: "Utility coordination", nextStep: "Confirm engineering markup" },
  { id: "UCI-4411", project: "Riverside Park Utilities", type: "Water tap", agency: "Austin Water", age: "1d", status: "Monitoring", risk: "Medium", service: "Utility coordination", nextStep: "Await receipt upload" },
  { id: "PP-4821-WO", project: "Downtown Transit Hub", type: "Plan review intake", agency: "Seattle review", age: "3d", status: "In Intake QC", risk: "Medium", service: "Permit expediting", nextStep: "Lock intake checklist" },
];

export const documents = [
  { name: "County intake packet", type: "Permit", project: "Downtown Transit Hub", status: "Awaiting QA", version: "v7", updated: "Today" },
  { name: "VE letter", type: "Permit", project: "Ballston Envelope Package", status: "Signature needed", version: "v3", updated: "Today" },
  { name: "Transformer pad specs", type: "Utility", project: "South Bay Fiber Expansion", status: "Provider markup", version: "v2", updated: "Today" },
  { name: "Water tap receipt", type: "Utility", project: "Riverside Park Utilities", status: "Waiting on upload", version: "v1", updated: "Yesterday" },
];

export const designAgents = [
  "Submission completeness",
  "Fire / life safety",
  "Accessibility",
  "Structural coordination",
  "Stormwater",
  "Utility Clearance",
  "Provider readiness",
  "Jurisdiction response planning",
];

export const adminCards = [
  { label: "Client access", value: "48 users", icon: Briefcase },
  { label: "Archived projects", value: "312", icon: FolderArchive },
  { label: "Invoices pending", value: "9", icon: WalletCards },
  { label: "Reporting coverage", value: "94%", icon: LineChart },
];

export const closeoutItems = [
  { label: "Final inspections", status: "2 pending", icon: ClipboardCheck },
  { label: "Certificate of occupancy", status: "Awaiting release", icon: FileCheck2 },
  { label: "Archive package", status: "Drafting", icon: FolderArchive },
  { label: "Post-mortem analytics", status: "Ready", icon: BarChart3 },
];

export const messageThreads = [
  { project: "PRJ-2023-089A", title: "County fire routing hold", time: "10:42", priority: "High" },
  { project: "PRJ-2023-112C", title: "Transformer lead-time escalation", time: "09:15", priority: "High" },
  { project: "PRJ-2023-045B", title: "Transit intake packet QA", time: "Today", priority: "Normal" },
  { project: "PRJ-2023-177D", title: "Portal credential rotation", time: "Yesterday", priority: "Normal" },
];

export const quickActions = [
  { label: "Create filing", icon: FileCheck2 },
  { label: "Add provider task", icon: Wrench },
  { label: "Run DesignCheck", icon: ShieldCheck },
  { label: "Open digest", icon: MessageSquare },
];