import { useState, useMemo } from "react";
import { Layout } from "@/components/layout/Layout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Search, HelpCircle, Zap, CreditCard, Shield, Users, FileText, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const categories = [
  { id: "all", label: "All", icon: HelpCircle },
  { id: "getting-started", label: "Getting Started", icon: Zap },
  { id: "pricing", label: "Pricing & Billing", icon: CreditCard },
  { id: "compliance", label: "Compliance", icon: Shield },
  { id: "jurisdictions", label: "Jurisdictions", icon: FileText },
  { id: "account", label: "Account", icon: Users },
  { id: "technical", label: "Technical", icon: Settings },
];

const faqData: FAQItem[] = [
  // Getting Started
  {
    question: "What is Insight|DesignCheck?",
    answer: "Insight|DesignCheck is a permit intelligence platform that helps architects, engineers, and contractors navigate the building permit process. We provide jurisdiction-specific requirements, AI-powered compliance checking, and tools to streamline your permit submissions.",
    category: "getting-started",
  },
  {
    question: "How do I get started with the platform?",
    answer: "Getting started is easy! Create a free account, complete your profile, and explore our jurisdiction map to find requirements for your project location. You can also try our ROI Calculator to see potential time savings, or run your first compliance check using our AI tools.",
    category: "getting-started",
  },
  {
    question: "Is there a free trial available?",
    answer: "Yes! We offer a free tier that includes access to basic jurisdiction information, limited compliance checks, and our ROI calculator. This allows you to explore the platform and see the value before committing to a paid plan.",
    category: "getting-started",
  },
  {
    question: "What types of projects does the platform support?",
    answer: "We support a wide range of project types including new construction, renovations, additions, tenant improvements, and demolitions. Our database covers residential, commercial, and mixed-use projects across thousands of jurisdictions.",
    category: "getting-started",
  },
  // Pricing & Billing
  {
    question: "What pricing plans are available?",
    answer: "We offer flexible pricing plans to suit different needs: a Free tier for basic access, a Professional plan for individual practitioners, and Enterprise plans for larger firms. Visit our Pricing page for detailed information on features and costs.",
    category: "pricing",
  },
  {
    question: "Can I change my plan at any time?",
    answer: "Yes, you can upgrade or downgrade your plan at any time. Upgrades take effect immediately, while downgrades will apply at the start of your next billing cycle. Any unused credits from your current plan will be prorated.",
    category: "pricing",
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept all major credit cards (Visa, MasterCard, American Express, Discover) and can arrange invoicing for Enterprise customers. All payments are processed securely through Stripe.",
    category: "pricing",
  },
  {
    question: "Do you offer refunds?",
    answer: "We offer a 14-day money-back guarantee for new subscribers. If you're not satisfied with the service within the first 14 days, contact our support team for a full refund.",
    category: "pricing",
  },
  // Compliance
  {
    question: "How does the AI compliance checker work?",
    answer: "Our AI compliance checker analyzes your project details against jurisdiction-specific building codes and requirements. It identifies potential issues, missing documentation, and provides actionable recommendations to help ensure your submission is complete and compliant.",
    category: "compliance",
  },
  {
    question: "How accurate is the compliance analysis?",
    answer: "Our AI is trained on thousands of building codes and permit requirements, achieving high accuracy rates. However, we always recommend reviewing the analysis with a qualified professional, as building codes can be complex and subject to interpretation.",
    category: "compliance",
  },
  {
    question: "Can I upload my own documents for review?",
    answer: "Yes, Professional and Enterprise plans allow you to upload drawings, specifications, and other documents for AI-powered analysis. The system can identify potential compliance issues and suggest corrections.",
    category: "compliance",
  },
  {
    question: "How often is the compliance data updated?",
    answer: "We continuously monitor code changes and update our database regularly. Major code updates are typically reflected within 30 days of adoption. You'll receive notifications about significant changes affecting your saved jurisdictions.",
    category: "compliance",
  },
  // Jurisdictions
  {
    question: "How many jurisdictions do you cover?",
    answer: "We currently cover thousands of jurisdictions across the United States, with a focus on high-volume permitting areas. Our coverage is continuously expanding based on user demand and market research.",
    category: "jurisdictions",
  },
  {
    question: "What information is available for each jurisdiction?",
    answer: "For each jurisdiction, we provide contact information, submission requirements, accepted file formats, fee schedules, typical review timelines, special requirements, and direct links to official resources. The depth of information varies by jurisdiction.",
    category: "jurisdictions",
  },
  {
    question: "Can I request coverage for a jurisdiction not in your database?",
    answer: "Absolutely! Use our Coverage Request form to let us know which jurisdictions you need. We prioritize additions based on demand and typically add new jurisdictions within 2-4 weeks.",
    category: "jurisdictions",
  },
  {
    question: "How do I compare requirements between jurisdictions?",
    answer: "Use our Jurisdiction Comparison tool to view side-by-side comparisons of fees, timelines, requirements, and submission methods across multiple jurisdictions. This is especially useful for projects spanning multiple areas.",
    category: "jurisdictions",
  },
  // Account
  {
    question: "How do I update my profile information?",
    answer: "Navigate to Settings from the sidebar menu. From there, you can update your personal information, company details, notification preferences, and security settings.",
    category: "account",
  },
  {
    question: "Can I invite team members to my account?",
    answer: "Yes, Professional and Enterprise plans support team collaboration. You can invite team members, assign roles, and manage permissions from your account settings. Team members can share projects and collaborate in real-time.",
    category: "account",
  },
  {
    question: "How do I change my password?",
    answer: "Go to Settings and scroll to the Security section. You'll need to enter your current password and then set a new one. For security, we recommend using a strong, unique password.",
    category: "account",
  },
  {
    question: "What happens to my data if I cancel my subscription?",
    answer: "Your data remains accessible in read-only mode for 90 days after cancellation. You can export your projects and reports during this period. After 90 days, data is permanently deleted unless you reactivate your subscription.",
    category: "account",
  },
  // Technical
  {
    question: "What browsers are supported?",
    answer: "We support the latest versions of Chrome, Firefox, Safari, and Edge. For the best experience, we recommend using Chrome or Firefox. Internet Explorer is not supported.",
    category: "technical",
  },
  {
    question: "Is there a mobile app available?",
    answer: "Our web application is fully responsive and works great on mobile devices. We also offer a Progressive Web App (PWA) that can be installed on your device for offline access and a native-like experience.",
    category: "technical",
  },
  {
    question: "Can I access the platform offline?",
    answer: "Yes, our PWA supports offline access for previously viewed content. You can view cached jurisdiction data, saved checklists, and project information without an internet connection. Changes sync automatically when you're back online.",
    category: "technical",
  },
  {
    question: "Do you offer API access?",
    answer: "Enterprise plans include API access for integrating our jurisdiction data and compliance tools with your existing systems. Contact our sales team for API documentation and pricing.",
    category: "technical",
  },
  {
    question: "How is my data secured?",
    answer: "We take security seriously. All data is encrypted in transit and at rest. We use industry-standard authentication, regular security audits, and comply with SOC 2 Type II requirements. Your project data is never shared with third parties.",
    category: "technical",
  },
];

export default function FAQ() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  const filteredFAQs = useMemo(() => {
    return faqData.filter((faq) => {
      const matchesSearch =
        searchQuery === "" ||
        faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
        faq.answer.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        selectedCategory === "all" || faq.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, selectedCategory]);

  const getCategoryCount = (categoryId: string) => {
    if (categoryId === "all") return faqData.length;
    return faqData.filter((faq) => faq.category === categoryId).length;
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <HelpCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3">
            Frequently Asked Questions
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Find answers to common questions about Insight|DesignCheck. Can't find what you're looking for? Contact our support team.
          </p>
        </div>

        {/* Search */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search questions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Categories */}
        <div className="flex flex-wrap gap-2 mb-6">
          {categories.map((category) => {
            const Icon = category.icon;
            const isSelected = selectedCategory === category.id;
            const count = getCategoryCount(category.id);

            return (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={cn(
                  "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {category.label}
                <Badge
                  variant={isSelected ? "secondary" : "outline"}
                  className="ml-1 h-5 px-1.5 text-xs"
                >
                  {count}
                </Badge>
              </button>
            );
          })}
        </div>

        {/* FAQ List */}
        {filteredFAQs.length > 0 ? (
          <Accordion type="single" collapsible className="space-y-3">
            {filteredFAQs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="border rounded-lg px-4 bg-card"
              >
                <AccordionTrigger className="text-left hover:no-underline py-4">
                  <div className="flex items-start gap-3">
                    <HelpCircle className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <span className="font-medium">{faq.question}</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pb-4 pl-8 text-muted-foreground">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No results found</h3>
              <p className="text-muted-foreground mb-4">
                We couldn't find any questions matching "{searchQuery}".
              </p>
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("all");
                }}
                className="text-primary hover:underline"
              >
                Clear filters
              </button>
            </CardContent>
          </Card>
        )}

        {/* Contact Support CTA */}
        <Card className="mt-8 bg-primary/5 border-primary/20">
          <CardHeader className="text-center">
            <CardTitle>Still have questions?</CardTitle>
            <CardDescription>
              Our support team is here to help you with any questions or issues.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <a
              href="/contact"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Contact Support
            </a>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
