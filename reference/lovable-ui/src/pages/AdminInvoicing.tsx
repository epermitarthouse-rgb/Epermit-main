import { useState } from "react";
import { CheckCircle2, CloudUpload, Download, ExternalLink, FileText, History, Loader2, Plus, RefreshCw, Send, Wallet } from "lucide-react";
type QbAuditEntry = {
  qbId: string;
  createdAt: string;
  reason: "initial" | "recreate";
  supersededBy?: string;
  amount: number;
};

import { cn } from "@/lib/utils";
import { CsvExportDialog, type CsvColumn } from "@/components/CsvExportDialog";
import communEtLogo from "@/assets/commun-et-logo.jpg.asset.json";
import { toast } from "@/hooks/use-toast";

type Invoice = { id: string; client: string; project: string; amount: number; issued: string; due: string; status: "draft" | "sent" | "paid" | "overdue" };

const invoices: Invoice[] = [
  { id: "INV-2024-0188", client: "McDonald's USA", project: "PRJ-2023-089A", amount: 18400, issued: "Oct 02", due: "Nov 01", status: "sent" },
  { id: "INV-2024-0187", client: "Valvoline LLC", project: "PRJ-2023-112C", amount: 22600, issued: "Sep 30", due: "Oct 30", status: "paid" },
  { id: "INV-2024-0186", client: "MetroWorks", project: "PRJ-2023-045B", amount: 31200, issued: "Sep 18", due: "Oct 18", status: "overdue" },
  { id: "INV-2024-0185", client: "Urban Parks", project: "PRJ-2023-177D", amount: 14800, issued: "Sep 14", due: "Oct 14", status: "paid" },
  { id: "INV-2024-0184", client: "McDonald's USA", project: "PRJ-2023-089A", amount: 9600, issued: "Sep 06", due: "Oct 06", status: "paid" },
];

const cols: CsvColumn<Invoice>[] = [
  { key: "id", label: "Invoice", value: (r) => r.id },
  { key: "client", label: "Client", value: (r) => r.client },
  { key: "project", label: "Project", value: (r) => r.project },
  { key: "amount", label: "Amount", value: (r) => r.amount },
  { key: "issued", label: "Issued", value: (r) => r.issued },
  { key: "due", label: "Due", value: (r) => r.due },
  { key: "status", label: "Status", value: (r) => r.status },
];

const statusTone = {
  draft: "border-border bg-muted/40 text-muted-foreground",
  sent: "border-primary/30 bg-primary/10 text-primary",
  paid: "border-success/30 bg-success/10 text-success",
  overdue: "border-destructive/30 bg-destructive/10 text-destructive",
} as const;

type LineItem = { label: string; qty: number; rate: number; note?: string; reimbursement?: boolean; admin?: boolean };

const sampleLineItems: LineItem[] = [
  { label: "Permit Expeditor Fee", qty: 1, rate: 4500, note: "Filing, tracking & jurisdictional liaison" },
  { label: "Site Investigation Report (SIR)", qty: 1, rate: 3200, note: "Field survey, utility locates, ESIR deliverable" },
  { label: "Permit Fees — Reimbursement", qty: 1, rate: 6000, note: "Pass-through to AHJ (DOB, DDOT, DOEE)", reimbursement: true },
  { label: "Admin Fee on Reimbursements (15%)", qty: 1, rate: 900, note: "Applied to permit fee pass-throughs", admin: true },
  { label: "Inspections (Special & Final)", qty: 6, rate: 300, note: "Third-party coordination & report compile" },
  { label: "Utility Coordination", qty: 1, rate: 2400, note: "Pepco, WGL, DC Water — joint trench scheduling" },
  { label: "External Construction Management", qty: 1, rate: 3500, note: "On-site CM liaison & RFI handling" },
  { label: "Project Management", qty: 1, rate: 2800, note: "Schedule, reporting, stakeholder cadence" },
];

const AdminInvoicing = () => {
  const [exportOpen, setExportOpen] = useState(false);
  const [qbState, setQbState] = useState<"idle" | "creating" | "created">("idle");
  const [qbInvoiceId, setQbInvoiceId] = useState<string | null>(null);
  const [qbAudit, setQbAudit] = useState<QbAuditEntry[]>([]);
  const total = invoices.reduce((a, i) => a + i.amount, 0);
  const paid = invoices.filter((i) => i.status === "paid").reduce((a, i) => a + i.amount, 0);
  const overdue = invoices.filter((i) => i.status === "overdue").reduce((a, i) => a + i.amount, 0);
  const subtotal = sampleLineItems.reduce((a, i) => a + i.qty * i.rate, 0);

  const createInQuickBooks = () => {
    if (qbState === "creating") return;
    const previousId = qbInvoiceId;
    const isRecreate = previousId !== null;
    setQbState("creating");
    // Simulated QB Online API call — replace with real OAuth + POST /v3/company/{realmId}/invoice
    window.setTimeout(() => {
      let nextId = String(1042 + Math.floor(Math.random() * 900));
      if (nextId === previousId) nextId = String(Number(nextId) + 1);
      const createdAt = new Date().toISOString();

      setQbAudit((prev) => {
        const updated = previousId
          ? prev.map((e) => (e.qbId === previousId && !e.supersededBy ? { ...e, supersededBy: nextId } : e))
          : prev;
        return [
          ...updated,
          {
            qbId: nextId,
            createdAt,
            reason: isRecreate ? "recreate" : "initial",
            amount: subtotal,
          },
        ];
      });
      setQbInvoiceId(nextId);
      setQbState("created");
      toast({
        title: isRecreate ? "Re-created in QuickBooks" : "Pushed to QuickBooks",
        description: isRecreate
          ? `Fresh QB #${nextId} created. Previous QB #${previousId} marked superseded in audit trail.`
          : `Invoice INV-2024-0188 created as QB #${nextId} ($${subtotal.toLocaleString()}).`,
      });
    }, 1400);
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">QuickBooks Client Invoicing</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">Billing Console</h1>
        </div>
        <div className="flex gap-2">
          <button className="pilot-button-ghost" onClick={() => setExportOpen(true)}><Download className="h-4 w-4" /> Export</button>
          <button className="pilot-button-primary"><Plus className="h-4 w-4" /> New Invoice</button>
        </div>
      </header>

      {/* QuickBooks connection banner */}
      <section className="pilot-card flex flex-col gap-3 border-l-4 border-l-success p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-success/15 text-success">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-tight text-base font-bold">QuickBooks Online — Connected</span>
              <span className="rounded border border-success/30 bg-success/10 px-2 py-0.5 pilot-kicker text-success">Live Sync</span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Realm <span className="font-data">4620 8163 9472 1108</span> · Commun-ET, LLC · last sync 4 min ago · 12 invoices · 3 payments mirrored
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="pilot-button-ghost"><RefreshCw className="h-4 w-4" /> Sync now</button>
          <button className="pilot-button-ghost">Manage</button>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { l: "Outstanding", v: `$${(total - paid).toLocaleString()}`, t: "text-foreground" },
          { l: "Paid (MTD)", v: `$${paid.toLocaleString()}`, t: "text-success" },
          { l: "Overdue", v: `$${overdue.toLocaleString()}`, t: "text-destructive" },
        ].map((k) => (
          <div key={k.l} className="pilot-card p-4">
            <div className="pilot-kicker text-muted-foreground">{k.l}</div>
            <div className={cn("mt-1 font-display text-3xl font-semibold", k.t)}>{k.v}</div>
          </div>
        ))}
      </div>

      <section className="pilot-card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/30 pilot-kicker">
            <tr>
              <th className="px-5 py-3 font-medium">Invoice</th>
              <th className="px-5 py-3 font-medium">Client</th>
              <th className="px-5 py-3 font-medium">Project</th>
              <th className="px-5 py-3 text-right font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Issued</th>
              <th className="px-5 py-3 font-medium">Due</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {invoices.map((r) => (
              <tr key={r.id} className={cn("hover:bg-muted/40", r.status === "overdue" && "bg-destructive/5")}>
                <td className="px-5 py-3 font-data text-xs">{r.id}</td>
                <td className="px-5 py-3 font-medium">{r.client}</td>
                <td className="px-5 py-3 text-muted-foreground">{r.project}</td>
                <td className="px-5 py-3 text-right font-data font-bold">${r.amount.toLocaleString()}</td>
                <td className="px-5 py-3 font-data text-xs">{r.issued}</td>
                <td className="px-5 py-3 font-data text-xs">{r.due}</td>
                <td className="px-5 py-3">
                  <span className={cn("inline-flex items-center gap-1 rounded border px-2 py-0.5 pilot-kicker", statusTone[r.status])}>
                    <Wallet className="h-3 w-3" /> {r.status}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="flex gap-1">
                    <button className="rounded p-1 text-muted-foreground hover:text-primary"><FileText className="h-4 w-4" /></button>
                    <button className="rounded p-1 text-muted-foreground hover:text-primary"><Send className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Sample invoice preview — what gets pushed to QuickBooks */}
      <section className="pilot-card overflow-hidden">
        <header className="flex items-center justify-between border-b border-border bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h2 className="font-tight text-base font-bold">Invoice Preview — pushes to QuickBooks</h2>
          </div>
          <span className="pilot-kicker text-muted-foreground">INV-2024-0188 · Draft</span>
        </header>

        <div className="bg-background p-6 md:p-8">
          {/* Branded invoice document */}
          <div className="mx-auto max-w-3xl rounded-md border border-border bg-card text-foreground shadow-elegant">
            {/* Header */}
            <div className="flex flex-col gap-4 border-b border-border p-6 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-md bg-white p-2">
                  <img
                    src={communEtLogo.url}
                    alt="Commun-ET, LLC"
                    width={180}
                    height={110}
                    loading="lazy"
                    className="h-20 w-auto object-contain"
                  />
                </div>
                <div className="text-xs leading-relaxed text-muted-foreground">
                  <div className="font-tight text-sm font-bold text-foreground">Commun-ET, LLC</div>
                  <div>Permitting · Utility Coordination · Results</div>
                  <div className="mt-1">1100 H St NW, Suite 200</div>
                  <div>Washington, DC 20005</div>
                  <div>billing@commun-et.com · (202) 555-0140</div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-3xl font-semibold tracking-tight text-primary">INVOICE</div>
                <div className="mt-1 font-data text-xs text-muted-foreground">#INV-2024-0188</div>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">Issued</span><span className="font-data">Oct 02, 2024</span>
                  <span className="text-muted-foreground">Due</span><span className="font-data">Nov 01, 2024</span>
                  <span className="text-muted-foreground">Terms</span><span className="font-data">Net 30</span>
                </div>
              </div>
            </div>

            {/* Bill to */}
            <div className="grid gap-6 border-b border-border p-6 md:grid-cols-2">
              <div>
                <div className="pilot-kicker text-muted-foreground">Bill To</div>
                <div className="mt-1 font-tight text-sm font-bold">McDonald's USA, LLC</div>
                <div className="text-xs text-muted-foreground">Attn: Development Accounting</div>
                <div className="text-xs text-muted-foreground">110 N Carpenter St, Chicago, IL 60607</div>
              </div>
              <div>
                <div className="pilot-kicker text-muted-foreground">Project</div>
                <div className="mt-1 font-tight text-sm font-bold">PRJ-2023-089A — Drive-Thru Modernization</div>
                <div className="text-xs text-muted-foreground">3401 Georgia Ave NW, Washington, DC</div>
                <div className="text-xs text-muted-foreground">PM: J. Okafor · Period: Sep 01 – Sep 30, 2024</div>
              </div>
            </div>

            {/* Line items */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/40 pilot-kicker">
                  <tr>
                    <th className="px-6 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                    <th className="px-6 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sampleLineItems.map((li) => (
                    <tr key={li.label} className={cn(li.reimbursement && "bg-primary/5", li.admin && "bg-muted/20")}>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{li.label}</span>
                          {li.reimbursement && (
                            <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 pilot-kicker text-primary">Reimbursement</span>
                          )}
                          {li.admin && (
                            <span className="rounded border border-border bg-muted px-1.5 py-0.5 pilot-kicker text-muted-foreground">Admin · 15%</span>
                          )}
                        </div>
                        {li.note && <div className="mt-0.5 text-xs text-muted-foreground">{li.note}</div>}
                      </td>
                      <td className="px-3 py-3 text-right font-data text-xs">{li.qty}</td>
                      <td className="px-3 py-3 text-right font-data text-xs">${li.rate.toLocaleString()}</td>
                      <td className="px-6 py-3 text-right font-data font-bold">${(li.qty * li.rate).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex flex-col items-end gap-1 border-t border-border bg-muted/20 p-6 text-sm">
              <div className="flex w-64 justify-between text-muted-foreground">
                <span>Subtotal</span><span className="font-data">${subtotal.toLocaleString()}</span>
              </div>
              <div className="flex w-64 justify-between text-muted-foreground">
                <span>Tax (DC — exempt)</span><span className="font-data">$0.00</span>
              </div>
              <div className="mt-2 flex w-64 justify-between border-t border-border pt-2">
                <span className="font-tight font-bold">Total Due</span>
                <span className="font-display text-xl font-semibold text-primary">${subtotal.toLocaleString()}</span>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border p-6 text-xs text-muted-foreground">
              <div className="font-tight text-sm font-bold text-foreground">Remit to</div>
              <div>Commun-ET, LLC · Wire: M&T Bank · Routing 022000046 · Acct ••••3318</div>
              <div className="mt-2">Permit fee reimbursements are billed at cost with a 15% administrative fee per MSA §4.2. Questions: billing@commun-et.com.</div>
              <div className="mt-3 flex items-center justify-between">
                <span className="pilot-kicker text-primary">Permitting · Utility Coordination · Results</span>
                <span className="pilot-kicker text-muted-foreground">Synced to QuickBooks · QB ID 1042</span>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {qbState === "created" && qbInvoiceId && (
              <span className="mr-auto inline-flex items-center gap-1.5 rounded border border-success/30 bg-success/10 px-2.5 py-1 pilot-kicker text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Created in QuickBooks · QB #{qbInvoiceId}
              </span>
            )}
            <button className="pilot-button-ghost"><Download className="h-4 w-4" /> Download PDF</button>
            <button
              type="button"
              onClick={createInQuickBooks}
              disabled={qbState === "creating"}
              className="pilot-button-primary disabled:opacity-60"
            >
              {qbState === "creating" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Creating in QuickBooks…</>
              ) : qbState === "created" ? (
                <><RefreshCw className="h-4 w-4" /> Re-create in QuickBooks</>
              ) : (
                <><CloudUpload className="h-4 w-4" /> Create in QuickBooks</>
              )}
            </button>
            <button className="pilot-button-ghost"><Send className="h-4 w-4" /> Send to Client</button>
          </div>

          {qbAudit.length > 0 && (
            <div className="mt-5 rounded-md border border-border bg-muted/20 p-4">
              <div className="mb-2 flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <h3 className="font-tight text-sm font-bold">QuickBooks Audit Trail</h3>
                <span className="ml-auto pilot-kicker text-muted-foreground">
                  {qbAudit.length} {qbAudit.length === 1 ? "push" : "pushes"} · INV-2024-0188
                </span>
              </div>
              <ul className="divide-y divide-border text-xs">
                {[...qbAudit].reverse().map((e) => {
                  const isActive = e.qbId === qbInvoiceId;
                  return (
                    <li key={e.qbId} className="flex items-center gap-3 py-2">
                       <a
                         href={`https://app.qbo.intuit.com/app/invoice?txnId=${e.qbId}`}
                         target="_blank"
                         rel="noopener noreferrer"
                         title={`Open QB #${e.qbId} in QuickBooks Online`}
                         className={cn(
                           "inline-flex items-center gap-1 rounded border px-2 py-0.5 pilot-kicker transition-colors hover:underline",
                           isActive
                             ? "border-success/30 bg-success/10 text-success hover:bg-success/20"
                             : "border-border bg-muted text-muted-foreground line-through hover:text-foreground",
                         )}
                       >
                         QB #{e.qbId}
                         <ExternalLink className="h-3 w-3 no-underline" />
                       </a>
                      <span className="font-medium">
                        {e.reason === "initial" ? "Initial push" : "Re-created"}
                      </span>
                       {e.supersededBy && (
                         <span className="text-muted-foreground">
                           → superseded by{" "}
                           <a
                             href={`https://app.qbo.intuit.com/app/invoice?txnId=${e.supersededBy}`}
                             target="_blank"
                             rel="noopener noreferrer"
                             className="font-data text-foreground hover:underline"
                           >
                             QB #{e.supersededBy}
                           </a>
                         </span>
                       )}
                      <span className="ml-auto font-data text-muted-foreground">{fmtTime(e.createdAt)}</span>
                      <span className="w-20 text-right font-data font-bold">${e.amount.toLocaleString()}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>

      <CsvExportDialog open={exportOpen} onOpenChange={setExportOpen} title="Export Invoices" filename="invoices" columns={cols} rows={invoices} storageKey="invoices" />
    </div>
  );
};

export default AdminInvoicing;