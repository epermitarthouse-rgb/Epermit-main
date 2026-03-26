import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  AlertTriangle, AlertCircle, Info, Check, X, ZoomIn, ZoomOut, 
  RotateCcw, Eye, EyeOff, ChevronRight, Edit3, FileText, Download,
  CheckCircle2, XCircle, Pencil
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { exportDesignMemoPDF } from "@/lib/designMemoPDF";

interface ComplianceIssue {
  id: string;
  x: number;
  y: number;
  severity: "critical" | "warning" | "advisory";
  code: string;
  title: string;
  description: string;
  requirement: string;
  suggestedFix: string;
  category: string;
}

interface IssueResponse {
  issueId: string;
  status: "accepted" | "modified" | "rejected";
  originalFix: string;
  response: string;
  sheetReference: string;
  cloudNumber: number;
}

const sampleIssues: ComplianceIssue[] = [
  {
    id: "1",
    x: 15,
    y: 25,
    severity: "critical",
    code: "IBC 1005.1",
    title: "Exit Width Violation",
    description: "Corridor exit width is 36\" but required minimum is 44\" for occupant load >50",
    requirement: "Minimum egress width: 0.2\" per occupant, minimum 44\" for corridors",
    suggestedFix: "Widen corridor to minimum 44\" or reduce occupant load calculation",
    category: "Egress",
  },
  {
    id: "2",
    x: 45,
    y: 18,
    severity: "critical",
    code: "IBC 1017.1",
    title: "Travel Distance Exceeded",
    description: "Travel distance from office area to nearest exit is 285'. Maximum allowed is 250' (sprinklered)",
    requirement: "Maximum travel distance: 250' with sprinklers, 200' without",
    suggestedFix: "Add additional exit or relocate workstations to reduce travel distance",
    category: "Egress",
  },
  {
    id: "3",
    x: 72,
    y: 35,
    severity: "warning",
    code: "IBC 707.3",
    title: "Fire Barrier Gap",
    description: "Shaft enclosure at stair B missing continuous fire-rated construction at ceiling intersection",
    requirement: "Fire barriers shall extend from floor to underside of floor or roof above",
    suggestedFix: "Extend fire-rated construction to deck above, seal all penetrations",
    category: "Fire Separation",
  },
  {
    id: "4",
    x: 28,
    y: 55,
    severity: "warning",
    code: "IBC 1013.1",
    title: "Missing Exit Sign",
    description: "Exit sign not shown at corridor intersection near conference room",
    requirement: "Exit signs required at exits and where necessary to indicate direction",
    suggestedFix: "Add illuminated exit sign at corridor intersection",
    category: "Egress",
  },
  {
    id: "5",
    x: 58,
    y: 68,
    severity: "advisory",
    code: "ADA 404.2.4",
    title: "Door Clearance",
    description: "Maneuvering clearance at restroom door appears tight for wheelchair access",
    requirement: "18\" minimum clearance on push side, 60\" minimum on pull side",
    suggestedFix: "Verify dimensions on enlarged plan, consider automatic door operator",
    category: "Accessibility",
  },
  {
    id: "6",
    x: 82,
    y: 48,
    severity: "critical",
    code: "IBC 508.4",
    title: "Occupancy Separation",
    description: "Assembly space (A-3) not properly separated from Business (B) occupancy",
    requirement: "1-hour separation required between A-3 and B occupancies (Table 508.4)",
    suggestedFix: "Add 1-hour fire-rated wall assembly with rated opening protectives",
    category: "Occupancy",
  },
  {
    id: "7",
    x: 35,
    y: 78,
    severity: "warning",
    code: "IBC 1010.1.9",
    title: "Door Swing Direction",
    description: "Exit door at loading dock swings against egress direction",
    requirement: "Doors shall swing in direction of egress for rooms with occupant load >50",
    suggestedFix: "Reverse door swing or verify occupant load calculation",
    category: "Egress",
  },
  {
    id: "8",
    x: 65,
    y: 22,
    severity: "advisory",
    code: "IFC 901.4.6",
    title: "Sprinkler Coverage",
    description: "New partition may obstruct sprinkler coverage pattern",
    requirement: "Sprinkler coverage must not be obstructed by construction",
    suggestedFix: "Coordinate with fire protection engineer for sprinkler head relocation",
    category: "Fire Protection",
  },
];

const severityConfig = {
  critical: { icon: AlertCircle, color: "text-red-500", bg: "bg-red-500", label: "Critical" },
  warning: { icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-500", label: "Warning" },
  advisory: { icon: Info, color: "text-blue-500", bg: "bg-blue-500", label: "Advisory" },
};

const categories = ["All", "Egress", "Fire Separation", "Occupancy", "Accessibility", "Fire Protection"];

export function InteractiveDrawingViewer() {
  const [selectedIssue, setSelectedIssue] = useState<ComplianceIssue | null>(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [filter, setFilter] = useState("All");
  const [resolvedIssues, setResolvedIssues] = useState<string[]>([]);
  const [issueResponses, setIssueResponses] = useState<IssueResponse[]>([]);
  const [showModifyDialog, setShowModifyDialog] = useState(false);
  const [modifiedResponse, setModifiedResponse] = useState("");
  const [showMemoDialog, setShowMemoDialog] = useState(false);

  const filteredIssues = sampleIssues.filter(
    (issue) => filter === "All" || issue.category === filter
  );

  const visibleIssues = filteredIssues.filter(
    (issue) => !resolvedIssues.includes(issue.id)
  );

  const stats = {
    critical: sampleIssues.filter((i) => i.severity === "critical" && !resolvedIssues.includes(i.id)).length,
    warning: sampleIssues.filter((i) => i.severity === "warning" && !resolvedIssues.includes(i.id)).length,
    advisory: sampleIssues.filter((i) => i.severity === "advisory" && !resolvedIssues.includes(i.id)).length,
  };

  const getNextCloudNumber = () => {
    return issueResponses.length + 1;
  };

  const getSheetReference = (issue: ComplianceIssue) => {
    const sheets: Record<string, string> = {
      Egress: "A1.1",
      "Fire Separation": "A2.1",
      Occupancy: "A1.1",
      Accessibility: "A3.1",
      "Fire Protection": "FP1.1",
    };
    return sheets[issue.category] || "A1.1";
  };

  const handleAccept = (issue: ComplianceIssue) => {
    const response: IssueResponse = {
      issueId: issue.id,
      status: "accepted",
      originalFix: issue.suggestedFix,
      response: issue.suggestedFix,
      sheetReference: getSheetReference(issue),
      cloudNumber: getNextCloudNumber(),
    };
    setIssueResponses((prev) => [...prev, response]);
    setResolvedIssues((prev) => [...prev, issue.id]);
    setSelectedIssue(null);
    toast.success(`Fix accepted! Revision cloud #${response.cloudNumber} added to ${response.sheetReference}`);
  };

  const handleModify = () => {
    if (!selectedIssue || !modifiedResponse.trim()) return;
    
    const response: IssueResponse = {
      issueId: selectedIssue.id,
      status: "modified",
      originalFix: selectedIssue.suggestedFix,
      response: modifiedResponse.trim(),
      sheetReference: getSheetReference(selectedIssue),
      cloudNumber: getNextCloudNumber(),
    };
    setIssueResponses((prev) => [...prev, response]);
    setResolvedIssues((prev) => [...prev, selectedIssue.id]);
    setSelectedIssue(null);
    setShowModifyDialog(false);
    setModifiedResponse("");
    toast.success(`Modified fix applied! Revision cloud #${response.cloudNumber} added to ${response.sheetReference}`);
  };

  const handleReject = (issue: ComplianceIssue) => {
    const response: IssueResponse = {
      issueId: issue.id,
      status: "rejected",
      originalFix: issue.suggestedFix,
      response: "No action required - existing condition complies or is not applicable",
      sheetReference: getSheetReference(issue),
      cloudNumber: 0,
    };
    setIssueResponses((prev) => [...prev, response]);
    setResolvedIssues((prev) => [...prev, issue.id]);
    setSelectedIssue(null);
    toast.info("Issue rejected - no changes made to drawings");
  };

  const handleReset = () => {
    setResolvedIssues([]);
    setIssueResponses([]);
    setSelectedIssue(null);
  };

  const getIssueResponse = (issueId: string) => {
    return issueResponses.find((r) => r.issueId === issueId);
  };

  const generateMemoContent = () => {
    const projectInfo = {
      name: "Sample Office Building TI",
      number: "2026-001",
      date: new Date().toLocaleDateString(),
      reviewer: "Building Department Plan Check",
      architect: "Design Team AOR",
    };

    return { projectInfo, responses: issueResponses };
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6 min-h-[700px]">
      {/* Drawing Viewer */}
      <div className="lg:col-span-2 relative">
        <Card className="h-full overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between p-3 border-b bg-secondary/30 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(z + 0.25, 2))}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-2">{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={showOverlay ? "default" : "outline"}
                size="sm"
                onClick={() => setShowOverlay(!showOverlay)}
                className={showOverlay ? "bg-accent hover:bg-accent/90" : ""}
              >
                {showOverlay ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
                {showOverlay ? "Hide" : "Show"}
              </Button>
              {issueResponses.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setShowMemoDialog(true)}>
                  <FileText className="h-4 w-4 mr-2" />
                  Design Memo
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={handleReset}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
            </div>
          </div>

          {/* Drawing Area */}
          <div className="relative h-[calc(100%-60px)] bg-[#091428] overflow-auto">
            <div
              className="relative w-full h-full min-h-[500px] transition-transform duration-200"
              style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
            >
              {/* Floor Plan SVG */}
              <svg viewBox="0 0 100 100" className="w-full h-full" style={{ minWidth: "600px", minHeight: "500px" }}>
                {/* Background grid */}
                <defs>
                  <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
                    <path d="M 5 0 L 0 0 0 5" fill="none" stroke="hsl(var(--border))" strokeWidth="0.1" />
                  </pattern>
                </defs>
                <rect width="100" height="100" fill="url(#grid)" />

                {/* Building outline */}
                <rect x="5" y="5" width="90" height="90" fill="white" stroke="hsl(var(--primary))" strokeWidth="0.5" />

                {/* Rooms */}
                <rect x="8" y="8" width="25" height="20" fill="hsl(var(--secondary))" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="20" y="19" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">LOBBY</text>

                <rect x="35" y="8" width="30" height="25" fill="hsl(var(--secondary))" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="50" y="22" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">OPEN OFFICE</text>

                <rect x="67" y="8" width="25" height="20" fill="hsl(var(--accent) / 0.1)" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="79" y="19" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">ASSEMBLY</text>

                <rect x="8" y="30" width="20" height="25" fill="hsl(var(--secondary))" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="18" y="44" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">CONF</text>

                <rect x="30" y="35" width="35" height="30" fill="hsl(var(--secondary))" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="47" y="52" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">CORRIDOR</text>

                <rect x="67" y="30" width="25" height="35" fill="hsl(var(--secondary))" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="79" y="49" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">STAIR B</text>

                <rect x="8" y="57" width="20" height="18" fill="hsl(var(--secondary))" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="18" y="67" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">REST</text>

                <rect x="30" y="67" width="35" height="25" fill="hsl(var(--secondary))" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="47" y="81" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">LOADING</text>

                <rect x="67" y="67" width="25" height="25" fill="hsl(var(--secondary))" stroke="hsl(var(--primary))" strokeWidth="0.3" />
                <text x="79" y="81" fontSize="2" fill="hsl(var(--muted-foreground))" textAnchor="middle">MECH</text>

                {/* Doors */}
                <rect x="32" y="7" width="3" height="1.5" fill="hsl(var(--accent))" />
                <rect x="64" y="7" width="3" height="1.5" fill="hsl(var(--accent))" />
                <rect x="27" y="42" width="3" height="1.5" fill="hsl(var(--accent))" />

                {/* Revision Clouds (AIA Standard) - shown for resolved issues */}
                {issueResponses.filter(r => r.status !== "rejected").map((response) => {
                  const issue = sampleIssues.find(i => i.id === response.issueId);
                  if (!issue) return null;
                  
                  // Generate cloud path around the issue location
                  const cx = issue.x;
                  const cy = issue.y;
                  const cloudPath = `
                    M ${cx - 5} ${cy}
                    Q ${cx - 6} ${cy - 3}, ${cx - 3} ${cy - 5}
                    Q ${cx} ${cy - 7}, ${cx + 3} ${cy - 5}
                    Q ${cx + 6} ${cy - 3}, ${cx + 5} ${cy}
                    Q ${cx + 6} ${cy + 3}, ${cx + 3} ${cy + 5}
                    Q ${cx} ${cy + 7}, ${cx - 3} ${cy + 5}
                    Q ${cx - 6} ${cy + 3}, ${cx - 5} ${cy}
                  `;
                  
                  return (
                    <g key={response.issueId}>
                      {/* Revision Cloud */}
                      <path
                        d={cloudPath}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="0.4"
                        strokeLinecap="round"
                      />
                      {/* Cloud Number Triangle */}
                      <polygon
                        points={`${cx + 6},${cy - 6} ${cx + 10},${cy - 6} ${cx + 8},${cy - 2}`}
                        fill="#2563eb"
                        stroke="#2563eb"
                        strokeWidth="0.2"
                      />
                      <text
                        x={cx + 8}
                        y={cy - 4}
                        fontSize="2"
                        fill="white"
                        textAnchor="middle"
                        fontWeight="bold"
                      >
                        {response.cloudNumber}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Issue Hotspots */}
              {showOverlay &&
                visibleIssues.map((issue) => {
                  const SeverityIcon = severityConfig[issue.severity].icon;
                  return (
                    <button
                      key={issue.id}
                      className={cn(
                        "absolute w-6 h-6 -ml-3 -mt-3 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer",
                        severityConfig[issue.severity].bg,
                        "hover:scale-125 animate-pulse-glow",
                        selectedIssue?.id === issue.id && "ring-4 ring-white scale-125"
                      )}
                      style={{ left: `${issue.x}%`, top: `${issue.y}%` }}
                      onClick={() => setSelectedIssue(issue)}
                    >
                      <SeverityIcon className="h-4 w-4 text-white" />
                    </button>
                  );
                })}

              {/* Resolved issue markers (green checkmarks) */}
              {issueResponses.map((response) => {
                const issue = sampleIssues.find(i => i.id === response.issueId);
                if (!issue) return null;
                
                return (
                  <div
                    key={`resolved-${response.issueId}`}
                    className={cn(
                      "absolute w-6 h-6 -ml-3 -mt-3 rounded-full flex items-center justify-center",
                      response.status === "rejected" ? "bg-[#6B9AC4]" : "bg-emerald-500"
                    )}
                    style={{ left: `${issue.x}%`, top: `${issue.y}%` }}
                  >
                    {response.status === "rejected" ? (
                      <XCircle className="h-4 w-4 text-white" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-white" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>

      {/* Side Panel */}
      <div className="flex flex-col gap-4">
        {/* Summary Stats */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Compliance Summary</h3>
            {issueResponses.length > 0 && (
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400">
                {issueResponses.length} addressed
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded bg-red-500/10">
              <div className="text-2xl font-bold text-red-500">{stats.critical}</div>
              <div className="text-xs text-muted-foreground">Critical</div>
            </div>
            <div className="p-2 rounded bg-amber-500/10">
              <div className="text-2xl font-bold text-amber-500">{stats.warning}</div>
              <div className="text-xs text-muted-foreground">Warning</div>
            </div>
            <div className="p-2 rounded bg-blue-500/10">
              <div className="text-2xl font-bold text-blue-500">{stats.advisory}</div>
              <div className="text-xs text-muted-foreground">Advisory</div>
            </div>
          </div>
        </Card>

        {/* Filter */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Filter by Category</h3>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={filter === cat ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(cat)}
                className={filter === cat ? "bg-accent hover:bg-accent/90" : ""}
              >
                {cat}
              </Button>
            ))}
          </div>
        </Card>

        {/* Issue Details or List */}
        <Card className="flex-1 overflow-hidden">
          {selectedIssue ? (
            <div className="p-4 h-full flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <Badge className={cn(severityConfig[selectedIssue.severity].bg, "text-white")}>
                  {severityConfig[selectedIssue.severity].label}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => setSelectedIssue(null)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <ScrollArea className="flex-1">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground">{selectedIssue.code}</p>
                    <h4 className="font-semibold text-lg">{selectedIssue.title}</h4>
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-1">Issue</p>
                    <p className="text-sm text-muted-foreground">{selectedIssue.description}</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-1">Code Requirement</p>
                    <p className="text-sm text-muted-foreground">{selectedIssue.requirement}</p>
                  </div>

                  <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
                    <p className="text-sm font-medium mb-1 text-accent">AI Suggested Fix</p>
                    <p className="text-sm">{selectedIssue.suggestedFix}</p>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Sheet Reference: <span className="font-medium">{getSheetReference(selectedIssue)}</span>
                  </div>
                </div>
              </ScrollArea>

              {/* Action Buttons */}
              <div className="space-y-2 mt-4 pt-4 border-t">
                <p className="text-xs font-medium text-muted-foreground mb-2">Respond to Suggested Fix:</p>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700"
                    onClick={() => handleAccept(selectedIssue)}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500 text-amber-400 hover:bg-[#FFF7ED] dark:hover:bg-[#FF6B2B08]"
                    onClick={() => {
                      setModifiedResponse(selectedIssue.suggestedFix);
                      setShowModifyDialog(true);
                    }}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Modify
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500 text-red-600 hover:bg-red-50"
                    onClick={() => handleReject(selectedIssue)}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <h3 className="font-semibold mb-3">
                {visibleIssues.length > 0 ? `Open Issues (${visibleIssues.length})` : "All Issues Addressed!"}
              </h3>
              <ScrollArea className="h-[300px]">
                {visibleIssues.length > 0 ? (
                  <div className="space-y-2">
                    {visibleIssues.map((issue) => {
                      const SeverityIcon = severityConfig[issue.severity].icon;
                      return (
                        <button
                          key={issue.id}
                          className="w-full p-3 rounded-lg border bg-card hover:bg-secondary/50 text-left transition-colors flex items-start gap-3"
                          onClick={() => setSelectedIssue(issue)}
                        >
                          <SeverityIcon className={cn("h-5 w-5 mt-0.5", severityConfig[issue.severity].color)} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-muted-foreground">{issue.code}</p>
                            <p className="font-medium text-sm truncate">{issue.title}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      All compliance issues have been addressed.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4"
                      onClick={() => setShowMemoDialog(true)}
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Generate Design Memo
                    </Button>
                  </div>
                )}
              </ScrollArea>
            </div>
          )}
        </Card>
      </div>

      {/* Modify Response Dialog */}
      <Dialog open={showModifyDialog} onOpenChange={setShowModifyDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Modify Suggested Fix</DialogTitle>
            <DialogDescription>
              Edit the response to match your design approach. The modification will be documented in the Design Memo.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={modifiedResponse}
              onChange={(e) => setModifiedResponse(e.target.value)}
              rows={5}
              placeholder="Enter your modified response..."
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModifyDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleModify} disabled={!modifiedResponse.trim()}>
              <Check className="h-4 w-4 mr-2" />
              Apply Modified Fix
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Design Memo Dialog */}
      <Dialog open={showMemoDialog} onOpenChange={setShowMemoDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Architect/Engineer Design Memo
            </DialogTitle>
            <DialogDescription>
              AIA Standard Response to Plan Check Comments
            </DialogDescription>
          </DialogHeader>
          
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6 py-4">
              {/* Header */}
              <div className="border rounded-lg p-4 bg-secondary/30">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Project Name:</p>
                    <p className="font-medium">Sample Office Building TI</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Project Number:</p>
                    <p className="font-medium">2026-001</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date:</p>
                    <p className="font-medium">{new Date().toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Revision:</p>
                    <p className="font-medium">Response to Plan Check #1</p>
                  </div>
                </div>
              </div>

              {/* Response Table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-primary text-primary-foreground p-3 grid grid-cols-12 gap-2 text-xs font-medium">
                  <div className="col-span-1">#</div>
                  <div className="col-span-2">Code Ref.</div>
                  <div className="col-span-3">Reviewer Comment</div>
                  <div className="col-span-1">Status</div>
                  <div className="col-span-3">Design Team Response</div>
                  <div className="col-span-2">Location</div>
                </div>
                
                {issueResponses.length > 0 ? (
                  issueResponses.map((response, index) => {
                    const issue = sampleIssues.find(i => i.id === response.issueId);
                    if (!issue) return null;
                    
                    return (
                      <div
                        key={response.issueId}
                        className="p-3 grid grid-cols-12 gap-2 text-xs border-t items-start"
                      >
                        <div className="col-span-1 font-medium">{index + 1}</div>
                        <div className="col-span-2">
                          <span className="font-medium">{issue.code}</span>
                        </div>
                        <div className="col-span-3 text-muted-foreground">
                          {issue.description}
                        </div>
                        <div className="col-span-1">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px]",
                              response.status === "accepted" && "bg-emerald-500/10 text-emerald-400",
                              response.status === "modified" && "bg-amber-500/10 text-amber-400",
                              response.status === "rejected" && "bg-[#6B9AC4]/10 text-[#6B9AC4]"
                            )}
                          >
                            {response.status}
                          </Badge>
                        </div>
                        <div className="col-span-3">
                          {response.response}
                        </div>
                        <div className="col-span-2">
                          {response.status !== "rejected" ? (
                            <span>
                              Sheet {response.sheetReference}
                              <br />
                              <span className="text-muted-foreground">
                                Cloud #{response.cloudNumber}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center text-muted-foreground">
                    No responses recorded yet. Accept, modify, or reject suggested fixes to populate this memo.
                  </div>
                )}
              </div>

              {/* Footer Note */}
              <div className="text-xs text-muted-foreground border-t pt-4">
                <p className="font-medium mb-2">Notes:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>All revisions are indicated by revision clouds per AIA standards</li>
                  <li>Cloud numbers correspond to the item numbers in this response memo</li>
                  <li>Rejected items have been reviewed and determined to be either compliant or not applicable</li>
                </ul>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setShowMemoDialog(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                const rows = issueResponses
                  .map((response, index) => {
                    const issue = sampleIssues.find((i) => i.id === response.issueId);
                    if (!issue) return null;
                    return {
                      number: index + 1,
                      codeRef: issue.code,
                      reviewerComment: issue.description,
                      status: response.status,
                      designTeamResponse: response.response,
                      location:
                        response.status !== "rejected"
                          ? `Sheet ${response.sheetReference}, Cloud #${response.cloudNumber}`
                          : "N/A",
                    };
                  })
                  .filter((r): r is NonNullable<typeof r> => r != null);
                try {
                  exportDesignMemoPDF({
                    projectName: "Sample Office Building TI",
                    projectNumber: "2026-001",
                    revision: "Response to Plan Check #1",
                    rows,
                  });
                  toast.success("Design Memo downloaded");
                  setShowMemoDialog(false);
                } catch (err) {
                  console.error("Design Memo PDF error:", err);
                  toast.error("Failed to download PDF. Please try again.");
                }
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
