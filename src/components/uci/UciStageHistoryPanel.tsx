import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { listCoordinationCommunications } from "@/lib/uciApi";
import { getCoordinationDocumentRegistry, type UciDocumentRegistryEntry } from "@/lib/uciDocumentRegistry";
import { supabase } from "@/lib/supabase";
import {
  buildUciStageHistory,
  stageHistoryName,
  type UciStageHistoryDocument,
  type UciStageHistoryStage,
} from "@/lib/uciStageHistory";
import type { UciDrawerTab } from "@/lib/uciNavSections";
import type { CoordinationCommunication, UciRecordDetailResponse } from "@/types/uci";
import { cn } from "@/lib/utils";

const STAGE_WORKSPACES: Record<number, { tab: UciDrawerTab; label: string; anchorId?: string }> = {
  1: { tab: "overview", label: "Provider mapping" },
  2: { tab: "load-profile", label: "Load analysis" },
  3: { tab: "application-prep", label: "Application preparation" },
  4: { tab: "applications", label: "Submission" },
  5: { tab: "communications", label: "Communications" },
  6: { tab: "cos", label: "Class of Service review" },
  7: { tab: "costs", label: "Cost tracking" },
  8: { tab: "costs", label: "Equipment tracking", anchorId: "uci-equipment-tracking" },
  9: { tab: "energization-closeout", label: "Pre-energization" },
  10: { tab: "energization-closeout", label: "Closeout" },
};

type UciStageHistoryPanelProps = {
  detail: UciRecordDetailResponse;
  providerName?: string | null;
  selectedStage: number;
  onSelectStage: (stage: number) => void;
  onOpenTools?: (tab: UciDrawerTab, anchorId?: string) => void;
};

export function UciStageHistoryPanel({
  detail,
  providerName,
  selectedStage,
  onSelectStage,
  onOpenTools,
}: UciStageHistoryPanelProps) {
  const recordId = detail.record.id;
  const [documents, setDocuments] = useState<UciDocumentRegistryEntry[] | null>(null);
  const [communications, setCommunications] = useState<CoordinationCommunication[] | null>(null);
  const [documentsUnavailable, setDocumentsUnavailable] = useState(false);
  const [communicationsUnavailable, setCommunicationsUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDocuments(null);
    setCommunications(null);
    setDocumentsUnavailable(false);
    setCommunicationsUnavailable(false);
    void Promise.all([
      getCoordinationDocumentRegistry(recordId)
        .then((response) => response.documents)
        .catch(() => {
          if (!cancelled) setDocumentsUnavailable(true);
          return [] as UciDocumentRegistryEntry[];
        }),
      listCoordinationCommunications(recordId, { limit: 100 })
        .then((response) => response.communications)
        .catch(() => {
          if (!cancelled) setCommunicationsUnavailable(true);
          return null;
        }),
    ]).then(([nextDocuments, nextCommunications]) => {
      if (cancelled) return;
      setDocuments(nextDocuments);
      if (nextCommunications) setCommunications(nextCommunications);
    });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  const model = buildUciStageHistory({
    detail,
    providerName,
    documents,
    communications,
  });
  const stage = model.stages.find((entry) => entry.stage === selectedStage) ?? model.stages[0];
  const savedLabel = model.savedStage
    ? `Stage ${model.savedStage} · ${stageHistoryName(model.savedStage)} · ${model.savedStateLabel}`
    : "Not recorded";

  return (
    <section className="space-y-4" data-testid="uci-stage-history" aria-label="Utility coordination stages">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg tracking-tight text-foreground">Coordination stages</h2>
          <p className="text-sm text-muted-foreground">
            Viewing stage {stage.stage}. Saved progress remains {savedLabel}.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="uci-stage-previous"
            disabled={stage.stage <= 1}
            onClick={() => onSelectStage(stage.stage - 1)}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Previous stage
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="uci-stage-next"
            disabled={stage.stage >= 10}
            onClick={() => onSelectStage(stage.stage + 1)}
          >
            Next stage
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="uci-stage-lifecycle">
        {model.stages.map((entry) => {
          const selected = entry.stage === stage.stage;
          const savedHere = entry.stage === model.savedStage;
          return (
            <li key={entry.stage}>
              <button
                type="button"
                data-testid={`uci-stage-chip-${entry.stage}`}
                aria-pressed={selected}
                onClick={() => onSelectStage(entry.stage)}
                className={cn(
                  "flex h-full min-h-[5.5rem] w-full flex-col items-start gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors",
                  selected
                    ? "border-teal bg-teal text-white"
                    : entry.position === "historical_gap"
                      ? "border-amber-500/50 bg-amber-500/5 hover:bg-amber-500/10"
                      : "border-border/70 bg-background hover:border-teal/40 hover:bg-teal/5",
                  savedHere && !selected && "ring-2 ring-teal/40",
                )}
              >
                <span className="flex w-full items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wide">
                  Stage {entry.stage}
                  {entry.position === "completed" ? <Check className="h-3.5 w-3.5" /> : null}
                  {entry.position === "historical_gap" ? (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  ) : null}
                </span>
                <span className="text-xs font-medium leading-snug">{entry.name}</span>
                <span className={cn("text-[10px]", selected ? "text-white/80" : "text-muted-foreground")}>
                  {savedHere ? `Saved · ${entry.statusLabel}` : entry.statusLabel}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <StageDetail
        stage={stage}
        documentsLoading={documents === null && !documentsUnavailable}
        documentsUnavailable={documentsUnavailable}
        communicationsLoading={communications === null && !communicationsUnavailable}
        communicationsUnavailable={communicationsUnavailable}
        onOpenTools={onOpenTools}
      />
    </section>
  );
}

function StageDetail({
  stage,
  documentsLoading,
  documentsUnavailable,
  communicationsLoading,
  communicationsUnavailable,
  onOpenTools,
}: {
  stage: UciStageHistoryStage;
  documentsLoading: boolean;
  documentsUnavailable: boolean;
  communicationsLoading: boolean;
  communicationsUnavailable: boolean;
  onOpenTools?: (tab: UciDrawerTab, anchorId?: string) => void;
}) {
  const workspace = STAGE_WORKSPACES[stage.stage];
  const highlights = (
    stage.completionEvidence.length
      ? stage.completionEvidence
      : stage.workPerformed.slice(2)
  ).slice(0, 3);
  const milestoneLines = stage.milestones.map((item) =>
    [item.label, item.status, item.actualDate ? shortDate(item.actualDate) : item.targetDate ? `target ${shortDate(item.targetDate)}` : null]
      .filter(Boolean)
      .join(" · "),
  );

  return (
    <div className="space-y-3" data-testid="uci-stage-detail">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
        <article className="rounded-xl border border-border/70 bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Stage {stage.stage} result
          </p>
          <div className="mt-2 flex items-start justify-between gap-3">
            <h3 className="font-display text-xl tracking-tight text-foreground">{stage.name}</h3>
            <span className="shrink-0 rounded-md border border-border/70 px-2 py-1 text-[11px] font-semibold text-foreground">
              {stage.statusLabel}
            </span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground">{stage.workSummary}</p>
          <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="font-medium text-foreground">{stage.startedAt ? shortDate(stage.startedAt) : "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Advanced</dt>
              <dd className="font-medium text-foreground">{stage.advancedAt ? shortDate(stage.advancedAt) : "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Responsible</dt>
              <dd className="font-medium text-foreground">{stage.responsibleParty}</dd>
            </div>
          </dl>
          {onOpenTools && workspace ? (
            <Button
              type="button"
              className="mt-4"
              data-testid="uci-stage-workspace"
              onClick={() => onOpenTools(workspace.tab, workspace.anchorId)}
            >
              Open {workspace.label}
            </Button>
          ) : null}
        </article>

        <article className="rounded-xl border border-border/70 bg-card p-4">
          <h4 className="text-sm font-semibold text-foreground">Key results</h4>
          {highlights.length ? (
            <ul className="mt-2 space-y-2 text-sm text-foreground">
              {highlights.map((item) => (
                <li key={item} className="rounded-md bg-muted/40 px-3 py-2">{item}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{stage.completionMessage}</p>
          )}
          {stage.position === "historical_gap" ? (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{stage.completionMessage}</p>
          ) : null}
        </article>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <DocumentSection
          documents={stage.documents.slice(0, 3)}
          hiddenCount={stage.hiddenDocumentCount + Math.max(0, stage.documents.length - 3)}
          loading={documentsLoading}
          unavailable={documentsUnavailable}
        />
        <CommunicationSection
          stage={{
            ...stage,
            communications: stage.communications.slice(0, 2),
            hiddenCommunicationCount:
              stage.hiddenCommunicationCount + Math.max(0, stage.communications.length - 2),
          }}
          loading={communicationsLoading}
          unavailable={communicationsUnavailable}
        />
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border/70 px-3 py-2 text-sm font-medium text-foreground">
          Record history
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-4 rounded-lg border border-border/70 p-4" data-testid="uci-stage-record-history">
          <StageList title="Work performed" empty="No recorded work is available for this stage." items={stage.workPerformed} />
          <StageList title="Milestones and activities" empty="No milestones are recorded for this stage." items={milestoneLines} />
          <StageList title="Completion evidence" empty={stage.completionMessage} items={stage.completionEvidence} />
          <section className="space-y-1 text-sm">
            <h4 className="font-semibold text-foreground">Transition</h4>
            <p>Next stage: {stage.nextStageName ?? "None"}</p>
            <p>Date: {stage.transitionDate ? shortDate(stage.transitionDate) : "Not recorded"}</p>
            <p>Reason: {stage.transitionReason}{stage.transitionTestRecord ? " · Controlled test record" : ""}</p>
            <p>Recorded by: {stage.transitionTrigger}</p>
            {stage.relatedTransitions.length ? (
              <ul className="list-disc space-y-1 pl-5">
                {stage.relatedTransitions.map((item) => (
                  <li key={item.id}>{item.summary}{item.testRecord ? " · Controlled test record" : ""}</li>
                ))}
              </ul>
            ) : null}
            {stage.hiddenTransitionCount > 0 ? (
              <p className="text-xs text-muted-foreground">{stage.hiddenTransitionCount} more recorded transitions are saved for this stage.</p>
            ) : null}
          </section>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function StageList({ title, empty, items }: { title: string; empty: string; items: string[] }) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

function DocumentSection({
  documents,
  hiddenCount,
  loading,
  unavailable,
}: {
  documents: UciStageHistoryDocument[];
  hiddenCount: number;
  loading: boolean;
  unavailable: boolean;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">Documents and deliverables</h4>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading documents
        </p>
      ) : unavailable ? (
        <p className="text-sm text-muted-foreground">Documents could not be loaded.</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No documents are linked to this stage.</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((document) => (
            <li key={`${document.name}-${document.typeLabel}`} className="rounded-md border border-border/60 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-foreground">
                    {document.name}
                    {document.testRecord ? " · Controlled test file" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {document.typeLabel}
                    {document.date ? ` · ${shortDate(document.date)}` : ""}
                    {` · ${document.sourceLabel}`}
                    {` · ${document.reviewLabel}`}
                  </p>
                  {document.relationshipWarning ? (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      {document.relationshipWarning}
                    </p>
                  ) : null}
                </div>
                {document.downloadPath ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void viewDocument(document.downloadPath as string)}
                  >
                    View
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 ? (
        <p className="text-xs text-muted-foreground">{hiddenCount} more documents are saved for this stage.</p>
      ) : null}
    </section>
  );
}

function CommunicationSection({
  stage,
  loading,
  unavailable,
}: {
  stage: UciStageHistoryStage;
  loading: boolean;
  unavailable: boolean;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">Communications</h4>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading communications
        </p>
      ) : unavailable ? (
        <p className="text-sm text-muted-foreground">Communications could not be loaded.</p>
      ) : stage.communications.length === 0 ? (
        <p className="text-sm text-muted-foreground">No communications are linked to this stage.</p>
      ) : (
        <ul className="space-y-2">
          {stage.communications.map((item) => (
            <li key={item.id} className="rounded-md border border-border/60 px-3 py-2 text-sm">
              <p className="font-medium text-foreground">
                {item.summary}
                {item.testRecord ? " · Controlled test message" : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.direction}
                {item.date ? ` · ${shortDate(item.date)}` : ""}
                {` · ${item.contact}`}
              </p>
              {item.actionItems.length ? (
                <p className="mt-1 text-xs text-foreground">Action items: {item.actionItems.join("; ")}</p>
              ) : null}
              {item.attachments.length ? (
                <p className="mt-1 text-xs text-muted-foreground">Attachments: {item.attachments.join(", ")}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {stage.hiddenCommunicationCount > 0 ? (
        <p className="text-xs text-muted-foreground">
          {stage.hiddenCommunicationCount} more communications are saved for this stage.
        </p>
      ) : null}
    </section>
  );
}

async function viewDocument(path: string) {
  const { data, error } = await supabase.storage.from("project-documents").createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    toast.error("The document could not be opened.");
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function shortDate(value: string | null | undefined): string {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : String(value || "");
}
