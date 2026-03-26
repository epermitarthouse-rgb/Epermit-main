import { useState } from "react";
import { Table2, Bot, CheckCircle2, AlertTriangle, Star, FileDown, Pen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import demoVideo from "@/assets/videos/demo-response-matrix.mp4";

const sampleComments = [
  {
    id: 1,
    discipline: "Structural",
    comment: "Provide structural calculations for the cantilevered balcony per IBC 1604.4.",
    status: "drafted",
    confidence: 94,
    response: "Structural calculations for the cantilevered balcony have been prepared per IBC 1604.4 and are included in the revised S-201 sheet. See attached calc package referencing ASCE 7-22 load combinations.",
    quality: 4.5,
  },
  {
    id: 2,
    discipline: "MEP",
    comment: "HVAC ductwork routing conflicts with structural beam at grid line C-4. Resolve coordination issue.",
    status: "drafted",
    confidence: 87,
    response: "The HVAC ductwork at grid C-4 has been rerouted below the structural beam with 2\" clearance. Revised routing shown on M-301. No impact to design airflow capacity.",
    quality: 4.2,
  },
  {
    id: 3,
    discipline: "Fire/Life Safety",
    comment: "Exit corridor width at Level 2 does not meet minimum 44\" requirement per IBC 1005.1.",
    status: "pending",
    confidence: 0,
    response: "",
    quality: 0,
  },
  {
    id: 4,
    discipline: "Zoning",
    comment: "Verify rear yard setback complies with R-3 zone requirement of 25 feet minimum.",
    status: "drafted",
    confidence: 91,
    response: "The rear yard setback has been verified at 27'-6\" from the property line, exceeding the R-3 zone minimum of 25'. See updated site plan A-001 with dimensioned setbacks.",
    quality: 4.8,
  },
];

const workflowSteps = [
  { label: "Parse Comments", desc: "AI extracts comments from portal" },
  { label: "Classify Discipline", desc: "Auto-categorize by trade" },
  { label: "Auto-Draft Response", desc: "AI generates code-backed replies" },
  { label: "Quality Check", desc: "Guardian agent scores responses" },
  { label: "Plan Markup", desc: "Link responses to drawing sheets" },
  { label: "Export Package", desc: "Branded PDF with company seal" },
];

const disciplineColors: Record<string, string> = {
  "Structural": "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "MEP": "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  "Fire/Life Safety": "bg-red-500/10 text-red-400 border-red-500/30",
  "Zoning": "bg-purple-500/10 text-purple-400 border-purple-500/30",
};

export function ResponseMatrixDemo() {
  const [selectedComment, setSelectedComment] = useState<number>(1);
  const selected = sampleComments.find((c) => c.id === selectedComment);

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
            <h4 className="text-sm font-medium mb-2">Response Workflow</h4>
            <div className="grid grid-cols-3 gap-1.5">
              {workflowSteps.map((step, i) => (
                <div key={step.label} className="p-2 rounded border border-border/50 bg-muted/20">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-accent font-mono text-[10px]">{i + 1}</span>
                    <p className="text-[11px] font-medium truncate">{step.label}</p>
                  </div>
                  <p className="text-[9px] text-muted-foreground leading-tight">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Review Comments ({sampleComments.length})</h4>
            <div className="flex gap-1.5">
              <Badge variant="secondary" className="text-[10px]">
                {sampleComments.filter((c) => c.status === "drafted").length} Drafted
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {sampleComments.filter((c) => c.status === "pending").length} Pending
              </Badge>
            </div>
          </div>

          <div className="space-y-2">
            {sampleComments.map((comment) => (
              <button
                key={comment.id}
                onClick={() => setSelectedComment(comment.id)}
                className={cn(
                  "w-full text-left p-3 rounded-md border transition-all",
                  selectedComment === comment.id
                    ? "border-accent bg-accent/5"
                    : "border-border/50 hover:border-border"
                )}
                aria-pressed={selectedComment === comment.id}
                data-testid={`button-comment-${comment.id}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 border", disciplineColors[comment.discipline])}>
                    {comment.discipline}
                  </Badge>
                  {comment.status === "drafted" ? (
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                      <span className="text-[10px] text-green-500">{comment.confidence}%</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      <span className="text-[10px] text-amber-500">Needs draft</span>
                    </div>
                  )}
                </div>
                <p className="text-xs line-clamp-2">{comment.comment}</p>
              </button>
            ))}
          </div>

          {selected && selected.status === "drafted" && (
            <Card className="border-green-500/20 bg-green-500/5">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-accent" />
                    <span className="text-xs font-medium">AI-Drafted Response</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={cn(
                          "h-3 w-3",
                          i < Math.floor(selected.quality)
                            ? "fill-amber-500 text-amber-500"
                            : i < selected.quality
                              ? "fill-amber-500/50 text-amber-500"
                              : "text-muted-foreground/30"
                        )}
                      />
                    ))}
                    <span className="text-[10px] text-muted-foreground ml-1">{selected.quality}</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{selected.response}</p>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2">
                    <Pen className="h-2.5 w-2.5 mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[10px] px-2">
                    <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> Accept
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {selected && selected.status === "pending" && (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-medium text-amber-500">Response Pending</span>
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  This comment needs a response. Click Auto-Draft to generate an AI response with code references.
                </p>
                <Button size="sm" className="h-7 text-xs" data-testid="button-auto-draft">
                  <Bot className="h-3 w-3 mr-1.5" /> Auto-Draft Response
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" data-testid="button-export-package">
              <FileDown className="h-3.5 w-3.5 mr-1.5" /> Export Response Package
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
