import { ReactNode, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { AppSidebar } from "./AppSidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { FloatingHelpWidget } from "@/components/help/FloatingHelpWidget";
import { CommandPalette } from "@/components/navigation/CommandPalette";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [commandOpen, setCommandOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || 
                       target.tagName === "TEXTAREA" || 
                       target.isContentEditable;

      // Cmd/Ctrl + K for command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }

      // Only handle these shortcuts when not typing
      if (isTyping) return;

      // ? for help
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelpOpen(prev => !prev);
        return;
      }

      // Escape to close panels
      if (e.key === "Escape") {
        if (helpOpen) {
          setHelpOpen(false);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [helpOpen]);

  const handleOpenHelp = useCallback(() => {
    setHelpOpen(true);
  }, []);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <SidebarInset className="flex flex-col flex-1">
          {/* Main Content */}
          <motion.main
            className="flex-1 pb-16 md:pb-0 overflow-x-hidden min-w-0"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {children}
          </motion.main>
          
          
        </SidebarInset>
        
        <MobileBottomNav />
        <FloatingHelpWidget isOpen={helpOpen} onOpenChange={setHelpOpen} />
        <CommandPalette 
          open={commandOpen} 
          onOpenChange={setCommandOpen} 
          onOpenHelp={handleOpenHelp}
        />
      </div>
    </SidebarProvider>
  );
}