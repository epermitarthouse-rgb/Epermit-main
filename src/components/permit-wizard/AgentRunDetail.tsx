import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  Timer,
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  FileSearch,
  KeyRound,
  FileText,
  Tags,
  UserCheck,
  Shield,
  MonitorPlay,
  Send,
  Eye,
  MapPin,
  Building2,
  Droplets,
  Landmark,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { PropertyIntelligenceCard } from "./PropertyIntelligenceCard";
import { LicenseValidationCard } from "./LicenseValidationCard";
import { DocumentChecklistCard } from "./DocumentChecklistCard";
import { PermitClassificationCard } from "./PermitClassificationCard";

interface AgentRun {
  id: string;
  filing_id: string;
  agent_name: string;
  layer: number;
  status: string;
  input_data?: Record<string, unknown> | null;
  output_data?: Record<string, unknown> | null;
  error_message?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

interface Screenshot {
  id: string;
  filing_id: string;
  agent_name: string;
  step_name: string;
  screenshot_url: string;
  field_audit?: Record<string, unknown> | null;
  created_at: string;
}

interface AgentRunDetailProps {
  run: AgentRun | null;
  screenshots?: Screenshot[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AGENT_META: Record<string, { label: string; icon: typeof FileSearch }> = {
  property_intelligence: { label: "Property Intelligence", icon: MapPin },
  license_validation: { label: "License Validation", icon: KeyRound },
  document_preparation: { label: "Document Preparation", icon: FileText },
  permit_classifier: { label: "Permit Classifier", icon: Tags },
  pre_submission_review: { label: "Human Review Gate", icon: UserCheck },
  authentication: { label: "Portal Authentication", icon: Shield },
  form_filing: { label: "Form Filing", icon: MonitorPlay },
  submission_finalization: { label: "Submission Finalization", icon: Send },
  status_monitor: { label: "Status Monitor", icon: Eye },
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; className?: string }> = {
  pending: { label: "Pending", variant: "secondary" },
  running: { label: "Running", variant: "default", className: "bg-blue-600 dark:bg-blue-500" },
  completed: { label: "Completed", variant: "default", className: "bg-emerald-600 dark:bg-emerald-500" },
  failed: { label: "Failed", variant: "destructive" },
  escalated: { label: "Escalated", variant: "default", className: "bg-amber-600 dark:bg-amber-500" },
  waiting_human: { label: "Awaiting Review", variant: "default", className: "bg-amber-600 dark:bg-amber-500" },
};

function computeDuration(startedAt?: string | null, completedAt?: string | null): string | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const diffMs = end - start;
  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
  return `${Math.floor(diffMs / 60000)}m ${Math.round((diffMs % 60000) / 1000)}s`;
}

function JsonViewer({ data, label }: { data: unknown; label: string }) {
  const [expanded, setExpanded] = useState(false);

  if (data === null || data === undefined) return null;

  const jsonStr = JSON.stringify(data, null, 2);
  const lines = jsonStr.split("\n");
  const isLong = lines.length > 8;

  return (
    <div className="space-y-1">
      <button
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        data-testid={`button-toggle-${label.toLowerCase().replace(/\s/g, "-")}`}
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {label}
      </button>
      {expanded && (
        <pre
          className="text-xs bg-muted/50 p-3 rounded-md overflow-x-auto max-h-80 overflow-y-auto font-mono"
          data-testid={`text-json-${label.toLowerCase().replace(/\s/g, "-")}`}
        >
          {isLong ? jsonStr : jsonStr}
        </pre>
      )}
      {!expanded && (
        <p className="text-xs text-muted-foreground">
          {typeof data === "object" && data !== null
            ? `${Object.keys(data as Record<string, unknown>).length} fields`
            : String(data)}
        </p>
      )}
    </div>
  );
}

function ScreenshotCarousel({ screenshots }: { screenshots: Screenshot[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  if (screenshots.length === 0) return null;

  const current = screenshots[currentIndex];

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
        <ImageIcon className="h-3 w-3" />
        Screenshots ({screenshots.length})
      </p>
      <div className="space-y-2">
        <div className="relative bg-muted/30 rounded-md overflow-hidden">
          <img
            src={current.screenshot_url}
            alt={`Step: ${current.step_name}`}
            className="w-full h-auto max-h-96 object-contain"
            data-testid={`img-screenshot-${currentIndex}`}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            data-testid="button-screenshot-prev"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Prev
          </Button>
          <div className="text-center">
            <p className="text-sm font-medium" data-testid="text-screenshot-step">
              {current.step_name}
            </p>
            <p className="text-xs text-muted-foreground">
              {currentIndex + 1} / {screenshots.length}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCurrentIndex(Math.min(screenshots.length - 1, currentIndex + 1))}
            disabled={currentIndex === screenshots.length - 1}
            data-testid="button-screenshot-next"
          >
            Next
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        {current.field_audit && Object.keys(current.field_audit).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Field Audit
            </p>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(current.field_audit).map(([field, value], i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-1 text-xs bg-muted/30 p-1.5 rounded-md"
                  data-testid={`text-field-audit-${i}`}
                >
                  <span className="text-muted-foreground truncate">{field}</span>
                  <span className="font-medium truncate max-w-[120px]">{String(value)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyIntelligenceDetail({ outputData }: { outputData: Record<string, unknown> | null | undefined }) {
  if (!outputData) return null;

  const propData = (outputData.property_data || outputData) as Record<string, unknown>;

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Property Intelligence Results
      </p>
      <PropertyIntelligenceCard data={propData as any} />
    </div>
  );
}

function LicenseValidationDetail({ outputData }: { outputData: Record<string, unknown> | null | undefined }) {
  if (!outputData) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        License Validation Results
      </p>
      <LicenseValidationCard data={outputData as any} />
    </div>
  );
}

function DocumentPreparationDetail({ outputData }: { outputData: Record<string, unknown> | null | undefined }) {
  if (!outputData) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Document Checklist
      </p>
      <DocumentChecklistCard data={outputData as any} />
    </div>
  );
}

function PermitClassifierDetail({ outputData }: { outputData: Record<string, unknown> | null | undefined }) {
  if (!outputData) return null;

  return (
    <div className="space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Permit Classification
      </p>
      <PermitClassificationCard data={outputData as any} />
    </div>
  );
}

function AgentSpecificView({
  agentName,
  outputData,
  screenshots,
}: {
  agentName: string;
  outputData: Record<string, unknown> | null | undefined;
  screenshots: Screenshot[];
}) {
  switch (agentName) {
    case "property_intelligence":
      return <PropertyIntelligenceDetail outputData={outputData} />;
    case "license_validation":
      return <LicenseValidationDetail outputData={outputData} />;
    case "document_preparation":
      return <DocumentPreparationDetail outputData={outputData} />;
    case "permit_classifier":
      return <PermitClassifierDetail outputData={outputData} />;
    case "form_filing":
    case "submission_finalization":
      return screenshots.length > 0 ? <ScreenshotCarousel screenshots={screenshots} /> : null;
    default:
      return null;
  }
}

export function AgentRunDetail({ run, screenshots = [], open, onOpenChange }: AgentRunDetailProps) {
  if (!run) return null;

  const meta = AGENT_META[run.agent_name] || { label: run.agent_name.replace(/_/g, " "), icon: FileSearch };
  const Icon = meta.icon;
  const statusCfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
  const duration = computeDuration(run.started_at, run.completed_at);
  const agentScreenshots = screenshots.filter((s) => s.agent_name === run.agent_name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap" data-testid="text-agent-detail-title">
            <Icon className="h-5 w-5" />
            {meta.label}
          </DialogTitle>
          <DialogDescription>
            Agent run details and execution data
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-4 pr-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge
                variant={statusCfg.variant}
                className={statusCfg.className}
                data-testid="badge-agent-detail-status"
              >
                {run.status === "running" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                {run.status === "completed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                {run.status === "failed" && <XCircle className="h-3 w-3 mr-1" />}
                {(run.status === "escalated" || run.status === "waiting_human") && <AlertTriangle className="h-3 w-3 mr-1" />}
                {run.status === "pending" && <Clock className="h-3 w-3 mr-1" />}
                {statusCfg.label}
              </Badge>
              <Badge variant="outline" data-testid="badge-agent-detail-layer">
                Layer {run.layer}
              </Badge>
              {duration && (
                <Badge variant="outline" data-testid="badge-agent-detail-duration">
                  <Timer className="h-3 w-3 mr-1" />
                  {duration}
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              {run.started_at && (
                <div data-testid="text-agent-started-at">
                  <span className="text-muted-foreground">Started: </span>
                  <span className="font-medium">{new Date(run.started_at).toLocaleString()}</span>
                </div>
              )}
              {run.completed_at && (
                <div data-testid="text-agent-completed-at">
                  <span className="text-muted-foreground">Completed: </span>
                  <span className="font-medium">{new Date(run.completed_at).toLocaleString()}</span>
                </div>
              )}
            </div>

            {run.error_message && (
              <Card className="border-destructive">
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-destructive">Error</p>
                      <p className="text-sm text-destructive/80 mt-1" data-testid="text-agent-error-message">
                        {run.error_message}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Separator />

            <AgentSpecificView
              agentName={run.agent_name}
              outputData={run.output_data}
              screenshots={agentScreenshots}
            />

            {run.agent_name === "form_filing" && agentScreenshots.length === 0 && run.output_data && (
              <JsonViewer data={run.output_data} label="Output Data" />
            )}

            {!["property_intelligence", "license_validation", "document_preparation", "permit_classifier", "form_filing", "submission_finalization"].includes(run.agent_name) && run.output_data && (
              <JsonViewer data={run.output_data} label="Output Data" />
            )}

            {run.input_data && (
              <JsonViewer data={run.input_data} label="Input Data" />
            )}

            {agentScreenshots.length > 0 && !["form_filing", "submission_finalization"].includes(run.agent_name) && (
              <ScreenshotCarousel screenshots={agentScreenshots} />
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
