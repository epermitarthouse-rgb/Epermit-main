import { useState, useCallback, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox, ComboboxOption } from "@/components/ui/searchable-combobox";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  Upload,
  FileImage,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  Shield,
  Loader2,
  FileText,
  Download,
  Building2,
  MapPin,
  Calendar,
  XCircle,
  Check,
  Edit,
  FileDown,
  X,
  File,
  Scale,
  ToggleLeft,
  FolderKanban,
  Plus,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { exportComplianceReportPDF } from "@/lib/complianceReportPDF";
import { pdfFirstPageToImageFile } from "@/utils/pdfToImage";
import { useRecentlyUsed } from "@/hooks/useRecentlyUsed";
import { useProjects } from "@/hooks/useProjects";
import { useProjectDocuments } from "@/hooks/useProjectDocuments";
import { useAuth } from "@/hooks/useAuth";
import { DocumentDiscipline, DISCIPLINE_OPTIONS, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES } from "@/types/document";
import type { ProjectDocument } from "@/types/document";

interface ComplianceIssue {
  id: string;
  category: string;
  title: string;
  description: string;
  severity: "critical" | "warning" | "advisory";
  codeReference: string;
  codeYear: string;
  location: string;
  suggestedFix: string;
  codeType?: "ibc" | "local";
}

interface AnalysisResult {
  issues: ComplianceIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    warnings: number;
    advisory: number;
    overallScore: number;
  };
  jurisdictionNotes: string;
  codeType: "ibc" | "local" | "combined";
}

interface IssueResponse {
  status: "accepted" | "modified" | "rejected";
  originalFix: string;
  modifiedResponse?: string;
}

interface UploadedFile {
  file: File;
  preview: string | null;
  discipline: DocumentDiscipline;
}

// Jurisdictions with local amendments
const JURISDICTIONS_WITH_AMENDMENTS = [
  "dc",
  "new-york-city",
  "california",
  "los-angeles",
  "san-francisco",
  "florida",
  "miami-dade",
  "chicago",
  "boston",
  "massachusetts",
  "seattle",
  "portland",
];

const severityConfig = {
  critical: {
    icon: AlertCircle,
    color: "text-destructive",
    bg: "bg-card",
    border: "border-destructive",
    stripe: "bg-destructive",
    iconBg: "bg-destructive/15",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-card",
    border: "border-amber-500 dark:border-amber-400",
    stripe: "bg-amber-500 dark:bg-amber-400",
    iconBg: "bg-amber-500/15",
    label: "Warning",
  },
  advisory: {
    icon: Info,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-card",
    border: "border-blue-500 dark:border-blue-400",
    stripe: "bg-blue-500 dark:bg-blue-400",
    iconBg: "bg-blue-500/15",
    label: "Advisory",
  },
};

const categoryIcons: Record<string, string> = {
  Egress: "🚪",
  "Fire Safety": "🔥",
  Accessibility: "♿",
  Structural: "🏗️",
  MEP: "⚡",
  Zoning: "📐",
  "Life Safety": "🛡️",
};

/** Annotation data shape for AI compliance findings stored in document_annotations */
interface ComplianceAnnotationData {
  compliance_issue?: boolean;
  compliance_metadata?: boolean;
  codeType?: "ibc" | "local";
  id?: string;
  category?: string;
  title?: string;
  description?: string;
  severity?: "critical" | "warning" | "advisory";
  codeReference?: string;
  codeYear?: string;
  location?: string;
  suggestedFix?: string;
  summary?: AnalysisResult["summary"];
  jurisdictionNotes?: string;
  jurisdiction?: string;
  projectType?: string;
  codeYear_meta?: string;
}

export function AIComplianceAnalyzer() {
  const { user } = useAuth();
  const { projects, loading: projectsLoading, createProject } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showNewProjectInput, setShowNewProjectInput] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const { documents, uploadDocument, fetchDocuments } = useProjectDocuments(selectedProjectId);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ibcResult, setIbcResult] = useState<AnalysisResult | null>(null);
  const [localResult, setLocalResult] = useState<AnalysisResult | null>(null);
  const [currentDocumentId, setCurrentDocumentId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, IssueResponse>>({});
  const [selectedIssue, setSelectedIssue] = useState<ComplianceIssue | null>(null);
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [modifiedText, setModifiedText] = useState("");
  const [dragActive, setDragActive] = useState(false);

  // Analysis options
  const [jurisdiction, setJurisdiction] = useState("general");
  const [projectType, setProjectType] = useState("commercial");
  const [codeYear, setCodeYear] = useState("2021");

  // Dual code analysis options
  const [analysisMode, setAnalysisMode] = useState<"both" | "ibc" | "local">("both");
  const [activeResultTab, setActiveResultTab] = useState<"ibc" | "local">("ibc");

  const hasLocalAmendments = JURISDICTIONS_WITH_AMENDMENTS.includes(jurisdiction);

  // Documents that have compliance annotations (for "Load existing")
  const [documentsWithAnalysis, setDocumentsWithAnalysis] = useState<ProjectDocument[]>([]);
  const [loadingDocsWithAnalysis, setLoadingDocsWithAnalysis] = useState(false);
  const [analysisSavedAt, setAnalysisSavedAt] = useState<number>(0);

  // Fetch documents that have compliance annotations when project changes or after save
  useEffect(() => {
    if (!selectedProjectId || !user) {
      setDocumentsWithAnalysis([]);
      return;
    }
    const fetchDocsWithAnalysis = async () => {
      setLoadingDocsWithAnalysis(true);
      try {
        const { data: annotations, error } = await supabase
          .from("document_annotations")
          .select("document_id, data")
          .eq("project_id", selectedProjectId)
          .not("document_id", "is", null);

        if (error) throw error;

        const complianceDocIds = new Set<string>();
        for (const a of annotations ?? []) {
          const d = (a?.data ?? {}) as ComplianceAnnotationData;
          if (d?.compliance_issue || d?.compliance_metadata) {
            if (a?.document_id) complianceDocIds.add(a.document_id);
          }
        }
        const docIds = Array.from(complianceDocIds);
        if (docIds.length === 0) {
          setDocumentsWithAnalysis([]);
          return;
        }

        const { data: docs, error: docsError } = await supabase
          .from("project_documents")
          .select("*")
          .in("id", docIds)
          .order("created_at", { ascending: false });

        if (docsError) throw docsError;
        setDocumentsWithAnalysis((docs as ProjectDocument[]) || []);
      } catch (err) {
        console.error("Error fetching documents with analysis:", err);
        setDocumentsWithAnalysis([]);
      } finally {
        setLoadingDocsWithAnalysis(false);
      }
    };
    fetchDocsWithAnalysis();
  }, [selectedProjectId, user, analysisSavedAt]);

  // Load existing annotations when document is selected
  const loadExistingAnalysis = useCallback(async () => {
    if (!selectedDocumentId || !selectedProjectId || !user) return;
    setLoadingExisting(true);
    try {
      const { data: annotations, error } = await supabase
        .from("document_annotations")
        .select("*")
        .eq("document_id", selectedDocumentId)
        .eq("project_id", selectedProjectId)
        .order("layer_order", { ascending: true });

      if (error) throw error;

      const complianceAnnotations = (annotations || []).filter(
        (a) => (a.data as ComplianceAnnotationData)?.compliance_issue || (a.data as ComplianceAnnotationData)?.compliance_metadata
      );

      if (complianceAnnotations.length === 0) {
        toast.info("No previous analysis found for this document");
        setLoadingExisting(false);
        return;
      }

      const metadataByCodeType = new Map<string, ComplianceAnnotationData>();
      const issuesByCodeType = new Map<string, ComplianceIssue[]>();

      for (const ann of complianceAnnotations) {
        const d = ann.data as ComplianceAnnotationData;
        if (d.compliance_metadata) {
          metadataByCodeType.set(d.codeType || "ibc", d);
        } else if (d.compliance_issue && d.codeType) {
          const issue: ComplianceIssue = {
            id: d.id || ann.id,
            category: d.category || "",
            title: d.title || "",
            description: d.description || "",
            severity: (d.severity as ComplianceIssue["severity"]) || "advisory",
            codeReference: d.codeReference || "",
            codeYear: d.codeYear || "",
            location: d.location || "",
            suggestedFix: d.suggestedFix || "",
            codeType: d.codeType,
          };
          const list = issuesByCodeType.get(d.codeType) || [];
          list.push(issue);
          issuesByCodeType.set(d.codeType, list);
        }
      }

      const ibcMeta = metadataByCodeType.get("ibc");
      const localMeta = metadataByCodeType.get("local");
      const ibcIssues = issuesByCodeType.get("ibc") || [];
      const localIssues = issuesByCodeType.get("local") || [];

      const buildSummary = (issues: ComplianceIssue[], meta?: ComplianceAnnotationData) => {
        if (meta?.summary) return meta.summary;
        const critical = issues.filter((i) => i.severity === "critical").length;
        const warnings = issues.filter((i) => i.severity === "warning").length;
        const advisory = issues.filter((i) => i.severity === "advisory").length;
        return {
          totalIssues: issues.length,
          critical,
          warnings,
          advisory,
          overallScore: issues.length === 0 ? 100 : Math.max(0, 100 - critical * 15 - warnings * 5 - advisory * 2),
        };
      };

      if (ibcIssues.length > 0 || ibcMeta) {
        setIbcResult({
          issues: ibcIssues,
          summary: buildSummary(ibcIssues, ibcMeta),
          jurisdictionNotes: ibcMeta?.jurisdictionNotes || "",
          codeType: "ibc",
        });
      }
      if (localIssues.length > 0 || localMeta) {
        setLocalResult({
          issues: localIssues,
          summary: buildSummary(localIssues, localMeta),
          jurisdictionNotes: localMeta?.jurisdictionNotes || "",
          codeType: "local",
        });
      }

      setCurrentDocumentId(selectedDocumentId);
      setActiveResultTab(ibcIssues.length > 0 ? "ibc" : "local");
      toast.success("Loaded previous analysis");
    } catch (err) {
      console.error("Error loading existing analysis:", err);
      toast.error("Failed to load previous analysis");
    } finally {
      setLoadingExisting(false);
    }
  }, [selectedDocumentId, selectedProjectId, user]);

  // Recently used tracking
  const { recentItems: recentJurisdictions, addRecentItem: addRecentJurisdiction } = useRecentlyUsed(
    "compliance-recent-jurisdictions",
  );
  const { recentItems: recentProjectTypes, addRecentItem: addRecentProjectType } = useRecentlyUsed(
    "compliance-recent-project-types",
  );

  const handleCreateNewProject = async () => {
    if (!newProjectName.trim() || !user) return;
    setCreatingProject(true);
    try {
      const newProject = await createProject({ name: newProjectName.trim() });
      if (newProject) {
        setSelectedProjectId(newProject.id);
        setSelectedDocumentId(null);
        setIbcResult(null);
        setLocalResult(null);
        setShowNewProjectInput(false);
        setNewProjectName("");
      }
    } finally {
      setCreatingProject(false);
    }
  };

  // Handle jurisdiction change with recent tracking
  const handleJurisdictionChange = useCallback(
    (value: string) => {
      setJurisdiction(value);
      addRecentJurisdiction(value);
      // Auto-set mode to both if jurisdiction has amendments
      if (JURISDICTIONS_WITH_AMENDMENTS.includes(value)) {
        setAnalysisMode("both");
      } else {
        setAnalysisMode("ibc");
      }
    },
    [addRecentJurisdiction],
  );

  // Handle project type change with recent tracking
  const handleProjectTypeChange = useCallback(
    (value: string) => {
      setProjectType(value);
      addRecentProjectType(value);
    },
    [addRecentProjectType],
  );

  // Base jurisdiction options with grouping
  const baseJurisdictionOptions: ComboboxOption[] = useMemo(
    () => [
      // General
      { value: "general", label: "General IBC (International Building Code)", group: "General" },

      // Northeast
      { value: "new-york-city", label: "New York City (NYC Building Code)", group: "Northeast" },
      { value: "new-york-state", label: "New York State (Uniform Code)", group: "Northeast" },
      { value: "boston", label: "Boston, MA", group: "Northeast" },
      { value: "massachusetts", label: "Massachusetts (780 CMR)", group: "Northeast" },
      { value: "philadelphia", label: "Philadelphia, PA", group: "Northeast" },
      { value: "pittsburgh", label: "Pittsburgh, PA", group: "Northeast" },
      { value: "new-jersey", label: "New Jersey (UCC)", group: "Northeast" },
      { value: "connecticut", label: "Connecticut (State Building Code)", group: "Northeast" },
      { value: "rhode-island", label: "Rhode Island", group: "Northeast" },
      { value: "vermont", label: "Vermont", group: "Northeast" },
      { value: "new-hampshire", label: "New Hampshire", group: "Northeast" },
      { value: "maine", label: "Maine", group: "Northeast" },

      // Mid-Atlantic / DC Area
      { value: "dc", label: "Washington D.C. (12A DCMR)", group: "Mid-Atlantic" },
      { value: "maryland", label: "Maryland (MSBC)", group: "Mid-Atlantic" },
      { value: "montgomery-county-md", label: "Montgomery County, MD", group: "Mid-Atlantic" },
      { value: "prince-georges-county-md", label: "Prince George's County, MD", group: "Mid-Atlantic" },
      { value: "baltimore", label: "Baltimore City, MD", group: "Mid-Atlantic" },
      { value: "arlington-va", label: "Arlington County, VA", group: "Mid-Atlantic" },
      { value: "fairfax-va", label: "Fairfax County, VA", group: "Mid-Atlantic" },
      { value: "virginia", label: "Virginia (USBC)", group: "Mid-Atlantic" },
      { value: "delaware", label: "Delaware", group: "Mid-Atlantic" },

      // Southeast
      { value: "florida", label: "Florida Building Code (FBC)", group: "Southeast" },
      { value: "miami-dade", label: "Miami-Dade County, FL (HVHZ)", group: "Southeast" },
      { value: "broward", label: "Broward County, FL", group: "Southeast" },
      { value: "orlando", label: "Orlando, FL", group: "Southeast" },
      { value: "tampa", label: "Tampa, FL", group: "Southeast" },
      { value: "jacksonville", label: "Jacksonville, FL", group: "Southeast" },
      { value: "georgia", label: "Georgia (State Codes)", group: "Southeast" },
      { value: "atlanta", label: "Atlanta, GA", group: "Southeast" },
      { value: "north-carolina", label: "North Carolina", group: "Southeast" },
      { value: "charlotte", label: "Charlotte, NC", group: "Southeast" },
      { value: "raleigh", label: "Raleigh, NC", group: "Southeast" },
      { value: "south-carolina", label: "South Carolina", group: "Southeast" },
      { value: "charleston", label: "Charleston, SC", group: "Southeast" },
      { value: "tennessee", label: "Tennessee", group: "Southeast" },
      { value: "nashville", label: "Nashville, TN", group: "Southeast" },
      { value: "alabama", label: "Alabama", group: "Southeast" },
      { value: "louisiana", label: "Louisiana", group: "Southeast" },
      { value: "new-orleans", label: "New Orleans, LA", group: "Southeast" },
      { value: "mississippi", label: "Mississippi", group: "Southeast" },

      // Midwest
      { value: "chicago", label: "Chicago (Chicago Building Code)", group: "Midwest" },
      { value: "illinois", label: "Illinois", group: "Midwest" },
      { value: "ohio", label: "Ohio", group: "Midwest" },
      { value: "columbus", label: "Columbus, OH", group: "Midwest" },
      { value: "cleveland", label: "Cleveland, OH", group: "Midwest" },
      { value: "cincinnati", label: "Cincinnati, OH", group: "Midwest" },
      { value: "michigan", label: "Michigan", group: "Midwest" },
      { value: "detroit", label: "Detroit, MI", group: "Midwest" },
      { value: "indiana", label: "Indiana", group: "Midwest" },
      { value: "indianapolis", label: "Indianapolis, IN", group: "Midwest" },
      { value: "wisconsin", label: "Wisconsin", group: "Midwest" },
      { value: "milwaukee", label: "Milwaukee, WI", group: "Midwest" },
      { value: "minnesota", label: "Minnesota", group: "Midwest" },
      { value: "minneapolis", label: "Minneapolis, MN", group: "Midwest" },
      { value: "missouri", label: "Missouri", group: "Midwest" },
      { value: "kansas-city", label: "Kansas City, MO", group: "Midwest" },
      { value: "st-louis", label: "St. Louis, MO", group: "Midwest" },
      { value: "iowa", label: "Iowa", group: "Midwest" },
      { value: "kansas", label: "Kansas", group: "Midwest" },
      { value: "nebraska", label: "Nebraska", group: "Midwest" },
      { value: "north-dakota", label: "North Dakota", group: "Midwest" },
      { value: "south-dakota", label: "South Dakota", group: "Midwest" },

      // Southwest
      { value: "texas", label: "Texas", group: "Southwest" },
      { value: "houston", label: "Houston, TX", group: "Southwest" },
      { value: "dallas", label: "Dallas, TX", group: "Southwest" },
      { value: "austin", label: "Austin, TX", group: "Southwest" },
      { value: "san-antonio", label: "San Antonio, TX", group: "Southwest" },
      { value: "fort-worth", label: "Fort Worth, TX", group: "Southwest" },
      { value: "arizona", label: "Arizona", group: "Southwest" },
      { value: "phoenix", label: "Phoenix, AZ", group: "Southwest" },
      { value: "tucson", label: "Tucson, AZ", group: "Southwest" },
      { value: "scottsdale", label: "Scottsdale, AZ", group: "Southwest" },
      { value: "new-mexico", label: "New Mexico", group: "Southwest" },
      { value: "albuquerque", label: "Albuquerque, NM", group: "Southwest" },
      { value: "oklahoma", label: "Oklahoma", group: "Southwest" },
      { value: "oklahoma-city", label: "Oklahoma City, OK", group: "Southwest" },
      { value: "arkansas", label: "Arkansas", group: "Southwest" },

      // West
      { value: "california", label: "California (CBC/Title 24)", group: "West" },
      { value: "los-angeles", label: "Los Angeles, CA (LAMC)", group: "West" },
      { value: "san-francisco", label: "San Francisco, CA", group: "West" },
      { value: "san-diego", label: "San Diego, CA", group: "West" },
      { value: "san-jose", label: "San Jose, CA", group: "West" },
      { value: "sacramento", label: "Sacramento, CA", group: "West" },
      { value: "oakland", label: "Oakland, CA", group: "West" },
      { value: "long-beach", label: "Long Beach, CA", group: "West" },
      { value: "nevada", label: "Nevada", group: "West" },
      { value: "las-vegas", label: "Las Vegas, NV (Clark County)", group: "West" },
      { value: "reno", label: "Reno, NV", group: "West" },
      { value: "colorado", label: "Colorado", group: "West" },
      { value: "denver", label: "Denver, CO", group: "West" },
      { value: "utah", label: "Utah", group: "West" },
      { value: "salt-lake-city", label: "Salt Lake City, UT", group: "West" },
      { value: "idaho", label: "Idaho", group: "West" },
      { value: "boise", label: "Boise, ID", group: "West" },
      { value: "montana", label: "Montana", group: "West" },
      { value: "wyoming", label: "Wyoming", group: "West" },

      // Pacific Northwest
      { value: "washington", label: "Washington State", group: "Pacific Northwest" },
      { value: "seattle", label: "Seattle, WA", group: "Pacific Northwest" },
      { value: "tacoma", label: "Tacoma, WA", group: "Pacific Northwest" },
      { value: "oregon", label: "Oregon", group: "Pacific Northwest" },
      { value: "portland", label: "Portland, OR", group: "Pacific Northwest" },
      { value: "alaska", label: "Alaska", group: "Pacific Northwest" },
      { value: "anchorage", label: "Anchorage, AK", group: "Pacific Northwest" },

      // Hawaii & Territories
      { value: "hawaii", label: "Hawaii", group: "Hawaii & Territories" },
      { value: "honolulu", label: "Honolulu, HI", group: "Hawaii & Territories" },
      { value: "puerto-rico", label: "Puerto Rico", group: "Hawaii & Territories" },
      { value: "guam", label: "Guam", group: "Hawaii & Territories" },
    ],
    [],
  );

  // Jurisdiction options with recently used at top
  const jurisdictionOptions: ComboboxOption[] = useMemo(() => {
    if (recentJurisdictions.length === 0) return baseJurisdictionOptions;

    const recentOptions: ComboboxOption[] = [];
    for (const value of recentJurisdictions) {
      const option = baseJurisdictionOptions.find((o) => o.value === value);
      if (option) {
        recentOptions.push({ value: option.value, label: option.label, group: "⏱️ Recently Used" });
      }
    }

    return [...recentOptions, ...baseJurisdictionOptions];
  }, [baseJurisdictionOptions, recentJurisdictions]);

  // Base project type options with grouping
  const baseProjectTypeOptions: ComboboxOption[] = useMemo(
    () => [
      // Residential
      { value: "single-family", label: "Single-Family Residential", group: "Residential" },
      { value: "two-family", label: "Two-Family / Duplex", group: "Residential" },
      { value: "townhouse", label: "Townhouse / Rowhouse", group: "Residential" },
      { value: "multi-family", label: "Multi-Family Residential (3+ units)", group: "Residential" },
      { value: "apartment", label: "Apartment Building", group: "Residential" },
      { value: "condominium", label: "Condominium", group: "Residential" },
      { value: "adu", label: "Accessory Dwelling Unit (ADU)", group: "Residential" },
      { value: "residential-addition", label: "Residential Addition", group: "Residential" },
      { value: "residential-renovation", label: "Residential Renovation/Alteration", group: "Residential" },

      // Commercial
      { value: "commercial", label: "Commercial (General)", group: "Commercial" },
      { value: "office", label: "Office Building", group: "Commercial" },
      { value: "retail", label: "Retail / Mercantile", group: "Commercial" },
      { value: "restaurant", label: "Restaurant / Food Service", group: "Commercial" },
      { value: "hotel", label: "Hotel / Motel", group: "Commercial" },
      { value: "mixed-use", label: "Mixed-Use Development", group: "Commercial" },
      { value: "tenant-improvement", label: "Tenant Improvement (TI)", group: "Commercial" },
      { value: "shell-core", label: "Shell & Core", group: "Commercial" },

      // Industrial
      { value: "industrial", label: "Industrial (General)", group: "Industrial" },
      { value: "warehouse", label: "Warehouse / Distribution", group: "Industrial" },
      { value: "manufacturing", label: "Manufacturing Facility", group: "Industrial" },
      { value: "data-center", label: "Data Center", group: "Industrial" },
      { value: "laboratory", label: "Laboratory / R&D", group: "Industrial" },
      { value: "cold-storage", label: "Cold Storage / Refrigerated", group: "Industrial" },

      // Healthcare
      { value: "healthcare", label: "Healthcare (General)", group: "Healthcare" },
      { value: "hospital", label: "Hospital", group: "Healthcare" },
      { value: "medical-office", label: "Medical Office Building", group: "Healthcare" },
      { value: "urgent-care", label: "Urgent Care / Clinic", group: "Healthcare" },
      { value: "assisted-living", label: "Assisted Living / Senior Care", group: "Healthcare" },
      { value: "nursing-home", label: "Nursing Home / Skilled Nursing", group: "Healthcare" },

      // Educational
      { value: "education", label: "Educational (General)", group: "Educational" },
      { value: "k12-school", label: "K-12 School", group: "Educational" },
      { value: "university", label: "University / College", group: "Educational" },
      { value: "daycare", label: "Daycare / Childcare Center", group: "Educational" },

      // Institutional
      { value: "religious", label: "Religious / Place of Worship", group: "Institutional" },
      { value: "government", label: "Government Building", group: "Institutional" },
      { value: "courthouse", label: "Courthouse", group: "Institutional" },
      { value: "library", label: "Library", group: "Institutional" },
      { value: "museum", label: "Museum / Gallery", group: "Institutional" },
      { value: "community-center", label: "Community Center", group: "Institutional" },

      // Assembly
      { value: "assembly", label: "Assembly (General)", group: "Assembly" },
      { value: "theater", label: "Theater / Performing Arts", group: "Assembly" },
      { value: "arena", label: "Arena / Stadium", group: "Assembly" },
      { value: "convention-center", label: "Convention Center", group: "Assembly" },
      { value: "nightclub", label: "Nightclub / Bar", group: "Assembly" },
      { value: "recreation", label: "Recreation / Fitness Center", group: "Assembly" },

      // Specialty
      { value: "parking-garage", label: "Parking Garage / Structure", group: "Specialty" },
      { value: "gas-station", label: "Gas Station / Auto Service", group: "Specialty" },
      { value: "car-wash", label: "Car Wash", group: "Specialty" },
      { value: "self-storage", label: "Self-Storage Facility", group: "Specialty" },
      { value: "agricultural", label: "Agricultural Building", group: "Specialty" },
      { value: "utility", label: "Utility / Infrastructure", group: "Specialty" },

      // Site Work
      { value: "deck", label: "Deck / Patio", group: "Site Work" },
      { value: "fence", label: "Fence / Retaining Wall", group: "Site Work" },
      { value: "pool", label: "Swimming Pool / Spa", group: "Site Work" },
      { value: "solar", label: "Solar Panel Installation", group: "Site Work" },
      { value: "ev-charger", label: "EV Charger Installation", group: "Site Work" },
      { value: "demolition", label: "Demolition", group: "Site Work" },
      { value: "grading", label: "Grading / Excavation", group: "Site Work" },
    ],
    [],
  );

  // Project type options with recently used at top
  const projectTypeOptions: ComboboxOption[] = useMemo(() => {
    if (recentProjectTypes.length === 0) return baseProjectTypeOptions;

    const recentOptions: ComboboxOption[] = [];
    for (const value of recentProjectTypes) {
      const option = baseProjectTypeOptions.find((o) => o.value === value);
      if (option) {
        recentOptions.push({ value: option.value, label: option.label, group: "⏱️ Recently Used" });
      }
    }

    return [...recentOptions, ...baseProjectTypeOptions];
  }, [baseProjectTypeOptions, recentProjectTypes]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const processFiles = useCallback((fileList: FileList | File[]) => {
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];
    const filesArray = Array.from(fileList);

    for (const file of filesArray) {
      if (!validTypes.includes(file.type)) {
        toast.error(`${file.name}: Invalid file type. Use PNG, JPEG, or PDF.`);
        continue;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`${file.name}: File exceeds ${MAX_FILE_SIZE_MB}MB limit`);
        continue;
      }

      // Create preview for images
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setFiles((prev) => [
            ...prev,
            {
              file,
              preview: e.target?.result as string,
              discipline: "general",
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setFiles((prev) => [
          ...prev,
          {
            file,
            preview: null,
            discipline: "general",
          },
        ]);
      }
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
      }
    },
    [processFiles],
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFileDiscipline = (index: number, discipline: DocumentDiscipline) => {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, discipline } : f)));
  };

  /** Save AI analysis results to document_annotations */
  const saveAnalysisToDb = useCallback(
    async (result: AnalysisResult, docId: string, projId: string) => {
      if (!user) return;
      try {
        const layerOrder = result.codeType === "ibc" ? 0 : 1000;
        const metadataData: ComplianceAnnotationData = {
          compliance_metadata: true,
          codeType: result.codeType as "ibc" | "local",
          summary: result.summary,
          jurisdictionNotes: result.jurisdictionNotes,
          jurisdiction,
          projectType,
          codeYear_meta: codeYear,
        };
        await supabase.from("document_annotations").insert({
          project_id: projId,
          document_id: docId,
          user_id: user.id,
          annotation_type: "text",
          data: metadataData as unknown as Record<string, unknown>,
          layer_order: layerOrder,
        });

        for (let i = 0; i < result.issues.length; i++) {
          const issue = result.issues[i];
          const issueData: ComplianceAnnotationData = {
            compliance_issue: true,
            codeType: result.codeType as "ibc" | "local",
            id: issue.id,
            category: issue.category,
            title: issue.title,
            description: issue.description,
            severity: issue.severity,
            codeReference: issue.codeReference,
            codeYear: issue.codeYear,
            location: issue.location,
            suggestedFix: issue.suggestedFix,
          };
          await supabase.from("document_annotations").insert({
            project_id: projId,
            document_id: docId,
            user_id: user.id,
            annotation_type: "text",
            data: issueData as unknown as Record<string, unknown>,
            layer_order: layerOrder + i + 1,
          });
        }
      } catch (err) {
        console.error("Error saving analysis to DB:", err);
        toast.error("Analysis saved to UI but failed to persist to database");
      }
    },
    [user, jurisdiction, projectType, codeYear]
  );

  const analyzeDrawings = async () => {
    if (files.length === 0) {
      toast.error("Please upload at least one drawing");
      return;
    }

    if (selectedProjectId && !user) {
      toast.error("You must be logged in to save analysis to a project");
      return;
    }

    setAnalyzing(true);
    setProgress(0);
    setIbcResult(null);
    setLocalResult(null);
    setResponses({});
    setCurrentDocumentId(null);

    const progressInterval = setInterval(() => {
      setProgress((prev) => Math.min(prev + Math.random() * 10, 85));
    }, 500);

    try {
      const file = files[0].file;
      // Client-side PDF rasterization: convert PDF to image so upload + API only ever receive images (fixes 400 on deployed envs)
      const fileToUse =
        file.type === "application/pdf"
          ? await pdfFirstPageToImageFile(file)
          : file;

      let documentId: string | null = null;
      const projectId = selectedProjectId;

      // Step 1: Upload the (possibly converted) image to storage — never send raw PDF
      if (projectId && user) {
        const newDoc = await uploadDocument({
          file: fileToUse,
          document_type: "permit_drawing",
          description: `AI compliance analysis - ${jurisdiction} ${projectType}`,
        });
        if (!newDoc) {
          throw new Error("Failed to upload document to project");
        }
        documentId = newDoc.id;
        setCurrentDocumentId(documentId);
        await fetchDocuments();
      }

      // Step 2: Get image base64 for Vision API (fileToUse is always an image)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64Data = result.split(",")[1];
          resolve(base64Data ?? "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(fileToUse);
      });
      const imageType = fileToUse.type;

      /** Normalize API response so summary and issues are always defined (avoids runtime errors) */
      const normalizeResult = (raw: unknown, codeType: "ibc" | "local"): AnalysisResult => {
        const d = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const issues = Array.isArray(d.issues) ? (d.issues as ComplianceIssue[]) : [];
        const sum = d.summary && typeof d.summary === "object" ? (d.summary as AnalysisResult["summary"]) : null;
        const critical = issues.filter((i) => i.severity === "critical").length;
        const warnings = issues.filter((i) => i.severity === "warning").length;
        const advisory = issues.filter((i) => i.severity === "advisory").length;
        const summary = sum ?? {
          totalIssues: issues.length,
          critical,
          warnings,
          advisory,
          overallScore: issues.length === 0 ? 100 : Math.max(0, 100 - critical * 15 - warnings * 5 - advisory * 2),
        };
        return {
          issues,
          summary,
          jurisdictionNotes: typeof d.jurisdictionNotes === "string" ? d.jurisdictionNotes : "",
          codeType,
        };
      };

      const runAnalysis = async (codeType: "ibc" | "local"): Promise<AnalysisResult> => {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (authSession?.access_token) {
          headers["Authorization"] = `Bearer ${authSession.access_token}`;
        }
        const raw =
          import.meta.env.VITE_API_BASE_URL || "https://epermit-production.up.railway.app";
        const API_BASE_URL = /^https?:\/\//i.test(raw)
          ? raw
          : /localhost|127\.0\.0\.1/i.test(raw)
            ? `http://${raw}`
            : `https://${raw}`;
        const response = await fetch(`${API_BASE_URL}/api/analyze-drawing`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            imageBase64: base64,
            imageType,
            jurisdiction: jurisdiction === "general" ? null : jurisdiction,
            projectType,
            codeYear,
            codeType,
            disciplines: files.map((f) => f.discipline),
          }),
        });

        let data;
        try {
          data = await response.json();
        } catch {
          throw new Error(`Analysis service returned an invalid response (HTTP ${response.status})`);
        }

        if (!response.ok) {
          throw new Error(data?.error || `Analysis failed (HTTP ${response.status})`);
        }

        if (data && typeof data === "object" && "error" in data && data.error) {
          throw new Error(typeof data.error === "string" ? data.error : "Analysis failed");
        }

        return normalizeResult(data, codeType);
      };

      let ibcData: AnalysisResult | null = null;
      let localData: AnalysisResult | null = null;

      if (analysisMode === "both" && hasLocalAmendments) {
        [ibcData, localData] = await Promise.all([runAnalysis("ibc"), runAnalysis("local")]);
        setIbcResult(ibcData);
        setLocalResult(localData);
        toast.success(
          `Analysis complete: ${ibcData.summary.totalIssues} IBC issues, ${localData.summary.totalIssues} local issues`,
        );
      } else if (analysisMode === "local" && hasLocalAmendments) {
        localData = await runAnalysis("local");
        setLocalResult(localData);
        setActiveResultTab("local");
        toast.success(`Analysis complete: ${localData.summary.totalIssues} local code issues found`);
      } else {
        ibcData = await runAnalysis("ibc");
        setIbcResult(ibcData);
        setActiveResultTab("ibc");
        toast.success(`Analysis complete: ${ibcData.summary.totalIssues} IBC issues found`);
      }

      // Step 2: Save results to document_annotations
      if (documentId && projectId && user) {
        if (ibcData) await saveAnalysisToDb(ibcData, documentId, projectId);
        if (localData) await saveAnalysisToDb(localData, documentId, projectId);
        setAnalysisSavedAt(Date.now());
        toast.success("Analysis saved to database");
      }

      clearInterval(progressInterval);
      setProgress(100);
    } catch (err) {
      console.error("Error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to analyze drawings");
    } finally {
      clearInterval(progressInterval);
      setAnalyzing(false);
    }
  };

  const handleAccept = (issue: ComplianceIssue) => {
    setResponses((prev) => ({
      ...prev,
      [issue.id]: { status: "accepted", originalFix: issue.suggestedFix },
    }));
    toast.success("Fix accepted");
  };

  const handleReject = (issue: ComplianceIssue) => {
    setResponses((prev) => ({
      ...prev,
      [issue.id]: { status: "rejected", originalFix: issue.suggestedFix },
    }));
    toast.info("Issue marked as not applicable");
  };

  const handleModify = (issue: ComplianceIssue) => {
    setSelectedIssue(issue);
    setModifiedText(issue.suggestedFix);
    setModifyDialogOpen(true);
  };

  const saveModification = () => {
    if (selectedIssue) {
      setResponses((prev) => ({
        ...prev,
        [selectedIssue.id]: {
          status: "modified",
          originalFix: selectedIssue.suggestedFix,
          modifiedResponse: modifiedText,
        },
      }));
      setModifyDialogOpen(false);
      toast.success("Response modified");
    }
  };

  const currentResult = (activeResultTab === "local" ? localResult : ibcResult) ?? localResult ?? ibcResult;

  const exportReportJSON = () => {
    const result = currentResult;
    if (!result) return;

    const report = {
      generatedAt: new Date().toISOString(),
      jurisdiction,
      projectType,
      codeYear,
      codeType: result.codeType,
      summary: result.summary,
      issues: result.issues.map((issue) => ({
        ...issue,
        response: responses[issue.id] || null,
      })),
      jurisdictionNotes: result.jurisdictionNotes,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${result.codeType}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON report exported");
  };

  const exportReportPDF = () => {
    const result = currentResult;
    if (!result) {
      toast.error("No analysis results to export. Please run an analysis first.");
      return;
    }

    try {
      exportComplianceReportPDF({
        jurisdiction,
        projectType,
        codeYear,
        summary: result.summary,
        issues: result.issues,
        responses,
        jurisdictionNotes: result.jurisdictionNotes ?? "",
        projectName: files[0]?.file?.name?.replace(/\.[^/.]+$/, "") || "Compliance Analysis",
      });
      toast.success("PDF report exported");
    } catch (err) {
      console.error("PDF export error:", err);
      toast.error("Failed to export PDF. Please try again.");
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-600";
    if (score >= 60) return "text-amber-600";
    return "text-destructive";
  };

  const resolvedCount = Object.keys(responses).length;
  const totalIssues = currentResult?.summary.totalIssues || 0;

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderIssuesList = (result: AnalysisResult) => {
    const issues = result?.issues ?? [];
    const summary = result?.summary ?? { totalIssues: 0, critical: 0, warnings: 0, advisory: 0, overallScore: 0 };
    const filteredIssues = (tab: string) =>
      issues.filter((issue) => tab === "all" || issue.severity === tab);

    const resolvedInResult = issues.filter((issue) => responses[issue.id]).length;
    const progressPercent = issues.length > 0 ? (resolvedInResult / issues.length) * 100 : 0;

    return (
      <Card className="overflow-hidden">
        {/* Header with progress */}
        <CardHeader className="pb-4 border-b bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <AlertTriangle className="h-5 w-5 text-primary" />
                Compliance Findings
              </CardTitle>
              <CardDescription className="mt-1">
                Review each finding and take action on suggested fixes
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-primary">{resolvedInResult}/{issues.length}</div>
              <div className="text-xs text-muted-foreground">Issues Resolved</div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-4">
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">{Math.round(progressPercent)}% complete</p>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <Tabs defaultValue="all" className="w-full">
            {/* Severity filter tabs */}
            <div className="border-b bg-background px-4 py-3">
              <TabsList className="grid w-full grid-cols-4 h-auto p-1 bg-muted/50">
                <TabsTrigger 
                  value="all" 
                  className="data-[state=active]:bg-background data-[state=active]:shadow-sm py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="hidden sm:inline">All</span>
                    <Badge variant="secondary" className="h-5 px-1.5 text-xs">{issues.length}</Badge>
                  </span>
                </TabsTrigger>
                <TabsTrigger 
                  value="critical" 
                  className="data-[state=active]:bg-destructive/10 data-[state=active]:text-destructive py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                    <span className="hidden sm:inline">Critical</span>
                    <Badge variant="destructive" className="h-5 px-1.5 text-xs">{summary.critical}</Badge>
                  </span>
                </TabsTrigger>
                <TabsTrigger 
                  value="warning" 
                  className="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700 dark:data-[state=active]:bg-amber-950 dark:data-[state=active]:text-amber-400 py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                    <span className="hidden sm:inline">Warning</span>
                    <Badge className="h-5 px-1.5 text-xs bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-0">{summary.warnings}</Badge>
                  </span>
                </TabsTrigger>
                <TabsTrigger 
                  value="advisory" 
                  className="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700 dark:data-[state=active]:bg-blue-950 dark:data-[state=active]:text-blue-400 py-2"
                >
                  <span className="flex items-center gap-1.5">
                    <Info className="h-3.5 w-3.5 text-blue-600" />
                    <span className="hidden sm:inline">Advisory</span>
                    <Badge className="h-5 px-1.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-0">{summary.advisory}</Badge>
                  </span>
                </TabsTrigger>
              </TabsList>
            </div>

            {["all", "critical", "warning", "advisory"].map((tab) => (
              <TabsContent key={tab} value={tab} className="mt-0">
                <ScrollArea className="h-[520px]">
                  <div className="p-4 space-y-3">
                    {filteredIssues(tab).length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <CheckCircle2 className="h-12 w-12 mb-3 text-emerald-500" />
                        <p className="font-medium">No {tab === "all" ? "" : tab} issues found</p>
                        <p className="text-sm">Great work! This section is clear.</p>
                      </div>
                    ) : (
                      filteredIssues(tab).map((issue, index) => {
                        const config = severityConfig[issue.severity];
                        const Icon = config.icon;
                        const response = responses[issue.id];

                        return (
                          <motion.div
                            key={issue.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.03, duration: 0.2 }}
                            className={`group relative rounded-xl border-l-4 border shadow-sm transition-all duration-200 ${
                              response 
                                ? "border-l-muted border-muted bg-muted/30 opacity-60" 
                                : `${config.border} border-l-4 ${config.bg} hover:shadow-lg`
                            }`}
                          >
                            <div className="p-4">
                              {/* Header row */}
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  {/* Title and badges */}
                                  <div className="flex items-start gap-3 mb-2">
                                    <div className={`p-2.5 rounded-lg ${config.iconBg} shrink-0`}>
                                      <Icon className={`h-5 w-5 ${config.color}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <h4 className="font-semibold text-foreground leading-tight">{issue.title}</h4>
                                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                        <Badge variant="outline" className="text-xs font-normal gap-1">
                                          <span>{categoryIcons[issue.category]}</span>
                                          {issue.category}
                                        </Badge>
                                        <Badge variant="secondary" className="text-xs font-mono">
                                          {issue.codeReference}
                                        </Badge>
                                        {response && (
                                          <Badge
                                            className={`text-xs gap-1 ${
                                              response.status === "accepted" 
                                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" 
                                                : response.status === "modified"
                                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                                                  : "bg-muted text-muted-foreground"
                                            }`}
                                          >
                                            {response.status === "accepted" && <Check className="h-3 w-3" />}
                                            {response.status === "modified" && <Edit className="h-3 w-3" />}
                                            {response.status === "rejected" && <X className="h-3 w-3" />}
                                            {response.status === "accepted" ? "Accepted" : 
                                             response.status === "modified" ? "Modified" : "Marked N/A"}
                                          </Badge>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Description */}
                                  <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                                    {issue.description}
                                  </p>

                                  {/* Location and Code info */}
                                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm mb-3">
                                    <div className="flex items-center gap-1.5">
                                      <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-muted-foreground">{issue.location}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-muted-foreground">{issue.codeReference} ({issue.codeYear})</span>
                                    </div>
                                  </div>

                                  {/* Suggested fix box */}
                                  <div className="p-3 rounded-lg bg-background border">
                                    <div className="flex items-center gap-2 mb-1.5">
                                      <CheckCircle2 className="h-4 w-4 text-primary" />
                                      <span className="text-sm font-medium">Suggested Fix</span>
                                    </div>
                                    <p className="text-sm text-muted-foreground leading-relaxed">
                                      {response?.modifiedResponse || issue.suggestedFix}
                                    </p>
                                  </div>
                                </div>

                                {/* Action buttons */}
                                {!response && (
                                  <div className="flex flex-col gap-1.5 shrink-0">
                                    <Button 
                                      size="sm" 
                                      onClick={() => handleAccept(issue)}
                                      className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                      Accept
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      variant="outline" 
                                      onClick={() => handleModify(issue)}
                                      className="gap-1.5"
                                    >
                                      <Edit className="h-3.5 w-3.5" />
                                      Modify
                                    </Button>
                                    <Button 
                                      size="sm" 
                                      variant="ghost" 
                                      onClick={() => handleReject(issue)}
                                      className="gap-1.5 text-muted-foreground hover:text-foreground"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                      N/A
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </motion.div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Upload & Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            AI Code Compliance Analyzer
          </CardTitle>
          <CardDescription>
            Upload architectural drawings to automatically detect building code violations using AI vision analysis
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Project Selection - Required for saving */}
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <FolderKanban className="h-4 w-4" />
              Project (required to save analysis)
            </Label>
            <Select
              value={selectedProjectId ?? "__none__"}
              onValueChange={(v) => {
                if (v === "__create_new__") {
                  setShowNewProjectInput(true);
                  return;
                }
                setShowNewProjectInput(false);
                setSelectedProjectId(v === "__none__" ? null : v);
                setSelectedDocumentId(null);
                setIbcResult(null);
                setLocalResult(null);
              }}
            >
              <SelectTrigger data-testid="select-project">
                <SelectValue placeholder="Select project to save analysis..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">No project (analysis won&apos;t be saved)</span>
                </SelectItem>
                <SelectItem value="__create_new__">
                  <span className="flex items-center gap-1.5 text-[#FF6B2B]">
                    <Plus className="h-3.5 w-3.5" />
                    Create new project
                  </span>
                </SelectItem>
                {(projects ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showNewProjectInput && (
              <div className="flex items-center gap-2 mt-2">
                <Input
                  data-testid="input-new-project-name"
                  placeholder="Enter new project name..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newProjectName.trim()) {
                      e.preventDefault();
                      handleCreateNewProject();
                    }
                  }}
                  disabled={creatingProject}
                  autoFocus
                />
                <Button
                  data-testid="button-create-project"
                  size="sm"
                  disabled={!newProjectName.trim() || creatingProject}
                  onClick={handleCreateNewProject}
                >
                  {creatingProject ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </Button>
                <Button
                  data-testid="button-cancel-create-project"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowNewProjectInput(false);
                    setNewProjectName("");
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            {!selectedProjectId && !showNewProjectInput && (
              <p className="text-xs text-muted-foreground mt-1">
                Select a project to save the file and AI results to the database
              </p>
            )}
          </div>

          {/* Load Previously Analyzed Document */}
          {selectedProjectId && documentsWithAnalysis.length > 0 && (
            <Card className="bg-muted/30">
              <CardContent className="pt-4">
                <div className="space-y-3">
                  <p className="font-medium text-sm">Load previously analyzed document</p>
                  <div className="flex flex-wrap gap-2">
                    <Select
                      value={selectedDocumentId || ""}
                      onValueChange={(v) => setSelectedDocumentId(v || null)}
                    >
                      <SelectTrigger className="w-[280px]">
                        <SelectValue placeholder="Select document..." />
                      </SelectTrigger>
                      <SelectContent>
                        {documentsWithAnalysis.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.file_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={loadExistingAnalysis}
                      disabled={!selectedDocumentId || loadingExisting}
                    >
                      {loadingExisting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Load Analysis"
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Configuration Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Jurisdiction
              </Label>
              <SearchableCombobox
                options={jurisdictionOptions}
                value={jurisdiction}
                onValueChange={handleJurisdictionChange}
                placeholder="Select jurisdiction..."
                searchPlaceholder="Search jurisdictions..."
                emptyText="No jurisdiction found."
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Project Type
              </Label>
              <SearchableCombobox
                options={projectTypeOptions}
                value={projectType}
                onValueChange={handleProjectTypeChange}
                placeholder="Select project type..."
                searchPlaceholder="Search project types..."
                emptyText="No project type found."
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Code Year
              </Label>
              <Select value={codeYear} onValueChange={setCodeYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2024">2024</SelectItem>
                  <SelectItem value="2021">2021</SelectItem>
                  <SelectItem value="2018">2018</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Analysis Mode Toggle - only show for jurisdictions with amendments */}
          {hasLocalAmendments && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Scale className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Dual Code Analysis</p>
                      <p className="text-sm text-muted-foreground">
                        This jurisdiction has local amendments. Choose analysis mode:
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={analysisMode} onValueChange={(v) => setAnalysisMode(v as "both" | "ibc" | "local")}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">
                          <div className="flex items-center gap-2">
                            <ToggleLeft className="h-4 w-4" />
                            Both (Recommended)
                          </div>
                        </SelectItem>
                        <SelectItem value="ibc">IBC Only</SelectItem>
                        <SelectItem value="local">Local Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upload Area */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <input
              type="file"
              id="drawing-upload"
              className="hidden"
              accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf"
              onChange={handleFileChange}
              multiple
            />

            {files.length > 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {files.map((f, index) => (
                    <div key={index} className="relative bg-muted/50 rounded-lg p-3">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-3 w-3" />
                      </Button>

                      {f.preview ? (
                        <img src={f.preview} alt={f.file.name} className="h-20 w-full object-cover rounded mb-2" />
                      ) : (
                        <div className="h-20 flex items-center justify-center bg-muted rounded mb-2">
                          <FileText className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}

                      <p className="text-xs font-medium truncate">{f.file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(f.file.size)}</p>

                      <Select
                        value={f.discipline}
                        onValueChange={(v) => updateFileDiscipline(index, v as DocumentDiscipline)}
                      >
                        <SelectTrigger className="h-7 mt-2 text-xs">
                          <SelectValue placeholder="Discipline" />
                        </SelectTrigger>
                        <SelectContent>
                          {DISCIPLINE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-xs">
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-center gap-4 pt-2 border-t">
                  <p className="text-sm text-muted-foreground">
                    {files.length} file{files.length !== 1 ? "s" : ""} selected
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById("drawing-upload")?.click()}
                  >
                    Add More Files
                  </Button>
                </div>
              </div>
            ) : (
              <label htmlFor="drawing-upload" className="cursor-pointer">
                <div className="space-y-2">
                  <div className="flex justify-center gap-4">
                    <FileImage className="h-12 w-12 text-muted-foreground" />
                    <Upload className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <p className="text-lg font-medium">Drop your drawings here or click to browse</p>
                  <p className="text-sm text-muted-foreground">
                    Supports PNG, JPEG, WebP, or PDF (max {MAX_FILE_SIZE_MB}MB per file)
                  </p>
                </div>
              </label>
            )}
          </div>

          {/* Analyze Button */}
          <div className="flex justify-center gap-4">
            <Button size="lg" onClick={analyzeDrawings} disabled={files.length === 0 || analyzing} className="px-8">
              {analyzing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Analyze for Compliance
                </>
              )}
            </Button>
            {currentResult && (
              <>
                <Button variant="outline" size="lg" onClick={exportReportPDF}>
                  <FileDown className="h-4 w-4 mr-2" />
                  Export PDF
                </Button>
                <Button variant="ghost" size="lg" onClick={exportReportJSON}>
                  <Download className="h-4 w-4 mr-2" />
                  Export JSON
                </Button>
              </>
            )}
          </div>

          {/* Progress Bar */}
          <AnimatePresence>
            {analyzing && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-center text-muted-foreground">
                  AI is analyzing your drawings for code compliance issues...
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Results */}
      <AnimatePresence>
        {(ibcResult || localResult) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            {/* Code Type Tabs - Only show if both results exist */}
            {ibcResult && localResult && (
              <Tabs value={activeResultTab} onValueChange={(v) => setActiveResultTab(v as "ibc" | "local")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="ibc" className="flex items-center gap-2">
                    <Scale className="h-4 w-4" />
                    General IBC ({ibcResult.summary.totalIssues} issues)
                  </TabsTrigger>
                  <TabsTrigger value="local" className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Local Amendments ({localResult.summary.totalIssues} issues)
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            {currentResult && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
                    <CardContent className="pt-6 text-center">
                      <div className={`text-4xl font-bold ${getScoreColor(currentResult.summary.overallScore ?? 0)}`}>
                        {currentResult.summary.overallScore ?? 0}%
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">Compliance Score</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-6 text-center">
                      <div className="text-4xl font-bold text-foreground">{currentResult.summary.totalIssues ?? 0}</div>
                      <p className="text-sm text-muted-foreground mt-1">Total Issues</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-destructive">
                    <CardContent className="pt-6 text-center">
                      <div className="text-4xl font-bold text-destructive">{currentResult.summary.critical ?? 0}</div>
                      <p className="text-sm text-muted-foreground mt-1">Critical</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-amber-500 dark:border-l-amber-400">
                    <CardContent className="pt-6 text-center">
                      <div className="text-4xl font-bold text-amber-600 dark:text-amber-400">{currentResult.summary.warnings ?? 0}</div>
                      <p className="text-sm text-muted-foreground mt-1">Warnings</p>
                    </CardContent>
                  </Card>
                  <Card className="border-l-4 border-l-blue-500 dark:border-l-blue-400">
                    <CardContent className="pt-6 text-center">
                      <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">{currentResult.summary.advisory ?? 0}</div>
                      <p className="text-sm text-muted-foreground mt-1">Advisory</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Resolution Progress */}
                {totalIssues > 0 && (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">Resolution Progress</span>
                        <span className="text-sm text-muted-foreground">
                          {resolvedCount} / {totalIssues} resolved
                        </span>
                      </div>
                      <Progress value={(resolvedCount / totalIssues) * 100} className="h-2" />
                    </CardContent>
                  </Card>
                )}

                {/* Jurisdiction Notes */}
                {currentResult.jurisdictionNotes && (
                  <Card className="bg-muted/50">
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-3">
                        <Info className="h-5 w-5 text-primary mt-0.5" />
                        <div>
                          <p className="font-medium mb-1">Jurisdiction Notes</p>
                          <p className="text-sm text-muted-foreground">{currentResult.jurisdictionNotes}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Issues List */}
                {renderIssuesList(currentResult)}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modify Dialog */}
      <Dialog open={modifyDialogOpen} onOpenChange={setModifyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modify Response</DialogTitle>
            <DialogDescription>Edit the suggested fix to match your design approach</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Original Suggestion</Label>
              <p className="text-sm text-muted-foreground mt-1">{selectedIssue?.suggestedFix}</p>
            </div>
            <div className="space-y-2">
              <Label>Your Response</Label>
              <Textarea
                value={modifiedText}
                onChange={(e) => setModifiedText(e.target.value)}
                rows={4}
                placeholder="Enter your modified response..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setModifyDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveModification}>Save Response</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
