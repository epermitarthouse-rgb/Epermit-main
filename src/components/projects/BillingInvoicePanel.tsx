import { useMemo, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { getScraperBaseUrl } from '@/lib/scraperBaseUrl';
import { fetchProjectCoordinationCosts } from '@/lib/operations/operations-real-data';
import { Project } from '@/types/project';
import type { CoordinationCost } from '@/types/uci';
import { cn } from '@/lib/utils';

export type InvoiceMilestone = 'M1' | 'M2' | 'M3';

const QB_NOT_CONNECTED_COPY =
  'QuickBooks is not connected yet. You can preview invoices now and create draft invoices after credentials are connected.';

const MILESTONE_DEFS: Array<{
  key: InvoiceMilestone;
  pct: number;
  pctLabel: string;
  subtitle: string;
}> = [
  {
    key: 'M1',
    pct: 0.4,
    pctLabel: '40%',
    subtitle: 'Initial / project setup milestone',
  },
  {
    key: 'M2',
    pct: 0.4,
    pctLabel: '40%',
    subtitle: 'Review / progress milestone',
  },
  {
    key: 'M3',
    pct: 0.2,
    pctLabel: '20%',
    subtitle: 'Final / issuance milestone',
  },
];

interface InvoiceTotals {
  baseMilestoneAmount?: number;
  reimbursementAmount?: number;
  adminFeeAmount?: number;
  totalInvoiceAmount?: number;
}

interface InvoiceTriggerSuccessBody {
  dryRun: boolean;
  milestone: string;
  payload?: Record<string, unknown>;
  totals?: InvoiceTotals;
  invoice?: { id?: string };
}

interface BillingInvoicePanelProps {
  project: Project;
  onBillingRefresh?: () => Promise<void>;
}

function displayLine(value: string | null | undefined): string {
  const t = value?.trim();
  return t ? t : '—';
}

function displayDateTime(iso: string | null | undefined): string {
  if (!iso?.trim()) return '—';
  try {
    return format(new Date(iso), 'MMM d, yyyy h:mm a');
  } catch {
    return '—';
  }
}

function roundMoney(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

function parseCustomerRef(payload: Record<string, unknown>): string {
  const ref = payload.CustomerRef;
  if (ref && typeof ref === 'object' && ref !== null && 'value' in ref) {
    return String((ref as { value: unknown }).value ?? '');
  }
  return '—';
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function milestoneState(project: Project, m: InvoiceMilestone) {
  if (m === 'M1') {
    return {
      triggered: Boolean(project.m1_triggered),
      triggeredAt: project.m1_triggered_at,
      triggerSource: project.m1_trigger_source,
      invoiceId: project.qb_invoice_id_m1?.trim?.() || null,
    };
  }
  if (m === 'M2') {
    return {
      triggered: Boolean(project.m2_triggered),
      triggeredAt: project.m2_triggered_at,
      triggerSource: project.m2_trigger_source,
      invoiceId: project.qb_invoice_id_m2?.trim?.() || null,
    };
  }
  return {
    triggered: Boolean(project.m3_triggered),
    triggeredAt: project.m3_triggered_at,
    triggerSource: project.m3_trigger_source,
    invoiceId: project.qb_invoice_id_m3?.trim?.() || null,
  };
}

function billingGateMessage(project: Project): string | null {
  const cv = Number(project.contract_value);
  if (!Number.isFinite(cv) || cv <= 0) {
    return 'Set a contract value greater than zero on the project (Edit Project → Billing).';
  }
  const name = project.client_name?.trim();
  const email = project.client_email?.trim();
  if (!name && !email) {
    return 'Add a client name or client email before triggering invoices.';
  }
  return null;
}

function parseReimbursementInput(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const t = raw.trim();
  if (t === '') return { ok: true, value: 0 };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: 'Reimbursement must be a number ≥ 0.' };
  }
  return { ok: true, value: n };
}

function mapErrorToast(code: string | undefined, message: string): string {
  switch (code) {
    case 'invoice_trigger_validation_failed':
      return message || 'Invoice request could not be validated.';
    case 'invoice_already_triggered':
      return message || 'This milestone invoice was already triggered.';
    case 'quickbooks_not_connected':
      return QB_NOT_CONNECTED_COPY;
    case 'quickbooks_item_missing':
      return message || 'QuickBooks item could not be resolved. Check service type or QB item configuration.';
    case 'invoice_trigger_failed':
      return message || 'Invoice request failed.';
    default:
      return message || 'Something went wrong while contacting the billing service.';
  }
}

async function postInvoiceTrigger(body: Record<string, unknown>): Promise<InvoiceTriggerSuccessBody> {
  const base = getScraperBaseUrl();
  const url = `${base}/api/quickbooks/invoice/trigger`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }

  const obj = data as { error?: string; message?: string };

  if (!res.ok) {
    const err = new Error(obj.message || `Request failed (${res.status})`) as Error & { code?: string };
    err.code = obj.error;
    throw err;
  }

  return data as InvoiceTriggerSuccessBody;
}

export function BillingInvoicePanel({ project, onBillingRefresh }: BillingInvoicePanelProps) {
  const gateMsg = billingGateMessage(project);
  const [utilityInvoices, setUtilityInvoices] = useState<CoordinationCost[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchProjectCoordinationCosts(project.id).then(({ data }) => {
      if (cancelled) return;
      setUtilityInvoices(data.filter((row) => Boolean(row.client_billed_at)));
    });
    return () => {
      cancelled = true;
    };
  }, [project.id, onBillingRefresh]);

  const [modalMilestone, setModalMilestone] = useState<InvoiceMilestone | null>(null);
  const [reimbursementRaw, setReimbursementRaw] = useState('0');
  const [reimbursementDescription, setReimbursementDescription] = useState('');
  const [dryRunOnly, setDryRunOnly] = useState(true);
  const [previewResult, setPreviewResult] = useState<InvoiceTriggerSuccessBody | null>(null);
  const [pendingAction, setPendingAction] = useState<'preview' | 'create' | null>(null);

  const activeDef = useMemo(
    () => MILESTONE_DEFS.find(d => d.key === modalMilestone) ?? null,
    [modalMilestone],
  );

  const contractNum = Number(project.contract_value);
  const contractOk = Number.isFinite(contractNum) && contractNum > 0;

  const reimbursementParsed = parseReimbursementInput(reimbursementRaw);
  const reimbursementAmount = reimbursementParsed.ok ? reimbursementParsed.value : 0;

  const basePreview =
    contractOk && activeDef ? roundMoney(contractNum * activeDef.pct) : 0;
  const adminFeePreview =
    reimbursementAmount > 0 ? roundMoney(reimbursementAmount * 0.15) : 0;
  const totalClientPreview =
    contractOk && activeDef
      ? roundMoney(basePreview + reimbursementAmount + adminFeePreview)
      : 0;

  function openModal(m: InvoiceMilestone) {
    setModalMilestone(m);
    setDryRunOnly(true);
    setPreviewResult(null);
    setReimbursementRaw(
      project.reimbursement_amount != null && Number.isFinite(Number(project.reimbursement_amount))
        ? String(project.reimbursement_amount)
        : '0',
    );
    setReimbursementDescription(project.reimbursement_description?.trim() ?? '');
  }

  function closeModal() {
    setModalMilestone(null);
    setPendingAction(null);
  }

  function validateModalInputs(): { reimbursementAmount: number } | null {
    const parsed = parseReimbursementInput(reimbursementRaw);
    if (!parsed.ok) {
      toast.error(parsed.message);
      return null;
    }
    if (parsed.value > 0 && !reimbursementDescription.trim()) {
      toast.error('Add a reimbursement description when reimbursement is greater than zero.');
      return null;
    }
    return { reimbursementAmount: parsed.value };
  }

  async function runPreview() {
    if (!modalMilestone) return;
    const v = validateModalInputs();
    if (!v) return;

    setPendingAction('preview');
    try {
      const body = await postInvoiceTrigger({
        projectId: project.id,
        milestone: modalMilestone,
        reimbursementAmount: v.reimbursementAmount,
        reimbursementDescription: v.reimbursementAmount > 0 ? reimbursementDescription.trim() : '',
        dryRun: true,
      });
      setPreviewResult(body);
      toast.success('Dry-run preview ready.');
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(mapErrorToast(code, msg));
    } finally {
      setPendingAction(null);
    }
  }

  async function runCreateDraft() {
    if (!modalMilestone) return;

    const v = validateModalInputs();
    if (!v) return;

    setPendingAction('create');
    try {
      const body = await postInvoiceTrigger({
        projectId: project.id,
        milestone: modalMilestone,
        reimbursementAmount: v.reimbursementAmount,
        reimbursementDescription: v.reimbursementAmount > 0 ? reimbursementDescription.trim() : '',
        dryRun: false,
      });

      const invoiceId = body.invoice?.id;
      toast.success(
        invoiceId
          ? `Draft invoice created (${invoiceId}) for ${modalMilestone}.`
          : `Draft invoice created for ${modalMilestone}.`,
      );
      await onBillingRefresh?.();
      closeModal();
    } catch (e) {
      const code = (e as Error & { code?: string }).code;
      const msg = e instanceof Error ? e.message : String(e);

      if (code === 'quickbooks_not_connected') {
        toast.error(QB_NOT_CONNECTED_COPY);
      } else {
        toast.error(mapErrorToast(code, msg));
      }
    } finally {
      setPendingAction(null);
    }
  }

  const payloadPreview = previewResult?.payload;
  const lines =
    payloadPreview &&
    typeof payloadPreview === 'object' &&
    payloadPreview !== null &&
    Array.isArray((payloadPreview as { Line?: unknown }).Line)
      ? ((payloadPreview as { Line: unknown[] }).Line as Record<string, unknown>[])
      : null;

  return (
    <div className="min-w-0 space-y-4">
      <div className="space-y-2">
        <h3 className="font-display text-lg font-normal tracking-tight text-foreground">
          Manual invoice controls
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Preview milestone invoices offline (dry run), or create QuickBooks draft invoices when connected.
          Milestone amounts follow contract value × milestone percentage plus optional reimbursement and 15%
          admin fee on reimbursement.
        </p>
      </div>

      {gateMsg ? (
        <div
          className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
          role="status"
        >
          {gateMsg}
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="font-display text-lg font-normal tracking-tight text-foreground">
          Utility client invoices
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          UCI passthrough invoices billed to the client from utility coordination costs. QuickBooks
          invoice IDs appear when background sync succeeds.
        </p>
        {utilityInvoices.length === 0 ? (
          <p className="rounded-lg border border-border bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
            No utility client invoices yet for this project.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Cost type</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2 font-medium">Client billed</th>
                  <th className="px-3 py-2 font-medium">QB invoice</th>
                  <th className="px-3 py-2 font-medium">QB status</th>
                </tr>
              </thead>
              <tbody>
                {utilityInvoices.map((row) => (
                  <tr key={row.id} className="border-b border-border/50">
                    <td className="px-3 py-2 font-medium">{row.cost_type || 'Utility cost'}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(Number(row.actual_amount))}</td>
                    <td className="px-3 py-2 font-mono text-xs">{displayDateTime(row.client_billed_at)}</td>
                    <td className="px-3 py-2 font-mono text-xs break-all">{displayLine(row.quickbooks_invoice_id)}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.qb_sync_status ? String(row.qb_sync_status).replace(/_/g, ' ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MILESTONE_DEFS.map(def => {
          const st = milestoneState(project, def.key);
          const blocked =
            Boolean(gateMsg) ||
            st.triggered ||
            Boolean(st.invoiceId?.trim?.());

          return (
            <div
              key={def.key}
              className={cn(
                'flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-muted/15 p-3 shadow-sm',
                'ring-1 ring-transparent transition-colors hover:ring-primary/25',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    <span className="font-mono tabular-nums">{def.key}</span>{' '}
                    <span className="font-normal font-tight text-muted-foreground">— {def.pctLabel}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground leading-snug">{def.subtitle}</p>
                </div>
                <Badge variant={st.triggered ? 'default' : 'secondary'} className="shrink-0">
                  {st.triggered ? 'Triggered' : 'Not triggered'}
                </Badge>
              </div>

              <dl className="mt-3 grid gap-1.5 text-[11px] sm:text-xs text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <dt className="font-medium text-foreground/75">Triggered at</dt>
                  <dd className="text-right font-mono tabular-nums text-[11px] sm:text-xs">{displayDateTime(st.triggeredAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-medium text-foreground/75">QB invoice ID</dt>
                  <dd className="font-mono text-right break-all">{displayLine(st.invoiceId)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="font-medium text-foreground/75">Source</dt>
                  <dd className="text-right">{displayLine(st.triggerSource)}</dd>
                </div>
              </dl>

              <div className="mt-auto min-w-0 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto w-full whitespace-normal border-primary/40 px-2 py-2 text-center text-xs leading-snug text-foreground hover:bg-primary/10 sm:text-sm"
                  disabled={blocked}
                  title={
                    blocked
                      ? gateMsg ||
                        'This milestone already has an invoice or was triggered.'
                      : `Open preview / trigger flow for ${def.key}`
                  }
                  onClick={() => openModal(def.key)}
                >
                  Preview / Trigger {def.key}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={modalMilestone !== null}
        onOpenChange={open => {
          if (!open) closeModal();
        }}
      >
        <DialogContent className="flex max-h-[90vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden border-border bg-card p-0 text-foreground sm:max-w-lg">
          <DialogHeader className="shrink-0 space-y-1 border-b border-border px-6 pb-4 pt-6 pr-12 text-left">
            <DialogTitle className="font-display text-xl font-normal leading-snug text-foreground">
                <span className="font-mono tabular-nums">{activeDef?.key}</span> milestone invoice
              {activeDef ? (
                <span className="font-normal font-tight text-muted-foreground"> ({activeDef.pctLabel})</span>
              ) : null}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">{activeDef?.subtitle}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            <div className="space-y-4 text-sm text-foreground">
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Base (contract × milestone)</span>
                <span className="font-mono font-medium tabular-nums">{formatMoney(basePreview)}</span>
              </div>
              {!reimbursementParsed.ok ? (
                <p className="text-xs text-destructive">{reimbursementParsed.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="qb-reimburse-amt" className="text-foreground">
                Reimbursement amount
              </Label>
              <Input
                id="qb-reimburse-amt"
                inputMode="decimal"
                value={reimbursementRaw}
                onChange={e => setReimbursementRaw(e.target.value)}
                placeholder="0"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="qb-reimburse-desc" className="text-foreground">
                Reimbursement description
              </Label>
              <Textarea
                id="qb-reimburse-desc"
                value={reimbursementDescription}
                onChange={e => setReimbursementDescription(e.target.value)}
                placeholder="Required when reimbursement is greater than zero"
                rows={3}
              />
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Admin fee (15% of reimbursement)</span>
                <span className="font-mono font-medium tabular-nums">{formatMoney(adminFeePreview)}</span>
              </div>
              <Separator className="bg-border" />
              <div className="flex justify-between gap-2 text-base font-semibold">
                <span>Total preview</span>
                <span className="font-mono tabular-nums text-primary">{formatMoney(totalClientPreview)}</span>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-md border border-border bg-muted/15 px-3 py-2">
              <Checkbox
                id="qb-dry-run"
                checked={dryRunOnly}
                onCheckedChange={v => setDryRunOnly(v === true)}
                className="mt-0.5"
              />
              <label
                htmlFor="qb-dry-run"
                className="cursor-pointer select-none font-tight text-sm leading-snug text-foreground"
              >
                Dry run / preview only
              </label>
            </div>
            </div>

            {previewResult?.dryRun && previewResult.payload ? (
            <div className="mt-4 space-y-2 rounded-lg border border-primary/25 bg-muted/25 p-3">
              <p className="text-xs font-tight font-bold uppercase tracking-[0.16em] text-primary">
                Invoice preview (dry run)
              </p>
              <dl className="grid gap-2 text-xs sm:text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">TxnDate</dt>
                  <dd className="font-mono">{String(previewResult.payload.TxnDate ?? '—')}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">DueDate</dt>
                  <dd className="font-mono">{String(previewResult.payload.DueDate ?? '—')}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">CustomerRef</dt>
                  <dd className="font-mono break-all">
                    {parseCustomerRef(previewResult.payload)}
                  </dd>
                </div>
              </dl>
              <Separator className="my-2 bg-border" />
              <p className="text-xs font-medium text-muted-foreground mb-1">Lines</p>
              <ul className="space-y-2">
                {lines?.length
                  ? lines.map((line, idx) => {
                      const desc =
                        typeof line.Description === 'string' ? line.Description : '—';
                      const amt =
                        typeof line.Amount === 'number'
                          ? line.Amount
                          : Number(line.Amount ?? NaN);
                      return (
                        <li
                          key={idx}
                          className="flex flex-wrap justify-between gap-2 rounded-md bg-background/40 px-2 py-1.5 text-xs"
                        >
                          <span className="text-foreground/90 flex-1 min-w-[12rem]">{desc}</span>
                          <span className="font-mono tabular-nums">{formatMoney(amt)}</span>
                        </li>
                      );
                    })
                  : null}
              </ul>
              <div className="flex justify-between gap-2 pt-2 text-sm font-semibold border-t border-border mt-2">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatMoney(previewResult.totals?.totalInvoiceAmount)}
                </span>
              </div>
            </div>
          ) : null}

          </div>

          <DialogFooter className="mt-0 shrink-0 flex-col gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:justify-end sm:gap-2">
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pendingAction !== null}
              onClick={() => void runPreview()}
            >
              {pendingAction === 'preview' ? 'Working…' : 'Preview Payload'}
            </Button>
            <Button
              type="button"
              disabled={pendingAction !== null || dryRunOnly}
              title={
                dryRunOnly
                  ? 'Uncheck dry run to create a QuickBooks draft (requires QuickBooks connected).'
                  : undefined
              }
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => void runCreateDraft()}
            >
              {pendingAction === 'create' ? 'Creating…' : 'Create Draft Invoice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
