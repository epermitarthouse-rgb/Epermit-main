import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useLeadCapture } from "@/contexts/LeadCaptureContext";
import { Shield, Zap, CheckCircle2 } from "lucide-react";

const toolOptions = [
  { id: "compliance", label: "Code Compliance Checking" },
  { id: "detection", label: "Pre-Submittal Issue Detection" },
  { id: "autofill", label: "Permit Application Auto-Fill" },
  { id: "jurisdiction", label: "Jurisdiction Requirement Lookup" },
];

const roleOptions = [
  "Architect",
  "Engineer",
  "Permit Expeditor",
  "General Contractor",
  "Project Manager",
  "Other",
];

export function LeadCaptureModal() {
  const { showLeadModal, setShowLeadModal, captureLead, pendingDemoId } = useLeadCapture();
  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    company: "",
    role: "",
    interestedTools: [] as string[],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 800));
    
    captureLead({
      ...formData,
      source: pendingDemoId || "demo-page",
    });
    
    setIsSubmitting(false);
  };

  const handleToolChange = (toolId: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      interestedTools: checked
        ? [...prev.interestedTools, toolId]
        : prev.interestedTools.filter(t => t !== toolId),
    }));
  };

  return (
    <Dialog open={showLeadModal} onOpenChange={setShowLeadModal}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">Unlock Full Interactive Demos</DialogTitle>
          <DialogDescription className="text-base">
            Get instant access to all interactive demos and see how Insight|DesignCheck™ can accelerate your permits.
          </DialogDescription>
        </DialogHeader>

        {/* Benefits */}
        <div className="grid grid-cols-3 gap-4 py-4 border-y">
          <div className="flex flex-col items-center text-center gap-2">
            <div className="p-2 rounded-full bg-accent/10">
              <Zap className="h-5 w-5 text-accent" />
            </div>
            <span className="text-xs text-muted-foreground">Instant Access</span>
          </div>
          <div className="flex flex-col items-center text-center gap-2">
            <div className="p-2 rounded-full bg-accent/10">
              <Shield className="h-5 w-5 text-accent" />
            </div>
            <span className="text-xs text-muted-foreground">No Credit Card</span>
          </div>
          <div className="flex flex-col items-center text-center gap-2">
            <div className="p-2 rounded-full bg-accent/10">
              <CheckCircle2 className="h-5 w-5 text-accent" />
            </div>
            <span className="text-xs text-muted-foreground">All 4 Demos</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                required
                value={formData.firstName}
                onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                required
                value={formData.lastName}
                onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))}
                placeholder="Smith"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Work Email *</Label>
            <Input
              id="email"
              type="email"
              required
              value={formData.email}
              onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
              placeholder="john@company.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="company">Company *</Label>
            <Input
              id="company"
              required
              value={formData.company}
              onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
              placeholder="Your Company"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              value={formData.role}
              onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
            >
              <option value="">Select your role</option>
              {roleOptions.map(role => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            <Label>Which tools interest you most?</Label>
            <div className="grid grid-cols-2 gap-2">
              {toolOptions.map(tool => (
                <label
                  key={tool.id}
                  className="flex items-center gap-2 p-2 rounded border border-border hover:bg-secondary/50 cursor-pointer text-sm"
                >
                  <Checkbox
                    checked={formData.interestedTools.includes(tool.id)}
                    onCheckedChange={(checked) => handleToolChange(tool.id, checked as boolean)}
                  />
                  {tool.label}
                </label>
              ))}
            </div>
          </div>

          <Button 
            type="submit" 
            className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Unlocking..." : "Unlock Interactive Demos"}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            By submitting, you agree to our Terms of Service and Privacy Policy.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
