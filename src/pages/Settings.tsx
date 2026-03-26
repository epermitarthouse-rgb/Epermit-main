import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useGettingStarted } from "@/hooks/useGettingStarted";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { z } from "zod";
import {
  User,
  Lock,
  Bell,
  Save,
  Loader2,
  Building2,
  Briefcase,
  Phone,
  Mail,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Trash2,
  Database,
  FileSignature,
  Stamp,
} from "lucide-react";
import { PortalCredentialsManager } from "@/components/settings/PortalCredentialsManager";
import { ArchitectProfileManager } from "@/components/settings/ArchitectProfileManager";
import { ExportBrandingManager } from "@/components/settings/ExportBrandingManager";

// Validation schemas
const profileSchema = z.object({
  full_name: z.string().max(100, "Name must be less than 100 characters").optional(),
  company_name: z.string().max(100, "Company name must be less than 100 characters").optional(),
  job_title: z.string().max(100, "Job title must be less than 100 characters").optional(),
  phone: z.string().max(20, "Phone must be less than 20 characters").optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

interface Profile {
  full_name: string | null;
  company_name: string | null;
  job_title: string | null;
  phone: string | null;
}

interface NotificationPreferences {
  emailDeadlineReminders: boolean;
  emailInspectionReminders: boolean;
  emailProjectUpdates: boolean;
  emailJurisdictionUpdates: boolean;
  inAppNotifications: boolean;
}

const defaultNotificationPrefs: NotificationPreferences = {
  emailDeadlineReminders: true,
  emailInspectionReminders: true,
  emailProjectUpdates: true,
  emailJurisdictionUpdates: false,
  inAppNotifications: true,
};

export default function Settings() {
  const { user, loading: authLoading } = useAuth();
  const { completeItem } = useGettingStarted();
  const navigate = useNavigate();

  // Profile state
  const [profile, setProfile] = useState<Profile>({
    full_name: "",
    company_name: "",
    job_title: "",
    phone: "",
  });
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  // Password state
  const [passwords, setPasswords] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  // Notification preferences state
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(defaultNotificationPrefs);
  const [notificationsSaving, setNotificationsSaving] = useState(false);

  // Clean up data state
  const [removingDuplicates, setRemovingDuplicates] = useState(false);
  const [clearingTestData, setClearingTestData] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  // Fetch profile data
  useEffect(() => {
    if (user) {
      fetchProfile();
      loadNotificationPrefs();
    }
  }, [user]);

  const fetchProfile = async () => {
    setProfileLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, company_name, job_title, phone")
        .eq("user_id", user!.id)
        .single();

      if (error && error.code !== "PGRST116") {
        console.error("Error fetching profile:", error);
      } else if (data) {
        setProfile({
          full_name: data.full_name || "",
          company_name: data.company_name || "",
          job_title: data.job_title || "",
          phone: data.phone || "",
        });
      }
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setProfileLoading(false);
    }
  };

  const loadNotificationPrefs = () => {
    const saved = localStorage.getItem(`notification_prefs_${user?.id}`);
    if (saved) {
      try {
        setNotificationPrefs(JSON.parse(saved));
      } catch {
        setNotificationPrefs(defaultNotificationPrefs);
      }
    }
  };

  const handleProfileChange = (field: keyof Profile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
    setProfileErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleProfileSave = async () => {
    // Validate
    const result = profileSchema.safeParse(profile);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          errors[err.path[0].toString()] = err.message;
        }
      });
      setProfileErrors(errors);
      return;
    }

    setProfileSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({
          user_id: user!.id,
          full_name: profile.full_name || null,
          company_name: profile.company_name || null,
          job_title: profile.job_title || null,
          phone: profile.phone || null,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "user_id",
        });

      if (error) throw error;
      toast.success("Profile updated successfully");
      
      // Mark getting started item as complete if profile has content
      if (profile.full_name || profile.company_name) {
        completeItem('complete_profile');
      }
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("Failed to save profile");
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    // Validate
    const result = passwordSchema.safeParse(passwords);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          errors[err.path[0].toString()] = err.message;
        }
      });
      setPasswordErrors(errors);
      return;
    }

    setPasswordSaving(true);
    setPasswordErrors({});

    try {
      // First verify current password by re-signing in
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user!.email!,
        password: passwords.currentPassword,
      });

      if (signInError) {
        setPasswordErrors({ currentPassword: "Current password is incorrect" });
        setPasswordSaving(false);
        return;
      }

      // Update password
      const { error } = await supabase.auth.updateUser({
        password: passwords.newPassword,
      });

      if (error) throw error;

      toast.success("Password updated successfully");
      setPasswords({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (error: any) {
      console.error("Error changing password:", error);
      toast.error(error.message || "Failed to change password");
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleNotificationToggle = (key: keyof NotificationPreferences) => {
    setNotificationPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleNotificationsSave = () => {
    setNotificationsSaving(true);
    try {
      localStorage.setItem(`notification_prefs_${user?.id}`, JSON.stringify(notificationPrefs));
      toast.success("Notification preferences saved");
    } catch (error) {
      toast.error("Failed to save preferences");
    } finally {
      setNotificationsSaving(false);
    }
  };

  const handleRemoveDuplicateProjects = async () => {
    if (!user?.id) return;
    setRemovingDuplicates(true);
    try {
      const { data: projects, error: fetchError } = await supabase
        .from("projects")
        .select("id, permit_number, last_checked_at")
        .eq("user_id", user.id);

      if (fetchError) throw fetchError;

      const list = (projects ?? []).filter((p) => p.permit_number != null && String(p.permit_number).trim() !== "");
      const byPermit = new Map<string, { id: string; last_checked_at: string | null }[]>();
      for (const p of list) {
        const num = String(p.permit_number).trim();
        if (!byPermit.has(num)) byPermit.set(num, []);
        byPermit.get(num)!.push({
          id: p.id,
          last_checked_at: p.last_checked_at ?? null,
        });
      }

      const toDelete: string[] = [];
      for (const [, arr] of byPermit) {
        if (arr.length <= 1) continue;
        const sorted = [...arr].sort((a, b) => {
          const tA = a.last_checked_at || "";
          const tB = b.last_checked_at || "";
          return tB.localeCompare(tA);
        });
        for (let i = 1; i < sorted.length; i++) {
          toDelete.push(sorted[i].id);
        }
      }

      for (const projectId of toDelete) {
        await supabase.from("parsed_comments").delete().eq("project_id", projectId);
        await supabase.from("projects").delete().eq("id", projectId);
      }

      toast.success(`Removed ${toDelete.length} duplicate projects`);
    } catch (error) {
      console.error("Remove duplicate projects error:", error);
      toast.error("Failed to remove duplicate projects");
    } finally {
      setRemovingDuplicates(false);
    }
  };

  const handleClearTestData = async () => {
    if (!user?.id) return;
    setClearingTestData(true);
    try {
      const { data: deleted, error } = await supabase
        .from("projects")
        .delete()
        .eq("user_id", user.id)
        .is("portal_data", null)
        .is("permit_number", null)
        .select("id");

      if (error) throw error;
      const count = (deleted ?? []).length;
      toast.success(`Removed ${count} empty test projects`);
    } catch (error) {
      console.error("Clear test data error:", error);
      toast.error("Failed to clear test data");
    } finally {
      setClearingTestData(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <>
      <section className="py-4 sm:py-6 md:py-8 lg:py-12">
        <div className="w-full max-w-4xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 lg:pl-6 lg:pr-8">
          {/* Header */}
          <motion.div
            className="mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <User className="h-8 w-8 text-accent" />
              Settings
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage your account settings and preferences
            </p>
          </motion.div>

          {/* Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <Tabs defaultValue="profile" className="space-y-6">
              <TabsList className="grid w-full grid-cols-3 sm:grid-cols-4 lg:grid-cols-7">
                <TabsTrigger value="profile" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  <span className="hidden sm:inline">Profile</span>
                </TabsTrigger>
                <TabsTrigger value="security" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  <span className="hidden sm:inline">Security</span>
                </TabsTrigger>
                <TabsTrigger value="notifications" className="flex items-center gap-2">
                  <Bell className="h-4 w-4" />
                  <span className="hidden sm:inline">Notifications</span>
                </TabsTrigger>
                <TabsTrigger value="portals" className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4" />
                  <span className="hidden sm:inline">Portal Credentials</span>
                </TabsTrigger>
                <TabsTrigger value="architect" className="flex items-center gap-2" data-testid="tab-architect-profile">
                  <Stamp className="h-4 w-4" />
                  <span className="hidden sm:inline">Architect</span>
                </TabsTrigger>
                <TabsTrigger value="branding" className="flex items-center gap-2" data-testid="tab-export-branding">
                  <FileSignature className="h-4 w-4" />
                  <span className="hidden sm:inline">Export Branding</span>
                </TabsTrigger>
                <TabsTrigger value="cleanup" className="flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  <span className="hidden sm:inline">Clean Up Data</span>
                </TabsTrigger>
              </TabsList>

              {/* Profile Tab */}
              <TabsContent value="profile">
                <Card>
                  <CardHeader>
                    <CardTitle>Profile Information</CardTitle>
                    <CardDescription>
                      Update your personal information and company details
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {profileLoading ? (
                      <div className="space-y-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ) : (
                      <>
                        {/* Email (read-only) */}
                        <div className="space-y-2">
                          <Label className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                            Email
                          </Label>
                          <Input
                            value={user?.email || ""}
                            disabled
                            className="bg-muted"
                          />
                          <p className="text-xs text-muted-foreground">
                            Email cannot be changed
                          </p>
                        </div>

                        {/* Full Name */}
                        <div className="space-y-2">
                          <Label htmlFor="full_name" className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            Full Name
                          </Label>
                          <Input
                            id="full_name"
                            value={profile.full_name || ""}
                            onChange={(e) => handleProfileChange("full_name", e.target.value)}
                            placeholder="Enter your full name"
                          />
                          {profileErrors.full_name && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {profileErrors.full_name}
                            </p>
                          )}
                        </div>

                        {/* Company Name */}
                        <div className="space-y-2">
                          <Label htmlFor="company_name" className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            Company Name
                          </Label>
                          <Input
                            id="company_name"
                            value={profile.company_name || ""}
                            onChange={(e) => handleProfileChange("company_name", e.target.value)}
                            placeholder="Enter your company name"
                          />
                          {profileErrors.company_name && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {profileErrors.company_name}
                            </p>
                          )}
                        </div>

                        {/* Job Title */}
                        <div className="space-y-2">
                          <Label htmlFor="job_title" className="flex items-center gap-2">
                            <Briefcase className="h-4 w-4 text-muted-foreground" />
                            Job Title
                          </Label>
                          <Input
                            id="job_title"
                            value={profile.job_title || ""}
                            onChange={(e) => handleProfileChange("job_title", e.target.value)}
                            placeholder="Enter your job title"
                          />
                          {profileErrors.job_title && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {profileErrors.job_title}
                            </p>
                          )}
                        </div>

                        {/* Phone */}
                        <div className="space-y-2">
                          <Label htmlFor="phone" className="flex items-center gap-2">
                            <Phone className="h-4 w-4 text-muted-foreground" />
                            Phone Number
                          </Label>
                          <Input
                            id="phone"
                            type="tel"
                            value={profile.phone || ""}
                            onChange={(e) => handleProfileChange("phone", e.target.value)}
                            placeholder="Enter your phone number"
                          />
                          {profileErrors.phone && (
                            <p className="text-xs text-destructive flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" />
                              {profileErrors.phone}
                            </p>
                          )}
                        </div>

                        <Separator />

                        <Button
                          onClick={handleProfileSave}
                          disabled={profileSaving}
                          className="bg-accent hover:bg-accent/90"
                        >
                          {profileSaving ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Save Changes
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Security Tab */}
              <TabsContent value="security">
                <Card>
                  <CardHeader>
                    <CardTitle>Change Password</CardTitle>
                    <CardDescription>
                      Update your password to keep your account secure
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Current Password */}
                    <div className="space-y-2">
                      <Label htmlFor="currentPassword">Current Password</Label>
                      <div className="relative">
                        <Input
                          id="currentPassword"
                          type={showCurrentPassword ? "text" : "password"}
                          value={passwords.currentPassword}
                          onChange={(e) => {
                            setPasswords((prev) => ({ ...prev, currentPassword: e.target.value }));
                            setPasswordErrors((prev) => ({ ...prev, currentPassword: "" }));
                          }}
                          placeholder="Enter current password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full"
                          onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                        >
                          {showCurrentPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {passwordErrors.currentPassword && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {passwordErrors.currentPassword}
                        </p>
                      )}
                    </div>

                    {/* New Password */}
                    <div className="space-y-2">
                      <Label htmlFor="newPassword">New Password</Label>
                      <div className="relative">
                        <Input
                          id="newPassword"
                          type={showNewPassword ? "text" : "password"}
                          value={passwords.newPassword}
                          onChange={(e) => {
                            setPasswords((prev) => ({ ...prev, newPassword: e.target.value }));
                            setPasswordErrors((prev) => ({ ...prev, newPassword: "" }));
                          }}
                          placeholder="Enter new password"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full"
                          onClick={() => setShowNewPassword(!showNewPassword)}
                        >
                          {showNewPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {passwordErrors.newPassword && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {passwordErrors.newPassword}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Must be at least 8 characters
                      </p>
                    </div>

                    {/* Confirm Password */}
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">Confirm New Password</Label>
                      <Input
                        id="confirmPassword"
                        type="password"
                        value={passwords.confirmPassword}
                        onChange={(e) => {
                          setPasswords((prev) => ({ ...prev, confirmPassword: e.target.value }));
                          setPasswordErrors((prev) => ({ ...prev, confirmPassword: "" }));
                        }}
                        placeholder="Confirm new password"
                      />
                      {passwordErrors.confirmPassword && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" />
                          {passwordErrors.confirmPassword}
                        </p>
                      )}
                    </div>

                    <Separator />

                    <Button
                      onClick={handlePasswordChange}
                      disabled={passwordSaving}
                    >
                      {passwordSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Lock className="mr-2 h-4 w-4" />
                      )}
                      Update Password
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Notifications Tab */}
              <TabsContent value="notifications">
                <Card>
                  <CardHeader>
                    <CardTitle>Notification Preferences</CardTitle>
                    <CardDescription>
                      Choose how you want to be notified about updates
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Email Notifications */}
                    <div>
                      <h4 className="font-medium mb-4">Email Notifications</h4>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="emailDeadlineReminders">Deadline Reminders</Label>
                            <p className="text-sm text-muted-foreground">
                              Receive email reminders before project deadlines
                            </p>
                          </div>
                          <Switch
                            id="emailDeadlineReminders"
                            checked={notificationPrefs.emailDeadlineReminders}
                            onCheckedChange={() => handleNotificationToggle("emailDeadlineReminders")}
                          />
                        </div>

                        <Separator />

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="emailInspectionReminders">Inspection Reminders</Label>
                            <p className="text-sm text-muted-foreground">
                              Get notified about upcoming inspections
                            </p>
                          </div>
                          <Switch
                            id="emailInspectionReminders"
                            checked={notificationPrefs.emailInspectionReminders}
                            onCheckedChange={() => handleNotificationToggle("emailInspectionReminders")}
                          />
                        </div>

                        <Separator />

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="emailProjectUpdates">Project Updates</Label>
                            <p className="text-sm text-muted-foreground">
                              Receive updates when project status changes
                            </p>
                          </div>
                          <Switch
                            id="emailProjectUpdates"
                            checked={notificationPrefs.emailProjectUpdates}
                            onCheckedChange={() => handleNotificationToggle("emailProjectUpdates")}
                          />
                        </div>

                        <Separator />

                        <div className="flex items-center justify-between">
                          <div className="space-y-0.5">
                            <Label htmlFor="emailJurisdictionUpdates">Jurisdiction Updates</Label>
                            <p className="text-sm text-muted-foreground">
                              Get notified about changes in subscribed jurisdictions
                            </p>
                          </div>
                          <Switch
                            id="emailJurisdictionUpdates"
                            checked={notificationPrefs.emailJurisdictionUpdates}
                            onCheckedChange={() => handleNotificationToggle("emailJurisdictionUpdates")}
                          />
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* In-App Notifications */}
                    <div>
                      <h4 className="font-medium mb-4">In-App Notifications</h4>
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label htmlFor="inAppNotifications">Enable In-App Notifications</Label>
                          <p className="text-sm text-muted-foreground">
                            Show notifications within the application
                          </p>
                        </div>
                        <Switch
                          id="inAppNotifications"
                          checked={notificationPrefs.inAppNotifications}
                          onCheckedChange={() => handleNotificationToggle("inAppNotifications")}
                        />
                      </div>
                    </div>

                    <Separator />

                    <Button
                      onClick={handleNotificationsSave}
                      disabled={notificationsSaving}
                      className="bg-accent hover:bg-accent/90"
                    >
                      {notificationsSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Save Preferences
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Portal Credentials Tab */}
              <TabsContent value="portals">
                <PortalCredentialsManager />
              </TabsContent>

              {/* Architect Profile Tab */}
              <TabsContent value="architect">
                <ArchitectProfileManager />
              </TabsContent>

              {/* Export Branding Tab */}
              <TabsContent value="branding">
                <ExportBrandingManager />
              </TabsContent>

              {/* Clean Up Data Tab */}
              <TabsContent value="cleanup">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Trash2 className="h-5 w-5 text-muted-foreground" />
                      Clean Up Data
                    </CardTitle>
                    <CardDescription>
                      Remove duplicate projects or empty test projects for your account
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-2">
                      <Label>Remove Duplicate Projects</Label>
                      <p className="text-sm text-muted-foreground">
                        For each permit number with multiple projects, keeps the most recently checked and deletes the rest (including their comments).
                      </p>
                      <Button
                        variant="outline"
                        onClick={handleRemoveDuplicateProjects}
                        disabled={removingDuplicates}
                      >
                        {removingDuplicates ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Database className="mr-2 h-4 w-4" />
                        )}
                        Remove Duplicate Projects
                      </Button>
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <Label>Clear Test Data</Label>
                      <p className="text-sm text-muted-foreground">
                        Deletes all projects that have no portal data and no permit number (empty test entries).
                      </p>
                      <Button
                        variant="outline"
                        onClick={handleClearTestData}
                        disabled={clearingTestData}
                      >
                        {clearingTestData ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="mr-2 h-4 w-4" />
                        )}
                        Clear Test Data
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        </div>
      </section>
    </>
  );
}
