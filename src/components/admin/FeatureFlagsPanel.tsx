import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, Flag, Loader2, Video } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import {
  FEATURE_FLAG,
  isAdminRequiredError,
  isUnknownFlagError,
  readLegacyShowDemoVideo,
  type FeatureFlagKey,
} from '@/lib/featureFlags';
import { toast } from '@/hooks/use-toast';

const flagUiConfig: Record<
  FeatureFlagKey,
  { icon: typeof Video; label: string; description: string; category: string }
> = {
  [FEATURE_FLAG.HOMEPAGE_SHOW_DEMO_VIDEO]: {
    label: 'Platform Demo Video',
    description: 'Show the interactive platform demo video on the homepage',
    icon: Video,
    category: 'Homepage',
  },
};

export function FeatureFlagsPanel() {
  const {
    rows,
    flags,
    isLoading,
    isError,
    error,
    toggleFlag,
    isMutating,
    mutationError,
    refetch,
  } = useFeatureFlags();

  const legacyShowDemoVideo = readLegacyShowDemoVideo();

  const handleToggle = async (key: FeatureFlagKey) => {
    try {
      const result = await toggleFlag(key);
      toast({
        title: result.changed ? 'Feature flag updated' : 'No change',
        description: `${flagUiConfig[key].label} is now ${result.enabled ? 'ON' : 'OFF'} platform-wide.`,
      });
    } catch (err) {
      const message = isAdminRequiredError(err)
        ? 'Admin access required to change feature flags.'
        : isUnknownFlagError(err)
          ? 'Unknown feature flag key.'
          : 'Failed to update feature flag.';
      toast({ title: 'Update failed', description: message, variant: 'destructive' });
    }
  };

  const displayRows =
    rows.length > 0
      ? rows.filter((row) => row.key in flagUiConfig)
      : Object.entries(flagUiConfig).map(([key, config]) => ({
          key,
          enabled: flags[key as FeatureFlagKey] ?? false,
          label: config.label,
          description: config.description,
          category: config.category,
          updated_at: null as string | null,
          updated_by: null as string | null,
        }));

  return (
    <div className="space-y-6">
      {legacyShowDemoVideo === true && (
        <Alert variant="default">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Previous browser-only setting detected</AlertTitle>
          <AlertDescription>
            Demo video was previously enabled in this browser via localStorage. Server default is
            OFF — toggle ON above to enable platform-wide. The old localStorage value is ignored.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Flag className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Feature Flags</CardTitle>
              <CardDescription>
                Global product visibility toggles (server-backed)
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading feature flags…
            </div>
          )}

          {isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Failed to load flags</AlertTitle>
              <AlertDescription className="flex flex-col gap-2">
                <span>
                  {(error as Error)?.message ?? 'Unknown error'}. All flags default to OFF.
                </span>
                <button
                  type="button"
                  className="text-sm underline w-fit"
                  onClick={() => void refetch()}
                >
                  Retry
                </button>
              </AlertDescription>
            </Alert>
          )}

          {mutationError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Update failed</AlertTitle>
              <AlertDescription>
                {(mutationError as Error)?.message ?? 'Could not save flag change.'}
              </AlertDescription>
            </Alert>
          )}

          {displayRows.map((row) => {
            const key = row.key as FeatureFlagKey;
            const config = flagUiConfig[key];
            if (!config) return null;
            const Icon = config.icon;
            const isEnabled = flags[key] ?? false;

            return (
              <div
                key={row.key}
                className="flex items-start justify-between gap-4 p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="p-2 rounded-md bg-primary/10 shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={row.key} className="font-medium cursor-pointer">
                        {config.label}
                      </Label>
                      <Badge variant="outline" className="text-xs">
                        {config.category}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{config.description}</p>
                    {row.updated_at && (
                      <p className="text-xs text-muted-foreground">
                        Last updated{' '}
                        {formatDistanceToNow(new Date(row.updated_at), { addSuffix: true })}
                        {row.updated_by ? ` · by ${row.updated_by.slice(0, 8)}…` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-xs font-medium ${isEnabled ? 'text-green-600' : 'text-muted-foreground'}`}
                  >
                    {isEnabled ? 'ON' : 'OFF'}
                  </span>
                  <Switch
                    id={row.key}
                    checked={isEnabled}
                    disabled={isLoading || isMutating}
                    onCheckedChange={() => void handleToggle(key)}
                  />
                </div>
              </div>
            );
          })}

          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              Flags are stored in Supabase and apply to all users and browsers. Failed loads safely
              default to OFF. Only registered flag keys can be toggled.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
