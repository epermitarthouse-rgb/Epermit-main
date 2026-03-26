import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Code2, ExternalLink, Palette } from "lucide-react";

interface WidgetGeneratorProps {
  shareToken: string;
  projectName: string;
}

export function WidgetGenerator({ shareToken, projectName }: WidgetGeneratorProps) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [compact, setCompact] = useState(false);
  const [showMilestones, setShowMilestones] = useState(true);
  const [showNextSteps, setShowNextSteps] = useState(true);
  const [accentColor, setAccentColor] = useState('#8B5CF6');
  const [width, setWidth] = useState('400');
  const [height, setHeight] = useState('500');

  const baseUrl = window.location.origin;
  const widgetUrl = `${baseUrl}/embed/${shareToken}?theme=${theme}&compact=${compact}&milestones=${showMilestones}&steps=${showNextSteps}&accent=${encodeURIComponent(accentColor)}`;
  
  const iframeCode = `<iframe
  src="${widgetUrl}"
  width="${width}"
  height="${compact ? '180' : height}"
  frameborder="0"
  style="border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);"
  title="${projectName} Status"
></iframe>`;

  const scriptCode = `<div id="permit-status-widget" data-token="${shareToken}" data-theme="${theme}" data-accent="${accentColor}"></div>
<script src="${baseUrl}/widget.js"></script>`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code2 className="h-5 w-5" />
          Embed Widget
        </CardTitle>
        <CardDescription>
          Add a live status widget to your client's website
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Configuration */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Theme</Label>
            <Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Accent Color
            </Label>
            <div className="flex gap-2">
              <Input
                type="color"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                className="w-12 h-10 p-1 cursor-pointer"
              />
              <Input
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                placeholder="#8B5CF6"
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Width (px)</Label>
            <Input
              type="number"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              min="300"
              max="800"
            />
          </div>

          <div className="space-y-2">
            <Label>Height (px)</Label>
            <Input
              type="number"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              min="200"
              max="800"
              disabled={compact}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="compact">Compact Mode</Label>
            <Switch id="compact" checked={compact} onCheckedChange={setCompact} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="milestones">Show Milestones</Label>
            <Switch 
              id="milestones" 
              checked={showMilestones} 
              onCheckedChange={setShowMilestones}
              disabled={compact}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="steps">Show Next Steps</Label>
            <Switch 
              id="steps" 
              checked={showNextSteps} 
              onCheckedChange={setShowNextSteps}
              disabled={compact}
            />
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-2">
          <Label>Preview</Label>
          <div className="p-4 bg-muted/50 rounded-lg flex justify-center overflow-auto">
            <iframe
              src={widgetUrl}
              width={Math.min(parseInt(width), 380)}
              height={compact ? 180 : Math.min(parseInt(height), 400)}
              frameBorder="0"
              style={{ borderRadius: '12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              title="Widget Preview"
            />
          </div>
        </div>

        {/* Embed Code */}
        <Tabs defaultValue="iframe">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="iframe">iFrame</TabsTrigger>
            <TabsTrigger value="direct">Direct Link</TabsTrigger>
          </TabsList>
          
          <TabsContent value="iframe" className="space-y-3">
            <div className="relative">
              <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all">
                {iframeCode}
              </pre>
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2"
                onClick={() => copyToClipboard(iframeCode, 'iFrame code')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste this code into your client's website HTML where you want the widget to appear.
            </p>
          </TabsContent>
          
          <TabsContent value="direct" className="space-y-3">
            <div className="flex gap-2">
              <Input value={widgetUrl} readOnly className="text-xs" />
              <Button
                size="icon"
                variant="secondary"
                onClick={() => copyToClipboard(widgetUrl, 'Widget URL')}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                onClick={() => window.open(widgetUrl, '_blank')}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this URL directly or use it in your own iframe implementation.
            </p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
