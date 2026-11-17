import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { AlertBanner } from "@/components/design/ProductPrimitives";
import { PermitChoiceList } from "@/components/permits/PermitPipelineViews";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PermitListRow } from "@/lib/centralPermits";
import { findExistingPermitLinks, listPermitJurisdictions, searchLinkablePermits } from "@/lib/projectPermits";

const ALL = "__all__";

/**
 * Choose one or more permits this account can see: pick a jurisdiction, then search or browse.
 * Selection is controlled by the parent; nothing is written here.
 */
export function ProjectPermitPicker({
  selected,
  onChange,
  excludeProjectId,
}: {
  selected: PermitListRow[];
  onChange: (rows: PermitListRow[]) => void;
  /** The project being edited, so its own links are not reported as "already linked". */
  excludeProjectId?: string | null;
}) {
  const [jurisdiction, setJurisdiction] = useState<string>(ALL);
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<{ query: string; jurisdiction: string } | null>(null);

  const jurisdictions = useQuery({
    queryKey: ["project-permits", "jurisdictions"],
    queryFn: listPermitJurisdictions,
    staleTime: 5 * 60 * 1000,
  });

  const results = useQuery({
    queryKey: ["project-permits", "search", submitted],
    queryFn: () =>
      searchLinkablePermits({
        query: submitted!.query,
        jurisdiction: submitted!.jurisdiction === ALL ? null : submitted!.jurisdiction,
      }),
    enabled: !!submitted,
  });

  const resultIds = (results.data ?? []).map((r) => r.id);
  const existing = useQuery({
    queryKey: ["project-permits", "existing-links", resultIds],
    queryFn: () => findExistingPermitLinks(resultIds),
    enabled: resultIds.length > 0,
  });

  const selectedIds = new Set(selected.map((r) => r.id));
  const toggle = (row: PermitListRow) =>
    onChange(selectedIds.has(row.id) ? selected.filter((r) => r.id !== row.id) : [...selected, row]);

  const canSearch = draft.trim().length >= 2 || jurisdiction !== ALL;

  return (
    <div className="space-y-3" data-testid="project-permit-picker">
      <div className="flex flex-wrap gap-2">
        <Select value={jurisdiction} onValueChange={setJurisdiction}>
          <SelectTrigger className="w-[200px]" aria-label="Jurisdiction">
            <SelectValue placeholder="Jurisdiction" />
          </SelectTrigger>
          <SelectContent className="z-50 max-h-[260px] border bg-popover shadow-lg">
            <SelectItem value={ALL}>All jurisdictions</SelectItem>
            {(jurisdictions.data ?? []).map((j) => (
              <SelectItem key={j} value={j}>
                {j}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (canSearch) setSubmitted({ query: draft.trim(), jurisdiction });
            }
          }}
          placeholder="Permit number, address or keyword"
          className="min-w-[200px] flex-1"
          aria-label="Search permits"
        />
        <Button type="button" variant="outline" disabled={!canSearch} onClick={() => setSubmitted({ query: draft.trim(), jurisdiction })}>
          {draft.trim() ? "Search" : "Browse"}
        </Button>
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="selected-permits">
          {selected.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs">
              <span className="font-mono font-semibold">{r.permit_number}</span>
              <button type="button" onClick={() => toggle(r)} aria-label={`Remove ${r.permit_number}`} className="text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {results.isLoading ? (
        <p className="text-sm text-muted-foreground">Searching…</p>
      ) : results.error ? (
        <AlertBanner tone="bad" title="Search failed" detail="Please try again." />
      ) : results.data ? (
        <PermitChoiceList
          rows={results.data}
          selectedIds={selectedIds}
          existingLinks={existing.data}
          excludeProjectId={excludeProjectId}
          onToggle={toggle}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Only permits your account can see on the portal are listed.</p>
      )}
    </div>
  );
}
