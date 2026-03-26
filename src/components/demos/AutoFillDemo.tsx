import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Check, FileText, ArrowRight, Download, Edit } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExtractedField {
  label: string;
  value: string;
  source: string;
  confidence: number;
}

interface FieldCategory {
  name: string;
  icon: string;
  fields: ExtractedField[];
}

const extractedData: FieldCategory[] = [
  {
    name: "Project Basics",
    icon: "📋",
    fields: [
      { label: "Project Address", value: "1234 Main Street, Suite 500", source: "Title Block", confidence: 98 },
      { label: "Project Name", value: "Tech Campus Phase 2 - Building C", source: "Title Block", confidence: 99 },
      { label: "Owner Name", value: "Innovation Properties LLC", source: "Cover Sheet", confidence: 95 },
      { label: "Permit Type", value: "Commercial Tenant Improvement", source: "Inferred", confidence: 88 },
    ],
  },
  {
    name: "Building Metrics",
    icon: "📐",
    fields: [
      { label: "Gross Floor Area", value: "45,250 SF", source: "Area Calculations", confidence: 97 },
      { label: "Stories Above Grade", value: "4", source: "Building Section", confidence: 99 },
      { label: "Building Height", value: "62'-0\"", source: "Building Section", confidence: 96 },
      { label: "Construction Type", value: "Type I-B", source: "Code Summary", confidence: 94 },
      { label: "Sprinkler System", value: "NFPA 13 - Fully Sprinklered", source: "Fire Protection", confidence: 92 },
    ],
  },
  {
    name: "Occupancy Details",
    icon: "👥",
    fields: [
      { label: "Primary Use Group", value: "B - Business", source: "Code Summary", confidence: 97 },
      { label: "Secondary Use", value: "A-3 - Assembly (Cafeteria)", source: "Floor Plan", confidence: 91 },
      { label: "Total Occupant Load", value: "423 persons", source: "Calculated", confidence: 89 },
      { label: "Floor 1 Occupancy", value: "156 persons", source: "Calculated", confidence: 88 },
    ],
  },
  {
    name: "Scope of Work",
    icon: "🔨",
    fields: [
      { label: "Work Type", value: "Tenant Improvement", source: "Cover Sheet", confidence: 96 },
      { label: "TI Area", value: "12,500 SF", source: "Floor Plan", confidence: 94 },
      { label: "New Partitions", value: "Yes - 2,400 LF", source: "Partition Schedule", confidence: 90 },
      { label: "MEP Modifications", value: "HVAC, Electrical, Plumbing", source: "MEP Sheets", confidence: 87 },
    ],
  },
  {
    name: "Design Team",
    icon: "✏️",
    fields: [
      { label: "Architect of Record", value: "Smith & Associates Architects", source: "Title Block", confidence: 99 },
      { label: "Architect License #", value: "C-28745", source: "Title Block", confidence: 98 },
      { label: "Structural Engineer", value: "Concrete Engineering Inc.", source: "Structural Cover", confidence: 96 },
      { label: "MEP Engineer", value: "Systems Design Group", source: "MEP Cover", confidence: 95 },
    ],
  },
];

const simulationSteps = [
  "Uploading drawings...",
  "Analyzing title block...",
  "Scanning floor plans...",
  "Reading code summaries...",
  "Extracting occupancy data...",
  "Parsing MEP sheets...",
  "Mapping to permit form...",
  "Validation complete!",
];

export function AutoFillDemo() {
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionStep, setExtractionStep] = useState(0);
  const [extractionComplete, setExtractionComplete] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);

  const startExtraction = () => {
    setIsExtracting(true);
    setExtractionStep(0);
    setExtractionComplete(false);
  };

  useEffect(() => {
    if (isExtracting && extractionStep < simulationSteps.length) {
      const timer = setTimeout(() => {
        setExtractionStep((prev) => prev + 1);
      }, 600);
      return () => clearTimeout(timer);
    } else if (extractionStep >= simulationSteps.length) {
      setIsExtracting(false);
      setExtractionComplete(true);
    }
  }, [isExtracting, extractionStep]);

  const progress = (extractionStep / simulationSteps.length) * 100;
  const totalFields = extractedData.reduce((sum, cat) => sum + cat.fields.length, 0);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Left Side - Upload & Extraction */}
      <div className="space-y-4">
        {/* Upload Card */}
        <Card className="p-6">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent/10 flex items-center justify-center">
              <FileText className="h-8 w-8 text-accent" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Sample Drawing Set</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Tech Campus Phase 2 - 45 sheets (A, S, M, E, P)
            </p>

            {!isExtracting && !extractionComplete && (
              <Button onClick={startExtraction} className="bg-accent hover:bg-accent/90">
                Extract Permit Data
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </Card>

        {/* Extraction Progress */}
        {(isExtracting || extractionComplete) && (
          <Card className="p-6 animate-fade-in">
            <h3 className="font-semibold mb-4">Extraction Progress</h3>
            <Progress value={progress} className="h-3 mb-4" />

            <div className="space-y-2 mb-4">
              {simulationSteps.map((step, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex items-center gap-3 text-sm transition-all",
                    index < extractionStep ? "text-accent" : index === extractionStep ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {index < extractionStep ? (
                    <Check className="h-4 w-4" />
                  ) : index === extractionStep ? (
                    <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />
                  )}
                  {step}
                </div>
              ))}
            </div>

            {extractionComplete && (
              <div className="p-4 rounded-lg bg-accent/10 border border-accent/20 text-center">
                <Check className="h-8 w-8 text-accent mx-auto mb-2" />
                <p className="font-semibold text-accent">Extraction Complete!</p>
                <p className="text-sm text-muted-foreground">{totalFields} fields extracted</p>
              </div>
            )}
          </Card>
        )}

        {/* Form Preview */}
        {extractionComplete && (
          <Card className="p-6 animate-fade-in">
            <h3 className="font-semibold mb-4">Permit Application Preview</h3>
            <div className="p-4 bg-secondary/30 rounded-lg border-2 border-dashed border-border text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">Jurisdiction Permit Application</p>
              <p className="text-xs text-muted-foreground mb-2">Compatible with: Washington DC, NYC, Chicago, LA, SF, Miami, Boston, Seattle, and more</p>
              <p className="text-xs text-muted-foreground mb-4">Form auto-filled with extracted data</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </Button>
                <Button size="sm" className="bg-accent hover:bg-accent/90">
                  <Edit className="h-4 w-4 mr-2" />
                  Review & Edit
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Right Side - Extracted Data */}
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Extracted Data</CardTitle>
          </CardHeader>
          <CardContent>
            {!extractionComplete ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>Start extraction to see data</p>
              </div>
            ) : (
              <div className="space-y-3">
                {extractedData.map((category) => (
                  <div key={category.name} className="border rounded-lg overflow-hidden">
                    <button
                      className="w-full p-3 flex items-center justify-between bg-secondary/30 hover:bg-secondary/50 transition-colors"
                      onClick={() => setSelectedCategory(selectedCategory === category.name ? null : category.name)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{category.icon}</span>
                        <span className="font-medium">{category.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{category.fields.length} fields</span>
                    </button>

                    {selectedCategory === category.name && (
                      <div className="p-3 space-y-2 animate-fade-in">
                        {category.fields.map((field) => (
                          <div
                            key={field.label}
                            className="p-3 rounded bg-background border flex items-start justify-between gap-4"
                          >
                            <div className="flex-1">
                              <p className="text-xs text-muted-foreground">{field.label}</p>
                              <p className="font-medium">{field.value}</p>
                              <p className="text-xs text-muted-foreground">Source: {field.source}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <div
                                className={cn(
                                  "text-sm font-medium",
                                  field.confidence >= 95 ? "text-green-500" : field.confidence >= 85 ? "text-amber-500" : "text-red-500"
                                )}
                              >
                                {field.confidence}%
                              </div>
                              <p className="text-xs text-muted-foreground">confidence</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats */}
        {extractionComplete && (
          <Card className="p-4 animate-fade-in">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-accent">{totalFields}</p>
                <p className="text-xs text-muted-foreground">Fields Extracted</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-accent">94%</p>
                <p className="text-xs text-muted-foreground">Avg Confidence</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-accent">2 min</p>
                <p className="text-xs text-muted-foreground">vs 2 hours manual</p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
