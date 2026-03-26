import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { 
  DollarSign, Users, ArrowRight, Check, TrendingDown, Download,
  Calculator, Layers, Zap, Save
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface Tool {
  id: string;
  name: string;
  monthlyPricePerUser: number;
  category: string;
  logo?: string;
}

const availableTools: Tool[] = [
  { id: "bluebeam", name: "Bluebeam Revu", monthlyPricePerUser: 240, category: "Markup & Review" },
  { id: "procore", name: "Procore", monthlyPricePerUser: 375, category: "Project Management" },
  { id: "plangrid", name: "PlanGrid", monthlyPricePerUser: 39, category: "Field Management" },
  { id: "upcodes", name: "UpCodes", monthlyPricePerUser: 49, category: "Code Research" },
  { id: "newforma", name: "Newforma", monthlyPricePerUser: 150, category: "Info Management" },
  { id: "bim360", name: "BIM 360", monthlyPricePerUser: 545, category: "BIM Coordination" },
  { id: "egnyte", name: "Egnyte", monthlyPricePerUser: 20, category: "File Storage" },
  { id: "aconex", name: "Aconex", monthlyPricePerUser: 85, category: "Document Control" },
  { id: "submittal", name: "Submittal Exchange", monthlyPricePerUser: 35, category: "Submittals" },
  { id: "buildertrend", name: "Buildertrend", monthlyPricePerUser: 99, category: "Construction Mgmt" },
];

const insightPricing = {
  starter: { name: "Starter", pricePerUser: 99, minUsers: 1 },
  professional: { name: "Professional", pricePerUser: 249, minUsers: 5 },
  business: { name: "Business", pricePerUser: 449, minUsers: 10 },
};

const ConsolidationCalculator = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [teamSize, setTeamSize] = useState(10);
  const [customToolName, setCustomToolName] = useState("");
  const [customToolCost, setCustomToolCost] = useState(0);
  const [step, setStep] = useState(1);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const toggleTool = (toolId: string) => {
    setSelectedTools(prev =>
      prev.includes(toolId) ? prev.filter(t => t !== toolId) : [...prev, toolId]
    );
  };

  const handleSaveCalculation = async () => {
    if (!user) {
      navigate("/auth");
      return;
    }

    if (!saveName.trim()) {
      toast.error("Please enter a name for your calculation");
      return;
    }

    setIsSaving(true);
    
    const inputData = JSON.parse(JSON.stringify({
      selectedTools,
      teamSize,
      customToolName,
      customToolCost,
    }));
    
    const resultsData = JSON.parse(JSON.stringify({
      currentCost: calculations.currentAnnualCost,
      insightCost: calculations.insightAnnualCost,
      annualSavings: Math.round(calculations.annualSavings),
      savingsPercent: Math.round(calculations.savingsPercent),
      toolCount: calculations.toolCount,
      recommendedTier: calculations.recommendedTier.name,
    }));
    
    const { error } = await supabase.from("saved_calculations").insert([{
      user_id: user.id,
      name: saveName.trim(),
      calculation_type: "consolidation",
      input_data: inputData,
      results_data: resultsData,
    }]);

    setIsSaving(false);
    setSaveDialogOpen(false);

    if (error) {
      toast.error("Failed to save calculation");
      console.error(error);
    } else {
      toast.success("Calculation saved to your dashboard!");
      setSaveName("");
    }
  };

  const handleSaveClick = () => {
    if (!user) {
      toast.error("Please sign in to save calculations");
      navigate("/auth");
      return;
    }
    setSaveDialogOpen(true);
  };

  const calculations = useMemo(() => {
    // Current costs
    const selectedToolsData = availableTools.filter(t => selectedTools.includes(t.id));
    const currentMonthlyCost = selectedToolsData.reduce((sum, tool) => sum + (tool.monthlyPricePerUser * teamSize), 0) + customToolCost;
    const currentAnnualCost = currentMonthlyCost * 12;

    // Determine recommended tier
    let recommendedTier = insightPricing.starter;
    if (teamSize > 50) {
      recommendedTier = insightPricing.business;
    } else if (teamSize > 10) {
      recommendedTier = insightPricing.professional;
    }

    // Insight costs (assuming 30% of team uses the tool actively)
    const activeUsers = Math.max(recommendedTier.minUsers, Math.ceil(teamSize * 0.5));
    const insightMonthlyCost = recommendedTier.pricePerUser * activeUsers;
    const insightAnnualCost = insightMonthlyCost * 12;

    // Savings
    const monthlySavings = currentMonthlyCost - insightMonthlyCost;
    const annualSavings = currentAnnualCost - insightAnnualCost;
    const savingsPercent = currentAnnualCost > 0 ? (annualSavings / currentAnnualCost) * 100 : 0;

    // Per-tool comparison for chart
    const toolComparison = selectedToolsData.map(tool => ({
      name: tool.name,
      currentCost: tool.monthlyPricePerUser * teamSize * 12,
      category: tool.category,
    }));

    return {
      currentMonthlyCost,
      currentAnnualCost,
      insightMonthlyCost,
      insightAnnualCost,
      monthlySavings,
      annualSavings,
      savingsPercent,
      recommendedTier,
      activeUsers,
      toolComparison,
      toolCount: selectedTools.length,
    };
  }, [selectedTools, teamSize, customToolCost]);

  const chartData = [
    {
      name: "Current Tools",
      cost: calculations.currentAnnualCost,
      fill: "hsl(var(--muted-foreground))",
    },
    {
      name: "Insight|DesignCheck",
      cost: calculations.insightAnnualCost,
      fill: "hsl(168, 76%, 32%)",
    },
  ];

  return (
    <>
      {/* Header */}
      <div className="bg-primary text-primary-foreground py-12">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">Tool Consolidation Calculator</h1>
          <p className="text-primary-foreground/80 max-w-2xl mx-auto">
            See how much you can save by replacing multiple tools with one platform
          </p>
        </div>
      </div>

      <div className="w-full max-w-6xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-6 sm:py-8">
        <div className="grid lg:grid-cols-5 gap-8">
          {/* Left Side - Inputs */}
          <div className="lg:col-span-3 space-y-6">
            {/* Step 1: Select Tools */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-3">
                      <Layers className="h-6 w-6 text-accent" />
                      Step 1: Select Your Current Tools
                    </CardTitle>
                    <CardDescription>Choose all the tools you're currently paying for</CardDescription>
                  </div>
                  <Badge variant="secondary">{selectedTools.length} selected</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-3">
                  {availableTools.map(tool => (
                    <label
                      key={tool.id}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-all",
                        selectedTools.includes(tool.id)
                          ? "border-accent bg-accent/10 shadow-md"
                          : "hover:bg-secondary/50"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedTools.includes(tool.id)}
                          onCheckedChange={() => toggleTool(tool.id)}
                        />
                        <div>
                          <p className="font-medium">{tool.name}</p>
                          <p className="text-xs text-muted-foreground">{tool.category}</p>
                        </div>
                      </div>
                      <span className="text-sm font-medium">${tool.monthlyPricePerUser}/user/mo</span>
                    </label>
                  ))}
                </div>

                {/* Custom tool */}
                <div className="mt-4 pt-4 border-t">
                  <Label className="text-sm text-muted-foreground mb-2 block">Add other monthly software costs</Label>
                  <div className="flex gap-3">
                    <Input
                      placeholder="Tool name (optional)"
                      value={customToolName}
                      onChange={(e) => setCustomToolName(e.target.value)}
                      className="flex-1"
                    />
                    <div className="relative w-32">
                      <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        type="number"
                        placeholder="0"
                        value={customToolCost || ""}
                        onChange={(e) => setCustomToolCost(Number(e.target.value))}
                        className="pl-8"
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Step 2: Team Size */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Users className="h-6 w-6 text-accent" />
                  Step 2: Team Size
                </CardTitle>
                <CardDescription>How many people on your team use these tools?</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label>Team Members</Label>
                    <span className="text-2xl font-bold text-accent">{teamSize}</span>
                  </div>
                  <Slider
                    value={[teamSize]}
                    onValueChange={([value]) => setTeamSize(value)}
                    min={1}
                    max={200}
                    step={1}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>1</span>
                    <span>50</span>
                    <span>100</span>
                    <span>150</span>
                    <span>200+</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Comparison Chart */}
            {selectedTools.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Annual Cost Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`} />
                        <YAxis type="category" dataKey="name" width={140} />
                        <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
                        <Bar dataKey="cost" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Tool breakdown */}
                  {calculations.toolComparison.length > 0 && (
                    <div className="mt-6 pt-4 border-t">
                      <p className="text-sm font-medium mb-3">Current Tool Costs (Annual)</p>
                      <div className="space-y-2">
                        {calculations.toolComparison.map(tool => (
                          <div key={tool.name} className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{tool.name}</span>
                            <span className="font-medium">${tool.currentCost.toLocaleString()}</span>
                          </div>
                        ))}
                        {customToolCost > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{customToolName || "Other tools"}</span>
                            <span className="font-medium">${(customToolCost * 12).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Side - Results */}
          <div className="lg:col-span-2 space-y-6">
            {/* Results Summary */}
            <Card className={cn("sticky top-24 transition-all", selectedTools.length > 0 ? "border-accent border-2" : "")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Calculator className="h-6 w-6 text-accent" />
                  Your Savings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {selectedTools.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Layers className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>Select tools to see your potential savings</p>
                  </div>
                ) : (
                  <>
                    {/* Annual Savings */}
                    <div className="p-6 rounded-xl bg-accent/10 border border-accent/20 text-center">
                      <TrendingDown className="h-8 w-8 text-accent mx-auto mb-2" />
                      <p className="text-4xl font-bold text-accent">
                        {calculations.annualSavings > 0 ? (
                          `$${Math.round(calculations.annualSavings).toLocaleString()}`
                        ) : (
                          "—"
                        )}
                      </p>
                      <p className="text-muted-foreground">Annual Savings</p>
                      {calculations.savingsPercent > 0 && (
                        <Badge className="mt-2 bg-accent text-accent-foreground">
                          {calculations.savingsPercent.toFixed(0)}% less
                        </Badge>
                      )}
                    </div>

                    {/* Cost Comparison */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
                        <span className="text-muted-foreground">Current Annual Cost</span>
                        <span className="font-bold text-lg">${calculations.currentAnnualCost.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-accent/10 border border-accent/20">
                        <span className="text-muted-foreground">With Insight|DesignCheck</span>
                        <span className="font-bold text-lg text-accent">${calculations.insightAnnualCost.toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Recommended Plan */}
                    <div className="p-4 rounded-lg border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">Recommended Plan</span>
                        <Badge>{calculations.recommendedTier.name}</Badge>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold">${calculations.recommendedTier.pricePerUser}</span>
                        <span className="text-muted-foreground">/user/month</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {calculations.activeUsers} users × ${calculations.recommendedTier.pricePerUser} = ${calculations.insightMonthlyCost.toLocaleString()}/mo
                      </p>
                    </div>

                    {/* Benefits */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium">What you get with consolidation:</p>
                      <div className="space-y-2">
                        {[
                          "AI-powered code compliance checking",
                          "Pre-submittal issue detection",
                          "Permit application auto-fill",
                          "Jurisdiction requirement database",
                          "Document management & versioning",
                          "Inspection scheduling & tracking",
                        ].map((benefit, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <Check className="h-4 w-4 text-accent" />
                            <span>{benefit}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* CTAs */}
                    <div className="space-y-3 pt-4">
                      <Button className="w-full bg-accent hover:bg-accent/90" asChild>
                        <Link to="/roi-calculator">
                          Calculate Full ROI
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                      </Button>
                      <Button variant="outline" className="w-full" onClick={handleSaveClick}>
                        <Save className="mr-2 h-4 w-4" />
                        {user ? "Save to Dashboard" : "Sign In to Save"}
                      </Button>
                      <Button variant="outline" className="w-full">
                        <Download className="mr-2 h-4 w-4" />
                        Download Comparison
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Quick Stats */}
            {selectedTools.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-accent">{calculations.toolCount}</p>
                      <p className="text-xs text-muted-foreground">Tools Replaced</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-accent">1</p>
                      <p className="text-xs text-muted-foreground">Platform Needed</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Calculation</DialogTitle>
            <DialogDescription>
              Give your tool consolidation calculation a name to save it to your dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="saveName">Calculation Name</Label>
            <Input
              id="saveName"
              placeholder="e.g., 2026 Tool Stack Comparison"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveCalculation} disabled={isSaving || !saveName.trim()}>
              {isSaving ? "Saving..." : "Save Calculation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ConsolidationCalculator;
