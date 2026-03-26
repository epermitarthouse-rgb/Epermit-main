import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { User, Building2, Briefcase, Phone, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface ProfileData {
  full_name: string;
  company_name: string;
  job_title: string;
  phone: string;
}

interface ProfileStepProps {
  data: ProfileData;
  onChange: (data: ProfileData) => void;
  onNext: () => void;
}

export function ProfileStep({ data, onChange, onNext }: ProfileStepProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleChange = (field: keyof ProfileData, value: string) => {
    onChange({ ...data, [field]: value });
  };

  const handleSubmit = async () => {
    if (!data.full_name.trim()) {
      toast.error("Please enter your name");
      return;
    }

    setLoading(true);
    try {
      if (user) {
        const { error } = await supabase
          .from("profiles")
          .update({
            full_name: data.full_name,
            company_name: data.company_name || null,
            job_title: data.job_title || null,
            phone: data.phone || null,
          })
          .eq("user_id", user.id);

        if (error) throw error;
      }
      onNext();
    } catch (error) {
      console.error("Error updating profile:", error);
      toast.error("Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <User className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">Complete Your Profile</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Help us personalize your experience
        </p>
      </div>

      <div className="grid gap-4">
        <div className="space-y-2">
          <Label htmlFor="full_name" className="flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            Full Name *
          </Label>
          <Input
            id="full_name"
            placeholder="John Smith"
            value={data.full_name}
            onChange={(e) => handleChange("full_name", e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="company_name" className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground" />
            Company Name
          </Label>
          <Input
            id="company_name"
            placeholder="Acme Construction"
            value={data.company_name}
            onChange={(e) => handleChange("company_name", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="job_title" className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-muted-foreground" />
              Job Title
            </Label>
            <Input
              id="job_title"
              placeholder="Project Manager"
              value={data.job_title}
              onChange={(e) => handleChange("job_title", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-muted-foreground" />
              Phone
            </Label>
            <Input
              id="phone"
              type="tel"
              placeholder="(555) 123-4567"
              value={data.phone}
              onChange={(e) => handleChange("phone", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={handleSubmit} disabled={loading} className="gap-2">
          {loading ? "Saving..." : "Continue"}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
