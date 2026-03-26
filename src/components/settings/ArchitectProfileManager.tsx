import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  Stamp,
  Upload,
  Save,
  Loader2,
  X,
  FileImage,
  PenTool,
  AlertCircle,
} from "lucide-react";

interface ArchitectProfile {
  id: string;
  user_id: string;
  seal_image_url: string | null;
  signature_image_url: string | null;
  license_number: string | null;
  license_state: string | null;
  created_at: string;
}

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL",
  "GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI",
  "SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const STORAGE_BUCKET = "project-documents";

export function ArchitectProfileManager() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ArchitectProfile | null>(null);
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseState, setLicenseState] = useState("");
  const [sealPreview, setSealPreview] = useState<string | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [uploadingSeal, setUploadingSeal] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const sealInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  const fetchProfile = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("architect_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setProfile(data as ArchitectProfile);
        setLicenseNumber(data.license_number || "");
        setLicenseState(data.license_state || "");
        if (data.seal_image_url) {
          const url = await getSignedUrl(data.seal_image_url);
          setSealPreview(url);
        }
        if (data.signature_image_url) {
          const url = await getSignedUrl(data.signature_image_url);
          setSignaturePreview(url);
        }
      }
    } catch (err) {
      console.error("Error fetching architect profile:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const getSignedUrl = async (path: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, 3600);
      if (error) throw error;
      return data.signedUrl;
    } catch {
      return null;
    }
  };

  const uploadFile = async (
    file: File,
    type: "seal" | "signature"
  ): Promise<string | null> => {
    if (!user) return null;
    const timestamp = Date.now();
    const ext = file.name.split(".").pop() || "png";
    const filePath = `${user.id}/architect/${type}_${timestamp}.${ext}`;

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, { upsert: true });

    if (error) throw error;
    return filePath;
  };

  const handleSealUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/png", "image/svg+xml", "image/jpeg"];
    if (!validTypes.includes(file.type)) {
      toast.error("Please upload a PNG, SVG, or JPEG image");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File must be less than 5MB");
      return;
    }

    setUploadingSeal(true);
    try {
      const path = await uploadFile(file, "seal");
      if (path) {
        const url = await getSignedUrl(path);
        setSealPreview(url);
        await upsertProfile({ seal_image_url: path });
        toast.success("Seal image uploaded");
      }
    } catch (err) {
      console.error("Seal upload error:", err);
      toast.error("Failed to upload seal image");
    } finally {
      setUploadingSeal(false);
      if (sealInputRef.current) sealInputRef.current.value = "";
    }
  };

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/png", "image/jpeg"];
    if (!validTypes.includes(file.type)) {
      toast.error("Please upload a PNG or JPEG image");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File must be less than 5MB");
      return;
    }

    setUploadingSignature(true);
    try {
      const path = await uploadFile(file, "signature");
      if (path) {
        const url = await getSignedUrl(path);
        setSignaturePreview(url);
        await upsertProfile({ signature_image_url: path });
        toast.success("Signature image uploaded");
      }
    } catch (err) {
      console.error("Signature upload error:", err);
      toast.error("Failed to upload signature image");
    } finally {
      setUploadingSignature(false);
      if (signatureInputRef.current) signatureInputRef.current.value = "";
    }
  };

  const removeSeal = async () => {
    if (profile?.seal_image_url) {
      await supabase.storage.from(STORAGE_BUCKET).remove([profile.seal_image_url]);
    }
    setSealPreview(null);
    await upsertProfile({ seal_image_url: null });
    toast.success("Seal image removed");
  };

  const removeSignature = async () => {
    if (profile?.signature_image_url) {
      await supabase.storage.from(STORAGE_BUCKET).remove([profile.signature_image_url]);
    }
    setSignaturePreview(null);
    await upsertProfile({ signature_image_url: null });
    toast.success("Signature image removed");
  };

  const upsertProfile = async (updates: Record<string, string | null>) => {
    if (!user) return;

    const payload = {
      user_id: user.id,
      ...updates,
    };

    if (profile?.id) {
      const { error } = await supabase
        .from("architect_profiles")
        .update(updates)
        .eq("id", profile.id);
      if (error) throw error;
      setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
    } else {
      const { data, error } = await supabase
        .from("architect_profiles")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      setProfile(data as ArchitectProfile);
    }
  };

  const handleSaveLicenseInfo = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await upsertProfile({
        license_number: licenseNumber.trim() || null,
        license_state: licenseState || null,
      });
      toast.success("License information saved");
    } catch (err) {
      console.error("Save license error:", err);
      toast.error("Failed to save license information");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stamp className="h-5 w-5" />
          Architect Profile
        </CardTitle>
        <CardDescription>
          Upload your architect seal and signature for plan markup approvals and stamped exports
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <FileImage className="h-4 w-4 text-muted-foreground" />
                Architect Seal
              </Label>
              <p className="text-sm text-muted-foreground">
                Upload your official architect seal image (PNG, SVG, or JPEG, max 5MB)
              </p>
              {sealPreview ? (
                <div className="relative inline-block">
                  <div className="border rounded-md p-4 bg-muted/30 inline-flex items-center justify-center">
                    <img
                      src={sealPreview}
                      alt="Architect seal preview"
                      className="max-h-32 max-w-48 object-contain"
                      data-testid="img-seal-preview"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute -top-2 -right-2"
                    onClick={removeSeal}
                    data-testid="button-remove-seal"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div
                  className="border border-dashed rounded-md p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover-elevate"
                  onClick={() => sealInputRef.current?.click()}
                  data-testid="dropzone-seal"
                >
                  {uploadingSeal ? (
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Click to upload seal image
                      </span>
                    </>
                  )}
                </div>
              )}
              <input
                ref={sealInputRef}
                type="file"
                accept="image/png,image/svg+xml,image/jpeg"
                className="hidden"
                onChange={handleSealUpload}
                data-testid="input-seal-upload"
              />
              {sealPreview && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => sealInputRef.current?.click()}
                  disabled={uploadingSeal}
                  data-testid="button-replace-seal"
                >
                  {uploadingSeal ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Replace Seal
                </Button>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <PenTool className="h-4 w-4 text-muted-foreground" />
                Signature
              </Label>
              <p className="text-sm text-muted-foreground">
                Upload your signature image (PNG or JPEG, max 5MB)
              </p>
              {signaturePreview ? (
                <div className="relative inline-block">
                  <div className="border rounded-md p-4 bg-muted/30 inline-flex items-center justify-center">
                    <img
                      src={signaturePreview}
                      alt="Signature preview"
                      className="max-h-24 max-w-48 object-contain"
                      data-testid="img-signature-preview"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute -top-2 -right-2"
                    onClick={removeSignature}
                    data-testid="button-remove-signature"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div
                  className="border border-dashed rounded-md p-6 flex flex-col items-center justify-center gap-2 cursor-pointer hover-elevate"
                  onClick={() => signatureInputRef.current?.click()}
                  data-testid="dropzone-signature"
                >
                  {uploadingSignature ? (
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Click to upload signature image
                      </span>
                    </>
                  )}
                </div>
              )}
              <input
                ref={signatureInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={handleSignatureUpload}
                data-testid="input-signature-upload"
              />
              {signaturePreview && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => signatureInputRef.current?.click()}
                  disabled={uploadingSignature}
                  data-testid="button-replace-signature"
                >
                  {uploadingSignature ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  Replace Signature
                </Button>
              )}
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="license_number" className="flex items-center gap-2">
                  License Number
                </Label>
                <Input
                  id="license_number"
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="e.g., AR-12345"
                  data-testid="input-license-number"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="license_state" className="flex items-center gap-2">
                  License State
                </Label>
                <Select value={licenseState} onValueChange={setLicenseState}>
                  <SelectTrigger data-testid="select-license-state">
                    <SelectValue placeholder="Select state" />
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

            <Separator />

            <Button
              onClick={handleSaveLicenseInfo}
              disabled={saving}
              className="bg-accent"
              data-testid="button-save-architect-profile"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save License Info
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
