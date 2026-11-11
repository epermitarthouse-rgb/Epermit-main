import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { AlertBanner, PageHeader, Panel } from "@/components/design/ProductPrimitives";
import { LocalInspectionBanner } from "@/components/permits/LocalInspectionBanner";
import { DcZipExportButton } from "@/components/permits/PermitExportButtons";
import { PermitListTable } from "@/components/permits/PermitRepositoryViews";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { PERMIT_PAGE_SIZE, loadPermitQueue } from "@/lib/centralPermits";
import {
  DEFAULT_QUEUE_FILTERS,
  filterQueueRows,
  paginate,
  queueSourceOptions,
  type LinkedFilter,
} from "@/lib/permitQueue";

const STATUS_OPTIONS = [
  ["all", "All statuses"],
  ["upload", "Upload"],
  ["in_review", "In Review"],
  ["resubmit", "Resubmit"],
  ["approved", "Approved"],
  ["other", "Other"],
] as const;

const LINKED_OPTIONS: ReadonlyArray<[LinkedFilter, string]> = [
  ["all", "Linked and unlinked"],
  ["linked", "Linked to a project"],
  ["unlinked", "Not linked"],
];

/** Permit Queue list (D-064): the portal dashboard view of every permit the caller may read. */
export default function PermitsPage() {
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const [source, setSource] = useState(DEFAULT_QUEUE_FILTERS.source);
  const [linked, setLinked] = useState<LinkedFilter>(DEFAULT_QUEUE_FILTERS.linked);
  const [page, setPage] = useState(1);

  const result = useQuery({
    queryKey: ["central-permits", "queue", query, status, includeRemoved],
    queryFn: () => loadPermitQueue({ query, status: status === "all" ? null : status, includeRemoved }),
    enabled: !!user,
    placeholderData: keepPreviousData,
  });

  const allRows = useMemo(() => result.data?.rows ?? [], [result.data]);
  const linkCounts = useMemo(() => result.data?.linkCounts ?? new Map<string, number>(), [result.data]);
  const sources = useMemo(() => queueSourceOptions(allRows), [allRows]);
  const filtered = useMemo(() => filterQueueRows(allRows, linkCounts, { source, linked }), [allRows, linkCounts, source, linked]);
  const view = paginate(filtered, page, PERMIT_PAGE_SIZE);

  return (
    <div className="space-y-6">
      <LocalInspectionBanner />
      <PageHeader
        eyebrow="Central permits"
        title="Permit Queue"
        body="Every permit collected from connected portals that you have access to, organised like the portal. Read-only; refreshed by scheduled syncs. No portal login is needed to view."
        action={<DcZipExportButton />}
      />

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(input.trim());
        }}
      >
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Permit #, address, description, department or comment text…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Search permits"
          />
        </div>
        <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-[170px]" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => { setSource(v); setPage(1); }}>
          <SelectTrigger className="w-[220px]" aria-label="Jurisdiction filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jurisdictions</SelectItem>
            {sources.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={linked} onValueChange={(v) => { setLinked(v as LinkedFilter); setPage(1); }} disabled={!!result.data?.linkError}>
          <SelectTrigger className="w-[200px]" aria-label="Project link filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINKED_OPTIONS.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Checkbox id="include-removed" checked={includeRemoved} onCheckedChange={(v) => { setIncludeRemoved(v === true); setPage(1); }} />
          <Label htmlFor="include-removed" className="text-sm">Include permits no longer on the portal</Label>
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {result.error ? (
        <AlertBanner tone="bad" title="Could not load permits" detail={result.error instanceof Error ? result.error.message : String(result.error)} />
      ) : null}
      {result.data?.linkError ? (
        <AlertBanner tone="warn" title="Project links could not be read" detail="The list is shown without the project link filter." />
      ) : null}

      <Panel title="Permits" eyebrow={`${view.total} permit${view.total === 1 ? "" : "s"}`}>
        {result.isLoading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading permits…
          </div>
        ) : (
          <PermitListTable rows={view.rows} linkCounts={result.data?.linkError ? undefined : linkCounts} />
        )}
        {view.pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {view.page} of {view.pages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={view.page <= 1} onClick={() => setPage(view.page - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={view.page >= view.pages} onClick={() => setPage(view.page + 1)}>
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
