import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle2, XCircle, ChevronRight, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface DetectionIssue {
  id: string;
  category: string;
  title: string;
  description: string;
  frequency: number; // % of rejections in this jurisdiction
  severity: "high" | "medium" | "low";
}

const issueCategories: { name: string; icon: string; issues: DetectionIssue[] }[] = [
  {
    name: "Egress & Exit Requirements",
    icon: "🚪",
    issues: [
      { id: "e1", category: "Egress", title: "Exit width insufficient", description: "Corridor or door width below minimum for calculated occupant load", frequency: 78, severity: "high" },
      { id: "e2", category: "Egress", title: "Travel distance exceeded", description: "Distance to nearest exit exceeds code maximum", frequency: 65, severity: "high" },
      { id: "e3", category: "Egress", title: "Common path of egress", description: "Single path of travel before reaching two exits is too long", frequency: 42, severity: "medium" },
      { id: "e4", category: "Egress", title: "Exit signage missing", description: "Required exit signs not shown on plans", frequency: 55, severity: "medium" },
    ],
  },
  {
    name: "Fire Separation & Ratings",
    icon: "🔥",
    issues: [
      { id: "f1", category: "Fire", title: "Fire barrier incomplete", description: "Fire-rated walls not continuous to deck", frequency: 71, severity: "high" },
      { id: "f2", category: "Fire", title: "Opening protective missing", description: "Doors in fire barriers not rated or labeled", frequency: 58, severity: "high" },
      { id: "f3", category: "Fire", title: "Penetration details", description: "Through-penetration firestop details not shown", frequency: 45, severity: "medium" },
    ],
  },
  {
    name: "Occupancy & Use Conflicts",
    icon: "🏢",
    issues: [
      { id: "o1", category: "Occupancy", title: "Mixed-use separation", description: "Required separation between different occupancies not provided", frequency: 52, severity: "high" },
      { id: "o2", category: "Occupancy", title: "Occupant load calculation", description: "Occupant load not shown or incorrectly calculated", frequency: 48, severity: "medium" },
    ],
  },
  {
    name: "MEP Coordination Issues",
    icon: "⚡",
    issues: [
      { id: "m1", category: "MEP", title: "Ceiling height conflicts", description: "Mechanical equipment conflicts with required ceiling heights", frequency: 35, severity: "medium" },
      { id: "m2", category: "MEP", title: "Equipment access", description: "Required clearances for maintenance not provided", frequency: 28, severity: "low" },
    ],
  },
  {
    name: "Accessibility",
    icon: "♿",
    issues: [
      { id: "a1", category: "ADA", title: "Door maneuvering clearance", description: "Required clear floor space at doors not dimensioned", frequency: 62, severity: "high" },
      { id: "a2", category: "ADA", title: "Accessible route gaps", description: "Accessible route not continuous or not identified", frequency: 55, severity: "medium" },
    ],
  },
];

const jurisdictions = [
  // Northeast
  { id: "nyc", name: "New York City, NY", rejectionRate: 58 },
  { id: "boston", name: "Boston, MA", rejectionRate: 44 },
  { id: "philadelphia", name: "Philadelphia, PA", rejectionRate: 42 },
  { id: "baltimore", name: "Baltimore, MD", rejectionRate: 39 },
  { id: "dc", name: "Washington, DC", rejectionRate: 48 },
  // Southeast
  { id: "miami", name: "Miami, FL", rejectionRate: 46 },
  { id: "atlanta", name: "Atlanta, GA", rejectionRate: 40 },
  { id: "charlotte", name: "Charlotte, NC", rejectionRate: 35 },
  { id: "jacksonville", name: "Jacksonville, FL", rejectionRate: 33 },
  { id: "new-orleans", name: "New Orleans, LA", rejectionRate: 44 },
  // Midwest
  { id: "chicago", name: "Chicago, IL", rejectionRate: 41 },
  { id: "detroit", name: "Detroit, MI", rejectionRate: 38 },
  { id: "columbus", name: "Columbus, OH", rejectionRate: 32 },
  { id: "minneapolis", name: "Minneapolis, MN", rejectionRate: 36 },
  { id: "kansas-city", name: "Kansas City, MO", rejectionRate: 30 },
  // Southwest
  { id: "houston", name: "Houston, TX", rejectionRate: 35 },
  { id: "dallas", name: "Dallas, TX", rejectionRate: 37 },
  { id: "austin", name: "Austin, TX", rejectionRate: 42 },
  { id: "san-antonio", name: "San Antonio, TX", rejectionRate: 34 },
  { id: "phoenix", name: "Phoenix, AZ", rejectionRate: 38 },
  // West
  { id: "la", name: "Los Angeles, CA", rejectionRate: 52 },
  { id: "sf", name: "San Francisco, CA", rejectionRate: 45 },
  { id: "san-diego", name: "San Diego, CA", rejectionRate: 43 },
  { id: "seattle", name: "Seattle, WA", rejectionRate: 38 },
  { id: "denver", name: "Denver, CO", rejectionRate: 36 },
  { id: "portland", name: "Portland, OR", rejectionRate: 41 },
  { id: "las-vegas", name: "Las Vegas, NV", rejectionRate: 34 },
];

export function PreSubmittalDetectionDemo() {
  const [selectedJurisdiction, setSelectedJurisdiction] = useState(jurisdictions[0]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<DetectionIssue | null>(null);
  const [projectScore, setProjectScore] = useState(72);

  const allIssues: DetectionIssue[] = issueCategories.flatMap((cat) => cat.issues);
  const criticalCount = allIssues.filter((i: DetectionIssue) => i.severity === "high").length;
  const warningCount = allIssues.filter((i: DetectionIssue) => i.severity === "medium").length;

  const getRiskLevel = (score: number) => {
    if (score >= 80) return { label: "Low Risk", color: "text-green-500", bg: "bg-green-500" };
    if (score >= 60) return { label: "Medium Risk", color: "text-amber-500", bg: "bg-amber-500" };
    return { label: "High Risk", color: "text-red-500", bg: "bg-red-500" };
  };

  const riskLevel = getRiskLevel(projectScore);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      {/* Left Panel - Issue Categories */}
      <div className="lg:col-span-2 space-y-4">
        {/* Jurisdiction Selector */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Select Jurisdiction ({jurisdictions.length} available)</h3>
          <ScrollArea className="h-[120px] pr-2 mb-3">
            <div className="flex flex-wrap gap-2">
              {jurisdictions.map((j) => (
                <Button
                  key={j.id}
                  variant={selectedJurisdiction.id === j.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedJurisdiction(j)}
                  className={selectedJurisdiction.id === j.id ? "bg-accent hover:bg-accent/90" : ""}
                >
                  {j.name}
                </Button>
              ))}
            </div>
          </ScrollArea>
          <p className="text-sm text-muted-foreground">
            Historical rejection rate: <span className="font-semibold">{selectedJurisdiction.rejectionRate}%</span> of first submissions
          </p>
        </Card>

        {/* Issue Categories */}
        <Card>
          <CardHeader>
            <CardTitle>Common Rejection Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[450px] pr-4">
              <div className="space-y-3">
                {issueCategories.map((category) => (
                  <div key={category.name} className="border rounded-lg overflow-hidden">
                    <button
                      className="w-full p-4 flex items-center justify-between bg-secondary/30 hover:bg-secondary/50 transition-colors"
                      onClick={() => setExpandedCategory(expandedCategory === category.name ? null : category.name)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{category.icon}</span>
                        <div className="text-left">
                          <p className="font-medium">{category.name}</p>
                          <p className="text-sm text-muted-foreground">{category.issues.length} potential issues</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                          {category.issues.filter((i) => i.severity === "high").length > 0 && (
                            <Badge variant="destructive" className="text-xs">
                              {category.issues.filter((i) => i.severity === "high").length} critical
                            </Badge>
                          )}
                        </div>
                        <ChevronRight
                          className={cn("h-5 w-5 transition-transform", expandedCategory === category.name && "rotate-90")}
                        />
                      </div>
                    </button>

                    {expandedCategory === category.name && (
                      <div className="p-4 space-y-3 animate-fade-in">
                        {category.issues.map((issue) => (
                          <button
                            key={issue.id}
                            className={cn(
                              "w-full p-3 rounded-lg border text-left transition-all hover:shadow-md",
                              selectedIssue?.id === issue.id ? "border-accent bg-accent/5" : "hover:bg-secondary/30"
                            )}
                            onClick={() => setSelectedIssue(issue)}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  {issue.severity === "high" && <XCircle className="h-4 w-4 text-red-500" />}
                                  {issue.severity === "medium" && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                                  {issue.severity === "low" && <CheckCircle2 className="h-4 w-4 text-blue-500" />}
                                  <span className="font-medium">{issue.title}</span>
                                </div>
                                <p className="text-sm text-muted-foreground">{issue.description}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-lg font-bold">{issue.frequency}%</p>
                                <p className="text-xs text-muted-foreground">of rejections</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Right Panel - Score & Details */}
      <div className="space-y-4">
        {/* Rejection Probability Score */}
        <Card className="p-6 text-center">
          <h3 className="font-semibold mb-4">Approval Probability</h3>
          <div className="relative inline-flex items-center justify-center mb-4">
            <svg className="w-32 h-32 transform -rotate-90">
              <circle cx="64" cy="64" r="56" stroke="hsl(var(--border))" strokeWidth="12" fill="none" />
              <circle
                cx="64"
                cy="64"
                r="56"
                stroke="hsl(var(--accent))"
                strokeWidth="12"
                fill="none"
                strokeDasharray={`${(projectScore / 100) * 352} 352`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute">
              <span className="text-4xl font-bold">{projectScore}%</span>
            </div>
          </div>
          <Badge className={cn(riskLevel.bg, "text-white mb-4")}>{riskLevel.label}</Badge>

          <div className="mt-4">
            <p className="text-sm text-muted-foreground mb-2">Adjust score to simulate fixes</p>
            <Slider
              value={[projectScore]}
              onValueChange={([value]) => setProjectScore(value)}
              min={0}
              max={100}
              step={1}
              className="w-full"
            />
          </div>
        </Card>

        {/* Quick Stats */}
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Issues Found</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-500" />
                <span className="text-sm">Critical Issues</span>
              </div>
              <span className="font-bold text-red-500">{criticalCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="text-sm">Warnings</span>
              </div>
              <span className="font-bold text-amber-500">{warningCount}</span>
            </div>
            <div className="pt-3 border-t">
              <div className="flex items-center gap-2 text-accent">
                <TrendingDown className="h-4 w-4" />
                <span className="text-sm font-medium">Fix critical issues to improve score by ~25%</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Selected Issue Detail */}
        {selectedIssue && (
          <Card className="p-4 animate-fade-in">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold">{selectedIssue.title}</h3>
              <Badge
                variant={selectedIssue.severity === "high" ? "destructive" : selectedIssue.severity === "medium" ? "default" : "secondary"}
              >
                {selectedIssue.severity}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{selectedIssue.description}</p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Rejection frequency</span>
                <span className="font-medium">{selectedIssue.frequency}%</span>
              </div>
              <Progress value={selectedIssue.frequency} className="h-2" />
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              In {selectedJurisdiction.name}, this issue causes {selectedIssue.frequency}% of permit rejections
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
