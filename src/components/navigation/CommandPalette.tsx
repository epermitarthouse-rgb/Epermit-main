import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Home,
  LayoutDashboard,
  Building2,
  Map,
  Scale,
  Shield,
  BookOpen,
  Calculator,
  Search,
  BarChart3,
  FileText,
  PlayCircle,
  DollarSign,
  Mail,
  Settings,
  HelpCircle,
  FileQuestion,
  User,
  Table2,
  Database,
  Inbox,
  Network,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { isPublicShellHref } from "@/lib/authGatedNav";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenHelp: () => void;
}

const navigationItems = [
  { name: "Home", href: "/", icon: Home, keywords: ["home", "main", "landing"] },
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: ["dashboard", "overview"], requiresAuth: true },
  { name: "Projects", href: "/projects", icon: Building2, keywords: ["projects", "permits"], requiresAuth: true },
  { name: "Portal Data", href: "/portal-data", icon: Database, keywords: ["portal", "scraped", "dob", "dc"], requiresAuth: true },
  { name: "Analytics", href: "/analytics", icon: BarChart3, keywords: ["analytics", "reports", "stats"], requiresAuth: true },
];

const toolItems = [
  {
    name: "DesignCheck",
    href: "/designcheck",
    icon: Shield,
    keywords: ["designcheck", "design check", "readiness", "compliance", "presubmittal", "pre-submittal"],
    requiresAuth: true,
  },
  { name: "Code Analyzer", href: "/code-compliance", icon: Shield, keywords: ["compliance", "check", "ai", "code", "analyzer"] },
  {
    name: "Response Matrix",
    href: "/response-matrix",
    icon: Table2,
    keywords: [
      "response",
      "matrix",
      "comments",
      "responses",
      "classified",
      "discipline",
      "draft",
      "approve",
      "export",
    ],
  },
  {
    name: "Comment Review",
    href: "/comment-review",
    icon: FileText,
    keywords: ["comment", "review", "upload", "parse", "letter", "approve rows"],
    requiresAuth: true,
  },
  { name: "Utility Coordination", href: "/uci", icon: Database, keywords: ["uci", "utility", "coordination", "pepco"] },
  { name: "UCI · Load Profile", href: "/uci?section=load-profile", icon: Database, keywords: ["uci", "load", "profile"] },
  { name: "UCI · Application Prep", href: "/uci?section=application-builder", icon: Database, keywords: ["uci", "application", "builder", "prep"] },
  { name: "UCI Builder", href: "/uci/application-builder", icon: Database, keywords: ["uci", "application", "builder", "commercial service"] },
  {
    name: "Reference Library",
    href: "/code-reference",
    icon: BookOpen,
    keywords: ["library", "reference", "codes", "code library"],
  },
  { name: "ROI Calculator", href: "/roi-calculator", icon: Calculator, keywords: ["roi", "calculator", "savings"] },
];

const jurisdictionItems = [
  { name: "Jurisdiction Map", href: "/jurisdictions/map", icon: Map, keywords: ["map", "coverage", "jurisdictions"] },
  { name: "Compare Jurisdictions", href: "/jurisdictions/compare", icon: Scale, keywords: ["compare", "comparison", "side by side"] },
  { name: "Permit Intelligence", href: "/permit-intelligence", icon: Search, keywords: ["search", "permits", "intelligence"] },
];

const resourceItems = [
  {
    name: "Demo",
    href: "/demo/mcdonalds",
    icon: PlayCircle,
    keywords: ["demo", "mcdonalds", "executive", "tour"],
    requiresAuth: true,
  },
  { name: "Demos", href: "/demos", icon: PlayCircle, keywords: ["demos", "examples", "videos"] },
  {
    name: "Client Authorization (LOA)",
    href: "/onboarding/authorization",
    icon: FileText,
    keywords: ["loa", "authorization", "onboarding", "letter", "signature"],
    requiresAuth: true,
  },
  { name: "Checklists", href: "/checklist-history", icon: FileText, keywords: ["checklists", "checklist history"], requiresAuth: true },
  {
    name: "Utility Coverage",
    href: "/reference/utility-coverage",
    icon: Network,
    keywords: ["utility", "coverage", "providers", "coming soon"],
  },
  { name: "Glossary", href: "/reference/glossary", icon: BookOpen, keywords: ["glossary", "terms", "coming soon"], requiresAuth: true },
  {
    name: "Messages",
    href: "/messages",
    icon: Inbox,
    keywords: ["messages", "inbox", "coming soon"],
    requiresAuth: true,
  },
  { name: "Pricing", href: "/pricing", icon: DollarSign, keywords: ["pricing", "plans", "cost"] },
  { name: "FAQ", href: "/faq", icon: HelpCircle, keywords: ["faq", "questions", "help"] },
  { name: "Documentation", href: "/api-docs", icon: FileQuestion, keywords: ["docs", "api", "documentation"] },
  { name: "Permit Queue", href: "/permit-queue", icon: FileText, keywords: ["queue", "filings", "coming soon"], requiresAuth: true },
  { name: "Contact", href: "/contact", icon: Mail, keywords: ["contact", "support", "email"] },
];

const settingsItems = [
  { name: "Settings", href: "/settings", icon: Settings, keywords: ["settings", "profile", "account"], requiresAuth: true },
];

export function CommandPalette({ open, onOpenChange, onOpenHelp }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const runCommand = useCallback((command: () => void) => {
    onOpenChange(false);
    command();
  }, [onOpenChange]);

  // Anonymous visitors still see every command (Lovable pattern); selecting one that
  // requires a session redirects to /auth instead of navigating straight to the route.
  const goTo = useCallback(
    (href: string) => {
      if (!user && !isPublicShellHref(href)) {
        navigate("/auth", { state: { from: { pathname: href } } });
        return;
      }
      navigate(href);
    },
    [user, navigate],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search navigation pages…" />
      <CommandList>
        <CommandEmpty>No navigation matches. Live project/permit search is not connected yet.</CommandEmpty>

        <CommandGroup heading="Pages">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={item.name + " " + item.keywords.join(" ")}
                onSelect={() => runCommand(() => goTo(item.href))}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Tools">
          {toolItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={item.name + " " + item.keywords.join(" ")}
                onSelect={() => runCommand(() => goTo(item.href))}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Jurisdictions">
          {jurisdictionItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={item.name + " " + item.keywords.join(" ")}
                onSelect={() => runCommand(() => goTo(item.href))}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Resources">
          {resourceItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={item.name + " " + item.keywords.join(" ")}
                onSelect={() => runCommand(() => goTo(item.href))}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            value="help support"
            onSelect={() => runCommand(onOpenHelp)}
          >
            <HelpCircle className="mr-2 h-4 w-4" />
            <span>Open Help</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          {settingsItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={item.name + " " + item.keywords.join(" ")}
                onSelect={() => runCommand(() => goTo(item.href))}
              >
                <Icon className="mr-2 h-4 w-4" />
                <span>{item.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
