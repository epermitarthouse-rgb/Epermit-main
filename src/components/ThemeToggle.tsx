import { Moon, Sun, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/useTheme";
import { motion } from "framer-motion";

// TODO: Product decision needed — mixed Commun-ET theme may replace global light/dark toggle; keep until product confirms editorial-only mode.

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Button variant="ghost" size="icon" className="relative h-9 w-9 p-2 rounded-md text-ink-secondary-light hover:text-ink-primary-light hover:bg-cream-raised focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-offset-0 dark:text-ink-secondary-dark dark:hover:bg-obsidian-raised dark:hover:text-ink-primary-dark dark:focus-visible:ring-teal/40">
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </motion.div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border border-cream-sunken bg-cream-raised text-ink-primary-light shadow-cream dark:border-obsidian-raised dark:bg-obsidian-raised dark:text-ink-primary-dark">
        <DropdownMenuItem onClick={() => setTheme("light")} className="gap-2 cursor-pointer focus:bg-cream-sunken dark:focus:bg-obsidian-sunken">
          <Sun className="h-4 w-4" />
          <span>Light</span>
          {theme === "light" && <span className="ml-auto text-gold font-medium">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")} className="gap-2 cursor-pointer focus:bg-cream-sunken dark:focus:bg-obsidian-sunken">
          <Moon className="h-4 w-4" />
          <span>Dark</span>
          {theme === "dark" && <span className="ml-auto text-gold font-medium">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")} className="gap-2 cursor-pointer focus:bg-cream-sunken dark:focus:bg-obsidian-sunken">
          <Monitor className="h-4 w-4" />
          <span>System</span>
          {theme === "system" && <span className="ml-auto text-gold font-medium">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
