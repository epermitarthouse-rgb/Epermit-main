import { FileText, Upload } from "lucide-react";
import { documents } from "@/components/permitpilot/data";
import { PageHeader, Panel, StatusPill } from "@/components/permitpilot/ProductPrimitives";

const DocumentVault = () => (
  <div>
    <PageHeader eyebrow="Project files" title="Document Vault" body="Versioned permit applications, technical reports, submission batches, and AI-extracted document intelligence." action={<button className="pilot-button-primary"><Upload className="h-4 w-4" />Upload Document</button>} />
    <div className="grid gap-6 xl:grid-cols-[1fr_0.7fr]">
      <Panel title="Active permit documents" eyebrow="Vault"><div className="space-y-3">{documents.map((doc) => <div key={doc.name} className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted p-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"><FileText className="h-5 w-5" /></div><div><div className="font-tight font-semibold">{doc.name}</div><div className="mt-1 text-xs text-muted-foreground">{doc.project} · {doc.type} · {doc.version}</div></div></div><StatusPill tone={doc.status.includes("Needs") ? "bad" : doc.status.includes("Awaiting") ? "warn" : "good"}>{doc.status}</StatusPill></div>)}</div></Panel>
      <Panel title="Document intelligence" eyebrow="AI summary"><div className="rounded-md border border-border bg-muted p-5"><div className="font-tight text-lg font-bold">Submission package health</div><p className="mt-2 text-sm leading-6 text-muted-foreground">Master permit application package is filed. Supplemental batch needs revised civil sheet C-402 and environmental addendum for sector B.</p><div className="mt-5 grid grid-cols-2 gap-3"><Mini label="Completeness" value="86%" /><Mini label="Open comments" value="12" /></div></div></Panel>
    </div>
  </div>
);

const Mini = ({ label, value }: { label: string; value: string }) => <div className="rounded-md bg-background p-4"><div className="font-data text-2xl font-semibold">{value}</div><div className="mt-1 text-xs uppercase tracking-wider text-muted-foreground">{label}</div></div>;

export default DocumentVault;