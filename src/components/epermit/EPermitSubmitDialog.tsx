import { useState, useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Send, 
  Loader2,
  CheckCircle,
  AlertCircle,
  FileText,
  Building2,
  User,
  Settings
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import type { Project } from '@/types/project';
import type { 
  EPermitConfig, 
  EPermitApplicationData, 
  EPermitSubmissionResult 
} from '@/types/epermit';
import { PERMIT_TYPES } from '@/types/epermit';
import { EPermitConfigDialog } from './EPermitConfigDialog';

interface EPermitSubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
}

export function EPermitSubmitDialog({
  open,
  onOpenChange,
  project,
}: EPermitSubmitDialogProps) {
  const { user } = useAuth();
  const [config, setConfig] = useState<EPermitConfig | null>(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EPermitSubmissionResult | null>(null);

  const [applicationData, setApplicationData] = useState<EPermitApplicationData>({
    permitType: '',
    projectName: project.name,
    address: project.address || '',
    city: project.city || '',
    state: project.state || '',
    zipCode: project.zip_code || '',
    description: project.description || '',
    estimatedValue: project.estimated_value || undefined,
    squareFootage: project.square_footage || undefined,
    applicantName: '',
    applicantEmail: user?.email || '',
    applicantPhone: '',
    contractorLicense: '',
  });

  // Load saved config from localStorage
  useEffect(() => {
    const savedConfig = localStorage.getItem('epermit_config');
    if (savedConfig) {
      try {
        setConfig(JSON.parse(savedConfig));
      } catch (e) {
        console.error('Failed to parse e-permit config:', e);
      }
    }
  }, []);

  const handleSaveConfig = (newConfig: EPermitConfig) => {
    setConfig(newConfig);
    localStorage.setItem('epermit_config', JSON.stringify(newConfig));
  };

  const handleSubmit = async () => {
    if (!config) {
      toast.error('Please configure e-permit settings first');
      return;
    }

    if (!applicationData.permitType) {
      toast.error('Please select a permit type');
      return;
    }

    if (!applicationData.applicantName) {
      toast.error('Please enter applicant name');
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('epermit-submit', {
        body: {
          action: 'submit',
          projectId: project.id,
          system: config.system,
          environment: config.environment,
          credentials: config.credentials,
          applicationData,
        },
      });

      if (error) throw error;

      setResult(data);
      
      if (data.success) {
        toast.success(`Permit submitted! Tracking #: ${data.trackingNumber}`);
      } else {
        toast.error(data.error || 'Submission failed');
      }
    } catch (err: any) {
      console.error('E-permit submission error:', err);
      setResult({
        success: false,
        system: config.system,
        status: 'error',
        submittedAt: new Date().toISOString(),
        error: err.message,
      });
      toast.error('Failed to submit permit application');
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = <K extends keyof EPermitApplicationData>(
    field: K, 
    value: EPermitApplicationData[K]
  ) => {
    setApplicationData(prev => ({ ...prev, [field]: value }));
  };

  const permitTypes = config ? PERMIT_TYPES[config.system] : [];

  return (
    <>
      <EPermitConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        config={config || undefined}
        onSave={handleSaveConfig}
      />

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Submit to E-Permit System
            </DialogTitle>
            <DialogDescription>
              Submit your permit application directly to Accela or CityView.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[60vh] pr-4">
            {/* Config Status */}
            <div className="mb-4">
              {config?.isConfigured ? (
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-emerald-500" />
                    <span className="text-sm font-medium">
                      Connected to {config.system === 'accela' ? 'Accela' : 'CityView'}
                    </span>
                    <Badge variant={config.environment === 'sandbox' ? 'secondary' : 'default'}>
                      {config.environment}
                    </Badge>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setConfigDialogOpen(true)}
                  >
                    <Settings className="h-4 w-4 mr-1" />
                    Change
                  </Button>
                </div>
              ) : (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Not Configured</AlertTitle>
                  <AlertDescription className="flex items-center justify-between">
                    <span>Configure your e-permit system connection to submit.</span>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => setConfigDialogOpen(true)}
                    >
                      Configure
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {config?.isConfigured && !result && (
              <div className="space-y-6">
                {/* Permit Type */}
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Permit Type *
                  </Label>
                  <Select
                    value={applicationData.permitType}
                    onValueChange={(v) => updateField('permitType', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select permit type" />
                    </SelectTrigger>
                    <SelectContent>
                      {permitTypes.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                {/* Project Info */}
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Project Information
                  </h4>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Project Name</Label>
                      <Input
                        value={applicationData.projectName}
                        onChange={(e) => updateField('projectName', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Estimated Value</Label>
                      <Input
                        type="number"
                        value={applicationData.estimatedValue || ''}
                        onChange={(e) => updateField('estimatedValue', parseFloat(e.target.value) || undefined)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Street Address</Label>
                    <Input
                      value={applicationData.address}
                      onChange={(e) => updateField('address', e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>City</Label>
                      <Input
                        value={applicationData.city}
                        onChange={(e) => updateField('city', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>State</Label>
                      <Input
                        value={applicationData.state}
                        onChange={(e) => updateField('state', e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ZIP Code</Label>
                      <Input
                        value={applicationData.zipCode}
                        onChange={(e) => updateField('zipCode', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Project Description</Label>
                    <Textarea
                      rows={3}
                      value={applicationData.description}
                      onChange={(e) => updateField('description', e.target.value)}
                    />
                  </div>
                </div>

                <Separator />

                {/* Applicant Info */}
                <div className="space-y-4">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Applicant Information
                  </h4>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Full Name *</Label>
                      <Input
                        value={applicationData.applicantName}
                        onChange={(e) => updateField('applicantName', e.target.value)}
                        placeholder="John Smith"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Email *</Label>
                      <Input
                        type="email"
                        value={applicationData.applicantEmail}
                        onChange={(e) => updateField('applicantEmail', e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Phone Number</Label>
                      <Input
                        type="tel"
                        value={applicationData.applicantPhone || ''}
                        onChange={(e) => updateField('applicantPhone', e.target.value)}
                        placeholder="(555) 123-4567"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Contractor License #</Label>
                      <Input
                        value={applicationData.contractorLicense || ''}
                        onChange={(e) => updateField('contractorLicense', e.target.value)}
                        placeholder="Optional"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Submission Result */}
            {result && (
              <div className="space-y-4">
                <Alert variant={result.success ? 'default' : 'destructive'}>
                  {result.success ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <AlertTitle>
                    {result.success ? 'Submission Successful!' : 'Submission Failed'}
                  </AlertTitle>
                  <AlertDescription>
                    {result.success 
                      ? result.message || 'Your permit application has been submitted.'
                      : result.error || 'An error occurred during submission.'}
                  </AlertDescription>
                </Alert>

                {result.success && (
                  <div className="p-4 bg-muted rounded-lg space-y-3">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Tracking Number</span>
                      <span className="text-sm font-mono font-medium">{result.trackingNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">System</span>
                      <Badge variant="outline">{result.system}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge>{result.status}</Badge>
                    </div>
                    {result.estimatedReviewTime && (
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Est. Review Time</span>
                        <span className="text-sm">{result.estimatedReviewTime}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {result ? 'Close' : 'Cancel'}
            </Button>
            {!result && config?.isConfigured && (
              <Button 
                onClick={handleSubmit} 
                disabled={submitting || !applicationData.permitType || !applicationData.applicantName}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Application
              </Button>
            )}
            {result?.success && (
              <Button onClick={() => { setResult(null); onOpenChange(false); }}>
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
