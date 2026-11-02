import { useLocation, useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { useDemoModePreference } from "@/hooks/useDemoModePreference";
import { isDemoNavHref } from "@/lib/demoModePreference";
import { cn } from "@/lib/utils";

type DemoModeToggleProps = {
  className?: string;
  /** Compact sidebar footer layout */
  compact?: boolean;
  id?: string;
};

/**
 * Turns Demo mode on/off: hides Demo nav + “Dashboard · Demo” labeling when off.
 */
export function DemoModeToggle({ className, compact = false, id = "demo-mode-toggle" }: DemoModeToggleProps) {
  const { enabled, setEnabled } = useDemoModePreference();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const onCheckedChange = (next: boolean) => {
    setEnabled(next);
    if (!next && isDemoNavHref(pathname)) {
      navigate("/dashboard", { replace: true });
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        compact ? "justify-between w-full" : "rounded-md border border-border/60 bg-muted/30 px-3 py-2",
        className,
      )}
      data-testid="demo-mode-toggle"
    >
      <label htmlFor={id} className={cn("cursor-pointer select-none", compact ? "text-xs text-sidebar-foreground" : "text-sm text-foreground")}>
        {compact ? "Demo mode" : enabled ? "Demo mode on" : "Demo mode off"}
      </label>
      <Switch
        id={id}
        checked={enabled}
        onCheckedChange={onCheckedChange}
        aria-label={enabled ? "Turn off Demo mode" : "Turn on Demo mode"}
      />
    </div>
  );
}

export default DemoModeToggle;
