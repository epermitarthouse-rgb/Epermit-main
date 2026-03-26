import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  Save,
  Loader2,
  Image,
  Building2,
  Phone,
  Mail,
  Globe,
  FileSignature,
  AlertCircle,
  Upload,
} from "lucide-react";

interface CompanyBranding {
  id?: string;
  logo_url: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_website: string;
  default_signoff: string;
}

const defaultBranding: CompanyBranding = {
  logo_url: "",
  company_address: "",
  company_phone: "",
  company_email: "",
  company_website: "",
  default_signoff: "Respectfully submitted,",
};

export function ExportBrandingManager() {
  const { user } = useAuth();
  const [branding, setBranding] = useState<CompanyBranding>(defaultBranding);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fetchBranding = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("company_branding")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setBranding({
          id: data.id,
          logo_url: data.logo_url || "",
          company_address: data.company_address || "",
          company_phone: data.company_phone || "",
          company_email: data.company_email || "",
          company_website: data.company_website || "",
          default_signoff: data.default_signoff || "Respectfully submitted,",
        });
      }
    } catch (error) {
      console.error("Error fetching company branding:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchBranding();
  }, [fetchBranding]);

  const handleChange = (field: keyof CompanyBranding, value: string) => {
    setBranding((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file (PNG, JPG, or SVG)");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be less than 2MB");
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const filePath = `company-logos/${user.id}/logo.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("exports")
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("exports")
        .getPublicUrl(filePath);

      handleChange("logo_url", urlData.publicUrl);
      toast.success("Logo uploaded successfully");
    } catch (error) {
      console.error("Error uploading logo:", error);
      toast.error("Failed to upload logo");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    const newErrors: Record<string, string> = {};
    if (branding.company_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(branding.company_email)) {
      newErrors.company_email = "Please enter a valid email address";
    }
    if (branding.company_website && !/^https?:\/\/.+/.test(branding.company_website) && branding.company_website.length > 0) {
      newErrors.company_website = "Website must start with http:// or https://";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        logo_url: branding.logo_url || null,
        company_address: branding.company_address || null,
        company_phone: branding.company_phone || null,
        company_email: branding.company_email || null,
        company_website: branding.company_website || null,
        default_signoff: branding.default_signoff || "Respectfully submitted,",
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("company_branding")
        .upsert(payload, { onConflict: "user_id" });

      if (error) throw error;
      toast.success("Export branding saved successfully");
      await fetchBranding();
    } catch (error) {
      console.error("Error saving company branding:", error);
      toast.error("Failed to save branding settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSignature className="h-5 w-5 text-muted-foreground" />
          Export Branding
        </CardTitle>
        <CardDescription>
          Configure company branding for exported response packages. Your company name is pulled from your Profile tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Image className="h-4 w-4 text-muted-foreground" />
                Company Logo
              </Label>
              <div className="flex items-center gap-4 flex-wrap">
                {branding.logo_url && (
                  <div className="border rounded-md p-2 bg-muted/30">
                    <img
                      src={branding.logo_url}
                      alt="Company logo preview"
                      className="max-h-12 max-w-[200px] object-contain"
                      data-testid="img-logo-preview"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    disabled={uploading}
                    onClick={() => document.getElementById("logo-upload")?.click()}
                    data-testid="button-upload-logo"
                  >
                    {uploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    Upload Logo
                  </Button>
                  <input
                    id="logo-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  {branding.logo_url && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleChange("logo_url", "")}
                      data-testid="button-remove-logo"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                PNG, JPG, or SVG. Max 2MB. Recommended: 200x50px.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Image className="h-4 w-4 text-muted-foreground" />
                Logo URL
              </Label>
              <Input
                value={branding.logo_url}
                onChange={(e) => handleChange("logo_url", e.target.value)}
                placeholder="https://example.com/logo.png"
                data-testid="input-logo-url"
              />
              <p className="text-xs text-muted-foreground">
                Or paste a direct URL to your logo image.
              </p>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="company_address" className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Company Address
              </Label>
              <Textarea
                id="company_address"
                value={branding.company_address}
                onChange={(e) => handleChange("company_address", e.target.value)}
                placeholder="123 Main Street&#10;Suite 100&#10;City, State ZIP"
                rows={3}
                data-testid="input-company-address"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company_phone" className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                Company Phone
              </Label>
              <Input
                id="company_phone"
                type="tel"
                value={branding.company_phone}
                onChange={(e) => handleChange("company_phone", e.target.value)}
                placeholder="(555) 123-4567"
                data-testid="input-company-phone"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="company_email" className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Company Email
              </Label>
              <Input
                id="company_email"
                type="email"
                value={branding.company_email}
                onChange={(e) => handleChange("company_email", e.target.value)}
                placeholder="info@yourcompany.com"
                data-testid="input-company-email"
              />
              {errors.company_email && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.company_email}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="company_website" className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                Company Website
              </Label>
              <Input
                id="company_website"
                type="url"
                value={branding.company_website}
                onChange={(e) => handleChange("company_website", e.target.value)}
                placeholder="https://www.yourcompany.com"
                data-testid="input-company-website"
              />
              {errors.company_website && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.company_website}
                </p>
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="default_signoff" className="flex items-center gap-2">
                <FileSignature className="h-4 w-4 text-muted-foreground" />
                Default Sign-off
              </Label>
              <Input
                id="default_signoff"
                value={branding.default_signoff}
                onChange={(e) => handleChange("default_signoff", e.target.value)}
                placeholder="Respectfully submitted,"
                data-testid="input-default-signoff"
              />
              <p className="text-xs text-muted-foreground">
                Used as the closing line in exported response packages.
              </p>
            </div>

            <Separator />

            <Button
              onClick={handleSave}
              disabled={saving}
              data-testid="button-save-branding"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Branding Settings
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
