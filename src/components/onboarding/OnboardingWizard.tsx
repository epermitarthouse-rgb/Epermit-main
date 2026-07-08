import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ProfileStep, type ProfileStepHandle } from "./steps/ProfileStep";
import { ProjectStep, type ProjectStepHandle } from "./steps/ProjectStep";
import { FeaturesStep } from "./steps/FeaturesStep";
import { Check, ArrowRight, ArrowLeft, Rocket } from "lucide-react";

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
  const [stepLoading, setStepLoading] = useState(false);
  const [skipProject, setSkipProject] = useState(false);
  const profileStepRef = useRef<ProfileStepHandle>(null);
  const projectStepRef = useRef<ProjectStepHandle>(null);
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

  const handlePrimaryAction = async () => {
    if (stepLoading) return;
    if (currentStep === 1) {
      await profileStepRef.current?.submit();
      return;
    }
    if (currentStep === 2) {
      await projectStepRef.current?.submit();
      return;
    }
    handleComplete();
  };

  const handleToggleSkip = () => {
    projectStepRef.current?.toggleSkip();
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="flex w-[calc(100%-2rem)] max-h-[calc(100vh-32px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        {/* Header — fixed height, does not scroll */}
        <div className="shrink-0 border-b bg-primary/5 px-6 py-4 pr-12">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Welcome to PermitPilot</h2>
              <p className="text-sm text-muted-foreground">Let's get you set up in just 3 steps</p>
            </div>
            <span className="text-sm font-medium text-primary">
              Step {currentStep} of {STEPS.length}
            </span>
          </div>

          <div className="mb-3 flex items-center gap-2">
            {STEPS.map((step, index) => (
              <div key={step.id} className="flex flex-1 items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                    currentStep > step.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : currentStep === step.id
                        ? "border-primary bg-background text-primary"
                        : "border-muted bg-background text-muted-foreground"
                  }`}
                >
                  {currentStep > step.id ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span className="text-sm font-medium">{step.id}</span>
                  )}
                </div>
                {index < STEPS.length - 1 && (
                  <div
                    className={`mx-2 h-0.5 flex-1 transition-colors ${
                      currentStep > step.id ? "bg-primary" : "bg-muted"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          <Progress value={progress} className="h-1" />
        </div>

        {/* Scrollable body — fields only */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
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
                  ref={profileStepRef}
                  data={profileData}
                  onChange={setProfileData}
                  onNext={handleNext}
                  onLoadingChange={setStepLoading}
                />
              )}
              {currentStep === 2 && (
                <ProjectStep
                  ref={projectStepRef}
                  data={projectData}
                  onChange={setProjectData}
                  onNext={handleNext}
                  onBack={handleBack}
                  skipProject={skipProject}
                  onSkipProjectChange={setSkipProject}
                  onLoadingChange={setStepLoading}
                />
              )}
              {currentStep === 3 && (
                <FeaturesStep onComplete={handleComplete} onBack={handleBack} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Footer — always visible */}
        <div className="shrink-0 border-t bg-background px-6 py-4">
          {currentStep === 1 && (
            <div className="flex justify-end">
              <Button
                onClick={handlePrimaryAction}
                disabled={stepLoading}
                className="gap-2"
              >
                {stepLoading ? "Saving..." : "Continue"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={handleBack} disabled={stepLoading} className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleToggleSkip}
                  disabled={stepLoading}
                  className="text-muted-foreground"
                >
                  {skipProject ? "Create a project" : "Skip for now"}
                </Button>
              </div>
              <Button
                onClick={handlePrimaryAction}
                disabled={stepLoading}
                className="gap-2 sm:ml-auto"
              >
                {stepLoading ? "Creating..." : "Continue"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {currentStep === 3 && (
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={handleBack} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button onClick={handleComplete} className="gap-2 bg-primary hover:bg-primary/90">
                <Rocket className="h-4 w-4" />
                Get Started
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
