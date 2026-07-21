import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import architectureBg from "@/assets/permitpilot-architecture-background.png";
import { motion } from "framer-motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import {
  Calculator,
  Clock,
  Plus,
  Trash2,
  Building2,
  Briefcase,
  LayoutDashboard,
  CreditCard,
  Crown,
  Loader2,
  RefreshCw,
  FolderKanban,
  Database,
} from "lucide-react";
import { format, isValid } from "date-fns";
import { staggerContainer, staggerItem } from "@/components/animations/variants";
import { SUBSCRIPTION_TIERS } from "@/lib/stripe";
import { InspectionsPunchListWidget } from "@/components/dashboard/InspectionsPunchListWidget";
import { DeadlineAlertsWidget } from "@/components/dashboard/DeadlineAlertsWidget";
import { RecentChecklistsWidget } from "@/components/dashboard/RecentChecklistsWidget";
import { AgentWorkflowStatus } from "@/components/dashboard/AgentWorkflowStatus";
import { ProjectHealthCard } from "@/components/dashboard/ProjectHealthCard";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { GettingStartedChecklist } from "@/components/onboarding/GettingStartedChecklist";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useGettingStarted } from "@/hooks/useGettingStarted";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { Eyebrow } from "@/components/ui/Typography";
import { cn } from "@/lib/utils";

/** Light raised card — welcome, projects, deadlines, checklists, calculations.
 * Force cream surface in dark mode so `text-ink-*-light` stays readable (Card defaults otherwise use `dark:bg-card`).
 */
const surfCreamRaised =
  "rounded-2xl border border-cream-sunken bg-cream-raised text-ink-primary-light shadow-cream transition-[box-shadow,border-color] hover:border-gold/25 hover:shadow-[0_12px_36px_-10px_hsl(30_55%_48%/0.16)] dark:border-cream-sunken dark:bg-cream-raised dark:text-ink-primary-light";

const surfGoldSoft =
  "rounded-2xl border border-gold/30 bg-gradient-to-br from-gold-soft/70 via-cream-raised to-cream-raised text-ink-primary-light shadow-cream transition-colors hover:border-gold/45 dark:border-gold/30 dark:bg-gradient-to-br dark:from-gold-soft/65 dark:via-cream-raised dark:to-cream-raised dark:text-ink-primary-light";

/** Blue-gray intelligence surface (Permit Intelligence quick card) — theme-aware */
const surfIntelBlueGray =
  "rounded-2xl border border-border bg-muted/60 text-foreground shadow-sm transition-colors hover:border-teal/40 hover:shadow-md dark:border-[hsl(var(--border-obsidian-strong)/0.42)] dark:bg-gradient-to-br dark:from-obsidian-raised/95 dark:via-obsidian dark:to-obsidian-sunken dark:text-ink-primary-dark dark:shadow-lg dark:shadow-black/20 dark:hover:border-teal/30";

/** Teal-soft light card (Interactive Demos) */
const surfTealSoftLight =
  "rounded-2xl border border-teal/22 bg-teal-soft/55 text-ink-primary-light shadow-cream transition-colors hover:border-teal/40 hover:shadow-md dark:border-teal/25 dark:bg-teal-soft/50 dark:text-ink-primary-light";

/** Pipeline feature shell — uses pipeline-canvas CSS class (theme-aware, defined in index.css) */
const intakePipelineShell = "pipeline-canvas p-6 sm:p-8";

/** Gold outline icon tile — light backgrounds */
const tileGoldAccent =
  "flex shrink-0 items-center justify-center rounded-lg border border-gold/28 bg-gold-soft/90 text-gold-deep shadow-sm transition-colors group-hover:border-gold/42 group-hover:bg-gold-soft";

/** Teal accent tile — dark intel card */
const tileTealOnDark =
  "flex shrink-0 items-center justify-center rounded-lg border border-teal/35 bg-teal/15 text-teal shadow-inner transition-colors group-hover:bg-teal/22";

/** Teal accent tile — teal-soft light card */
const tileTealOnLight =
  "flex shrink-0 items-center justify-center rounded-lg border border-teal/25 bg-teal/12 text-teal transition-colors group-hover:bg-teal/18";

interface SavedCalculation {
  id: string;
  name: string;
  calculation_type: string;
  input_data: unknown;
  results_data: unknown;
  created_at: string;
}

interface Profile {
  full_name: string | null;
  company_name: string | null;
  job_title: string | null;
}

export default function Dashboard() {
  const { user, loading: authLoading, subscription, subscriptionLoading, checkSubscription } = useAuth();
  const { showOnboarding, completeOnboarding } = useOnboarding();
  const { isComplete: gettingStartedComplete } = useGettingStarted();
  const { selectedProjectId } = useSelectedProject();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [calculations, setCalculations] = useState<SavedCalculation[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Handle checkout success
  useEffect(() => {
    if (searchParams.get("checkout") === "success") {
      toast.success("Welcome! Your subscription is now active.");
      checkSubscription();
    }
  }, [searchParams, checkSubscription]);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    
    // Fetch profile
    const { data: profileData } = await supabase
      .from("profiles")
      .select("full_name, company_name, job_title")
      .eq("user_id", user!.id)
      .single();
    
    if (profileData) {
      setProfile(profileData);
    }

    // Fetch saved calculations
    const { data: calcData, error } = await supabase
      .from("saved_calculations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching calculations:", error);
    } else {
      setCalculations(calcData || []);
    }

    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("saved_calculations")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete calculation");
    } else {
      toast.success("Calculation deleted");
      setCalculations(calculations.filter((c) => c.id !== id));
    }
  };

  const getTierDisplayName = () => {
    if (!subscription.tier) return null;
    return SUBSCRIPTION_TIERS[subscription.tier]?.name || subscription.tier;
  };

  const profileFullNameSafe = String(profile?.full_name ?? "");
  const welcomeFirstName = profileFullNameSafe.trim().split(/\s+/).filter(Boolean)[0];

  if (authLoading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <>
      {/* Onboarding Wizard */}
      <OnboardingWizard open={showOnboarding} onComplete={completeOnboarding} />

      <div className="dashboard-editorial-canvas min-w-0">
        <div className="dashboard-editorial-canvas__inner mx-auto w-full max-w-6xl min-w-0 px-4 pb-14 pt-7 sm:px-6 sm:pt-9 sm:pb-16">
          <Card
            className={cn(
              surfCreamRaised,
              "relative mb-8 overflow-hidden border-cream-sunken/95 before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_70%_58%_at_100%_-8%,hsl(var(--accent-gold-soft)/0.5),transparent_58%)] before:opacity-[0.85]",
            )}
          >
            <CardContent className="relative z-[1] p-6 sm:p-7">
              <motion.div
                className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gold/45 bg-cream text-lg font-display font-normal text-ink-primary-light shadow-inner sm:h-14 sm:w-14 sm:text-xl">
                    {(profileFullNameSafe.trim()
                      ? profileFullNameSafe.trim().charAt(0)
                      : "") ||
                      user?.email?.charAt(0)?.toUpperCase() ||
                      "U"}
                  </div>
                  <div className="min-w-0">
                    <Eyebrow className="mb-1 text-muted-foreground">Home</Eyebrow>
                    <h1 className="font-tight text-2xl font-black tracking-tight text-foreground sm:text-3xl">
                      {welcomeFirstName ? (
                        <>
                          Welcome, <span className="text-primary">{welcomeFirstName}</span>!
                        </>
                      ) : (
                        "Welcome!"
                      )}
                    </h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-secondary-light sm:gap-x-3 sm:text-sm">
                      {profile?.job_title && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="h-3 w-3 shrink-0" />
                          {profile.job_title}
                        </span>
                      )}
                      {profile?.company_name && (
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3 shrink-0" />
                          {profile.company_name}
                        </span>
                      )}
                    </div>
                    {selectedProjectId ? (
                      <p className="mt-2 font-mono text-[11px] tabular-nums tracking-tight text-ink-secondary-light sm:text-xs">
                        Active project{" "}
                        <span className="text-ink-primary-light/95">
                          {selectedProjectId.slice(0, 8)}…{selectedProjectId.slice(-4)}
                        </span>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 sm:pt-1">
                  {subscription.subscribed && (
                    <Button
                      variant="outline"
                      asChild
                      className="w-fit shrink-0 rounded-lg border-gold/45 bg-cream-raised px-3.5 text-gold-deep shadow-sm transition-colors hover:border-gold hover:bg-gold hover:text-cream"
                    >
                      <Link to="/pricing">
                        <CreditCard className="mr-2 h-4 w-4" />
                        Manage Billing
                      </Link>
                    </Button>
                  )}
                </div>
              </motion.div>
            </CardContent>
          </Card>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mb-10"
          >
            <div className={intakePipelineShell}>
              {/* Architecture background image */}
              <div
                className="pointer-events-none absolute inset-0 bg-cover bg-right-center bg-no-repeat"
                style={{ backgroundImage: `url(${architectureBg})`, backgroundPosition: "right center" }}
                aria-hidden
              />
              {/* Light-mode overlay: strong cream wash so image is subtle and text stays readable */}
              <div
                className="pointer-events-none absolute inset-0 dark:hidden"
                style={{ background: "linear-gradient(to right, hsl(42 38% 99% / 0.96) 38%, hsl(42 38% 99% / 0.80) 68%, hsl(42 38% 99% / 0.55) 100%)" }}
                aria-hidden
              />
              {/* Dark-mode overlay: deep navy wash, preserves orange image highlights */}
              <div
                className="pointer-events-none absolute inset-0 hidden dark:block"
                style={{ background: "linear-gradient(to right, hsl(219 52% 6% / 0.97) 32%, hsl(219 52% 6% / 0.82) 62%, hsl(219 52% 6% / 0.58) 100%)" }}
                aria-hidden
              />
              {/* Grid overlay — theme-aware */}
              <div
                className="pointer-events-none absolute inset-0 bg-grid-light opacity-[0.6] dark:bg-grid-navy-lines dark:opacity-[0.22]"
                aria-hidden
              />
              {/* Subtle top-right radial glow (dark only) */}
              <div
                className="pointer-events-none absolute inset-0 hidden dark:block bg-[radial-gradient(ellipse_78%_60%_at_68%_-12%,hsl(219_48%_20%/0.45),transparent_58%)]"
                aria-hidden
              />
              <div className="relative">
                <AgentWorkflowStatus />
              </div>
            </div>
          </motion.div>
          {/* Project Health (Step 6) - near/below Portal Monitor */}
          {selectedProjectId && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="mb-8"
            >
              <ProjectHealthCard projectId={selectedProjectId} />
            </motion.div>
          )}

          {/* Subscription Status Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8"
          >
            <Card
              className={cn(
                surfGoldSoft,
                subscription.subscribed
                  ? ""
                  : "border-dashed border-cream-sunken bg-gradient-to-br from-cream-sunken/55 to-cream-raised hover:border-gold/30",
              )}
            >
              <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 sm:p-6">
                <div className="flex items-center gap-4">
                  <div
                    className={cn(
                      "w-12 h-12 rounded-lg flex items-center justify-center border",
                      subscription.subscribed
                        ? "bg-gold-soft/80 border-gold/30 text-gold-deep"
                        : "bg-cream-sunken/80 border-cream-sunken text-ink-tertiary-light",
                    )}
                  >
                    <Crown className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-lg font-normal text-ink-primary-light tracking-tight">
                        {subscription.subscribed ? `${getTierDisplayName()} Plan` : "No Active Subscription"}
                      </h3>
                      {subscription.subscribed && (
                        <Badge className="border border-gold/35 bg-gold/12 text-gold-deep">Active</Badge>
                      )}
                      {subscriptionLoading && (
                        <RefreshCw className="h-4 w-4 animate-spin text-ink-tertiary-light" />
                      )}
                    </div>
                    <p className="text-sm text-ink-secondary-light">
                      {subscription.subscribed && subscription.subscriptionEnd
                        ? (() => {
                            const end = new Date(subscription.subscriptionEnd);
                            return isValid(end)
                              ? `Renews on ${format(end, "MMMM d, yyyy")}`
                              : "Subscription active — renewal date unavailable";
                          })()
                        : "Upgrade to access all features"}
                    </p>
                  </div>
                </div>
                {!subscription.subscribed && (
                  <Button variant="gold" asChild>
                    <Link to="/pricing">View Plans</Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Quick Actions */}
          <motion.div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6 sm:mb-8"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={staggerItem} className="h-full min-h-[120px]">
              <Card
                className={cn(
                  "group h-full min-h-[120px] cursor-pointer rounded-2xl border-cream-sunken bg-cream/95 text-ink-primary-light shadow-cream transition-colors hover:border-gold/35 hover:shadow-lg dark:border-cream-sunken dark:bg-cream dark:text-ink-primary-light",
                )}
                onClick={() => navigate("/projects")}
              >
                <CardContent className="flex h-full items-center gap-3 p-4 sm:gap-4 sm:p-6">
                  <div className={cn("h-12 w-12", tileGoldAccent)}>
                    <FolderKanban className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-normal tracking-tight text-ink-primary-light">
                      Projects
                    </h3>
                    <p className="text-sm text-ink-secondary-light">Manage permits</p>
                  </div>
                  <Plus className="ml-auto h-5 w-5 text-ink-tertiary-light transition-colors group-hover:text-gold-deep" />
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={staggerItem} className="h-full min-h-[120px]">
              <Card
                className={cn(
                  "group h-full min-h-[120px] cursor-pointer",
                  surfIntelBlueGray,
                )}
                onClick={() => navigate("/permit-intelligence")}
              >
                <CardContent className="flex h-full items-center gap-3 p-4 sm:gap-4 sm:p-6">
                  <div className={cn("h-12 w-12", tileTealOnDark)}>
                    <Database className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-normal tracking-tight text-foreground dark:text-ink-primary-dark">
                      Permit Intelligence
                    </h3>
                    <p className="text-sm text-muted-foreground dark:text-ink-secondary-dark">Shovels data</p>
                  </div>
                  <Plus className="ml-auto h-5 w-5 text-muted-foreground dark:text-ink-tertiary-dark transition-colors group-hover:text-teal" />
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={staggerItem} className="h-full min-h-[120px]">
              <Card
                className={cn("group h-full min-h-[120px] cursor-pointer", surfTealSoftLight)}
                onClick={() => navigate("/demos")}
              >
                <CardContent className="flex h-full items-center gap-3 p-4 sm:gap-4 sm:p-6">
                  <div className={cn("h-12 w-12", tileTealOnLight)}>
                    <LayoutDashboard className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-normal tracking-tight text-ink-primary-light">
                      Interactive Demos
                    </h3>
                    <p className="text-sm text-ink-secondary-light">Try our AI tools</p>
                  </div>
                  <Plus className="ml-auto h-5 w-5 text-ink-tertiary-light transition-colors group-hover:text-teal" />
                </CardContent>
              </Card>
            </motion.div>
          </motion.div>

          {/* Getting Started Checklist - Show for new users */}
          {!gettingStartedComplete && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mb-8"
            >
              <GettingStartedChecklist />
            </motion.div>
          )}

          {/* Deadline Alerts & Inspections Row */}
          <div className="grid gap-6 lg:grid-cols-2 mb-8 items-stretch">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="min-h-0"
            >
              <DeadlineAlertsWidget />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="min-h-0"
            >
              <InspectionsPunchListWidget />
            </motion.div>
          </div>

          {/* Recent Checklists Widget */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28 }}
            className="mb-8"
          >
            <RecentChecklistsWidget />
          </motion.div>

          {/* Saved Calculations */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="rounded-2xl border border-cream-sunken/80 bg-gradient-to-br from-cream-sunken/40 via-cream-raised/95 to-cream-raised px-5 py-7 text-ink-primary-light shadow-inner dark:border-cream-sunken/80 dark:from-cream-sunken/45 dark:via-cream-raised dark:to-cream-raised dark:text-ink-primary-light sm:px-7 sm:py-9"
          >
            <div className="flex items-center justify-between mb-6 gap-3">
              <h2 className="font-display text-2xl font-normal text-ink-primary-light tracking-tight">
                Saved Calculations
              </h2>
              <Badge
                variant="secondary"
                className="border border-cream-sunken bg-cream-sunken/60 text-ink-secondary-light"
              >
                {calculations.length} saved
              </Badge>
            </div>

            {loading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className={cn(surfCreamRaised)}>
                    <CardHeader>
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-20 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : calculations.length === 0 ? (
              <Card className="border-dashed border-cream-sunken bg-cream/90 text-ink-primary-light shadow-inner dark:border-cream-sunken dark:bg-cream dark:text-ink-primary-light">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Calculator className="mb-4 h-12 w-12 text-gold/70" />
                  <h3 className="font-display text-lg font-normal text-ink-primary-light mb-2">
                    No saved calculations yet
                  </h3>
                  <p className="text-ink-secondary-light text-sm mb-4">
                    Run an ROI or Consolidation calculation to save your results here
                  </p>
                  <div className="flex gap-2">
                    <Button variant="gold" asChild size="sm">
                      <Link to="/roi-calculator">ROI Calculator</Link>
                    </Button>
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="rounded-lg border-gold/45 bg-cream text-gold-deep transition-colors hover:border-gold hover:bg-gold hover:text-cream"
                    >
                      <Link to="/consolidation-calculator">Consolidation Calculator</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {calculations.map((calc) => (
                  <motion.div
                    key={calc.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    whileHover={{ y: -4 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Card className={cn("h-full transition-colors", surfCreamRaised)}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <Badge
                            className={cn(
                              "border shadow-sm",
                              calc.calculation_type === "roi"
                                ? "border-gold/35 bg-gold text-cream"
                                : "border-teal/28 bg-teal-soft/85 text-teal",
                            )}
                          >
                            {calc.calculation_type === "roi" ? "ROI" : "Consolidation"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-ink-tertiary-light hover:text-destructive"
                            onClick={() => handleDelete(calc.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <CardTitle className="mt-2 text-lg text-ink-primary-light">{calc.name}</CardTitle>
                        <CardDescription className="flex items-center gap-1 text-ink-secondary-light">
                          <Clock className="h-3 w-3" />
                          {(() => {
                            const d = new Date(calc.created_at);
                            return isValid(d) ? format(d, "MMM d, yyyy") : "—";
                          })()}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {calc.calculation_type === "roi" && calc.results_data && (
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-ink-secondary-light">Annual Savings</span>
                              <span className="font-semibold text-success">
                                ${((calc.results_data as { annualSavings?: number }).annualSavings || 0).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-ink-secondary-light">Time Saved</span>
                              <span className="font-semibold text-ink-primary-light">
                                {((calc.results_data as { hoursSaved?: number }).hoursSaved || 0)} hrs/yr
                              </span>
                            </div>
                          </div>
                        )}
                        {calc.calculation_type === "consolidation" && calc.results_data && (
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-ink-secondary-light">Current Cost</span>
                              <span className="font-semibold text-ink-primary-light">
                                ${((calc.results_data as { currentCost?: number }).currentCost || 0).toLocaleString()}/yr
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-ink-secondary-light">With PermitPilot</span>
                              <span className="font-semibold text-success">
                                ${((calc.results_data as { insightCost?: number }).insightCost || 0).toLocaleString()}/yr
                              </span>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </>
  );
}
