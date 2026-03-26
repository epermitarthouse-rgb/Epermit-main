import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, X, Minus, ArrowRight, Zap, Shield, Users, Building2, Loader2, Crown, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { SUBSCRIPTION_TIERS, SubscriptionTier } from "@/lib/stripe";
import { PageTransition } from "@/components/animations/PageTransition";

// Pricing tiers with detailed features
const tiers = [
  {
    name: "Free",
    key: "free" as SubscriptionTier,
    price: "$0",
    period: "",
    description: "Try before you buy",
    teamSize: "Individual",
    icon: <Sparkles className="h-5 w-5" />,
    features: ["1 active permit project", "Basic jurisdiction lookup", "ROI calculator access", "Community support"],
    limitations: ["No code compliance checking", "No document management", "No team collaboration"],
    isFree: true,
  },
  {
    name: "Starter",
    key: "starter" as SubscriptionTier,
    price: "$99",
    period: "/user/mo",
    description: "Perfect for small firms getting started",
    teamSize: "1-10 employees",
    icon: <Zap className="h-5 w-5" />,
    features: [
      "5 active permit projects",
      "Code compliance: IBC + ADA basics",
      "3 jurisdiction coverage",
      "Basic document management",
      "Email support (48hr response)",
    ],
    limitations: ["No pre-submittal detection", "No permit auto-fill", "No API access"],
  },
  {
    name: "Professional",
    key: "professional" as SubscriptionTier,
    price: "$249",
    period: "/user/mo",
    description: "Most popular for growing teams",
    teamSize: "11-50 employees",
    popular: true,
    icon: <Shield className="h-5 w-5" />,
    features: [
      "25 active permit projects",
      "Full code compliance (IBC, IFC, ADA, IRC)",
      "Pre-submittal issue detection",
      "Permit application auto-fill",
      "Unlimited jurisdiction coverage",
      "Inspection scheduling & tracking",
      "Priority support (24hr response)",
    ],
    limitations: ["No custom code libraries", "No API access"],
  },
  {
    name: "Business",
    key: "business" as SubscriptionTier,
    price: "$449",
    period: "/user/mo",
    description: "For large firms and GCs",
    teamSize: "51-200 employees",
    icon: <Building2 className="h-5 w-5" />,
    features: [
      "Unlimited active projects",
      "Custom code libraries",
      "Local amendment database",
      "RFI & change order management",
      "Punch list & closeout tools",
      "Advanced analytics & reporting",
      "API access",
      "Dedicated success manager",
    ],
    limitations: [],
  },
  {
    name: "Enterprise",
    key: "enterprise" as SubscriptionTier,
    price: "$999",
    period: "/user/mo",
    description: "For national & multi-office teams",
    teamSize: "200+ employees",
    icon: <Users className="h-5 w-5" />,
    features: [
      "Everything in Business",
      "SSO & advanced security",
      "Custom jurisdiction integrations",
      "Historical rejection AI training",
      "On-premise deployment option",
      "SLA guarantees",
      "24/7 phone support",
      "Custom onboarding & training",
    ],
    limitations: [],
  },
];

// Competitor comparison data
type FeatureValue = boolean | "partial" | "addon" | string;

interface CompetitorData {
  name: string;
  logo?: string;
  priceRange: string;
  focus: string;
}

interface FeatureCategory {
  name: string;
  features: {
    name: string;
    tooltip?: string;
    insight: FeatureValue;
    bluebeam: FeatureValue;
    procore: FeatureValue;
    plangrid: FeatureValue;
    upcodes: FeatureValue;
    newforma: FeatureValue;
  }[];
}

const competitors: Record<string, CompetitorData> = {
  insight: { name: "Insight|DesignCheck", priceRange: "$99-999/user/mo", focus: "Permit Acceleration" },
  bluebeam: { name: "Bluebeam Revu", priceRange: "$240/user/mo", focus: "PDF Markup" },
  procore: { name: "Procore", priceRange: "$375+/user/mo", focus: "Project Management" },
  plangrid: { name: "PlanGrid", priceRange: "$39/user/mo", focus: "Field Management" },
  upcodes: { name: "UpCodes", priceRange: "$49/user/mo", focus: "Code Research" },
  newforma: { name: "Newforma", priceRange: "$150/user/mo", focus: "Info Management" },
};

const featureCategories: FeatureCategory[] = [
  {
    name: "AI-Powered Compliance",
    features: [
      {
        name: "Automated code compliance checking",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: "partial",
        newforma: false,
      },
      {
        name: "IBC/IFC/IRC code support",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: true,
        newforma: false,
      },
      {
        name: "ADA/Accessibility checking",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: true,
        newforma: false,
      },
      {
        name: "Local amendments database",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: "partial",
        newforma: false,
      },
      {
        name: "AI-powered issue detection",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
      {
        name: "Rejection probability scoring",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
    ],
  },
  {
    name: "Permit Management",
    features: [
      {
        name: "Permit application auto-fill",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
      {
        name: "Jurisdiction requirements lookup",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: "partial",
        newforma: false,
      },
      {
        name: "Fee schedule database",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
      {
        name: "Processing time estimates",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
      {
        name: "Submission checklist generation",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
      {
        name: "Permit status tracking",
        insight: true,
        bluebeam: false,
        procore: "addon",
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
    ],
  },
  {
    name: "Document Management",
    features: [
      {
        name: "Drawing version control",
        insight: true,
        bluebeam: true,
        procore: true,
        plangrid: true,
        upcodes: false,
        newforma: true,
      },
      {
        name: "PDF markup & annotation",
        insight: true,
        bluebeam: true,
        procore: "partial",
        plangrid: true,
        upcodes: false,
        newforma: "partial",
      },
      {
        name: "Cloud storage",
        insight: true,
        bluebeam: "addon",
        procore: true,
        plangrid: true,
        upcodes: false,
        newforma: true,
      },
      {
        name: "Mobile access",
        insight: true,
        bluebeam: "partial",
        procore: true,
        plangrid: true,
        upcodes: true,
        newforma: "partial",
      },
      {
        name: "Submittal management",
        insight: true,
        bluebeam: false,
        procore: true,
        plangrid: "partial",
        upcodes: false,
        newforma: true,
      },
    ],
  },
  {
    name: "Project Coordination",
    features: [
      {
        name: "Inspection scheduling",
        insight: true,
        bluebeam: false,
        procore: "addon",
        plangrid: "partial",
        upcodes: false,
        newforma: false,
      },
      {
        name: "Inspection tracking & results",
        insight: true,
        bluebeam: false,
        procore: "addon",
        plangrid: "partial",
        upcodes: false,
        newforma: false,
      },
      {
        name: "RFI management",
        insight: true,
        bluebeam: false,
        procore: true,
        plangrid: true,
        upcodes: false,
        newforma: true,
      },
      {
        name: "Change order tracking",
        insight: true,
        bluebeam: false,
        procore: true,
        plangrid: false,
        upcodes: false,
        newforma: "partial",
      },
      {
        name: "Punch list & closeout",
        insight: true,
        bluebeam: false,
        procore: true,
        plangrid: true,
        upcodes: false,
        newforma: false,
      },
    ],
  },
  {
    name: "Reporting & Analytics",
    features: [
      {
        name: "Permit timeline analytics",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
      {
        name: "Rejection trend analysis",
        insight: true,
        bluebeam: false,
        procore: false,
        plangrid: false,
        upcodes: false,
        newforma: false,
      },
      {
        name: "Team productivity metrics",
        insight: true,
        bluebeam: false,
        procore: true,
        plangrid: "partial",
        upcodes: false,
        newforma: "partial",
      },
      {
        name: "Custom report builder",
        insight: true,
        bluebeam: false,
        procore: true,
        plangrid: false,
        upcodes: false,
        newforma: true,
      },
      {
        name: "API access",
        insight: true,
        bluebeam: "addon",
        procore: true,
        plangrid: "partial",
        upcodes: false,
        newforma: true,
      },
    ],
  },
];

const FeatureIcon = ({ value }: { value: FeatureValue }) => {
  if (value === true) {
    return <Check className="h-5 w-5 text-accent" />;
  }
  if (value === false) {
    return <X className="h-5 w-5 text-muted-foreground/40" />;
  }
  if (value === "partial") {
    return <Minus className="h-5 w-5 text-amber-500" />;
  }
  if (value === "addon") {
    return <span className="text-xs text-muted-foreground">Add-on</span>;
  }
  return <span className="text-xs text-muted-foreground">{value}</span>;
};

const Pricing = () => {
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "annual">("monthly");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const { user, session, subscription, subscriptionLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Check for checkout canceled status
  useEffect(() => {
    if (searchParams.get("checkout") === "canceled") {
      toast.info("Checkout was canceled. You can try again anytime.");
    }
  }, [searchParams]);

  const getPrice = (tier: (typeof tiers)[0]) => {
    if (tier.key === "enterprise") return "Custom";
    if (tier.key === "free") return "$0";
    const config = SUBSCRIPTION_TIERS[tier.key];
    const price = billingPeriod === "annual" ? config.annualPrice : config.price;
    return `$${price}`;
  };

  const handleSubscribe = async (tierKey: SubscriptionTier) => {
    // Free tier - just navigate to signup
    if (tierKey === "free") {
      if (!user) {
        navigate("/auth");
      } else {
        navigate("/dashboard");
      }
      return;
    }

    if (!user) {
      toast.info("Please sign in to subscribe");
      navigate("/auth");
      return;
    }

    if (tierKey === "enterprise") {
      navigate("/contact");
      return;
    }

    setLoadingTier(tierKey);

    try {
      const priceId = SUBSCRIPTION_TIERS[tierKey].priceId;

      // ✅ FIXED: Only calling this ONCE now
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { priceId },
      });

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, "_blank");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      toast.error("Failed to start checkout. Please try again.");
    } finally {
      setLoadingTier(null);
    }
  };

  const isCurrentPlan = (tierKey: SubscriptionTier) => {
    if (tierKey === "free") {
      return user && !subscription.subscribed;
    }
    return subscription.subscribed && subscription.tier === tierKey;
  };

  const getButtonText = (tier: (typeof tiers)[0]) => {
    if (isCurrentPlan(tier.key)) return "Current Plan";
    if (tier.key === "free") return user ? "Go to Dashboard" : "Get Started Free";
    if (tier.key === "enterprise") return "Contact Sales";
    if (subscription.subscribed) return "Switch Plan";
    return "Start Free Trial";
  };

  return (
    <Layout>
      <PageTransition>
        {/* Hero Section */}
        <div className="bg-primary text-primary-foreground py-16">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">Simple, Transparent Pricing</h1>
            <p className="text-xl text-primary-foreground/80 max-w-2xl mx-auto mb-8">
              One platform to replace multiple tools. Pay for what you need.
            </p>

            {/* Billing Toggle */}
            <div className="inline-flex items-center gap-4 bg-primary-foreground/10 rounded-full p-1">
              <button
                className={cn(
                  "px-6 py-2 rounded-full text-sm font-medium transition-all",
                  billingPeriod === "monthly"
                    ? "bg-accent text-accent-foreground"
                    : "text-primary-foreground/70 hover:text-primary-foreground",
                )}
                onClick={() => setBillingPeriod("monthly")}
              >
                Monthly
              </button>
              <button
                className={cn(
                  "px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2",
                  billingPeriod === "annual"
                    ? "bg-accent text-accent-foreground"
                    : "text-primary-foreground/70 hover:text-primary-foreground",
                )}
                onClick={() => setBillingPeriod("annual")}
              >
                Annual
                <Badge className="bg-primary-foreground/20 text-primary-foreground text-xs">Save 20%</Badge>
              </button>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-16">
          {/* Pricing Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4 mb-20">
            {tiers.map((tier) => (
              <Card
                key={tier.name}
                className={cn(
                  "relative flex flex-col transition-all hover:shadow-lg",
                  tier.popular ? "border-accent border-2 shadow-lg lg:scale-105 z-10" : "",
                  isCurrentPlan(tier.key) ? "ring-2 ring-accent ring-offset-2" : "",
                  (tier as any).isFree ? "border-dashed" : "",
                )}
              >
                {tier.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Badge className="bg-accent text-accent-foreground px-4 py-1">Most Popular</Badge>
                  </div>
                )}
                {isCurrentPlan(tier.key) && (
                  <div className="absolute -top-4 right-4">
                    <Badge className="bg-emerald-500 text-white px-3 py-1 flex items-center gap-1">
                      <Crown className="h-3 w-3" />
                      Your Plan
                    </Badge>
                  </div>
                )}
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-2 rounded-lg bg-accent/10 text-accent">{tier.icon}</div>
                    <CardTitle>{tier.name}</CardTitle>
                  </div>
                  <CardDescription>{tier.description}</CardDescription>
                  <p className="text-xs text-muted-foreground">{tier.teamSize}</p>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{getPrice(tier)}</span>
                    <span className="text-muted-foreground">{tier.period}</span>
                    {billingPeriod === "annual" && tier.key !== "enterprise" && tier.key !== "free" && (
                      <p className="text-sm text-accent mt-1">Billed annually</p>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <ul className="space-y-3 flex-1">
                    {tier.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                    {tier.limitations.map((limitation) => (
                      <li key={limitation} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <X className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{limitation}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className={cn(
                      "w-full mt-6",
                      tier.popular ? "bg-accent hover:bg-accent/90" : "",
                      isCurrentPlan(tier.key) ? "bg-emerald-500 hover:bg-emerald-600" : "",
                    )}
                    variant={tier.popular || isCurrentPlan(tier.key) ? "default" : "outline"}
                    disabled={isCurrentPlan(tier.key) || loadingTier === tier.key || subscriptionLoading}
                    onClick={() => handleSubscribe(tier.key)}
                  >
                    {loadingTier === tier.key ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      getButtonText(tier)
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Competitor Comparison Section */}
          <div className="mb-20">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">How We Compare</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                See how Insight|DesignCheck stacks up against the tools you're currently using
              </p>
            </div>

            {/* Competitor Overview Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-12">
              {Object.entries(competitors).map(([key, comp]) => (
                <Card
                  key={key}
                  className={cn("p-4 text-center", key === "insight" ? "border-accent border-2 bg-accent/5" : "")}
                >
                  <p className={cn("font-semibold text-sm mb-1", key === "insight" && "text-accent")}>{comp.name}</p>
                  <p className="text-xs text-muted-foreground mb-2">{comp.focus}</p>
                  <Badge variant={key === "insight" ? "default" : "secondary"} className="text-xs">
                    {comp.priceRange}
                  </Badge>
                </Card>
              ))}
            </div>

            {/* Detailed Comparison Table */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Feature Comparison</CardTitle>
                <CardDescription>Click on each category to expand and see detailed feature comparisons</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Table Header */}
                <div className="hidden lg:grid lg:grid-cols-7 gap-4 p-4 bg-secondary/50 rounded-t-lg font-medium text-sm">
                  <div className="col-span-1">Feature</div>
                  <div className="text-center text-accent">Insight|DesignCheck</div>
                  <div className="text-center">Bluebeam</div>
                  <div className="text-center">Procore</div>
                  <div className="text-center">PlanGrid</div>
                  <div className="text-center">UpCodes</div>
                  <div className="text-center">Newforma</div>
                </div>

                {/* Feature Categories */}
                <div className="divide-y">
                  {featureCategories.map((category) => (
                    <div key={category.name}>
                      {/* Category Header */}
                      <button
                        className="w-full p-4 flex items-center justify-between hover:bg-secondary/30 transition-colors"
                        onClick={() => setExpandedCategory(expandedCategory === category.name ? null : category.name)}
                      >
                        <span className="font-semibold">{category.name}</span>
                        <div className="flex items-center gap-4">
                          <div className="hidden md:flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">
                              {category.features.filter((f) => f.insight === true).length}/{category.features.length}{" "}
                              features
                            </span>
                            <Badge className="bg-accent text-accent-foreground">Leading</Badge>
                          </div>
                          <ArrowRight
                            className={cn(
                              "h-5 w-5 transition-transform",
                              expandedCategory === category.name && "rotate-90",
                            )}
                          />
                        </div>
                      </button>

                      {/* Expanded Features */}
                      {expandedCategory === category.name && (
                        <div className="animate-fade-in">
                          {category.features.map((feature, idx) => (
                            <div
                              key={feature.name}
                              className={cn(
                                "grid grid-cols-2 lg:grid-cols-7 gap-4 p-4 items-center",
                                idx % 2 === 0 ? "bg-secondary/20" : "",
                              )}
                            >
                              <div className="col-span-2 lg:col-span-1 text-sm font-medium">{feature.name}</div>

                              {/* Mobile View */}
                              <div className="col-span-2 lg:hidden grid grid-cols-3 gap-2 text-center text-sm">
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-xs text-muted-foreground">Insight</span>
                                  <FeatureIcon value={feature.insight} />
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-xs text-muted-foreground">Bluebeam</span>
                                  <FeatureIcon value={feature.bluebeam} />
                                </div>
                                <div className="flex flex-col items-center gap-1">
                                  <span className="text-xs text-muted-foreground">Procore</span>
                                  <FeatureIcon value={feature.procore} />
                                </div>
                              </div>

                              {/* Desktop View */}
                              <div className="hidden lg:flex justify-center">
                                <FeatureIcon value={feature.insight} />
                              </div>
                              <div className="hidden lg:flex justify-center">
                                <FeatureIcon value={feature.bluebeam} />
                              </div>
                              <div className="hidden lg:flex justify-center">
                                <FeatureIcon value={feature.procore} />
                              </div>
                              <div className="hidden lg:flex justify-center">
                                <FeatureIcon value={feature.plangrid} />
                              </div>
                              <div className="hidden lg:flex justify-center">
                                <FeatureIcon value={feature.upcodes} />
                              </div>
                              <div className="hidden lg:flex justify-center">
                                <FeatureIcon value={feature.newforma} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* FAQ Section */}
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Can I switch plans anytime?</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Yes! You can upgrade or downgrade your plan at any time. When upgrading, you'll be prorated for the
                    remaining time. When downgrading, the change takes effect at the next billing cycle.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Is there a free trial?</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Yes, all plans come with a 14-day free trial. No credit card required to start. You'll have full
                    access to all features in your chosen tier during the trial.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">What payment methods do you accept?</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    We accept all major credit cards (Visa, MasterCard, American Express) and can set up invoicing for
                    Enterprise customers. All payments are processed securely through Stripe.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Can I cancel anytime?</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Absolutely. You can cancel your subscription at any time from your account settings. You'll continue
                    to have access until the end of your current billing period.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </PageTransition>
    </Layout>
  );
};

export default Pricing;
