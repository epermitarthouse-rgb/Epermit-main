import { AlertBanner, PageHeader, Panel } from "@/components/design/ProductPrimitives";
import { EmptyState } from "@/components/design/EmptyState";
import { Inbox } from "lucide-react";

/**
 * Visible placeholder (Resources › Messages).
 * Coming Soon until product maps to notifications / project chat / mailbox.
 * No mock threads or unread badge counts.
 */
export default function MessagesPlaceholder() {
  return (
    <div className="container-page space-y-6">
      <PageHeader
        eyebrow="Coming soon"
        title="Messages"
        body="Shared inbox across notifications, project chat, and mailbox. Mapping not decided yet."
      />
      <AlertBanner
        tone="info"
        title="Not yet connected"
        detail="Future options: Notifications hub, cross-project chat inbox, Microsoft mailbox list, or a unified tabs view. Existing NotificationBell, ProjectChat, and mailbox connectors stay in place — this page will not show fabricated threads."
      />
      <Panel title="Inbox" eyebrow="Resources">
        <EmptyState
          icon={Inbox}
          title="No live inbox"
          body="Unread counts and message rows appear only after a real mapping ships — never mock threads."
        />
      </Panel>
    </div>
  );
}
