import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { format, isValid } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Brain,
  Calculator,
  Clock,
  CreditCard,
  Crown,
  FileUp,
  FolderKanban,
  Loader2,
  PlusCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertBanner,
  PageHeader,
  ServicePill,
  StatusPill,
} from "@/components/design/ProductPrimitives";
import { AgentWorkflowStatus } from "@/components/dashboard/AgentWorkflowStatus";
import { DeadlineAlertsWidget } from "@/components/dashboard/DeadlineAlertsWidget";
import { InspectionsPunchListWidget } from "@/components/dashboard/InspectionsPunchListWidget";
import { ProjectHealthCard } from "@/components/dashboard/ProjectHealthCard";
import { RecentChecklistsWidget } from "@/components/dashboard/RecentChecklistsWidget";
import { GettingStartedChecklist } from "@/components/onboarding/GettingStartedChecklist";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useAuth } from "@/hooks/useAuth";
import { useGettingStarted } from "@/hooks/useGettingStarted";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useProjects } from "@/hooks/useProjects";
import { useSelectedProject } from "@/contexts/SelectedProjectContext";
import { supabase } from "@/lib/supabase";
import { SUBSCRIPTION_TIERS } from "@/lib/stripe";
import { PROJECT_STATUS_CONFIG, type Project } from "@/types/project";
import { cn } from "@/lib/utils";

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

function statusTone(status: Project["status"]): "default" | "good" | "warn" | "bad" {
  if (status === "approved") return "good";
  if (status === "corrections") return "bad";
  if (status === "in_review" || status === "submitted") return "warn";
  return "default";
}

export default function Dashboard() {
  const { user, loading: authLoading, subscription, subscriptionLoading, checkSubscription } =
    useAuth();
  const { showOnboarding, completeOnboarding } = useOnboarding();
  const { isComplete: gettingStartedComplete } = useGettingStarted();
  const { selectedProjectId, setSelectedProjectId } = useSelectedProject();
  const { projects, loading: projectsLoading } = useProjects();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [calculations, setCalculations] = useState<SavedCalculation[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
      void fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    setLoading(true);

    const { data: profileData } = await supabase
      .from("profiles")
      .select("full_name, company_name, job_title")
      .eq("user_id", user!.id)
      .single();

    if (profileData) setProfile(profileData);

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
    const { error } = await supabase.from("saved_calculations").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete calculation");
    } else {
      toast.success("Calculation deleted");
      setCalculations((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const getTierDisplayName = () => {
    if (!subscription.tier) return null;
    return SUBSCRIPTION_TIERS[subscription.tier]?.name || subscription.tier;
  };

  const welcomeFirstName = String(profile?.full_name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];

  const kpis = useMemo(() => {
    const active = projects.filter((p) => p.status !== "approved");
    const corrections = projects.filter((p) => p.status === "corrections");
    const inReview = projects.filter((p) => p.status === "in_review" || p.status === "submitted");
    const withPortal = projects.filter((p) => !!p.portal_status || !!p.portal_data);
    return [
      {
        value: String(active.length),
        label: "Active Projects",
        accent: "bg-primary/10",
      },
      {
        value: String(inReview.length),
        label: "In Review / Submitted",
        accent: "bg-[hsl(var(--pilot-cyan)/0.12)]",
      },
      {
        value: String(withPortal.length),
        label: "Portal-linked",
        accent: "bg-[hsl(var(--pilot-teal)/0.12)]",
      },
      {
        value: String(corrections.length),
        label: "Corrections Needed",
        accent: "bg-destructive/10",
        tone: "bad" as const,
      },
    ];
  }, [projects]);

  const portfolio = useMemo(
    () =>
      [...projects]
        .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
        .slice(0, 8),
    [projects],
  );

  if (authLoading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <OnboardingWizard open={showOnboarding} onComplete={completeOnboarding} />

      <div className="space-y-6">
        <PageHeader
          eyebrow="PermitPilot Command"
          title={welcomeFirstName ? `Dashboard · ${welcomeFirstName}` : "Dashboard"}
          body="Overview of active permit expediting and utility coordination work across your portfolio."
          action={
            <>
              <button
                type="button"
                className="pilot-button-ghost"
                onClick={() => navigate("/projects")}
              >
                <PlusCircle className="h-4 w-4 text-primary" /> New Project
              </button>
              <button
                type="button"
                className="pilot-button-ghost"
                onClick={() => navigate("/portal-data")}
              >
                <FileUp className="h-4 w-4 text-primary" /> Portal Harvest
              </button>
              <button
                type="button"
                className="pilot-button-primary"
                onClick={() => navigate("/analytics")}
              >
                <BarChart3 className="h-4 w-4" /> Open Analytics
              </button>
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          <ServicePill kind="permit">Permit expediting</ServicePill>
          <ServicePill kind="utility">Utility coordination</ServicePill>
          {profile?.company_name ? (
            <span className="text-xs text-muted-foreground">{profile.company_name}</span>
          ) : null}
          {profile?.job_title ? (
            <span className="text-xs text-muted-foreground">· {profile.job_title}</span>
          ) : null}
        </div>

        <nav className="flex items-center gap-1 border-b border-border">
          {[
            { to: "/dashboard", label: "Operations", end: true },
            { to: "/uci", label: "Utility Coordination", end: false },
          ].map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "relative px-4 py-3 font-tight text-sm font-semibold transition-colors",
                  isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  isActive &&
                    "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-primary",
                )
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        {/* KPI cards — Lovable composition, PP counts */}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {projectsLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="pilot-card p-6">
                  <Skeleton className="h-12 w-16" />
                  <Skeleton className="mt-3 h-3 w-28" />
                </div>
              ))
            : kpis.map((s) => (
                <article key={s.label} className="pilot-card relative overflow-hidden p-6">
                  <div
                    className={cn(
                      "pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full",
                      s.accent,
                    )}
                  />
                  <div
                    className={cn(
                      "relative font-display text-5xl font-semibold leading-none tracking-tight",
                      s.tone === "bad" ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {s.value}
                  </div>
                  <div className="pilot-kicker relative mt-3">{s.label}</div>
                </article>
              ))}
        </div>

        {!subscription.subscribed && (
          <AlertBanner
            tone="warn"
            title="No active subscription"
            detail={
              <div className="flex flex-wrap items-center gap-3">
                <span>Upgrade to unlock full PermitPilot workflows.</span>
                <Button variant="outline" size="sm" asChild>
                  <Link to="/pricing">View Plans</Link>
                </Button>
              </div>
            }
          />
        )}

        {subscription.subscribed && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-3">
              <Crown className="h-5 w-5 text-primary" />
              <div>
                <p className="font-tight text-sm font-semibold">
                  {getTierDisplayName()} Plan
                  {subscriptionLoading ? (
                    <RefreshCw className="ml-2 inline h-3.5 w-3.5 animate-spin" />
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {subscription.subscriptionEnd && isValid(new Date(subscription.subscriptionEnd))
                    ? `Renews on ${format(new Date(subscription.subscriptionEnd), "MMMM d, yyyy")}`
                    : "Subscription active"}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/pricing">
                <CreditCard className="mr-2 h-4 w-4" />
                Manage Billing
              </Link>
            </Button>
          </div>
        )}

        {/* Portfolio + Intelligence — Lovable 2fr/1fr grid */}
        <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
          <section className="pilot-card overflow-hidden">
            <header className="flex items-center justify-between gap-3 border-b border-border p-5">
              <div className="flex items-center gap-3">
                <h2 className="font-tight text-lg font-bold">Active Projects</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                  {projects.length} total
                </span>
              </div>
              <Link
                to="/projects"
                className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-primary hover:underline"
              >
                View All <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </header>
            <div className="overflow-x-auto">
              {projectsLoading ? (
                <div className="space-y-3 p-5">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : portfolio.length === 0 ? (
                <div className="flex flex-col items-center gap-3 p-10 text-center">
                  <FolderKanban className="h-10 w-10 text-muted-foreground" />
                  <p className="font-tight font-semibold">No projects yet</p>
                  <p className="text-sm text-muted-foreground">
                    Create a project to start tracking permits and portal harvest.
                  </p>
                  <Button onClick={() => navigate("/projects")}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    New Project
                  </Button>
                </div>
              ) : (
                <table className="w-full text-left">
                  <thead className="bg-muted/60">
                    <tr className="pilot-kicker">
                      <th className="px-5 py-3 font-medium">Project</th>
                      <th className="px-5 py-3 font-medium">Jurisdiction</th>
                      <th className="px-5 py-3 font-medium">Permit #</th>
                      <th className="px-5 py-3 font-medium">Status</th>
                      <th className="px-5 py-3 font-medium">Portal</th>
                      <th className="px-5 py-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-sm">
                    {portfolio.map((row) => (
                      <tr
                        key={row.id}
                        className="cursor-pointer transition-colors hover:bg-muted/40"
                        onClick={() => {
                          setSelectedProjectId(row.id);
                          navigate("/projects");
                        }}
                      >
                        <td className="px-5 py-4 font-tight font-semibold text-foreground">
                          {row.name}
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">
                          {row.jurisdiction || "—"}
                        </td>
                        <td className="px-5 py-4 font-mono text-xs tabular-nums text-muted-foreground">
                          {row.permit_number || "—"}
                        </td>
                        <td className="px-5 py-4">
                          <StatusPill tone={statusTone(row.status)}>
                            {PROJECT_STATUS_CONFIG[row.status].label}
                          </StatusPill>
                        </td>
                        <td className="px-5 py-4 text-muted-foreground">
                          {row.portal_status || (row.portal_data ? "Synced" : "—")}
                        </td>
                        <td className="px-5 py-4 font-data text-xs text-muted-foreground">
                          {isValid(new Date(row.updated_at))
                            ? format(new Date(row.updated_at), "MMM d")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="pilot-card flex flex-col">
            <header className="flex items-center justify-between border-b border-border p-5">
              <h2 className="font-tight text-lg font-bold">Intelligence &amp; Alerts</h2>
              <Brain className="h-5 w-5 text-muted-foreground" />
            </header>
            <div className="relative flex-1 space-y-5 p-5">
              <div className="flex gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Quick actions
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to="/portal-data"
                      className="text-[11px] font-bold text-accent hover:underline"
                    >
                      Open Portal Harvest
                    </Link>
                    <span className="text-border">•</span>
                    <Link
                      to="/response-matrix"
                      className="text-[11px] font-bold text-accent hover:underline"
                    >
                      Response Matrix
                    </Link>
                    <span className="text-border">•</span>
                    <Link
                      to="/uci"
                      className="text-[11px] font-bold text-accent hover:underline"
                    >
                      Utility Coordination
                    </Link>
                    <span className="text-border">•</span>
                    <Link
                      to="/permit-wizard-filing"
                      className="text-[11px] font-bold text-accent hover:underline"
                    >
                      Permit Filing
                    </Link>
                  </div>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <DeadlineAlertsWidget />
              </div>
            </div>
          </section>
        </div>

        {!gettingStartedComplete && <GettingStartedChecklist />}

        <div className="pilot-card overflow-hidden p-5">
          <div className="pilot-kicker mb-3">Portal monitor</div>
          <AgentWorkflowStatus />
        </div>

        {selectedProjectId && <ProjectHealthCard projectId={selectedProjectId} />}

        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <InspectionsPunchListWidget />
          <RecentChecklistsWidget />
        </div>

        {/* Saved Calculations — preserved PP feature */}
        <section className="pilot-card p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="font-tight text-lg font-bold">Saved Calculations</h2>
            <Badge variant="secondary">{calculations.length} saved</Badge>
          </div>

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 w-full rounded-lg" />
              ))}
            </div>
          ) : calculations.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
              <Calculator className="h-10 w-10 text-muted-foreground" />
              <p className="font-tight font-semibold">No saved calculations yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Run an ROI or Consolidation calculation to save results here.
              </p>
              <div className="flex gap-2">
                <Button asChild size="sm">
                  <Link to="/roi-calculator">ROI Calculator</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/consolidation-calculator">Consolidation</Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {calculations.map((calc) => (
                <Card key={calc.id} className="border-border bg-card">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <Badge variant="outline">
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
                    <CardTitle className="mt-2 text-base">{calc.name}</CardTitle>
                    <CardDescription className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {isValid(new Date(calc.created_at))
                        ? format(new Date(calc.created_at), "MMM d, yyyy")
                        : "—"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {calc.calculation_type === "roi" && calc.results_data && (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Annual Savings</span>
                          <span className="font-semibold text-success">
                            $
                            {(
                              (calc.results_data as { annualSavings?: number }).annualSavings || 0
                            ).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Time Saved</span>
                          <span className="font-semibold">
                            {(calc.results_data as { hoursSaved?: number }).hoursSaved || 0} hrs/yr
                          </span>
                        </div>
                      </div>
                    )}
                    {calc.calculation_type === "consolidation" && calc.results_data && (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Current Cost</span>
                          <span className="font-semibold">
                            $
                            {(
                              (calc.results_data as { currentCost?: number }).currentCost || 0
                            ).toLocaleString()}
                            /yr
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">With PermitPilot</span>
                          <span className="font-semibold text-success">
                            $
                            {(
                              (calc.results_data as { insightCost?: number }).insightCost || 0
                            ).toLocaleString()}
                            /yr
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
