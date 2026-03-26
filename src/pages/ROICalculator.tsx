import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLeadCapture } from "@/contexts/LeadCaptureContext";
import { useAuth } from "@/hooks/useAuth";
import { useGettingStarted } from "@/hooks/useGettingStarted";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { 
  Building2, Users, FileText, ChevronRight, ChevronLeft, Check, 
  Clock, DollarSign, TrendingUp, Download, Share2, Calendar,
  ArrowRight, Zap, Shield, AlertTriangle, Save, LogIn, Search
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

// Types
interface CompanyProfile {
  orgType: string;
  companySize: string;
  permitsPerYear: number;
  avgProjectValue: number;
  primaryJurisdictions: string[];
}

interface CurrentTools {
  tools: string[];
  customTools: string;
  monthlySpend: number;
}

interface PainPoints {
  permitTime: number;
  rejectionRate: number;
  complianceTime: number;
  applicationTime: number;
  jurisdictionResearch: number;
  inspectionCoordination: number;
  documentControl: number;
  projectDelays: number;
}

interface LeadInfo {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  role: string;
}

// Data
const orgTypes = ["Architecture Firm", "Engineering Firm", "General Contractor", "Permit Expeditor", "Developer", "Other"];
const companySizes = ["1-10 employees", "11-50 employees", "51-200 employees", "201-500 employees", "500+ employees"];
const jurisdictionOptions = [
  // Alabama
  "Birmingham, AL", "Montgomery, AL", "Huntsville, AL", "Mobile, AL",
  // Alaska
  "Anchorage, AK", "Fairbanks, AK", "Juneau, AK",
  // Arizona
  "Phoenix, AZ", "Tucson, AZ", "Mesa, AZ", "Scottsdale, AZ", "Chandler, AZ", "Gilbert, AZ", "Tempe, AZ",
  // Arkansas
  "Little Rock, AR", "Fort Smith, AR", "Fayetteville, AR",
  // California
  "Los Angeles, CA", "San Diego, CA", "San Jose, CA", "San Francisco, CA", "Fresno, CA", "Sacramento, CA", 
  "Long Beach, CA", "Oakland, CA", "Bakersfield, CA", "Anaheim, CA", "Santa Ana, CA", "Riverside, CA",
  "Stockton, CA", "Irvine, CA", "Chula Vista, CA", "Fremont, CA", "San Bernardino, CA", "Modesto, CA",
  "Fontana, CA", "Moreno Valley, CA", "Glendale, CA", "Huntington Beach, CA", "Santa Clarita, CA",
  "Garden Grove, CA", "Oceanside, CA", "Rancho Cucamonga, CA", "Ontario, CA", "Santa Rosa, CA",
  "Elk Grove, CA", "Oxnard, CA", "Hayward, CA", "Corona, CA", "Pomona, CA", "Escondido, CA",
  "Sunnyvale, CA", "Pasadena, CA", "Torrance, CA", "Roseville, CA", "Fullerton, CA", "Visalia, CA",
  // Colorado
  "Denver, CO", "Colorado Springs, CO", "Aurora, CO", "Fort Collins, CO", "Lakewood, CO", "Boulder, CO",
  // Connecticut
  "Bridgeport, CT", "New Haven, CT", "Stamford, CT", "Hartford, CT", "Waterbury, CT",
  // Delaware
  "Wilmington, DE", "Dover, DE", "Newark, DE",
  // District of Columbia
  "Washington, DC",
  // Florida
  "Jacksonville, FL", "Miami, FL", "Tampa, FL", "Orlando, FL", "St. Petersburg, FL", "Hialeah, FL",
  "Port St. Lucie, FL", "Cape Coral, FL", "Tallahassee, FL", "Fort Lauderdale, FL", "Pembroke Pines, FL",
  "Hollywood, FL", "Gainesville, FL", "Miramar, FL", "Coral Springs, FL", "Palm Bay, FL", "West Palm Beach, FL",
  "Clearwater, FL", "Lakeland, FL", "Pompano Beach, FL", "Miami Gardens, FL", "Davie, FL", "Boca Raton, FL",
  // Georgia
  "Atlanta, GA", "Augusta, GA", "Columbus, GA", "Macon, GA", "Savannah, GA", "Athens, GA", "Sandy Springs, GA",
  // Hawaii
  "Honolulu, HI", "Pearl City, HI", "Hilo, HI",
  // Idaho
  "Boise, ID", "Meridian, ID", "Nampa, ID", "Idaho Falls, ID",
  // Illinois
  "Chicago, IL", "Aurora, IL", "Naperville, IL", "Joliet, IL", "Rockford, IL", "Springfield, IL", "Elgin, IL", "Peoria, IL",
  // Indiana
  "Indianapolis, IN", "Fort Wayne, IN", "Evansville, IN", "South Bend, IN", "Carmel, IN", "Fishers, IN",
  // Iowa
  "Des Moines, IA", "Cedar Rapids, IA", "Davenport, IA", "Sioux City, IA",
  // Kansas
  "Wichita, KS", "Overland Park, KS", "Kansas City, KS", "Olathe, KS", "Topeka, KS",
  // Kentucky
  "Louisville, KY", "Lexington, KY", "Bowling Green, KY", "Owensboro, KY",
  // Louisiana
  "New Orleans, LA", "Baton Rouge, LA", "Shreveport, LA", "Lafayette, LA", "Lake Charles, LA",
  // Maine
  "Portland, ME", "Lewiston, ME", "Bangor, ME",
  // Maryland
  "Baltimore, MD", "Frederick, MD", "Rockville, MD", "Gaithersburg, MD", "Bowie, MD",
  // Massachusetts
  "Boston, MA", "Worcester, MA", "Springfield, MA", "Cambridge, MA", "Lowell, MA", "Brockton, MA", "Quincy, MA",
  // Michigan
  "Detroit, MI", "Grand Rapids, MI", "Warren, MI", "Sterling Heights, MI", "Ann Arbor, MI", "Lansing, MI", "Flint, MI",
  // Minnesota
  "Minneapolis, MN", "St. Paul, MN", "Rochester, MN", "Bloomington, MN", "Duluth, MN",
  // Mississippi
  "Jackson, MS", "Gulfport, MS", "Southaven, MS", "Biloxi, MS",
  // Missouri
  "Kansas City, MO", "St. Louis, MO", "Springfield, MO", "Columbia, MO", "Independence, MO",
  // Montana
  "Billings, MT", "Missoula, MT", "Great Falls, MT", "Bozeman, MT",
  // Nebraska
  "Omaha, NE", "Lincoln, NE", "Bellevue, NE", "Grand Island, NE",
  // Nevada
  "Las Vegas, NV", "Henderson, NV", "Reno, NV", "North Las Vegas, NV", "Sparks, NV",
  // New Hampshire
  "Manchester, NH", "Nashua, NH", "Concord, NH",
  // New Jersey
  "Newark, NJ", "Jersey City, NJ", "Paterson, NJ", "Elizabeth, NJ", "Trenton, NJ", "Camden, NJ", "Clifton, NJ",
  // New Mexico
  "Albuquerque, NM", "Las Cruces, NM", "Rio Rancho, NM", "Santa Fe, NM",
  // New York
  "New York, NY", "Buffalo, NY", "Rochester, NY", "Yonkers, NY", "Syracuse, NY", "Albany, NY", "New Rochelle, NY",
  // North Carolina
  "Charlotte, NC", "Raleigh, NC", "Greensboro, NC", "Durham, NC", "Winston-Salem, NC", "Fayetteville, NC", 
  "Cary, NC", "Wilmington, NC", "High Point, NC", "Asheville, NC",
  // North Dakota
  "Fargo, ND", "Bismarck, ND", "Grand Forks, ND",
  // Ohio
  "Columbus, OH", "Cleveland, OH", "Cincinnati, OH", "Toledo, OH", "Akron, OH", "Dayton, OH", "Parma, OH",
  // Oklahoma
  "Oklahoma City, OK", "Tulsa, OK", "Norman, OK", "Broken Arrow, OK", "Edmond, OK",
  // Oregon
  "Portland, OR", "Salem, OR", "Eugene, OR", "Gresham, OR", "Hillsboro, OR", "Beaverton, OR",
  // Pennsylvania
  "Philadelphia, PA", "Pittsburgh, PA", "Allentown, PA", "Reading, PA", "Erie, PA", "Scranton, PA",
  // Rhode Island
  "Providence, RI", "Warwick, RI", "Cranston, RI",
  // South Carolina
  "Charleston, SC", "Columbia, SC", "North Charleston, SC", "Mount Pleasant, SC", "Greenville, SC",
  // South Dakota
  "Sioux Falls, SD", "Rapid City, SD", "Aberdeen, SD",
  // Tennessee
  "Nashville, TN", "Memphis, TN", "Knoxville, TN", "Chattanooga, TN", "Clarksville, TN", "Murfreesboro, TN",
  // Texas
  "Houston, TX", "San Antonio, TX", "Dallas, TX", "Austin, TX", "Fort Worth, TX", "El Paso, TX", "Arlington, TX",
  "Corpus Christi, TX", "Plano, TX", "Laredo, TX", "Lubbock, TX", "Garland, TX", "Irving, TX", "Frisco, TX",
  "Amarillo, TX", "Grand Prairie, TX", "McKinney, TX", "Brownsville, TX", "Killeen, TX", "Pasadena, TX",
  "Mesquite, TX", "McAllen, TX", "Midland, TX", "Denton, TX", "Waco, TX", "Carrollton, TX", "Round Rock, TX",
  // Utah
  "Salt Lake City, UT", "West Valley City, UT", "Provo, UT", "West Jordan, UT", "Orem, UT", "Sandy, UT", "Ogden, UT",
  // Vermont
  "Burlington, VT", "South Burlington, VT", "Rutland, VT",
  // Virginia
  "Virginia Beach, VA", "Norfolk, VA", "Chesapeake, VA", "Richmond, VA", "Newport News, VA", "Alexandria, VA",
  "Hampton, VA", "Roanoke, VA", "Portsmouth, VA", "Suffolk, VA", "Lynchburg, VA",
  // Washington
  "Seattle, WA", "Spokane, WA", "Tacoma, WA", "Vancouver, WA", "Bellevue, WA", "Kent, WA", "Everett, WA",
  "Renton, WA", "Federal Way, WA", "Spokane Valley, WA", "Kirkland, WA",
  // West Virginia
  "Charleston, WV", "Huntington, WV", "Morgantown, WV",
  // Wisconsin
  "Milwaukee, WI", "Madison, WI", "Green Bay, WI", "Kenosha, WI", "Racine, WI", "Appleton, WI",
  // Wyoming
  "Cheyenne, WY", "Casper, WY", "Laramie, WY"
];

const toolOptions = [
  { id: "bluebeam", name: "Bluebeam Revu", monthlyPrice: 240 },
  { id: "procore", name: "Procore", monthlyPrice: 375 },
  { id: "plangrid", name: "PlanGrid", monthlyPrice: 39 },
  { id: "upcodes", name: "UpCodes", monthlyPrice: 49 },
  { id: "newforma", name: "Newforma", monthlyPrice: 150 },
  { id: "bim360", name: "BIM 360", monthlyPrice: 545 },
  { id: "egnyte", name: "Egnyte", monthlyPrice: 20 },
  { id: "manual", name: "Manual/Spreadsheets", monthlyPrice: 0 },
];

const roleOptions = ["Architect", "Engineer", "Project Manager", "Permit Expeditor", "Owner/Principal", "Operations", "Other"];

const ROICalculator = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [jurisdictionSearch, setJurisdictionSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>({
    orgType: "",
    companySize: "",
    permitsPerYear: 25,
    avgProjectValue: 500000,
    primaryJurisdictions: [],
  });
  const [currentTools, setCurrentTools] = useState<CurrentTools>({
    tools: [],
    customTools: "",
    monthlySpend: 0,
  });
  const [painPoints, setPainPoints] = useState<PainPoints>({
    permitTime: 5,
    rejectionRate: 5,
    complianceTime: 5,
    applicationTime: 5,
    jurisdictionResearch: 5,
    inspectionCoordination: 5,
    documentControl: 5,
    projectDelays: 5,
  });
  const [leadInfo, setLeadInfo] = useState<LeadInfo>({
    email: "",
    firstName: "",
    lastName: "",
    company: "",
    phone: "",
    role: "",
  });
  const { captureLead } = useLeadCapture();
  const { completeItem } = useGettingStarted();

  const totalSteps = 6;
  const progress = (step / totalSteps) * 100;

  // Calculate results
  const calculateResults = () => {
    const avgPainScore = Object.values(painPoints).reduce((a, b) => a + b, 0) / 8;
    const currentToolsCost = currentTools.tools.reduce((sum, toolId) => {
      const tool = toolOptions.find(t => t.id === toolId);
      return sum + (tool?.monthlyPrice || 0);
    }, 0) + currentTools.monthlySpend;

    // Time savings calculations
    const hoursPerPermit = 40; // Average hours spent per permit
    const timeSavingsPercent = Math.min(45, avgPainScore * 4.5);
    const hoursSavedPerPermit = hoursPerPermit * (timeSavingsPercent / 100);
    const totalHoursSaved = hoursSavedPerPermit * companyProfile.permitsPerYear;
    const hourlyRate = 85; // Average blended rate
    const timeSavingsValue = totalHoursSaved * hourlyRate;

    // Delay cost savings
    const avgDelayWeeks = painPoints.projectDelays * 0.4;
    const delayCostPerWeek = companyProfile.avgProjectValue * 0.002; // 0.2% of project value per week
    const delaysSavedPercent = Math.min(60, avgPainScore * 6);
    const delayCostSavings = avgDelayWeeks * delayCostPerWeek * (delaysSavedPercent / 100) * companyProfile.permitsPerYear;

    // Rejection reduction savings
    const rejectionReductionPercent = Math.min(80, painPoints.rejectionRate * 8);
    const costPerRejection = 2500; // Average cost of a rejection
    const currentRejections = companyProfile.permitsPerYear * (painPoints.rejectionRate / 10) * 0.4;
    const rejectionsSaved = currentRejections * (rejectionReductionPercent / 100);
    const rejectionSavings = rejectionsSaved * costPerRejection;

    // Tool consolidation savings
    const recommendedTier = companyProfile.companySize.includes("1-10") ? 99 :
                           companyProfile.companySize.includes("11-50") ? 249 :
                           companyProfile.companySize.includes("51-200") ? 449 : 449;
    const teamSize = companyProfile.companySize.includes("1-10") ? 5 :
                     companyProfile.companySize.includes("11-50") ? 25 :
                     companyProfile.companySize.includes("51-200") ? 100 : 200;
    const insightCost = recommendedTier * Math.ceil(teamSize * 0.3); // 30% of team uses it
    const toolSavings = Math.max(0, (currentToolsCost * 12) - (insightCost * 12));

    const totalAnnualSavings = timeSavingsValue + delayCostSavings + rejectionSavings + toolSavings;
    const roi = ((totalAnnualSavings - (insightCost * 12)) / (insightCost * 12)) * 100;
    const paybackMonths = (insightCost * 12) / (totalAnnualSavings / 12);

    return {
      timeSavingsPercent,
      hoursSavedPerPermit,
      totalHoursSaved,
      timeSavingsValue,
      rejectionReductionPercent,
      rejectionsSaved,
      rejectionSavings,
      delayCostSavings,
      toolSavings,
      totalAnnualSavings,
      roi,
      paybackMonths,
      recommendedTier,
      insightCost,
      currentToolsCost,
    };
  };

  const results = calculateResults();

  const handleNext = () => {
    if (step === 3) {
      completeItem('try_roi_calculator');
    }
    if (step < totalSteps) setStep(step + 1);
  };

  const handlePrev = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleLeadSubmit = () => {
    captureLead({
      email: leadInfo.email,
      firstName: leadInfo.firstName,
      lastName: leadInfo.lastName,
      company: leadInfo.company,
      phone: leadInfo.phone,
      role: leadInfo.role,
      source: "roi-calculator",
    });
    setStep(6);
  };

  const toggleTool = (toolId: string) => {
    setCurrentTools(prev => ({
      ...prev,
      tools: prev.tools.includes(toolId)
        ? prev.tools.filter(t => t !== toolId)
        : [...prev.tools, toolId],
    }));
  };

  const toggleJurisdiction = (jurisdiction: string) => {
    setCompanyProfile(prev => ({
      ...prev,
      primaryJurisdictions: prev.primaryJurisdictions.includes(jurisdiction)
        ? prev.primaryJurisdictions.filter(j => j !== jurisdiction)
        : [...prev.primaryJurisdictions, jurisdiction],
    }));
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
      companyProfile,
      currentTools,
      painPoints,
      leadInfo,
    }));
    
    const resultsData = JSON.parse(JSON.stringify({
      annualSavings: Math.round(results.totalAnnualSavings),
      roi: Math.round(results.roi),
      paybackMonths: results.paybackMonths,
      hoursSaved: Math.round(results.totalHoursSaved),
      timeSavingsValue: Math.round(results.timeSavingsValue),
      rejectionSavings: Math.round(results.rejectionSavings),
      delayCostSavings: Math.round(results.delayCostSavings),
      toolSavings: Math.round(results.toolSavings),
    }));
    
    const { error } = await supabase.from("saved_calculations").insert([{
      user_id: user.id,
      name: saveName.trim(),
      calculation_type: "roi",
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

  return (
    <div className="w-full overflow-x-hidden">
      {/* Header */}
      <div className="bg-primary text-primary-foreground py-8 sm:py-12">
        <div className="w-full max-w-4xl mx-auto px-3 sm:px-4 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">ROI Calculator</h1>
          <p className="text-primary-foreground/80 max-w-2xl mx-auto">
            Calculate your potential savings with AI-powered permit acceleration
          </p>
        </div>
      </div>

      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 md:py-8">
        {/* Progress */}
        <div className="mb-8 max-w-2xl mx-auto">
          <div className="flex justify-between text-sm text-muted-foreground mb-2">
            <span>Step {step} of {totalSteps}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-2" />
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 mt-2">
            {["Profile", "Tools", "Pain Points", "Preview", "Contact", "Results"].map((label, i) => (
              <span
                key={label}
                className={cn(
                  "text-xs shrink-0",
                  step > i + 1 ? "text-accent" : step === i + 1 ? "text-foreground font-medium" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* Step 1: Company Profile */}
        {step === 1 && (
          <Card className="animate-fade-in max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Building2 className="h-6 w-6 text-accent shrink-0" />
                Company Profile
              </CardTitle>
              <CardDescription>Tell us about your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Organization Type</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {orgTypes.map(type => (
                    <Button
                      key={type}
                      variant={companyProfile.orgType === type ? "default" : "outline"}
                      size="sm"
                      className={cn("justify-start text-left min-w-0", companyProfile.orgType === type && "bg-accent hover:bg-accent/90")}
                      onClick={() => setCompanyProfile(prev => ({ ...prev, orgType: type }))}
                    >
                      <span className="truncate">{type}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Company Size</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                  {companySizes.map(size => (
                    <Button
                      key={size}
                      variant={companyProfile.companySize === size ? "default" : "outline"}
                      size="sm"
                      className={cn("justify-start text-left min-w-0", companyProfile.companySize === size && "bg-accent hover:bg-accent/90")}
                      onClick={() => setCompanyProfile(prev => ({ ...prev, companySize: size }))}
                    >
                      <span className="truncate">{size}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label>Permits Per Year: {companyProfile.permitsPerYear}</Label>
                <Slider
                  value={[companyProfile.permitsPerYear]}
                  onValueChange={([value]) => setCompanyProfile(prev => ({ ...prev, permitsPerYear: value }))}
                  min={1}
                  max={200}
                  step={1}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>1</span>
                  <span>200+</span>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Average Project Value: ${companyProfile.avgProjectValue.toLocaleString()}</Label>
                <Slider
                  value={[companyProfile.avgProjectValue]}
                  onValueChange={([value]) => setCompanyProfile(prev => ({ ...prev, avgProjectValue: value }))}
                  min={50000}
                  max={10000000}
                  step={50000}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$50K</span>
                  <span>$10M+</span>
                </div>
              </div>

              <div className="space-y-3">
                <Label>Primary Jurisdictions (select all that apply)</Label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search cities or states..."
                    value={jurisdictionSearch}
                    onChange={(e) => setJurisdictionSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto border rounded-lg p-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {jurisdictionOptions
                      .filter(jurisdiction => 
                        jurisdiction.toLowerCase().includes(jurisdictionSearch.toLowerCase())
                      )
                      .map(jurisdiction => (
                        <label
                          key={jurisdiction}
                          className={cn(
                            "flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors text-sm min-w-0",
                            companyProfile.primaryJurisdictions.includes(jurisdiction)
                              ? "border-accent bg-accent/10"
                              : "hover:bg-secondary/50"
                          )}
                        >
                          <Checkbox
                            checked={companyProfile.primaryJurisdictions.includes(jurisdiction)}
                            onCheckedChange={() => toggleJurisdiction(jurisdiction)}
                          />
                          <span className="truncate">{jurisdiction}</span>
                        </label>
                      ))}
                  </div>
                  {jurisdictionOptions.filter(j => j.toLowerCase().includes(jurisdictionSearch.toLowerCase())).length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No jurisdictions found matching "{jurisdictionSearch}"</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Current Tools */}
        {step === 2 && (
          <Card className="animate-fade-in max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-accent" />
                Current Tools
              </CardTitle>
              <CardDescription>What tools do you currently use for permit management?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Select all tools you currently use</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {toolOptions.map(tool => (
                    <label
                      key={tool.id}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-lg border cursor-pointer transition-all",
                        currentTools.tools.includes(tool.id)
                          ? "border-accent bg-accent/10 shadow-md"
                          : "hover:bg-secondary/50"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={currentTools.tools.includes(tool.id)}
                          onCheckedChange={() => toggleTool(tool.id)}
                        />
                        <span className="font-medium">{tool.name}</span>
                      </div>
                      {tool.monthlyPrice > 0 && (
                        <span className="text-sm text-muted-foreground">${tool.monthlyPrice}/mo</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="customTools">Other tools (comma separated)</Label>
                <Input
                  id="customTools"
                  placeholder="e.g., Dropbox, custom software..."
                  value={currentTools.customTools}
                  onChange={(e) => setCurrentTools(prev => ({ ...prev, customTools: e.target.value }))}
                />
              </div>

              <div className="space-y-3">
                <Label>Additional monthly software spend: ${currentTools.monthlySpend}</Label>
                <Slider
                  value={[currentTools.monthlySpend]}
                  onValueChange={([value]) => setCurrentTools(prev => ({ ...prev, monthlySpend: value }))}
                  min={0}
                  max={5000}
                  step={50}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$0</span>
                  <span>$5,000+</span>
                </div>
              </div>

              <div className="p-4 bg-secondary/30 rounded-lg">
                <p className="text-sm text-muted-foreground">Estimated current monthly tool spend:</p>
                <p className="text-2xl font-bold text-accent">
                  ${(currentTools.tools.reduce((sum, toolId) => {
                    const tool = toolOptions.find(t => t.id === toolId);
                    return sum + (tool?.monthlyPrice || 0);
                  }, 0) + currentTools.monthlySpend).toLocaleString()}/mo
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Pain Points */}
        {step === 3 && (
          <Card className="animate-fade-in max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-accent" />
                Pain Points Assessment
              </CardTitle>
              <CardDescription>Rate each challenge from 1 (minor) to 10 (severe)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {[
                { key: "permitTime", label: "Permit approval takes too long", icon: Clock },
                { key: "rejectionRate", label: "High permit rejection rate", icon: AlertTriangle },
                { key: "complianceTime", label: "Code compliance checking is time-consuming", icon: FileText },
                { key: "applicationTime", label: "Filling out permit applications is tedious", icon: FileText },
                { key: "jurisdictionResearch", label: "Researching jurisdiction requirements", icon: Building2 },
                { key: "inspectionCoordination", label: "Coordinating inspections is difficult", icon: Calendar },
                { key: "documentControl", label: "Document version control issues", icon: FileText },
                { key: "projectDelays", label: "Projects delayed due to permit issues", icon: Clock },
              ].map(({ key, label, icon: Icon }) => (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {label}
                    </Label>
                    <Badge variant={painPoints[key as keyof PainPoints] >= 7 ? "destructive" : painPoints[key as keyof PainPoints] >= 4 ? "default" : "secondary"}>
                      {painPoints[key as keyof PainPoints]}/10
                    </Badge>
                  </div>
                  <Slider
                    value={[painPoints[key as keyof PainPoints]]}
                    onValueChange={([value]) => setPainPoints(prev => ({ ...prev, [key]: value }))}
                    min={1}
                    max={10}
                    step={1}
                  />
                </div>
              ))}

              <div className="p-4 bg-secondary/30 rounded-lg">
                <p className="text-sm text-muted-foreground">Average pain score:</p>
                <p className="text-2xl font-bold text-accent">
                  {(Object.values(painPoints).reduce((a, b) => a + b, 0) / 8).toFixed(1)}/10
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Results Preview (Teaser) */}
        {step === 4 && (
          <Card className="animate-fade-in max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <TrendingUp className="h-6 w-6 text-accent" />
                Your Potential Savings
              </CardTitle>
              <CardDescription>Based on your inputs, here's a preview of your potential ROI</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Animated counter preview */}
              <div className="grid md:grid-cols-2 gap-6">
                <div className="p-6 rounded-xl bg-accent/10 border border-accent/20 text-center">
                  <Clock className="h-8 w-8 text-accent mx-auto mb-3" />
                  <p className="text-4xl font-bold text-accent mb-2">{Math.round(results.totalHoursSaved)}</p>
                  <p className="text-muted-foreground">Hours Saved Per Year</p>
                </div>
                <div className="p-6 rounded-xl bg-accent/10 border border-accent/20 text-center">
                  <DollarSign className="h-8 w-8 text-accent mx-auto mb-3" />
                  <p className="text-4xl font-bold text-accent mb-2">${Math.round(results.totalAnnualSavings / 1000)}K+</p>
                  <p className="text-muted-foreground">Estimated Annual Savings</p>
                </div>
              </div>

              {/* Blurred details */}
              <div className="relative p-6 bg-secondary/30 rounded-lg overflow-hidden">
                <div className="blur-sm pointer-events-none space-y-4">
                  <div className="flex justify-between">
                    <span>Time savings value</span>
                    <span className="font-bold">$XX,XXX</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Rejection reduction savings</span>
                    <span className="font-bold">$XX,XXX</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Delay cost avoidance</span>
                    <span className="font-bold">$XX,XXX</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tool consolidation savings</span>
                    <span className="font-bold">$X,XXX</span>
                  </div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <div className="text-center">
                    <Shield className="h-8 w-8 text-accent mx-auto mb-2" />
                    <p className="font-medium mb-1">Unlock Full Results</p>
                    <p className="text-sm text-muted-foreground">Enter your details to see the complete breakdown</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 5: Lead Capture */}
        {step === 5 && (
          <Card className="animate-fade-in max-w-2xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Users className="h-6 w-6 text-accent" />
                Get Your Full Results
              </CardTitle>
              <CardDescription>Enter your details to unlock your personalized ROI report</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={leadInfo.firstName}
                    onChange={(e) => setLeadInfo(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="John"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={leadInfo.lastName}
                    onChange={(e) => setLeadInfo(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Smith"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Work Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={leadInfo.email}
                  onChange={(e) => setLeadInfo(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="john@company.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="company">Company *</Label>
                <Input
                  id="company"
                  value={leadInfo.company}
                  onChange={(e) => setLeadInfo(prev => ({ ...prev, company: e.target.value }))}
                  placeholder="Your Company"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={leadInfo.phone}
                  onChange={(e) => setLeadInfo(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div className="space-y-2">
                <Label>Role</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                  {roleOptions.map(role => (
                    <Button
                      key={role}
                      variant={leadInfo.role === role ? "default" : "outline"}
                      size="sm"
                      className={cn(leadInfo.role === role && "bg-accent hover:bg-accent/90")}
                      onClick={() => setLeadInfo(prev => ({ ...prev, role }))}
                    >
                      {role}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="outline" onClick={handlePrev} className="flex-1">
                  <ChevronLeft className="mr-2 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={handleLeadSubmit}
                  className="flex-1 bg-accent hover:bg-accent/90"
                  disabled={!leadInfo.email || !leadInfo.firstName || !leadInfo.lastName || !leadInfo.company}
                >
                  View Full Results
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 6: Full Results Dashboard */}
        {step === 6 && (
          <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
            {/* Summary Header */}
            <Card className="bg-primary text-primary-foreground">
              <CardContent className="p-8">
                <div className="text-center mb-8">
                  <h2 className="text-3xl font-bold mb-2">Your ROI Report</h2>
                  <p className="text-primary-foreground/80">Personalized for {leadInfo.company}</p>
                </div>
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="text-center p-4 bg-primary-foreground/10 rounded-xl">
                    <p className="text-4xl font-bold text-accent">${Math.round(results.totalAnnualSavings).toLocaleString()}</p>
                    <p className="text-primary-foreground/80">Annual Savings</p>
                  </div>
                  <div className="text-center p-4 bg-primary-foreground/10 rounded-xl">
                    <p className="text-4xl font-bold text-accent">{Math.round(results.roi)}%</p>
                    <p className="text-primary-foreground/80">Return on Investment</p>
                  </div>
                  <div className="text-center p-4 bg-primary-foreground/10 rounded-xl">
                    <p className="text-4xl font-bold text-accent">{results.paybackMonths.toFixed(1)} mo</p>
                    <p className="text-primary-foreground/80">Payback Period</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Savings Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle>Savings Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[
                        { name: "Time Savings", value: Math.round(results.timeSavingsValue), fill: "hsl(168, 76%, 32%)" },
                        { name: "Rejection Reduction", value: Math.round(results.rejectionSavings), fill: "hsl(168, 65%, 42%)" },
                        { name: "Delay Avoidance", value: Math.round(results.delayCostSavings), fill: "hsl(168, 55%, 52%)" },
                        { name: "Tool Consolidation", value: Math.round(results.toolSavings), fill: "hsl(168, 45%, 62%)" },
                      ]}
                      layout="vertical"
                      margin={{ left: 120 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`} />
                      <YAxis type="category" dataKey="name" />
                      <Tooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid md:grid-cols-2 gap-4 mt-6">
                  <div className="p-4 bg-secondary/30 rounded-lg">
                    <div className="flex items-center gap-3 mb-2">
                      <Clock className="h-5 w-5 text-accent" />
                      <span className="font-medium">Time Efficiency</span>
                    </div>
                    <p className="text-2xl font-bold">{results.timeSavingsPercent.toFixed(0)}% faster</p>
                    <p className="text-sm text-muted-foreground">{Math.round(results.totalHoursSaved)} hours saved annually</p>
                  </div>
                  <div className="p-4 bg-secondary/30 rounded-lg">
                    <div className="flex items-center gap-3 mb-2">
                      <Shield className="h-5 w-5 text-accent" />
                      <span className="font-medium">Rejection Rate</span>
                    </div>
                    <p className="text-2xl font-bold">{results.rejectionReductionPercent.toFixed(0)}% reduction</p>
                    <p className="text-sm text-muted-foreground">{results.rejectionsSaved.toFixed(1)} fewer rejections/year</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Recommended Plan */}
            <Card className="border-accent border-2">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3">
                    <Zap className="h-6 w-6 text-accent" />
                    Recommended Plan
                  </CardTitle>
                  <Badge className="bg-accent text-accent-foreground">Best Value</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-2xl font-bold">
                      {companyProfile.companySize.includes("1-10") ? "Starter" :
                       companyProfile.companySize.includes("11-50") ? "Professional" : "Business"}
                    </p>
                    <p className="text-muted-foreground">Based on your company profile</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-accent">${results.recommendedTier}</p>
                    <p className="text-muted-foreground">/user/month</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button className="flex-1 bg-accent hover:bg-accent/90">
                    Start Free Trial
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Button variant="outline">
                    Schedule Demo
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex flex-wrap gap-3 justify-center">
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Download PDF Report
              </Button>
              <Button variant="outline" onClick={handleSaveClick}>
                <Save className="mr-2 h-4 w-4" />
                {user ? "Save to Dashboard" : "Sign In to Save"}
              </Button>
              <Button variant="outline">
                <Share2 className="mr-2 h-4 w-4" />
                Share Results
              </Button>
            </div>
          </div>
        )}

        {/* Save Dialog */}
        <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Save Calculation</DialogTitle>
              <DialogDescription>
                Give your ROI calculation a name to save it to your dashboard.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="saveName">Calculation Name</Label>
              <Input
                id="saveName"
                placeholder="e.g., Q1 2026 Permit Savings Estimate"
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

        {/* Navigation */}
        {step < 5 && (
          <div className="flex flex-col sm:flex-row gap-3 mt-8 max-w-2xl mx-auto">
            {step > 1 && (
              <Button variant="outline" onClick={handlePrev} className="flex-1">
                <ChevronLeft className="mr-2 h-4 w-4" />
                Previous
              </Button>
            )}
            <Button onClick={handleNext} className="flex-1 bg-accent hover:bg-accent/90">
              Next Step
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ROICalculator;
