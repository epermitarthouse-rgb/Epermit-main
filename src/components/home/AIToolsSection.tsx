import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useLeadCapture } from "@/contexts/LeadCaptureContext";
import { Bot, Search, FileText, MapPin, ChevronDown, ChevronUp, Play, Lock, Check, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { staggerContainer, staggerItem, cardHover } from "@/components/animations/variants";

interface AITool {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  codes?: string[];
  issues?: string[];
  dataExtracted?: string[];
  coverage?: string[];
  animationSteps: { title: string; description: string }[];
}

const aiTools: AITool[] = [
  {
    id: "compliance",
    icon: <Bot className="h-8 w-8" />,
    title: "Automated Code Compliance Checking",
    description: "AI-Powered Code Compliance in Minutes, Not Days",
    features: [
      "Automatic code year detection based on jurisdiction",
      "Side-by-side code requirement citations",
      "Markup overlay showing issue locations on drawings",
      "Severity rating (Critical / Warning / Advisory)",
      "Suggested fixes with code references",
    ],
    codes: ["IBC 2018, 2021, 2024", "IFC Fire Safety", "ADA / ICC A117.1", "IRC Residential", "Local Amendments"],
    animationSteps: [
      { title: "Upload Drawings", description: "PDF, DWG, or RVT files" },
      { title: "AI Scans Codes", description: "IBC, IFC, ADA, IRC + local" },
      { title: "Receive Report", description: "Issues with locations & fixes" },
    ],
  },
  {
    id: "detection",
    icon: <Search className="h-8 w-8" />,
    title: "Pre-Submittal Issue Detection",
    description: "Catch Rejection Reasons Before You Submit",
    features: [
      "AI learns from historical rejections per jurisdiction",
      "Priority ranking of most common rejection causes",
      "\"Fix before submitting\" checklist",
      "Estimated rejection probability score",
      "Integration with compliance tool for remediation",
    ],
    issues: ["Egress & Exit Requirements", "Fire Separation & Ratings", "Occupancy & Use Conflicts", "MEP Coordination Issues", "Jurisdiction-Specific"],
    animationSteps: [
      { title: "Analyze Drawings", description: "Scan for common issues" },
      { title: "Flag Problems", description: "Egress, fire, occupancy, MEP" },
      { title: "Rejection Score", description: "Probability of rejection" },
    ],
  },
  {
    id: "autofill",
    icon: <FileText className="h-8 w-8" />,
    title: "Permit Application Auto-Fill",
    description: "Complete Applications in Minutes, Not Hours",
    features: [
      "Pre-populates 80%+ of standard permit application fields",
      "Supports 200+ municipal permit form formats",
      "Smart field mapping to different jurisdiction forms",
      "Review and edit before export",
      "Export to PDF or direct jurisdiction portal submission",
    ],
    dataExtracted: ["Project Basics", "Building Metrics", "Occupancy Details", "Scope of Work", "Design Team Info"],
    animationSteps: [
      { title: "Extract Data", description: "From your drawings" },
      { title: "Map to Forms", description: "200+ jurisdiction formats" },
      { title: "Export Ready", description: "PDF or direct submit" },
    ],
  },
  {
    id: "jurisdiction",
    icon: <MapPin className="h-8 w-8" />,
    title: "Jurisdiction Requirement Lookup",
    description: "Know Exactly What Every Jurisdiction Requires",
    features: [
      "Search by address or jurisdiction name",
      "Side-by-side comparison of multiple jurisdictions",
      "Recently updated requirements highlighted",
      "Subscribe to jurisdiction update alerts",
      "Direct links to official jurisdiction websites",
    ],
    coverage: ["Amendments & Local Codes", "Submission Requirements", "Fee Schedules", "Processing Times"],
    animationSteps: [
      { title: "Enter Address", description: "Or select jurisdiction" },
      { title: "Load Requirements", description: "500+ jurisdictions" },
      { title: "Compare & Plan", description: "Fees, times, checklist" },
    ],
  },
];

function AnimatedDemo({ steps }: { steps: AITool["animationSteps"] }) {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <div className="relative p-6 bg-secondary/50 rounded-lg">
      {/* Progress bar */}
      <div className="flex gap-2 mb-6">
        {steps.map((_, index) => (
          <motion.div
            key={index}
            className="h-1 flex-1 rounded-full bg-border"
            initial={false}
          >
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: index <= activeStep ? "100%" : "0%" }}
              transition={{ duration: 0.3 }}
            />
          </motion.div>
        ))}
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, index) => (
          <motion.div
            key={index}
            className={`flex items-center gap-4 p-3 rounded-lg transition-all duration-300 cursor-pointer ${
              index === activeStep
                ? "bg-accent/10 border border-accent/30"
                : index < activeStep
                ? "opacity-50"
                : "opacity-30"
            }`}
            onClick={() => setActiveStep(index)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <motion.div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                index <= activeStep ? "bg-accent text-accent-foreground" : "bg-border text-muted-foreground"
              }`}
              animate={index === activeStep ? { scale: [1, 1.1, 1] } : {}}
              transition={{ duration: 0.3 }}
            >
              {index < activeStep ? <Check className="h-4 w-4" /> : index + 1}
            </motion.div>
            <div>
              <p className="font-medium">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Auto-advance */}
      <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 w-full"
          onClick={() => setActiveStep((prev) => (prev + 1) % steps.length)}
        >
          {activeStep === steps.length - 1 ? "Restart" : "Next Step"}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </motion.div>
    </div>
  );
}

function ToolCard({ tool, index }: { tool: AITool; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const { isLeadCaptured, setShowLeadModal, setPendingDemoId } = useLeadCapture();

  const handleFullDemo = () => {
    if (isLeadCaptured) {
      window.location.href = `/demos#${tool.id}`;
    } else {
      setPendingDemoId(tool.id);
      setShowLeadModal(true);
    }
  };

  return (
    <>
      <motion.div
        variants={staggerItem}
        whileHover={{ y: -8, transition: { duration: 0.3 } }}
      >
        <Card className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl h-full">
          <CardHeader>
            <div className="flex items-start justify-between">
              <motion.div
                className="p-3 rounded-lg bg-accent/10 text-accent mb-4"
                whileHover={{ scale: 1.1, rotate: 5 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                {tool.icon}
              </motion.div>
            </div>
            <CardTitle className="text-xl">{tool.title}</CardTitle>
            <CardDescription className="text-base">{tool.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Tags */}
            <div className="flex flex-wrap gap-2">
              {(tool.codes || tool.issues || tool.dataExtracted || tool.coverage)?.slice(0, 3).map((item, i) => (
                <motion.span
                  key={i}
                  className="px-2 py-1 text-xs rounded-full bg-secondary text-secondary-foreground"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.1 }}
                >
                  {item}
                </motion.span>
              ))}
              {(tool.codes || tool.issues || tool.dataExtracted || tool.coverage)?.length! > 3 && (
                <span className="px-2 py-1 text-xs rounded-full bg-secondary text-secondary-foreground">
                  +{(tool.codes || tool.issues || tool.dataExtracted || tool.coverage)!.length - 3} more
                </span>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setShowModal(true)}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Quick Preview
                </Button>
              </motion.div>
              <motion.div className="flex-1" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  size="sm"
                  className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
                  onClick={handleFullDemo}
                >
                  {isLeadCaptured ? (
                    <>Full Demo</>
                  ) : (
                    <>
                      <Lock className="mr-2 h-4 w-4" />
                      Full Demo
                    </>
                  )}
                </Button>
              </motion.div>
            </div>

            {/* Expandable Section */}
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Hide Details" : "Show Details"}
              <motion.div
                animate={{ rotate: expanded ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronDown className="ml-2 h-4 w-4" />
              </motion.div>
            </Button>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="pt-4 border-t space-y-4">
                    <AnimatedDemo steps={tool.animationSteps} />
                    <div>
                      <p className="font-medium mb-2">Key Capabilities:</p>
                      <ul className="space-y-1">
                        {tool.features.map((feature, i) => (
                          <motion.li
                            key={i}
                            className="flex items-start gap-2 text-sm text-muted-foreground"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05 }}
                          >
                            <Check className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                            {feature}
                          </motion.li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>

      {/* Preview Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <motion.div
                className="p-2 rounded-lg bg-accent/10 text-accent"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200 }}
              >
                {tool.icon}
              </motion.div>
              {tool.title}
            </DialogTitle>
            <DialogDescription>{tool.description}</DialogDescription>
          </DialogHeader>

          <AnimatedDemo steps={tool.animationSteps} />

          {/* Blurred results preview */}
          <div className="relative p-4 bg-secondary/30 rounded-lg">
            <div className="blur-sm pointer-events-none">
              <div className="space-y-2">
                <div className="h-4 bg-accent/20 rounded w-3/4" />
                <div className="h-4 bg-accent/20 rounded w-1/2" />
                <div className="h-4 bg-accent/20 rounded w-2/3" />
              </div>
            </div>
            <div className="absolute inset-0 flex items-center justify-center">
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button
                  className="bg-accent hover:bg-accent/90 text-accent-foreground"
                  onClick={() => {
                    setShowModal(false);
                    handleFullDemo();
                  }}
                >
                  <Lock className="mr-2 h-4 w-4" />
                  Unlock Full Interactive Demo
                </Button>
              </motion.div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AIToolsSection() {
  return (
    <section className="py-20 bg-background" id="features">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          className="text-center max-w-3xl mx-auto mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 text-accent text-sm font-medium mb-4">
            <Check className="h-4 w-4" />
            Functional Demos — Try Them Now
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            The Permit Intelligence Platform
          </h2>
          <p className="text-lg text-muted-foreground">
            Four AI-powered tools backed by our <strong>90+ jurisdiction database</strong> and <strong>Shovels API</strong> integration. 
            Not mockups—real functionality you can test today.
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          {aiTools.map((tool, index) => (
            <ToolCard key={tool.id} tool={tool} index={index} />
          ))}
        </motion.div>

        <motion.div
          className="text-center mt-12"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button asChild size="lg" variant="outline">
              <Link to="/demos">
                Explore All Interactive Demos
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
