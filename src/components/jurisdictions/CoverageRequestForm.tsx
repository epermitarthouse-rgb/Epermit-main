import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { MapPin, Send, CheckCircle2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { z } from "zod";

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" }, { code: "DC", name: "District of Columbia" }
];

const coverageRequestSchema = z.object({
  email: z.string().trim().email("Invalid email address").max(255),
  company_name: z.string().trim().max(200).optional(),
  jurisdiction_name: z.string().trim().min(1, "Jurisdiction name is required").max(200),
  city: z.string().trim().max(100).optional(),
  state: z.string().min(2, "State is required"),
  county: z.string().trim().max(100).optional(),
  project_type: z.string().optional(),
  estimated_permits_per_year: z.number().int().positive().optional(),
  notes: z.string().trim().max(1000).optional()
});

interface CoverageRequestFormProps {
  defaultState?: string;
  triggerButton?: React.ReactNode;
}

export function CoverageRequestForm({ defaultState, triggerButton }: CoverageRequestFormProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  
  const [formData, setFormData] = useState({
    email: "",
    company_name: "",
    jurisdiction_name: "",
    city: "",
    state: defaultState || "",
    county: "",
    project_type: "",
    estimated_permits_per_year: "",
    notes: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const validatedData = coverageRequestSchema.parse({
        ...formData,
        estimated_permits_per_year: formData.estimated_permits_per_year 
          ? parseInt(formData.estimated_permits_per_year) 
          : undefined
      });

      const { error } = await supabase
        .from("coverage_requests")
        .insert({
          email: validatedData.email,
          company_name: validatedData.company_name || null,
          jurisdiction_name: validatedData.jurisdiction_name,
          city: validatedData.city || null,
          state: validatedData.state,
          county: validatedData.county || null,
          project_type: validatedData.project_type || null,
          estimated_permits_per_year: validatedData.estimated_permits_per_year || null,
          notes: validatedData.notes || null
        });

      if (error) throw error;

      setSubmitted(true);
      toast({
        title: "Request Submitted!",
        description: "We'll notify you when we add coverage for this jurisdiction.",
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        toast({
          title: "Validation Error",
          description: err.errors[0]?.message || "Please check your input",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Error",
          description: "Failed to submit request. Please try again.",
          variant: "destructive"
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setFormData({
      email: "",
      company_name: "",
      jurisdiction_name: "",
      city: "",
      state: defaultState || "",
      county: "",
      project_type: "",
      estimated_permits_per_year: "",
      notes: ""
    });
    setSubmitted(false);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen);
      if (!isOpen) resetForm();
    }}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button variant="outline">
            <MapPin className="h-4 w-4 mr-2" />
            Request Coverage
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Request Jurisdiction Coverage
          </DialogTitle>
          <DialogDescription>
            Don't see your jurisdiction? Let us know and we'll prioritize adding it.
          </DialogDescription>
        </DialogHeader>

        {submitted ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="py-8 text-center"
          >
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Request Submitted!</h3>
            <p className="text-muted-foreground mb-4">
              We've added your jurisdiction to our expansion list. We'll email you when coverage is available.
            </p>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </motion.div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label htmlFor="email">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={formData.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  required
                />
              </div>
              
              <div className="col-span-2">
                <Label htmlFor="company_name">Company Name</Label>
                <Input
                  id="company_name"
                  placeholder="Your company"
                  value={formData.company_name}
                  onChange={(e) => handleChange("company_name", e.target.value)}
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="jurisdiction_name">Jurisdiction Name *</Label>
                <Input
                  id="jurisdiction_name"
                  placeholder="e.g., City of Austin"
                  value={formData.jurisdiction_name}
                  onChange={(e) => handleChange("jurisdiction_name", e.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  placeholder="City name"
                  value={formData.city}
                  onChange={(e) => handleChange("city", e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="state">State *</Label>
                <Select
                  value={formData.state}
                  onValueChange={(value) => handleChange("state", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select state" />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((state) => (
                      <SelectItem key={state.code} value={state.code}>
                        {state.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="county">County</Label>
                <Input
                  id="county"
                  placeholder="County name"
                  value={formData.county}
                  onChange={(e) => handleChange("county", e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="project_type">Project Type</Label>
                <Select
                  value={formData.project_type}
                  onValueChange={(value) => handleChange("project_type", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="residential">Residential</SelectItem>
                    <SelectItem value="commercial">Commercial</SelectItem>
                    <SelectItem value="industrial">Industrial</SelectItem>
                    <SelectItem value="mixed_use">Mixed Use</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2">
                <Label htmlFor="permits_per_year">Estimated Permits Per Year</Label>
                <Input
                  id="permits_per_year"
                  type="number"
                  placeholder="e.g., 50"
                  min="1"
                  value={formData.estimated_permits_per_year}
                  onChange={(e) => handleChange("estimated_permits_per_year", e.target.value)}
                />
              </div>

              <div className="col-span-2">
                <Label htmlFor="notes">Additional Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Any specific requirements or details..."
                  value={formData.notes}
                  onChange={(e) => handleChange("notes", e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? (
                  "Submitting..."
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Submit Request
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
