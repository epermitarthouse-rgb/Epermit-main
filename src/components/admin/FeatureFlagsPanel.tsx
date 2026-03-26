import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { Flag, Video, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const flagConfig = {
  showDemoVideo: {
    label: 'Platform Demo Video',
    description: 'Show the interactive platform demo video on the homepage',
    icon: Video,
    category: 'Homepage',
  },
} as const;

export function FeatureFlagsPanel() {
  const { flags, toggleFlag } = useFeatureFlags();

  const handleReset = () => {
    Object.keys(flags).forEach((key) => {
      const flagKey = key as keyof typeof flags;
      if (flags[flagKey]) {
        toggleFlag(flagKey);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Flag className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Feature Flags</CardTitle>
              <CardDescription>
                Toggle features on/off without code changes
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset All
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(flagConfig).map(([key, config]) => {
          const flagKey = key as keyof typeof flags;
          const Icon = config.icon;
          const isEnabled = flags[flagKey];

          return (
            <div
              key={key}
              className="flex items-start justify-between gap-4 p-4 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-md bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={key} className="font-medium cursor-pointer">
                      {config.label}
                    </Label>
                    <Badge variant="outline" className="text-xs">
                      {config.category}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {config.description}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${isEnabled ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {isEnabled ? 'ON' : 'OFF'}
                </span>
                <Switch
                  id={key}
                  checked={isEnabled}
                  onCheckedChange={() => toggleFlag(flagKey)}
                />
              </div>
            </div>
          );
        })}

        <div className="pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Feature flags are stored in browser localStorage and persist across sessions.
            Changes take effect immediately on page refresh.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
