import { Inbox, LucideIcon } from "lucide-react";

/**
 * Shared loading + empty-state primitives used by every /uci/* surface.
 * Keeps the "no data yet" and "data loading" experiences visually consistent
 * across the Utility Coordination Intelligence pages.
 */

type UciLoadingProps = {
  kicker: string;
  title: string;
  description?: string;
  rows?: number;
};

export const UciLoading = ({ kicker, title, description, rows = 4 }: UciLoadingProps) => (
  <div className="space-y-6 pb-12" aria-busy="true" aria-live="polite">
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="pilot-kicker text-primary">{kicker}</div>
        <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
    </header>

    <div className="pilot-card flex items-center gap-3 p-3">
      <div className="h-8 flex-1 animate-pulse rounded-md bg-muted/50" />
      <div className="h-8 w-32 animate-pulse rounded-md bg-muted/50" />
      <div className="h-8 w-32 animate-pulse rounded-md bg-muted/50" />
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="pilot-card p-5">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
          <div className="mt-3 h-7 w-16 animate-pulse rounded bg-muted/60" />
          <div className="mt-2 h-3 w-32 animate-pulse rounded bg-muted/40" />
        </div>
      ))}
    </div>

    <div className="pilot-card divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="p-5">
          <div className="flex items-center justify-between">
            <div className="h-4 w-48 animate-pulse rounded bg-muted/50" />
            <div className="h-4 w-24 animate-pulse rounded bg-muted/40" />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="h-3 animate-pulse rounded bg-muted/40" />
            <div className="h-3 animate-pulse rounded bg-muted/40" />
            <div className="h-3 animate-pulse rounded bg-muted/40" />
          </div>
        </div>
      ))}
    </div>

    <span className="sr-only">Loading utility coordination data…</span>
  </div>
);

type UciEmptyProps = {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  onClear?: () => void;
  compact?: boolean;
  className?: string;
};

export const UciEmpty = ({
  title = "No results",
  description = "Adjust your search or clear filters to see more.",
  icon: Icon = Inbox,
  onClear,
  compact = false,
  className = "",
}: UciEmptyProps) => (
  <div
    className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? "py-6" : "py-10"} ${className}`}
    role="status"
  >
    <div className="rounded-full border border-border bg-muted/30 p-3">
      <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
    </div>
    <div className="font-tight text-sm font-bold text-foreground">{title}</div>
    <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
    {onClear && (
      <button
        onClick={onClear}
        className="mt-1 text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
      >
        Clear filters
      </button>
    )}
  </div>
);

/** Table-cell empty state; renders one <tr> spanning all columns. */
export const UciEmptyRow = ({
  colSpan,
  onClear,
  title,
  description,
}: {
  colSpan: number;
  onClear?: () => void;
  title?: string;
  description?: string;
}) => (
  <tr>
    <td colSpan={colSpan} className="px-5 py-8">
      <UciEmpty compact title={title} description={description} onClear={onClear} />
    </td>
  </tr>
);