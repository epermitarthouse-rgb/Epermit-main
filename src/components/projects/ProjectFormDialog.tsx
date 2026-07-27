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
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Loader2, Sparkles, Info, KeyRound } from 'lucide-react';
import { Project, ProjectType, PROJECT_TYPE_LABELS, PROJECT_TYPE_VALUES, coerceProjectTypeForDb } from '@/types/project';
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
  permit_number:
    "Portal permit or application/record number used by Quick Scrape (e.g. Accela record ID). Required to start a scrape for this project.",
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
  client_name: "Billing contact or organization name shown on invoices.",
  client_email: "Email for the billed client (used for QuickBooks customer matching).",
  service_type: "Short label for the service line (e.g. Permit management).",
  contract_value: "Total contract amount for billing milestones (separate from estimated construction value).",
  reimbursement_amount: "Expected reimbursable expenses passed through (e.g. agency fees).",
  reimbursement_description: "Description for reimbursable line items on invoices.",
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
  project_type: z
    .union([z.enum(PROJECT_TYPE_VALUES), z.literal("")])
    .optional(),
  description: z.string().trim().max(2000, "Description must be less than 2000 characters").optional(),
  estimated_value: z.string().optional().refine((val) => !val || !isNaN(parseFloat(val)), "Must be a valid number"),
  square_footage: z.string().optional().refine((val) => !val || !isNaN(parseInt(val)), "Must be a valid number"),
  deadline: z.string().optional(),
  notes: z.string().trim().max(2000, "Notes must be less than 2000 characters").optional(),
  permit_number: z.string().trim().max(100, "Permit number must be less than 100 characters").optional(),
  permit_fee: z.string().optional().refine((val) => !val || !isNaN(parseFloat(val)), "Must be a valid number"),
  expeditor_cost: z.string().optional().refine((val) => !val || !isNaN(parseFloat(val)), "Must be a valid number"),
  client_name: z.string().trim().max(200, "Max 200 characters").optional(),
  client_email: z
    .string()
    .trim()
    .max(320, "Email too long")
    .optional()
    .refine(
      (val) => !val || z.string().email().safeParse(val).success,
      "Must be a valid email",
    ),
  service_type: z.string().trim().max(200, "Max 200 characters").optional(),
  contract_value: z
    .string()
    .optional()
    .refine((val) => {
      if (val == null || val.trim() === "") return true;
      const n = parseFloat(val);
      return !Number.isNaN(n) && n >= 0;
    }, "Must be a number ≥ 0"),
  reimbursement_amount: z
    .string()
    .optional()
    .refine((val) => {
      if (val == null || val.trim() === "") return true;
      const n = parseFloat(val);
      return !Number.isNaN(n) && n >= 0;
    }, "Must be a number ≥ 0"),
  reimbursement_description: z.string().trim().max(2000, "Max 2000 characters").optional(),
});

type FormErrors = Partial<Record<keyof z.infer<typeof projectSchema>, string>>;

// Info button component — uses portaled TooltipContent (see ui/tooltip) to avoid dialog clipping
function FieldInfo({ info }: { info: string }) {
  return (
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
      <TooltipContent side="top" align="start" className="max-w-xs">
        <p className="text-sm leading-relaxed">{info}</p>
      </TooltipContent>
    </Tooltip>
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
    client_name: '',
    client_email: '',
    service_type: '',
    contract_value: '',
    reimbursement_amount: '',
    reimbursement_description: '',
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
        project_url: project.project_url || '',
        city: project.city || '',
        state: project.state || '',
        zip_code: project.zip_code || '',
        jurisdiction: project.jurisdiction || '',
        project_type: coerceProjectTypeForDb(project.project_type) || '',
        description: project.description || '',
        estimated_value: project.estimated_value?.toString() || '',
        square_footage: project.square_footage?.toString() || '',
        deadline: project.deadline ? project.deadline.split('T')[0] : '',
        notes: project.notes || '',
        permit_number: project.permit_number || '',
        permit_fee: project.permit_fee?.toString() || '',
        expeditor_cost: project.expeditor_cost?.toString() || '',
        credential_id: project.credential_id || '',
        client_name: project.client_name ?? '',
        client_email: project.client_email ?? '',
        service_type: project.service_type ?? '',
        contract_value:
          project.contract_value != null && !Number.isNaN(Number(project.contract_value))
            ? String(project.contract_value)
            : '',
        reimbursement_amount:
          project.reimbursement_amount != null &&
          !Number.isNaN(Number(project.reimbursement_amount))
            ? String(project.reimbursement_amount)
            : '',
        reimbursement_description: project.reimbursement_description ?? '',
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
        client_name: '',
        client_email: '',
        service_type: '',
        contract_value: '',
        reimbursement_amount: '',
        reimbursement_description: '',
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
    const newErrors: FormErrors = {};

    if (!result.success) {
      result.error.errors.forEach((err) => {
        const field = err.path[0] as keyof FormErrors;
        if (showAllErrors || touched.has(field)) {
          newErrors[field] = err.message;
        }
      });
    }

    // Scrape contract: a linked portal credential needs a project permit/application number.
    if (formData.credential_id && !formData.permit_number.trim()) {
      if (showAllErrors || touched.has("permit_number")) {
        newErrors.permit_number =
          "Permit / Application Number is required when a portal credential is linked.";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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
    
    const permitFee = formData.permit_fee ? parseFloat(formData.permit_fee) : undefined;
    const expeditorCost = formData.expeditor_cost ? parseFloat(formData.expeditor_cost) : undefined;

    const data: CreateProjectData | UpdateProjectData = {
      name: formData.name.trim(),
      address: formData.address.trim() || undefined,
      city: formData.city.trim() || undefined,
      state: formData.state || undefined,
      zip_code: formData.zip_code.trim() || undefined,
      jurisdiction: formData.jurisdiction.trim() || undefined,
      project_type: coerceProjectTypeForDb(formData.project_type),
      description: formData.description.trim() || undefined,
      estimated_value: formData.estimated_value ? parseFloat(formData.estimated_value) : undefined,
      square_footage: formData.square_footage ? parseInt(formData.square_footage) : undefined,
      deadline: formData.deadline ? new Date(formData.deadline).toISOString() : undefined,
      notes: formData.notes.trim() || undefined,
    };

    // Optional portal deep-link — omit when empty so create does not send unknown/blank columns.
    if (formData.project_url.trim()) {
      data.project_url = formData.project_url.trim();
    }

    // Fees: only send when the user entered a value (create) or when editing.
    if (permitFee !== undefined) {
      data.permit_fee = permitFee;
    }
    if (expeditorCost !== undefined) {
      data.expeditor_cost = expeditorCost;
    }
    if (permitFee !== undefined || expeditorCost !== undefined) {
      data.total_cost = (permitFee || 0) + (expeditorCost || 0);
    }

    // Billing fields — include only when set on create; allow null clears on edit.
    const clientName = formData.client_name.trim();
    const clientEmail = formData.client_email.trim();
    const serviceType = formData.service_type.trim();
    const contractValue = formData.contract_value.trim();
    const reimbursementAmount = formData.reimbursement_amount.trim();
    const reimbursementDescription = formData.reimbursement_description.trim();

    if (project) {
      data.client_name = clientName || null;
      data.client_email = clientEmail || null;
      data.service_type = serviceType || null;
      data.contract_value = contractValue ? parseFloat(contractValue) : null;
      data.reimbursement_amount = reimbursementAmount ? parseFloat(reimbursementAmount) : null;
      data.reimbursement_description = reimbursementDescription || null;
      data.credential_id = formData.credential_id || null;
      if (formData.permit_number.trim()) {
        data.permit_number = formData.permit_number.trim();
      }
    } else {
      if (clientName) data.client_name = clientName;
      if (clientEmail) data.client_email = clientEmail;
      if (serviceType) data.service_type = serviceType;
      if (contractValue) data.contract_value = parseFloat(contractValue);
      if (reimbursementAmount) data.reimbursement_amount = parseFloat(reimbursementAmount);
      if (reimbursementDescription) data.reimbursement_description = reimbursementDescription;
      if (formData.credential_id) data.credential_id = formData.credential_id;
      if (formData.permit_number.trim()) data.permit_number = formData.permit_number.trim();
    }

    await onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border-border bg-card shadow-lg">
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
            <h3 className="font-tight text-sm font-semibold text-muted-foreground">Basic Information</h3>
            
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

              <div>
                <Label htmlFor="permit_number" className="flex items-center">
                  Permit / Application Number
                  {formData.credential_id ? (
                    <span className="ml-1 text-destructive">*</span>
                  ) : null}
                  <FieldInfo info={FIELD_INFO.permit_number} />
                </Label>
                <Input
                  id="permit_number"
                  value={formData.permit_number}
                  onChange={(e) => handleChange('permit_number', e.target.value)}
                  onBlur={() => handleBlur('permit_number')}
                  placeholder="e.g., B2508799 or BP-2024-12345"
                  className={errors.permit_number ? 'border-destructive' : ''}
                  data-testid="input-permit-number"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Used by Quick Scrape to find the portal record. You can also set it later in Edit Project or the header Active Project control.
                </p>
                <FieldError error={errors.permit_number} />
              </div>

              <div>
                <Label htmlFor="credential_id" className="flex items-center">
                  <KeyRound className="h-3.5 w-3.5 mr-1" />
                  Portal Credential
                  <FieldInfo info="Link a saved portal credential to this project. The scraper will use this credential when running." />
                </Label>
                <Select
                  value={formData.credential_id}
                  onValueChange={(value) => {
                    const next = value === '__none__' ? '' : value;
                    setFormData(prev => ({ ...prev, credential_id: next }));
                    setTouched(prev => new Set(prev).add('credential_id').add('permit_number'));
                    if (next && !formData.permit_number.trim()) {
                      setErrors(prev => ({
                        ...prev,
                        permit_number:
                          "Permit / Application Number is required when a portal credential is linked.",
                      }));
                    } else if (!next) {
                      setErrors(prev => {
                        const { permit_number: _removed, ...rest } = prev;
                        return rest;
                      });
                    }
                  }}
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
            <h3 className="font-tight text-sm font-semibold text-muted-foreground">Location</h3>
            
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
            <h3 className="font-tight text-sm font-semibold text-muted-foreground">Project Details</h3>
            
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

          {/* Billing (optional) */}
          <div className="space-y-4 rounded-lg border border-border bg-muted/25 p-4">
            <div>
              <h3 className="font-tight text-sm font-semibold text-foreground">Billing</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Optional fields for invoicing and QuickBooks. Leave blank if not applicable.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="client_name" className="flex items-center">
                  Client name
                  <FieldInfo info={FIELD_INFO.client_name} />
                </Label>
                <Input
                  id="client_name"
                  value={formData.client_name}
                  onChange={(e) => handleChange('client_name', e.target.value)}
                  onBlur={() => handleBlur('client_name')}
                  placeholder="Organization or billed party"
                  className={`bg-background ${errors.client_name ? 'border-destructive' : ''}`}
                />
                <FieldError error={errors.client_name} />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="client_email" className="flex items-center">
                  Client email
                  <FieldInfo info={FIELD_INFO.client_email} />
                </Label>
                <Input
                  id="client_email"
                  type="email"
                  autoComplete="email"
                  value={formData.client_email}
                  onChange={(e) => handleChange('client_email', e.target.value)}
                  onBlur={() => handleBlur('client_email')}
                  placeholder="billing@example.com"
                  className={`bg-background ${errors.client_email ? 'border-destructive' : ''}`}
                />
                <FieldError error={errors.client_email} />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="service_type" className="flex items-center">
                  Service type
                  <FieldInfo info={FIELD_INFO.service_type} />
                </Label>
                <Input
                  id="service_type"
                  value={formData.service_type}
                  onChange={(e) => handleChange('service_type', e.target.value)}
                  onBlur={() => handleBlur('service_type')}
                  placeholder="e.g. Permit management"
                  className={`bg-background ${errors.service_type ? 'border-destructive' : ''}`}
                />
                <FieldError error={errors.service_type} />
              </div>

              <div>
                <Label htmlFor="contract_value" className="flex items-center">
                  Contract value ($)
                  <FieldInfo info={FIELD_INFO.contract_value} />
                </Label>
                <Input
                  id="contract_value"
                  type="number"
                  min={0}
                  step="0.01"
                  value={formData.contract_value}
                  onChange={(e) => handleChange('contract_value', e.target.value)}
                  onBlur={() => handleBlur('contract_value')}
                  placeholder="0.00"
                  className={`bg-background ${errors.contract_value ? 'border-destructive' : ''}`}
                />
                <FieldError error={errors.contract_value} />
              </div>

              <div>
                <Label htmlFor="reimbursement_amount" className="flex items-center">
                  Reimbursement ($)
                  <FieldInfo info={FIELD_INFO.reimbursement_amount} />
                </Label>
                <Input
                  id="reimbursement_amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={formData.reimbursement_amount}
                  onChange={(e) => handleChange('reimbursement_amount', e.target.value)}
                  onBlur={() => handleBlur('reimbursement_amount')}
                  placeholder="0.00"
                  className={`bg-background ${errors.reimbursement_amount ? 'border-destructive' : ''}`}
                />
                <FieldError error={errors.reimbursement_amount} />
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="reimbursement_description" className="flex items-center">
                  Reimbursement description
                  <FieldInfo info={FIELD_INFO.reimbursement_description} />
                </Label>
                <Textarea
                  id="reimbursement_description"
                  value={formData.reimbursement_description}
                  onChange={(e) =>
                    handleChange('reimbursement_description', e.target.value)
                  }
                  onBlur={() => handleBlur('reimbursement_description')}
                  placeholder="e.g. City filing fees"
                  rows={2}
                  className={`bg-background ${errors.reimbursement_description ? 'border-destructive' : ''}`}
                />
                <FieldError error={errors.reimbursement_description} />
              </div>
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
