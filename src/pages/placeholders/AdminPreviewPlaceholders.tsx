import { AlertBanner, PageHeader, Panel } from "@/components/design/ProductPrimitives";
import { EmptyState } from "@/components/design/EmptyState";
import { Shield } from "lucide-react";

type AdminPreviewPlaceholderProps = {
  title: string;
  eyebrow?: string;
  integrationNote: string;
};

/** Shared chrome for admin_preview_placeholder routes (Preview label; actions disabled). */
export function AdminPreviewPlaceholder({
  title,
  eyebrow = "Preview",
  integrationNote,
}: AdminPreviewPlaceholderProps) {
  return (
    <div className="container-page space-y-6">
      <PageHeader eyebrow={eyebrow} title={title} body="Admin preview only — not wired to production backends." />
      <AlertBanner tone="warn" title="Preview — not live" detail={integrationNote} />
      <Panel title="Surface" eyebrow="Admin">
        <EmptyState
          icon={Shield}
          title="Controls disabled"
          body="Approve, save, export, and member actions stay disabled until the corresponding PermitPilot API and schema are approved."
        />
      </Panel>
    </div>
  );
}

export default function AdminAuthorizationsPlaceholder() {
  return (
    <AdminPreviewPlaceholder
      title="Authorizations"
      integrationNote="Requires client_authorizations (+ signatures) — PD-4/PD-5. Do not treat as live LOA."
    />
  );
}
