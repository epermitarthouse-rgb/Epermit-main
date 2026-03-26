import { useState } from "react";
import { Rocket, Building2, Shield, FileSearch, Brain, Send, Eye, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import demoVideo from "@/assets/videos/demo-multi-filing.mp4";

const municipalities = [
  { key: "dc_dob", name: "DC DOB", state: "DC", platform: "Accela", color: "bg-blue-500" },
  { key: "fairfax", name: "Fairfax County", state: "VA", platform: "Accela", color: "bg-blue-500" },
  { key: "baltimore", name: "Baltimore City", state: "MD", platform: "Accela", color: "bg-blue-500" },
  { key: "howard", name: "Howard County", state: "MD", platform: "Accela", color: "bg-blue-500" },
  { key: "arlington", name: "Arlington County", state: "VA", platform: "Accela", color: "bg-blue-500" },
  { key: "anne_arundel", name: "Anne Arundel County", state: "MD", platform: "Accela", color: "bg-blue-500" },
  { key: "pg_county", name: "Prince George's County", state: "MD", platform: "Momentum", color: "bg-emerald-500" },
  { key: "montgomery", name: "Montgomery County", state: "MD", platform: "ASP.NET", color: "bg-purple-500" },
  { key: "alexandria", name: "City of Alexandria", state: "VA", platform: "EnerGov", color: "bg-amber-500" },
  { key: "loudoun", name: "Loudoun County", state: "VA", platform: "EnerGov", color: "bg-amber-500" },
];

const agentPipeline = [
  { layer: "Pre-Flight", agents: [
    { num: "01", name: "Property Intelligence", icon: Building2, desc: "Zoning, historic, flood data" },
    { num: "02", name: "License Validation", icon: Shield, desc: "Professional license checks" },
    { num: "03", name: "Document Preparation", icon: FileSearch, desc: "Format & naming validation" },
    { num: "04", name: "Permit Classifier", icon: Brain, desc: "Type, track & fee prediction" },
  ]},
  { layer: "Human Gate", agents: [
    { num: "05", name: "Filing Review", icon: Eye, desc: "Mandatory approve/reject" },
  ]},
  { layer: "Execution", agents: [
    { num: "06", name: "Portal Auth", icon: Shield, desc: "Login & session management" },
    { num: "07", name: "Form Filer", icon: FileSearch, desc: "Navigate wizard & upload docs" },
    { num: "08", name: "Submit", icon: Send, desc: "Validate & confirm submission" },
  ]},
  { layer: "Post-Submit", agents: [
    { num: "09", name: "Status Monitor", icon: Eye, desc: "Track permit progress" },
  ]},
];

const platformColors: Record<string, string> = {
  "Accela": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "Momentum": "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  "ASP.NET": "bg-purple-500/10 text-purple-400 border-purple-500/30",
  "EnerGov": "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

export function MultiMunicipalityFilingDemo() {
  const [selectedMunicipality, setSelectedMunicipality] = useState<string | null>(null);
  const selected = municipalities.find((m) => m.key === selectedMunicipality);

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

          <div>
            <h4 className="text-sm font-medium mb-2">9-Agent Pipeline</h4>
            <div className="space-y-3">
              {agentPipeline.map((layer) => (
                <div key={layer.layer}>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{layer.layer}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {layer.agents.map((agent) => (
                      <div
                        key={agent.num}
                        className="flex items-center gap-1.5 px-2 py-1 rounded border border-border/50 bg-muted/20 text-xs"
                      >
                        <span className="text-accent font-mono text-[10px]">#{agent.num}</span>
                        <agent.icon className="h-3 w-3 text-muted-foreground" />
                        <span>{agent.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-medium">10 Supported DMV Jurisdictions</h4>
          <p className="text-xs text-muted-foreground">Click a jurisdiction to see details</p>

          <div className="grid grid-cols-2 gap-2">
            {municipalities.map((m) => (
              <button
                key={m.key}
                onClick={() => setSelectedMunicipality(m.key === selectedMunicipality ? null : m.key)}
                className={cn(
                  "flex items-center gap-2 p-2.5 rounded-md border text-left transition-all",
                  selectedMunicipality === m.key
                    ? "border-accent bg-accent/5"
                    : "border-border/50 hover:border-border"
                )}
                aria-pressed={selectedMunicipality === m.key}
                data-testid={`button-municipality-${m.key}`}
              >
                <div className={cn("h-2 w-2 rounded-full", m.color)} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{m.name}</p>
                  <p className="text-[10px] text-muted-foreground">{m.state}</p>
                </div>
                <Badge variant="outline" className={cn("text-[9px] px-1 py-0 border", platformColors[m.platform])}>
                  {m.platform}
                </Badge>
              </button>
            ))}
          </div>

          {selected && (
            <div className="p-3 rounded-md border border-accent/30 bg-accent/5 space-y-2">
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-accent" />
                <span className="text-sm font-medium">{selected.name}</span>
                <Badge variant="outline" className={cn("text-[10px] border", platformColors[selected.platform])}>
                  {selected.platform}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Autonomous filing through the {selected.platform} portal platform. The 9-agent pipeline handles property lookup, license validation, document prep, form filling, and submission monitoring — all jurisdiction-aware for {selected.name}.
              </p>
              <div className="flex items-center gap-1 text-xs text-accent">
                <span>View in Permit Filing</span>
                <ChevronRight className="h-3 w-3" />
              </div>
            </div>
          )}

          <div className="p-3 rounded-md border border-border/50 bg-muted/10">
            <h5 className="text-xs font-medium mb-2">Portal Platform Coverage</h5>
            <div className="grid grid-cols-2 gap-2">
              <div className="text-center p-2 rounded bg-blue-500/5 border border-blue-500/20">
                <p className="text-lg font-bold text-blue-400">6</p>
                <p className="text-[10px] text-muted-foreground">Accela</p>
              </div>
              <div className="text-center p-2 rounded bg-emerald-500/5 border border-emerald-500/20">
                <p className="text-lg font-bold text-emerald-400">1</p>
                <p className="text-[10px] text-muted-foreground">Momentum</p>
              </div>
              <div className="text-center p-2 rounded bg-purple-500/5 border border-purple-500/20">
                <p className="text-lg font-bold text-purple-400">1</p>
                <p className="text-[10px] text-muted-foreground">ASP.NET</p>
              </div>
              <div className="text-center p-2 rounded bg-amber-500/5 border border-amber-500/20">
                <p className="text-lg font-bold text-amber-400">2</p>
                <p className="text-[10px] text-muted-foreground">EnerGov</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
