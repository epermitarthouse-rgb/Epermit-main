import { useEffect, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
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
import { format } from "date-fns";
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
      
      <section className="py-4 sm:py-6 md:py-8 lg:py-12 pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6">
        <div className="max-w-6xl mr-auto ml-0 w-full min-w-0">
          {/* Header */}
          <motion.div
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 sm:mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-bold text-lg sm:text-xl">
                {profile?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold truncate">
                  Welcome{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}!
                </h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-muted-foreground text-xs sm:text-sm">
                  {profile?.job_title && (
                    <span className="flex items-center gap-1">
                      <Briefcase className="h-3 w-3" />
                      {profile.job_title}
                    </span>
                  )}
                  {profile?.company_name && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {profile.company_name}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {subscription.subscribed && (
                <Button variant="outline" asChild>
                  <Link to="/pricing">
                    <CreditCard className="mr-2 h-4 w-4" />
                    Manage Billing
                  </Link>
                </Button>
              )}
            </div>
          </motion.div>

          {/* Agent Workflow Status (Intake Pipeline) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mb-8"
          >
            <AgentWorkflowStatus />
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
            <Card className={subscription.subscribed ? "border-accent/50 bg-accent/5" : "border-dashed"}>
              <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 sm:p-6">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                    subscription.subscribed ? "bg-accent/20 text-accent" : "bg-muted text-muted-foreground"
                  }`}>
                    <Crown className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">
                        {subscription.subscribed ? `${getTierDisplayName()} Plan` : "No Active Subscription"}
                      </h3>
                      {subscription.subscribed && (
                        <Badge className="bg-accent text-accent-foreground">Active</Badge>
                      )}
                      {subscriptionLoading && (
                        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {subscription.subscribed && subscription.subscriptionEnd
                        ? `Renews on ${format(new Date(subscription.subscriptionEnd), "MMMM d, yyyy")}`
                        : "Upgrade to access all features"}
                    </p>
                  </div>
                </div>
                {!subscription.subscribed && (
                  <Button asChild className="bg-accent hover:bg-accent/90">
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
              <Card className="h-full min-h-[120px] hover:border-accent/50 transition-colors cursor-pointer group border-accent/30 bg-accent/5" onClick={() => navigate("/projects")}>
                <CardContent className="flex items-center gap-3 sm:gap-4 p-4 sm:p-6 h-full">
                  <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center group-hover:bg-accent/30 transition-colors">
                    <FolderKanban className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Projects</h3>
                    <p className="text-sm text-muted-foreground">Manage permits</p>
                  </div>
                  <Plus className="ml-auto h-5 w-5 text-muted-foreground group-hover:text-accent transition-colors" />
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={staggerItem} className="h-full min-h-[120px]">
              <Card className="h-full min-h-[120px] hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => navigate("/permit-intelligence")}>
                <CardContent className="flex items-center gap-3 sm:gap-4 p-4 sm:p-6 h-full">
                  <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
                    <Database className="h-6 w-6 text-orange-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Permit Intelligence</h3>
                    <p className="text-sm text-muted-foreground">Shovels data</p>
                  </div>
                  <Plus className="ml-auto h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={staggerItem} className="h-full min-h-[120px]">
              <Card className="h-full min-h-[120px] hover:border-primary/50 transition-colors cursor-pointer group" onClick={() => navigate("/demos")}>
                <CardContent className="flex items-center gap-3 sm:gap-4 p-4 sm:p-6 h-full">
                  <div className="w-12 h-12 rounded-lg bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/20 transition-colors">
                    <LayoutDashboard className="h-6 w-6 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold">Interactive Demos</h3>
                    <p className="text-sm text-muted-foreground">Try our AI tools</p>
                  </div>
                  <Plus className="ml-auto h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
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
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">Saved Calculations</h2>
              <Badge variant="secondary">{calculations.length} saved</Badge>
            </div>

            {loading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
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
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Calculator className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="font-semibold mb-2">No saved calculations yet</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Run an ROI or Consolidation calculation to save your results here
                  </p>
                  <div className="flex gap-2">
                    <Button asChild size="sm">
                      <Link to="/roi-calculator">ROI Calculator</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
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
                    <Card className="h-full hover:border-primary/30 transition-colors">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <Badge variant={calc.calculation_type === "roi" ? "default" : "secondary"}>
                            {calc.calculation_type === "roi" ? "ROI" : "Consolidation"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(calc.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <CardTitle className="text-lg mt-2">{calc.name}</CardTitle>
                        <CardDescription className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(calc.created_at), "MMM d, yyyy")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        {calc.calculation_type === "roi" && calc.results_data && (
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Annual Savings</span>
                              <span className="font-semibold text-emerald-600">
                                ${((calc.results_data as { annualSavings?: number }).annualSavings || 0).toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Time Saved</span>
                              <span className="font-semibold">
                                {((calc.results_data as { hoursSaved?: number }).hoursSaved || 0)} hrs/yr
                              </span>
                            </div>
                          </div>
                        )}
                        {calc.calculation_type === "consolidation" && calc.results_data && (
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Current Cost</span>
                              <span className="font-semibold">
                                ${((calc.results_data as { currentCost?: number }).currentCost || 0).toLocaleString()}/yr
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">With Insight</span>
                              <span className="font-semibold text-emerald-600">
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
      </section>
    </>
  );
}
