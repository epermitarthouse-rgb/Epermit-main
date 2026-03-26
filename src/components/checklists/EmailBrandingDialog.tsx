import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useEmailBranding } from '@/hooks/useEmailBranding';
import { Loader2, Palette, Image, Type, FileText } from 'lucide-react';

interface EmailBrandingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EmailBrandingDialog({ open, onOpenChange }: EmailBrandingDialogProps) {
  const { settings, loading, updateSettings } = useEmailBranding();
  const [saving, setSaving] = useState(false);
  
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#0f4c5c');
  const [headerText, setHeaderText] = useState('Insight|DesignCheck');
  const [footerText, setFooterText] = useState('');
  const [unsubscribeText, setUnsubscribeText] = useState('');

  useEffect(() => {
    if (settings) {
      setLogoUrl(settings.logo_url || '');
      setPrimaryColor(settings.primary_color);
      setHeaderText(settings.header_text);
      setFooterText(settings.footer_text);
      setUnsubscribeText(settings.unsubscribe_text);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        logo_url: logoUrl || null,
        primary_color: primaryColor,
        header_text: headerText,
        footer_text: footerText,
        unsubscribe_text: unsubscribeText,
      });
      onOpenChange(false);
    } catch (error) {
      // Error handled in hook
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Email Branding Settings
          </DialogTitle>
          <DialogDescription>
            Customize the appearance of your checklist report emails.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="logoUrl" className="flex items-center gap-2">
                <Image className="h-4 w-4" />
                Logo URL
              </Label>
              <Input
                id="logoUrl"
                type="url"
                placeholder="https://example.com/logo.png"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Recommended size: 200x50 pixels. Leave empty to use text header.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="primaryColor" className="flex items-center gap-2">
                <Palette className="h-4 w-4" />
                Primary Color
              </Label>
              <div className="flex gap-2">
                <Input
                  id="primaryColor"
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-16 h-10 p-1 cursor-pointer"
                />
                <Input
                  type="text"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#0f4c5c"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="headerText" className="flex items-center gap-2">
                <Type className="h-4 w-4" />
                Header Text
              </Label>
              <Input
                id="headerText"
                placeholder="Your Company Name"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Displayed when no logo is provided.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="footerText" className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Footer Text
              </Label>
              <Textarea
                id="footerText"
                placeholder="© 2025 Your Company. All rights reserved."
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unsubscribeText">Unsubscribe Text</Label>
              <Textarea
                id="unsubscribeText"
                placeholder="You are receiving this email because..."
                value={unsubscribeText}
                onChange={(e) => setUnsubscribeText(e.target.value)}
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
