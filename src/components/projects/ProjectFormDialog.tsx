import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2, Sparkles, Info, KeyRound } from 'lucide-react';
import { Project, ProjectType, PROJECT_TYPE_LABELS } from '@/types/project';
import { CreateProjectData, UpdateProjectData } from '@/hooks/useProjects';
import { JurisdictionLookup } from './JurisdictionLookup';
import { toast } from 'sonner';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

interface ProjectFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
  onSubmit: (data: CreateProjectData | UpdateProjectData) => Promise<void>;
  loading?: boolean;
}

const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
];

// Field info tooltips
const FIELD_INFO = {
  name: "A unique, descriptive name for your project (e.g., 'Smith Residence Addition' or '123 Main St Renovation')",
  project_type: "The category that best describes your construction work. This helps determine required permits and inspections.",
  jurisdiction: "The city, county, or municipality where the project is located. This determines which building codes apply.",
  permit_number: "The official permit number assigned by the jurisdiction after approval. Leave blank until assigned.",
  address: "The physical street address where construction will take place.",
  project_url: "Optional direct link to the project page in the jurisdiction portal. Used by the Portal Monitor Agent as a deep link.",
  city: "The city or town where the project is located.",
  state: "The US state where the project is located.",
  zip_code: "The 5-digit ZIP code for the project location.",
  estimated_value: "The total estimated construction cost in dollars. This may affect permit fees.",
  square_footage: "The total square footage of the project area (new construction or renovation space).",
  deadline: "Your target completion date for the permit approval or project milestone.",
  permit_fee: "The fee charged by the jurisdiction for the building permit. Can be auto-filled from jurisdiction data.",
  expeditor_cost: "Any fees paid to expediting services or consultants to help process the permit.",
  description: "A brief summary of the work to be performed (e.g., 'Kitchen remodel with new electrical and plumbing').",
  notes: "Internal notes or reminders about this project. Not shared with the jurisdiction.",
};

// Validation schema
const projectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(200, "Project name must be less than 200 characters"),
  address: z.string().trim().max(500, "Address must be less than 500 characters").optional(),
  project_url: z
    .union([
      z
        .string()
        .trim()
        .max(1000, "Project URL must be less than 1000 characters")
        .url("Must be a valid URL"),
      z.literal(""),
    ])
    .optional(),
  city: z.string().trim().max(100, "City must be less than 100 characters").optional(),
  state: z.string().optional(),
  zip_code: z.string().trim().regex(/^(\d{5}(-\d{4})?)?$/, "Invalid ZIP code format").optional(),
  jurisdiction: z.string().trim().max(200, "Jurisdiction must be less than 200 characters").optional(),
  project_type: z.string().optional(),
  description: z.string().trim().max(2000, "Description must be less than 2000 characters").optional(),
  estimated_value: z.string().optional().refine((val) => !val || !isNaN(parseFloat(val)), "Must be a valid number"),
  square_footage: z.string().optional().refine((val) => !val || !isNaN(parseInt(val)), "Must be a valid number"),
  deadline: z.string().optional(),
  notes: z.string().trim().max(2000, "Notes must be less than 2000 characters").optional(),
  permit_number: z.string().trim().max(100, "Permit number must be less than 100 characters").optional(),
  permit_fee: z.string().optional().refine((val) => !val || !isNaN(parseFloat(val)), "Must be a valid number"),
  expeditor_cost: z.string().optional().refine((val) => !val || !isNaN(parseFloat(val)), "Must be a valid number"),
});

type FormErrors = Partial<Record<keyof z.infer<typeof projectSchema>, string>>;

// Info button component
function FieldInfo({ info }: { info: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="ml-1 inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => e.preventDefault()}
          >
            <Info className="h-3.5 w-3.5" />
            <span className="sr-only">More info</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs bg-popover text-popover-foreground border shadow-md z-50">
          <p className="text-sm">{info}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Error message component
function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-sm text-destructive mt-1">{error}</p>;
}

interface CredentialOption {
  id: string;
  jurisdiction: string;
  portal_username: string;
  login_url: string | null;
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  project,
  onSubmit,
  loading = false,
}: ProjectFormDialogProps) {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    project_url: '',
    city: '',
    state: '',
    zip_code: '',
    jurisdiction: '',
    project_type: '' as ProjectType | '',
    description: '',
    estimated_value: '',
    square_footage: '',
    deadline: '',
    notes: '',
    permit_number: '',
    permit_fee: '',
    expeditor_cost: '',
    credential_id: '',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [credentials, setCredentials] = useState<CredentialOption[]>([]);

  useEffect(() => {
    if (!user || !open) return;
    supabase
      .from('portal_credentials')
      .select('id, jurisdiction, portal_username, login_url')
      .eq('user_id', user.id)
      .order('jurisdiction', { ascending: true })
      .then(({ data }) => setCredentials(data || []));
  }, [user, open]);

  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        address: project.address || '',
        project_url: (project as any).project_url || '',
        city: project.city || '',
        state: project.state || '',
        zip_code: project.zip_code || '',
        jurisdiction: project.jurisdiction || '',
        project_type: project.project_type || '',
        description: project.description || '',
        estimated_value: project.estimated_value?.toString() || '',
        square_footage: project.square_footage?.toString() || '',
        deadline: project.deadline ? project.deadline.split('T')[0] : '',
        notes: project.notes || '',
        permit_number: project.permit_number || '',
        permit_fee: (project as any).permit_fee?.toString() || '',
        expeditor_cost: (project as any).expeditor_cost?.toString() || '',
        credential_id: project.credential_id || '',
      });
      setErrors({});
      setTouched(new Set());
    } else {
      setFormData({
        name: '',
        address: '',
        project_url: '',
        city: '',
        state: '',
        zip_code: '',
        jurisdiction: '',
        project_type: '',
        description: '',
        estimated_value: '',
        square_footage: '',
        deadline: '',
        notes: '',
        permit_number: '',
        permit_fee: '',
        expeditor_cost: '',
        credential_id: '',
      });
      setErrors({});
      setTouched(new Set());
    }
  }, [project, open]);

  const validateField = (field: string, value: string): string | undefined => {
    const testData = { ...formData, [field]: value };
    const result = projectSchema.safeParse(testData);
    
    if (!result.success) {
      const fieldError = result.error.errors.find((err) => err.path[0] === field);
      return fieldError?.message;
    }
    return undefined;
  };

  const validateForm = (showAllErrors = false): boolean => {
    const result = projectSchema.safeParse(formData);
    
    if (!result.success) {
      const newErrors: FormErrors = {};
      result.error.errors.forEach((err) => {
        const field = err.path[0] as keyof FormErrors;
        if (showAllErrors || touched.has(field)) {
          newErrors[field] = err.message;
        }
      });
      setErrors(newErrors);
      return false;
    }
    
    setErrors({});
    return true;
  };

  const handleChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Only show inline errors for fields that have been touched
    if (touched.has(field)) {
      const error = validateField(field, value);
      setErrors(prev => ({
        ...prev,
        [field]: error,
      }));
    }
  };

  const handleBlur = (field: string) => {
    if (!touched.has(field)) {
      setTouched(prev => new Set(prev).add(field));
      // Validate on first blur
      const error = validateField(field, formData[field as keyof typeof formData]);
      setErrors(prev => ({
        ...prev,
        [field]: error,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Mark all fields as touched and validate
    const allFields = Object.keys(formData);
    setTouched(new Set(allFields));
    
    if (!validateForm(true)) {
      toast.error('Please fix the errors in the form before submitting.');
      return;
    }
    
    const permitFee = formData.permit_fee ? parseFloat(formData.permit_fee) : 0;
    const expeditorCost = formData.expeditor_cost ? parseFloat(formData.expeditor_cost) : 0;
    
    const data: CreateProjectData | UpdateProjectData = {
      name: formData.name.trim(),
      address: formData.address.trim() || undefined,
      project_url: formData.project_url.trim() || undefined,
      city: formData.city.trim() || undefined,
      state: formData.state || undefined,
      zip_code: formData.zip_code.trim() || undefined,
      jurisdiction: formData.jurisdiction.trim() || undefined,
      project_type: formData.project_type || undefined,
      description: formData.description.trim() || undefined,
      estimated_value: formData.estimated_value ? parseFloat(formData.estimated_value) : undefined,
      square_footage: formData.square_footage ? parseInt(formData.square_footage) : undefined,
      deadline: formData.deadline ? new Date(formData.deadline).toISOString() : undefined,
      notes: formData.notes.trim() || undefined,
      permit_fee: permitFee,
      expeditor_cost: expeditorCost,
      total_cost: permitFee + expeditorCost,
    };

    if (project && formData.permit_number) {
      (data as UpdateProjectData).permit_number = formData.permit_number.trim();
    }

    data.credential_id = formData.credential_id || null;

    await onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{project ? 'Edit Project' : 'Create New Project'}</DialogTitle>
          <DialogDescription>
            {project 
              ? 'Update the project details below.' 
              : 'Fill in the details to create a new permit project. Fields marked with * are required.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Basic Information</h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="name" className="flex items-center">
                  Project Name <span className="text-destructive ml-0.5">*</span>
                  <FieldInfo info={FIELD_INFO.name} />
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  onBlur={() => handleBlur('name')}
                  placeholder="Enter project name"
                  className={errors.name ? 'border-destructive' : ''}
                />
                <FieldError error={errors.name} />
              </div>

              <div>
                <Label htmlFor="project_type" className="flex items-center">
                  Project Type
                  <FieldInfo info={FIELD_INFO.project_type} />
                </Label>
                <Select
                  value={formData.project_type}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, project_type: value as ProjectType }))}
                >
                  <SelectTrigger className={errors.project_type ? 'border-destructive' : ''}>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border shadow-lg z-50">
                    {Object.entries(PROJECT_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError error={errors.project_type} />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="jurisdiction" className="flex items-center">
                  Jurisdiction
                  <FieldInfo info={FIELD_INFO.jurisdiction} />
                </Label>
                <JurisdictionLookup
                  value={formData.jurisdiction}
                  onChange={(value) => setFormData(prev => ({ ...prev, jurisdiction: value }))}
                  stateFilter={formData.state || undefined}
                  onSelect={(jurisdiction) => {
                    if (jurisdiction) {
                      // Auto-fill fees from jurisdiction
                      const totalFee = jurisdiction.base_permit_fee + jurisdiction.plan_review_fee;
                      setFormData(prev => ({
                        ...prev,
                        jurisdiction: jurisdiction.name,
                        permit_fee: totalFee > 0 ? totalFee.toString() : prev.permit_fee,
                      }));
                      if (totalFee > 0) {
                        toast.success(`Auto-filled permit fee: $${totalFee.toLocaleString()}`, {
                          icon: <Sparkles className="h-4 w-4" />,
                        });
                      }
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Search to auto-fill fees and SLAs from the database
                </p>
                <FieldError error={errors.jurisdiction} />
              </div>

              {project && (
                <div>
                  <Label htmlFor="permit_number" className="flex items-center">
                    Permit Number
                    <FieldInfo info={FIELD_INFO.permit_number} />
                  </Label>
                  <Input
                    id="permit_number"
                    value={formData.permit_number}
                    onChange={(e) => handleChange('permit_number', e.target.value)}
                    onBlur={() => handleBlur('permit_number')}
                    placeholder="e.g., BP-2024-12345"
                    className={errors.permit_number ? 'border-destructive' : ''}
                  />
                  <FieldError error={errors.permit_number} />
                </div>
              )}

              <div>
                <Label htmlFor="credential_id" className="flex items-center">
                  <KeyRound className="h-3.5 w-3.5 mr-1" />
                  Portal Credential
                  <FieldInfo info="Link a saved portal credential to this project. The scraper will use this credential when running." />
                </Label>
                <Select
                  value={formData.credential_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, credential_id: value === '__none__' ? '' : value }))}
                >
                  <SelectTrigger data-testid="select-credential">
                    <SelectValue placeholder="Select credential" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border shadow-lg z-50">
                    <SelectItem value="__none__">None (select a credential)</SelectItem>
                    {credentials.map((cred) => (
                      <SelectItem key={cred.id} value={cred.id}>
                        {cred.jurisdiction}{cred.portal_username ? ` — ${cred.portal_username}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Select a saved credential for portal scraping. Manage credentials in Settings.
                </p>
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Location</h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="address" className="flex items-center">
                  Street Address
                  <FieldInfo info={FIELD_INFO.address} />
                </Label>
                <Input
                  id="address"
                  value={formData.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  onBlur={() => handleBlur('address')}
                  placeholder="123 Main Street"
                  className={errors.address ? 'border-destructive' : ''}
                />
                <FieldError error={errors.address} />
              </div>

              <div>
                <Label htmlFor="city" className="flex items-center">
                  City
                  <FieldInfo info={FIELD_INFO.city} />
                </Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => handleChange('city', e.target.value)}
                  onBlur={() => handleBlur('city')}
                  placeholder="City"
                  className={errors.city ? 'border-destructive' : ''}
                />
                <FieldError error={errors.city} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="state" className="flex items-center">
                    State
                    <FieldInfo info={FIELD_INFO.state} />
                  </Label>
                  <Select
                    value={formData.state}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, state: value }))}
                  >
                    <SelectTrigger className={errors.state ? 'border-destructive' : ''}>
                      <SelectValue placeholder="State" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border shadow-lg z-50 max-h-[200px]">
                      {US_STATES.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError error={errors.state} />
                </div>

                <div>
                  <Label htmlFor="zip_code" className="flex items-center">
                    ZIP Code
                    <FieldInfo info={FIELD_INFO.zip_code} />
                  </Label>
                  <Input
                    id="zip_code"
                    value={formData.zip_code}
                    onChange={(e) => handleChange('zip_code', e.target.value)}
                    onBlur={() => handleBlur('zip_code')}
                    placeholder="12345"
                    className={errors.zip_code ? 'border-destructive' : ''}
                  />
                  <FieldError error={errors.zip_code} />
                </div>
              </div>
            </div>
          </div>

          {/* Project Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">Project Details</h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="estimated_value" className="flex items-center">
                  Estimated Value ($)
                  <FieldInfo info={FIELD_INFO.estimated_value} />
                </Label>
                <Input
                  id="estimated_value"
                  type="number"
                  value={formData.estimated_value}
                  onChange={(e) => handleChange('estimated_value', e.target.value)}
                  onBlur={() => handleBlur('estimated_value')}
                  placeholder="0.00"
                  className={errors.estimated_value ? 'border-destructive' : ''}
                />
                <FieldError error={errors.estimated_value} />
              </div>

              <div>
                <Label htmlFor="square_footage" className="flex items-center">
                  Square Footage
                  <FieldInfo info={FIELD_INFO.square_footage} />
                </Label>
                <Input
                  id="square_footage"
                  type="number"
                  value={formData.square_footage}
                  onChange={(e) => handleChange('square_footage', e.target.value)}
                  onBlur={() => handleBlur('square_footage')}
                  placeholder="0"
                  className={errors.square_footage ? 'border-destructive' : ''}
                />
                <FieldError error={errors.square_footage} />
              </div>

              <div>
                <Label htmlFor="deadline" className="flex items-center">
                  Deadline
                  <FieldInfo info={FIELD_INFO.deadline} />
                </Label>
                <Input
                  id="deadline"
                  type="date"
                  value={formData.deadline}
                  onChange={(e) => handleChange('deadline', e.target.value)}
                  onBlur={() => handleBlur('deadline')}
                  className={errors.deadline ? 'border-destructive' : ''}
                />
                <FieldError error={errors.deadline} />
              </div>

              <div>
                <Label htmlFor="permit_fee" className="flex items-center">
                  Permit Fee ($)
                  <FieldInfo info={FIELD_INFO.permit_fee} />
                </Label>
                <Input
                  id="permit_fee"
                  type="number"
                  value={formData.permit_fee}
                  onChange={(e) => handleChange('permit_fee', e.target.value)}
                  onBlur={() => handleBlur('permit_fee')}
                  placeholder="0.00"
                  className={errors.permit_fee ? 'border-destructive' : ''}
                />
                <FieldError error={errors.permit_fee} />
              </div>

              <div>
                <Label htmlFor="expeditor_cost" className="flex items-center">
                  Expeditor Cost ($)
                  <FieldInfo info={FIELD_INFO.expeditor_cost} />
                </Label>
                <Input
                  id="expeditor_cost"
                  type="number"
                  value={formData.expeditor_cost}
                  onChange={(e) => handleChange('expeditor_cost', e.target.value)}
                  onBlur={() => handleBlur('expeditor_cost')}
                  placeholder="0.00"
                  className={errors.expeditor_cost ? 'border-destructive' : ''}
                />
                <FieldError error={errors.expeditor_cost} />
              </div>
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="project_url" className="flex items-center">
                Project URL (optional)
                <FieldInfo info={FIELD_INFO.project_url} />
              </Label>
              <Input
                id="project_url"
                value={formData.project_url}
                onChange={(e) => handleChange('project_url', e.target.value)}
                onBlur={() => handleBlur('project_url')}
                placeholder="https://..."
                className={errors.project_url ? 'border-destructive' : ''}
              />
              <FieldError error={errors.project_url} />
            </div>

            <div>
              <Label htmlFor="description" className="flex items-center">
                Description
                <FieldInfo info={FIELD_INFO.description} />
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                onBlur={() => handleBlur('description')}
                placeholder="Describe the project scope..."
                rows={3}
                className={errors.description ? 'border-destructive' : ''}
              />
              <FieldError error={errors.description} />
            </div>

            <div>
              <Label htmlFor="notes" className="flex items-center">
                Notes
                <FieldInfo info={FIELD_INFO.notes} />
              </Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                onBlur={() => handleBlur('notes')}
                placeholder="Additional notes..."
                rows={2}
                className={errors.notes ? 'border-destructive' : ''}
              />
              <FieldError error={errors.notes} />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {project ? 'Save Changes' : 'Create Project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
