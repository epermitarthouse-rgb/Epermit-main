import { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  HelpCircle,
  X,
  FileQuestion,
  MessageSquare,
  BookOpen,
  Search,
  ChevronRight,
  Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface FloatingHelpWidgetProps {
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const quickLinks = [
  {
    title: "Browse FAQ",
    description: "Find answers to common questions",
    href: "/faq",
    icon: FileQuestion,
  },
  {
    title: "Documentation",
    description: "API docs & integration guides",
    href: "/api-documentation",
    icon: BookOpen,
  },
  {
    title: "Contact Support",
    description: "Get help from our team",
    href: "/contact",
    icon: MessageSquare,
  },
];

const popularQuestions = [
  { question: "How do I get started?", href: "/faq?q=get+started" },
  { question: "What jurisdictions do you cover?", href: "/faq?q=jurisdictions+cover" },
  { question: "How does AI compliance work?", href: "/faq?q=ai+compliance" },
];

export function FloatingHelpWidget({ isOpen: controlledOpen, onOpenChange }: FloatingHelpWidgetProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Use controlled state if provided, otherwise use internal state
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = onOpenChange || setInternalOpen;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      window.location.href = `/faq?q=${encodeURIComponent(searchQuery)}`;
      setIsOpen(false);
    }
  };

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-50">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-16 right-0 w-[calc(100vw-2rem)] max-w-80 bg-card border border-border rounded-xl shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="bg-primary px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-primary-foreground">
                <HelpCircle className="h-5 w-5" />
                <span className="font-semibold">Help & Support</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-border">
              <form onSubmit={handleSearch}>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search for help..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </form>
            </div>

            {/* Quick Links */}
            <div className="p-2">
              {quickLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    to={link.href}
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted transition-colors group"
                  >
                    <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{link.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {link.description}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
            </div>

            {/* Popular Questions */}
            <div className="border-t border-border p-3">
              <p className="text-xs font-medium text-muted-foreground mb-2 px-1">
                Popular Questions
              </p>
              <div className="space-y-1">
                {popularQuestions.map((item, index) => (
                  <Link
                    key={index}
                    to={item.href}
                    onClick={() => setIsOpen(false)}
                    className="block text-sm text-foreground hover:text-primary px-2 py-1.5 rounded hover:bg-muted transition-colors"
                  >
                    {item.question}
                  </Link>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-muted/50 px-4 py-2.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Press <kbd className="px-1.5 py-0.5 bg-background rounded border text-[10px] font-mono">?</kbd> to open
                </span>
                <Link
                  to="/contact"
                  onClick={() => setIsOpen(false)}
                  className="text-primary hover:underline font-medium"
                >
                  Contact us
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Button */}
      <motion.button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors",
          isOpen
            ? "bg-muted text-muted-foreground"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        )}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label={isOpen ? "Close help" : "Open help"}
      >
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <X className="h-6 w-6" />
            </motion.div>
          ) : (
            <motion.div
              key="help"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <HelpCircle className="h-6 w-6" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
