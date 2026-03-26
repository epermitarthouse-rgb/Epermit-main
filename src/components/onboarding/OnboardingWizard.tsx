import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ProfileStep } from "./steps/ProfileStep";
import { ProjectStep } from "./steps/ProjectStep";
import { FeaturesStep } from "./steps/FeaturesStep";
import { Check } from "lucide-react";

interface OnboardingData {
  profileName?: string;
  companyName?: string;
  projectName?: string;
}

interface OnboardingWizardProps {
  open: boolean;
  onComplete: (data?: OnboardingData) => void;
}

const STEPS = [
  { id: 1, title: "Your Profile", description: "Tell us about yourself" },
  { id: 2, title: "First Project", description: "Create your first permit project" },
  { id: 3, title: "Key Features", description: "Discover what you can do" },
];

export function OnboardingWizard({ open, onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [profileData, setProfileData] = useState({
    full_name: "",
    company_name: "",
    job_title: "",
    phone: "",
  });
  const [projectData, setProjectData] = useState<{
    name: string;
    description: string;
    project_type: "new_construction" | "renovation" | "addition" | "tenant_improvement" | "demolition" | "other";
    jurisdiction: string;
    city: string;
    state: string;
  }>({
    name: "",
    description: "",
    project_type: "new_construction",
    jurisdiction: "",
    city: "",
    state: "",
  });

  const progress = (currentStep / STEPS.length) * 100;

  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    } else {
      // Pass collected data to onComplete for welcome email
      onComplete({
        profileName: profileData.full_name,
        companyName: profileData.company_name,
        projectName: projectData.name,
      });
    }
  };

  const handleComplete = () => {
    onComplete({
      profileName: profileData.full_name,
      companyName: profileData.company_name,
      projectName: projectData.name,
    });
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-2xl p-0 gap-0 overflow-hidden" onPointerDownOutside={(e) => e.preventDefault()}>
        {/* Header with Progress */}
        <div className="bg-primary/5 px-6 py-4 border-b">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Welcome to Insight|DesignCheck</h2>
              <p className="text-sm text-muted-foreground">Let's get you set up in just 3 steps</p>
            </div>
            <span className="text-sm font-medium text-primary">Step {currentStep} of {STEPS.length}</span>
          </div>
          
          {/* Step Indicators */}
          <div className="flex items-center gap-2 mb-3">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex items-center flex-1">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 transition-colors ${
                  currentStep > step.id 
                    ? "bg-primary border-primary text-primary-foreground" 
                    : currentStep === step.id 
                      ? "border-primary text-primary bg-background" 
                      : "border-muted text-muted-foreground bg-background"
                }`}>
                  {currentStep > step.id ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span className="text-sm font-medium">{step.id}</span>
                  )}
                </div>
                {index < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 transition-colors ${
                    currentStep > step.id ? "bg-primary" : "bg-muted"
                  }`} />
                )}
              </div>
            ))}
          </div>
          
          <Progress value={progress} className="h-1" />
        </div>

        {/* Step Content */}
        <div className="p-6 min-h-[400px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {currentStep === 1 && (
                <ProfileStep
                  data={profileData}
                  onChange={setProfileData}
                  onNext={handleNext}
                />
              )}
              {currentStep === 2 && (
                <ProjectStep
                  data={projectData}
                  onChange={setProjectData}
                  onNext={handleNext}
                  onBack={handleBack}
                />
              )}
              {currentStep === 3 && (
                <FeaturesStep
                  onComplete={handleComplete}
                  onBack={handleBack}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
