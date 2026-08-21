import { Link } from "react-router-dom";
import { MoreHorizontal, Plus, Rocket, Search, Sparkles } from "lucide-react";
import { AuthGatedLink } from "@/components/layout/AuthGatedLink";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderOverflowMenuProps {
  onOpenCommand: () => void;
}

/**
 * Narrow authenticated desktop/tablet overflow for secondary header actions.
 * Primary controls remain visible; this catches items that do not fit.
 */
export function HeaderOverflowMenu({ onOpenCommand }: HeaderOverflowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 border-border lg:hidden"
          aria-label="More actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-50 w-52">
        <DropdownMenuItem onSelect={onOpenCommand} className="cursor-pointer gap-2 lg:hidden">
          <Search className="h-4 w-4" />
          Search navigation
        </DropdownMenuItem>
        <DropdownMenuSeparator className="lg:hidden" />
        <DropdownMenuItem asChild className="cursor-pointer gap-2 lg:hidden">
          <AuthGatedLink to="/projects/new">
            <Plus className="h-4 w-4" />
            New Project
          </AuthGatedLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer gap-2 lg:hidden">
          <AuthGatedLink to="/permit-wizard-filing">
            <Rocket className="h-4 w-4" />
            Start Filing
          </AuthGatedLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer gap-2 sm:hidden">
          <Link to="/demo/mcdonalds">
            <Sparkles className="h-4 w-4" />
            Request Demo
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
