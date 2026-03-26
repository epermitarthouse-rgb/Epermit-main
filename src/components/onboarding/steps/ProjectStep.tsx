import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FolderPlus, ArrowRight, ArrowLeft, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface ProjectData {
  name: string;
  description: string;
  project_type: "new_construction" | "renovation" | "addition" | "tenant_improvement" | "demolition" | "other";
  jurisdiction: string;
  city: string;
  state: string;
}

interface ProjectStepProps {
  data: ProjectData;
  onChange: (data: ProjectData) => void;
  onNext: () => void;
  onBack: () => void;
}

const PROJECT_TYPES = [
  { value: "new_construction", label: "New Construction" },
  { value: "renovation", label: "Renovation" },
  { value: "addition", label: "Addition" },
  { value: "tenant_improvement", label: "Tenant Improvement" },
  { value: "demolition", label: "Demolition" },
  { value: "other", label: "Other" },
];

const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

export function ProjectStep({ data, onChange, onNext, onBack }: ProjectStepProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [skipProject, setSkipProject] = useState(false);

  const handleChange = (field: keyof ProjectData, value: string) => {
    onChange({ ...data, [field]: value });
  };

  const handleSubmit = async () => {
    if (skipProject) {
      onNext();
      return;
    }

    if (!data.name.trim()) {
      toast.error("Please enter a project name");
      return;
    }

    setLoading(true);
    try {
      if (user) {
        const { error } = await supabase.from("projects").insert({
          user_id: user.id,
          name: data.name,
          description: data.description || null,
          project_type: data.project_type,
          jurisdiction: data.jurisdiction || null,
          city: data.city || null,
          state: data.state || null,
          status: "draft",
        });

        if (error) throw error;
        toast.success("Project created!");
      }
      onNext();
    } catch (error) {
      console.error("Error creating project:", error);
      toast.error("Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <FolderPlus className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">Create Your First Project</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Set up a permit project to track through the approval process
        </p>
      </div>

      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="project_name">Project Name *</Label>
          <Input
            id="project_name"
            placeholder="123 Main St - New Construction"
            value={data.name}
            onChange={(e) => handleChange("name", e.target.value)}
            disabled={skipProject}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="project_type">Project Type</Label>
          <Select
            value={data.project_type}
            onValueChange={(value) => handleChange("project_type", value)}
            disabled={skipProject}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="city" className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              City
            </Label>
            <Input
              id="city"
              placeholder="Miami"
              value={data.city}
              onChange={(e) => handleChange("city", e.target.value)}
              disabled={skipProject}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="state">State</Label>
            <Select
              value={data.state}
              onValueChange={(value) => handleChange("state", value)}
              disabled={skipProject}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {US_STATES.map((state) => (
                  <SelectItem key={state} value={state}>
                    {state}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            placeholder="Brief description of the project..."
            value={data.description}
            onChange={(e) => handleChange("description", e.target.value)}
            rows={2}
            disabled={skipProject}
          />
        </div>
      </div>

      <div className="flex items-center justify-between pt-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSkipProject(!skipProject);
              if (!skipProject) {
                onChange({ ...data, name: "" });
              }
            }}
            className="text-muted-foreground"
          >
            {skipProject ? "Create a project" : "Skip for now"}
          </Button>
        </div>
        <Button onClick={handleSubmit} disabled={loading} className="gap-2">
          {loading ? "Creating..." : "Continue"}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
