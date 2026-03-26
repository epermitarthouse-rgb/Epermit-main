import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Link2,
  Copy,
  ExternalLink,
  Trash2,
  Clock,
  Eye,
  Check,
  Plus,
  LinkIcon,
  Code2,
} from 'lucide-react';
import { format, addDays, isPast } from 'date-fns';
import { useProjectShareLinks } from '@/hooks/useProjectShareLinks';
import { Project } from '@/types/project';
import { WidgetGenerator } from '@/components/widgets/WidgetGenerator';

interface ShareProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

export function ShareProjectDialog({
  open,
  onOpenChange,
  project,
}: ShareProjectDialogProps) {
  const { shareLinks, loading, createShareLink, deactivateShareLink, deleteShareLink } = useProjectShareLinks(project.id);
  const [expiresEnabled, setExpiresEnabled] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedLinkForWidget, setSelectedLinkForWidget] = useState<string | null>(null);

  const getShareUrl = (token: string) => {
    return `${window.location.origin}/portal/${token}`;
  };

  const handleCopy = async (token: string, linkId: string) => {
    try {
      await navigator.clipboard.writeText(getShareUrl(token));
      setCopiedId(linkId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleCreateLink = async () => {
    setCreating(true);
    try {
      await createShareLink({
        project_id: project.id,
        expires_at: expiresEnabled ? addDays(new Date(), expiresInDays).toISOString() : null,
      });
    } finally {
      setCreating(false);
    }
  };

  const isExpired = (expiresAt: string | null) => {
    return expiresAt && isPast(new Date(expiresAt));
  };

  const activeLinks = shareLinks.filter(link => link.is_active && !isExpired(link.expires_at));
  const inactiveLinks = shareLinks.filter(link => !link.is_active || isExpired(link.expires_at));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Share Project
          </DialogTitle>
          <DialogDescription>
            Create shareable links and embeddable widgets for "{project.name}".
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="links">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="links" className="flex items-center gap-2">
              <LinkIcon className="h-4 w-4" />
              Share Links
            </TabsTrigger>
            <TabsTrigger value="widget" className="flex items-center gap-2">
              <Code2 className="h-4 w-4" />
              Embed Widget
            </TabsTrigger>
          </TabsList>

          <TabsContent value="links" className="space-y-4 mt-4">
            {/* Create New Link Section */}
            <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
              <h4 className="font-medium text-sm">Create New Link</h4>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <Label htmlFor="expires-toggle" className="text-sm">Set expiration</Label>
                </div>
                <Switch
                  id="expires-toggle"
                  checked={expiresEnabled}
                  onCheckedChange={setExpiresEnabled}
                />
              </div>

              {expiresEnabled && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="expires-days" className="text-sm text-muted-foreground whitespace-nowrap">
                    Expires in
                  </Label>
                  <Input
                    id="expires-days"
                    type="number"
                    min={1}
                    max={365}
                    value={expiresInDays}
                    onChange={(e) => setExpiresInDays(parseInt(e.target.value) || 7)}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
              )}

              <Button onClick={handleCreateLink} disabled={creating} className="w-full">
                <Plus className="mr-2 h-4 w-4" />
                {creating ? 'Creating...' : 'Create Share Link'}
              </Button>
            </div>

            {/* Active Links */}
            <div className="space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                Active Links ({activeLinks.length})
              </h4>
              
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : activeLinks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active share links</p>
              ) : (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {activeLinks.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between p-3 border rounded-lg bg-background"
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-0.5 rounded truncate max-w-[180px]">
                            {link.token.slice(0, 8)}...
                          </code>
                          {link.expires_at && (
                            <Badge variant="outline" className="text-xs">
                              Expires {format(new Date(link.expires_at), 'MMM d')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {link.view_count} views
                          </span>
                          <span>Created {format(new Date(link.created_at), 'MMM d, yyyy')}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleCopy(link.token, link.id)}
                          title="Copy link"
                        >
                          {copiedId === link.id ? (
                            <Check className="h-4 w-4 text-green-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          asChild
                          title="Open portal"
                        >
                          <a href={getShareUrl(link.token)} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button
                          variant={selectedLinkForWidget === link.token ? 'secondary' : 'ghost'}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setSelectedLinkForWidget(
                            selectedLinkForWidget === link.token ? null : link.token
                          )}
                          title="Get embed code"
                        >
                          <Code2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deactivateShareLink(link.id)}
                          title="Deactivate"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Inactive/Expired Links */}
            {inactiveLinks.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="font-medium text-sm text-muted-foreground">
                    Inactive/Expired ({inactiveLinks.length})
                  </h4>
                  <div className="space-y-2 max-h-[120px] overflow-y-auto">
                    {inactiveLinks.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center justify-between p-2 border rounded-lg bg-muted/30 opacity-60"
                      >
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-muted px-2 py-0.5 rounded">
                            {link.token.slice(0, 8)}...
                          </code>
                          <Badge variant="secondary" className="text-xs">
                            {isExpired(link.expires_at) ? 'Expired' : 'Deactivated'}
                          </Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => deleteShareLink(link.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="widget" className="mt-4">
            {activeLinks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Code2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p>Create a share link first to generate an embeddable widget.</p>
                <Button 
                  variant="outline" 
                  className="mt-4"
                  onClick={handleCreateLink}
                  disabled={creating}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Create Share Link
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {activeLinks.length > 1 && (
                  <div className="space-y-2">
                    <Label>Select a share link for the widget</Label>
                    <div className="flex flex-wrap gap-2">
                      {activeLinks.map((link) => (
                        <Button
                          key={link.id}
                          variant={selectedLinkForWidget === link.token ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setSelectedLinkForWidget(link.token)}
                        >
                          {link.token.slice(0, 8)}...
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <WidgetGenerator 
                  shareToken={selectedLinkForWidget || activeLinks[0].token}
                  projectName={project.name}
                />
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
