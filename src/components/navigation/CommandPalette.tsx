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
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

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
  { name: "AI Compliance", href: "/code-compliance", icon: Shield, keywords: ["compliance", "check", "ai", "code"] },
  { name: "Response Matrix", href: "/response-matrix", icon: Table2, keywords: ["response", "matrix", "comments", "responses"] },
  { name: "Code Library", href: "/code-reference", icon: BookOpen, keywords: ["library", "reference", "codes"] },
  { name: "ROI Calculator", href: "/roi-calculator", icon: Calculator, keywords: ["roi", "calculator", "savings"] },
];

const jurisdictionItems = [
  { name: "Jurisdiction Map", href: "/jurisdictions/map", icon: Map, keywords: ["map", "coverage", "jurisdictions"] },
  { name: "Compare Jurisdictions", href: "/jurisdictions/compare", icon: Scale, keywords: ["compare", "comparison", "side by side"] },
  { name: "Permit Intelligence", href: "/permit-intelligence", icon: Search, keywords: ["search", "permits", "intelligence"] },
];

const resourceItems = [
  { name: "Demos", href: "/demos", icon: PlayCircle, keywords: ["demos", "examples", "videos"] },
  { name: "Pricing", href: "/pricing", icon: DollarSign, keywords: ["pricing", "plans", "cost"] },
  { name: "FAQ", href: "/faq", icon: HelpCircle, keywords: ["faq", "questions", "help"] },
  { name: "Documentation", href: "/api-documentation", icon: FileQuestion, keywords: ["docs", "api", "documentation"] },
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

  const filterItems = (items: typeof navigationItems) => {
    return items.filter(item => !item.requiresAuth || user);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          {filterItems(navigationItems).map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={item.name + " " + item.keywords.join(" ")}
                onSelect={() => runCommand(() => navigate(item.href))}
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
                onSelect={() => runCommand(() => navigate(item.href))}
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
                onSelect={() => runCommand(() => navigate(item.href))}
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
                onSelect={() => runCommand(() => navigate(item.href))}
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
          {filterItems(settingsItems).map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={item.name + " " + item.keywords.join(" ")}
                onSelect={() => runCommand(() => navigate(item.href))}
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
