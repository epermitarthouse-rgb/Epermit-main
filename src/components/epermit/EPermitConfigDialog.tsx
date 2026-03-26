import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Settings, 
  CheckCircle, 
  AlertCircle, 
  Loader2,
  Shield,
  Building2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { 
  EPermitSystem, 
  EPermitEnvironment, 
  EPermitCredentials,
  EPermitConfig 
} from '@/types/epermit';
import { SAMPLE_AGENCIES } from '@/types/epermit';

interface EPermitConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config?: EPermitConfig;
  onSave: (config: EPermitConfig) => void;
}

export function EPermitConfigDialog({
  open,
  onOpenChange,
  config,
  onSave,
}: EPermitConfigDialogProps) {
  const [system, setSystem] = useState<EPermitSystem>(config?.system || 'accela');
  const [environment, setEnvironment] = useState<EPermitEnvironment>(config?.environment || 'sandbox');
  const [credentials, setCredentials] = useState<EPermitCredentials>(config?.credentials || {});
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; message: string } | null>(null);

  const handleValidate = async () => {
    setValidating(true);
    setValidationResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('epermit-submit', {
        body: {
          action: 'validate',
          system,
          environment,
          credentials,
        },
      });

      if (error) throw error;

      setValidationResult(data);
      if (data.valid) {
        toast.success('Credentials validated successfully');
      } else {
        toast.error(data.message || 'Validation failed');
      }
    } catch (err: any) {
      setValidationResult({ valid: false, message: err.message });
      toast.error('Validation failed');
    } finally {
      setValidating(false);
    }
  };

  const handleSave = () => {
    const newConfig: EPermitConfig = {
      system,
      environment,
      credentials,
      isConfigured: true,
      lastValidated: validationResult?.valid ? new Date().toISOString() : undefined,
    };
    onSave(newConfig);
    onOpenChange(false);
    toast.success('E-permit configuration saved');
  };

  const updateCredential = (key: keyof EPermitCredentials, value: string) => {
    setCredentials(prev => ({ ...prev, [key]: value }));
    setValidationResult(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            E-Permit System Configuration
          </DialogTitle>
          <DialogDescription>
            Configure your connection to Accela or CityView for direct permit submission.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={system} onValueChange={(v) => setSystem(v as EPermitSystem)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="accela">Accela</TabsTrigger>
            <TabsTrigger value="cityview">CityView</TabsTrigger>
          </TabsList>

          <TabsContent value="accela" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as EPermitEnvironment)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-amber-500" />
                      Sandbox (Testing)
                    </div>
                  </SelectItem>
                  <SelectItem value="production">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-emerald-500" />
                      Production
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>API Base URL</Label>
              <Input
                placeholder="https://apis.accela.com"
                value={credentials.baseUrl || ''}
                onChange={(e) => updateCredential('baseUrl', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Default: https://apis.accela.com
              </p>
            </div>

            <div className="space-y-2">
              <Label>Agency ID</Label>
              <Input
                placeholder="e.g., SFGOV, LADBS"
                value={credentials.agencyId || ''}
                onChange={(e) => updateCredential('agencyId', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Client ID (App ID)</Label>
              <Input
                placeholder="Your Accela App ID"
                value={credentials.clientId || ''}
                onChange={(e) => updateCredential('clientId', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Client Secret</Label>
              <Input
                type="password"
                placeholder="Your Accela App Secret"
                value={credentials.clientSecret || ''}
                onChange={(e) => updateCredential('clientSecret', e.target.value)}
              />
            </div>

            {/* Sample agencies */}
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Sample Agencies:</p>
              <div className="flex flex-wrap gap-1">
                {SAMPLE_AGENCIES.accela.map((agency) => (
                  <Badge
                    key={agency.agencyId}
                    variant="outline"
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => {
                      updateCredential('agencyId', agency.agencyId);
                      updateCredential('baseUrl', agency.baseUrl);
                    }}
                  >
                    {agency.name}
                  </Badge>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cityview" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Environment</Label>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as EPermitEnvironment)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-amber-500" />
                      Sandbox (Testing)
                    </div>
                  </SelectItem>
                  <SelectItem value="production">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-emerald-500" />
                      Production
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>API Base URL</Label>
              <Input
                placeholder="https://your-city.gov/cityview"
                value={credentials.baseUrl || ''}
                onChange={(e) => updateCredential('baseUrl', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>API Key</Label>
              <Input
                type="password"
                placeholder="Your CityView API Key"
                value={credentials.apiKey || ''}
                onChange={(e) => updateCredential('apiKey', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Client ID</Label>
              <Input
                placeholder="Your Client ID"
                value={credentials.clientId || ''}
                onChange={(e) => updateCredential('clientId', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Client Secret</Label>
              <Input
                type="password"
                placeholder="Your Client Secret"
                value={credentials.clientSecret || ''}
                onChange={(e) => updateCredential('clientSecret', e.target.value)}
              />
            </div>

            {/* Sample agencies */}
            <div className="pt-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Sample Agencies:</p>
              <div className="flex flex-wrap gap-1">
                {SAMPLE_AGENCIES.cityview.map((agency) => (
                  <Badge
                    key={agency.name}
                    variant="outline"
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => updateCredential('baseUrl', agency.baseUrl)}
                  >
                    {agency.name}
                  </Badge>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {validationResult && (
          <Alert variant={validationResult.valid ? 'default' : 'destructive'}>
            {validationResult.valid ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            <AlertDescription>{validationResult.message}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleValidate} disabled={validating}>
            {validating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Validate
          </Button>
          <Button onClick={handleSave}>
            Save Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
