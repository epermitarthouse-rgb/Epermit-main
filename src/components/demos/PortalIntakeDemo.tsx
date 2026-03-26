import { useState, useEffect } from "react";
import { Globe, ArrowRight, CheckCircle2, Loader2, Database, FileText, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import demoVideo from "@/assets/videos/demo-portal-intake.mp4";

const scrapeSteps = [
  { id: "login", label: "Portal Login", icon: Globe, detail: "Authenticating with jurisdiction portal" },
  { id: "scrape", label: "Scrape Data", icon: Database, detail: "Extracting permit records & review cycles" },
  { id: "extract", label: "Extract Comments", icon: MessageSquare, detail: "Parsing plan review comments & status" },
  { id: "sync", label: "Sync to Platform", icon: FileText, detail: "Saving structured data to your workspace" },
];

const sampleExtractedData = [
  { category: "Project Info", items: ["Permit #B2508799", "Status: Under Review", "Filed: 2025-11-14"] },
  { category: "Review Cycle", items: ["Cycle 2 of 3", "12 comments total", "4 disciplines flagged"] },
  { category: "Plan Review", items: ["Structural: 3 comments", "MEP: 5 comments", "Zoning: 2 comments", "Fire/Life Safety: 2 comments"] },
  { category: "Attachments", items: ["S-101 Structural Plans.pdf", "M-201 Mechanical Layout.pdf", "Review Report #2.pdf"] },
];

const supportedPortals = [
  { name: "Accela Citizen Access", count: 6, jurisdictions: "DC, Fairfax, Baltimore, Howard, Arlington, Anne Arundel" },
  { name: "Liferay / Momentum", count: 1, jurisdictions: "Prince George's County" },
  { name: "ASP.NET WebForms", count: 1, jurisdictions: "Montgomery County" },
  { name: "Tyler EnerGov", count: 2, jurisdictions: "Alexandria, Loudoun County" },
];

export function PortalIntakeDemo() {
  const [activeStep, setActiveStep] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [completed, setCompleted] = useState(false);

  const runSimulation = () => {
    setIsRunning(true);
    setCompleted(false);
    setActiveStep(0);
  };

  useEffect(() => {
    if (!isRunning || activeStep < 0) return;
    if (activeStep >= scrapeSteps.length) {
      setIsRunning(false);
      setCompleted(true);
      return;
    }
    const timer = setTimeout(() => setActiveStep((s) => s + 1), 1500);
    return () => clearTimeout(timer);
  }, [activeStep, isRunning]);

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="rounded-lg overflow-hidden border border-border/50">
            <video
              src={demoVideo}
              autoPlay
              loop
              muted
              playsInline
              className="w-full aspect-video object-cover"
            />
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Supported Portal Platforms</h4>
            <div className="grid grid-cols-2 gap-2">
              {supportedPortals.map((portal) => (
                <div key={portal.name} className="p-2 rounded-md border border-border/50 bg-muted/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">{portal.name}</span>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{portal.count}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">{portal.jurisdictions}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Intake Pipeline</h4>
            <Button
              size="sm"
              variant={completed ? "outline" : "default"}
              onClick={runSimulation}
              disabled={isRunning}
              data-testid="button-run-intake-simulation"
            >
              {isRunning ? (
                <><Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> Running...</>
              ) : completed ? (
                "Run Again"
              ) : (
                "Simulate Scrape"
              )}
            </Button>
          </div>

          <div className="space-y-2">
            {scrapeSteps.map((step, i) => {
              const isActive = activeStep === i;
              const isDone = activeStep > i;
              return (
                <div
                  key={step.id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-md border transition-all duration-300",
                    isActive && "border-accent bg-accent/5",
                    isDone && "border-green-500/30 bg-green-500/5",
                    !isActive && !isDone && "border-border/50 opacity-50"
                  )}
                >
                  <div className={cn(
                    "flex items-center justify-center h-8 w-8 rounded-full border-2 transition-colors",
                    isActive && "border-accent text-accent",
                    isDone && "border-green-500 bg-green-500 text-white",
                    !isActive && !isDone && "border-muted-foreground/30 text-muted-foreground/30"
                  )}>
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : isActive ? <Loader2 className="h-4 w-4 animate-spin" /> : <step.icon className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{step.label}</p>
                    <p className="text-xs text-muted-foreground">{step.detail}</p>
                  </div>
                  {i < scrapeSteps.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground/30 hidden sm:block" />
                  )}
                </div>
              );
            })}
          </div>

          {completed && (
            <Card className="border-green-500/30 bg-green-500/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-green-500">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="text-sm font-medium">Extraction Complete</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {sampleExtractedData.map((group) => (
                    <div key={group.category} className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">{group.category}</p>
                      {group.items.map((item, j) => (
                        <p key={j} className="text-xs">{item}</p>
                      ))}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
