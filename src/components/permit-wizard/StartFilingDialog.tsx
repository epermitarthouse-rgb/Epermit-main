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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Rocket,
  Loader2,
  Plus,
  Trash2,
  Upload,
  FileText,
  Building2,
  User,
  KeyRound,
  AlertTriangle,
  X,
  MapPin,
  Home,
  Mail,
  Phone,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useProjects } from '@/hooks/useProjects';
import type { Project } from '@/types/project';
import { PROJECT_TYPE_LABELS } from '@/types/project';
import type { ProjectType } from '@/types/project';

interface Professional {
  id: string;
  name: string;
  licenseType: string;
  licenseNumber: string;
  role: string;
}

interface DocumentFile {
  id: string;
  file: File;
  documentType: string;
}

interface PortalCredential {
  id: string;
  jurisdiction: string;
  portal_username: string;
  login_url: string | null;
}

interface MunicipalityConfig {
  id: string;
  municipality_key: string;
  display_name: string;
  short_name: string;
  state: string;
  county: string | null;
  portal_type: string;
  portal_base_url: string;
  login_url: string | null;
  is_active: boolean;
}

interface StartFilingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project | null;
  onFilingStarted?: (filingId: string) => void;
  onProjectCreated?: (project: Project) => void;
}

const PROJECT_TYPES_LIST = Object.entries(PROJECT_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const PROPERTY_TYPE_GROUPS = [
  {
    group: 'Residential',
    items: [
      { value: 'single_family', label: 'Single-Family Dwelling' },
      { value: 'two_family_duplex', label: 'Two-Family / Duplex' },
      { value: 'townhouse_rowhouse', label: 'Townhouse / Rowhouse' },
      { value: 'multi_family_small', label: 'Multi-Family (3–4 Units)' },
      { value: 'multi_family_large', label: 'Multi-Family (5+ Units)' },
      { value: 'adu', label: 'Accessory Dwelling Unit (ADU)' },
      { value: 'mixed_use_residential', label: 'Mixed-Use Residential' },
    ],
  },
  {
    group: 'Commercial',
    items: [
      { value: 'office', label: 'Office' },
      { value: 'retail_store', label: 'Retail / Store' },
      { value: 'restaurant_food_service', label: 'Restaurant / Food Service' },
      { value: 'hotel_motel', label: 'Hotel / Motel' },
      { value: 'shopping_center', label: 'Shopping Center / Mall' },
      { value: 'medical_dental_office', label: 'Medical / Dental Office' },
      { value: 'bank_financial', label: 'Bank / Financial Institution' },
      { value: 'gas_station_auto', label: 'Gas Station / Auto Service' },
      { value: 'parking_garage', label: 'Parking Garage / Lot' },
    ],
  },
  {
    group: 'Industrial',
    items: [
      { value: 'warehouse', label: 'Warehouse / Distribution' },
      { value: 'manufacturing', label: 'Manufacturing / Factory' },
      { value: 'data_center', label: 'Data Center' },
      { value: 'self_storage', label: 'Self-Storage Facility' },
      { value: 'laboratory', label: 'Laboratory / R&D' },
    ],
  },
  {
    group: 'Institutional',
    items: [
      { value: 'school_educational', label: 'School / Educational' },
      { value: 'hospital_healthcare', label: 'Hospital / Healthcare' },
      { value: 'church_religious', label: 'Church / Religious' },
      { value: 'government_public', label: 'Government / Public' },
      { value: 'library_museum', label: 'Library / Museum' },
      { value: 'community_center', label: 'Community Center' },
    ],
  },
  {
    group: 'Assembly & Recreation',
    items: [
      { value: 'theater_auditorium', label: 'Theater / Auditorium' },
      { value: 'sports_recreation', label: 'Sports / Recreation Facility' },
      { value: 'convention_center', label: 'Convention / Event Center' },
    ],
  },
  {
    group: 'Infrastructure & Other',
    items: [
      { value: 'utility', label: 'Utility / Infrastructure' },
      { value: 'telecom', label: 'Telecommunications' },
      { value: 'transportation', label: 'Transportation Facility' },
      { value: 'vacant_land', label: 'Vacant Land' },
      { value: 'agricultural', label: 'Agricultural' },
      { value: 'temporary_structure', label: 'Temporary Structure' },
      { value: 'other', label: 'Other' },
    ],
  },
];

const FALLBACK_MUNICIPALITIES: MunicipalityConfig[] = [
  { id: 'fb-1', municipality_key: 'dc_dob', display_name: 'DC Department of Buildings', short_name: 'DC DOB', state: 'DC', county: null, portal_type: 'accela', portal_base_url: 'https://permitwizard.dcra.dc.gov', login_url: 'https://login.dc.gov', is_active: true },
  { id: 'fb-2', municipality_key: 'fairfax_county_va', display_name: 'Fairfax County Land Development Services', short_name: 'Fairfax Co.', state: 'VA', county: 'Fairfax', portal_type: 'accela', portal_base_url: 'https://plus.fairfaxcounty.gov/CitizenAccess', login_url: null, is_active: true },
  { id: 'fb-3', municipality_key: 'baltimore_city_md', display_name: 'Baltimore City Housing & Community Development', short_name: 'Baltimore City', state: 'MD', county: null, portal_type: 'accela', portal_base_url: 'https://aca-prod.accela.com/BALTIMORE', login_url: null, is_active: true },
  { id: 'fb-4', municipality_key: 'howard_county_md', display_name: 'Howard County Inspections, Licenses & Permits', short_name: 'Howard Co.', state: 'MD', county: 'Howard', portal_type: 'accela', portal_base_url: 'https://aca-prod.accela.com/HOWARD', login_url: null, is_active: true },
  { id: 'fb-5', municipality_key: 'arlington_county_va', display_name: 'Arlington County Inspection Services', short_name: 'Arlington Co.', state: 'VA', county: 'Arlington', portal_type: 'accela', portal_base_url: 'https://aca-prod.accela.com/ARLINGTON', login_url: null, is_active: true },
  { id: 'fb-6', municipality_key: 'anne_arundel_county_md', display_name: 'Anne Arundel County Inspections & Permits', short_name: 'Anne Arundel Co.', state: 'MD', county: 'Anne Arundel', portal_type: 'accela', portal_base_url: 'https://aca-prod.accela.com/AACOUNTY', login_url: null, is_active: true },
  { id: 'fb-7', municipality_key: 'pg_county_md', display_name: "Prince George's County DPIE", short_name: 'PG County', state: 'MD', county: "Prince George's", portal_type: 'momentum_liferay', portal_base_url: 'https://permits.mypgc.us', login_url: null, is_active: true },
  { id: 'fb-8', municipality_key: 'montgomery_county_md', display_name: 'Montgomery County DPS', short_name: 'Montgomery Co.', state: 'MD', county: 'Montgomery', portal_type: 'aspnet_webforms', portal_base_url: 'https://eplans.montgomeryplanning.org', login_url: null, is_active: true },
  { id: 'fb-9', municipality_key: 'alexandria_va', display_name: 'City of Alexandria Code Administration', short_name: 'Alexandria', state: 'VA', county: null, portal_type: 'energov', portal_base_url: 'https://permits.alexandriava.gov', login_url: null, is_active: true },
  { id: 'fb-10', municipality_key: 'loudoun_county_va', display_name: 'Loudoun County Building & Development', short_name: 'Loudoun Co.', state: 'VA', county: 'Loudoun', portal_type: 'energov', portal_base_url: 'https://permits.loudoun.gov', login_url: null, is_active: true },
];

const LICENSE_TYPES = [
  { value: 'architect', label: 'Architect' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'expediter', label: 'Expediter' },
  { value: 'master_electrician', label: 'Master Electrician' },
  { value: 'master_plumber', label: 'Master Plumber' },
  { value: 'master_hvac', label: 'Master HVAC' },
];

const PROFESSIONAL_ROLES = [
  { value: 'architect_of_record', label: 'Architect of Record' },
  { value: 'structural_engineer', label: 'Structural Engineer' },
  { value: 'mep_engineer', label: 'MEP Engineer' },
  { value: 'general_contractor', label: 'General Contractor' },
  { value: 'permit_expediter', label: 'Permit Expediter' },
  { value: 'owner', label: 'Owner' },
];

const DOCUMENT_TYPES = [
  { value: 'plan', label: 'Plans / Drawings' },
  { value: 'cost_estimate', label: 'Cost Estimate' },
  { value: 'contract', label: 'Contract' },
  { value: 'specification', label: 'Specification Sheet' },
  { value: 'approved_documents', label: 'Approved Documents' },
  { value: 'menu', label: 'Menus' },
  { value: 'plat_survey', label: 'Plats / Surveys' },
  { value: 'geotech_report', label: 'Geotech Report' },
  { value: 'letter_of_authorization', label: 'Letter of Authorization' },
  { value: 'eif', label: 'Environmental Intake Form (EIF)' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'other', label: 'Other' },
];

const PERMIT_TYPES = [
  { value: 'building', label: 'Building Permit' },
  { value: 'construction', label: 'Construction Permit' },
  { value: 'electrical', label: 'Electrical Permit' },
  { value: 'mechanical', label: 'Mechanical Permit' },
  { value: 'plumbing', label: 'Plumbing Permit' },
  { value: 'fire_protection', label: 'Fire Protection Permit' },
  { value: 'demolition', label: 'Demolition Permit' },
  { value: 'supplemental', label: 'Supplemental Permit' },
  { value: 'postcard', label: 'Postcard Permit' },
  { value: 'excavation', label: 'Excavation Permit' },
  { value: 'crane_derrick', label: 'Crane / Derrick Permit' },
  { value: 'sheeting_shoring', label: 'Sheeting & Shoring Permit' },
  { value: 'raze', label: 'Raze Permit' },
  { value: 'solar', label: 'Solar Permit' },
  { value: 'grading', label: 'Grading Permit' },
  { value: 'sediment_control', label: 'Sediment Control Permit' },
  { value: 'use_occupancy', label: 'Use & Occupancy Permit' },
  { value: 'right_of_way', label: 'Right-of-Way Permit' },
  { value: 'sign', label: 'Sign Permit' },
  { value: 'site_plan', label: 'Site Plan Permit' },
  { value: 'other', label: 'Other' },
];

const PORTAL_TYPE_LABELS: Record<string, string> = {
  accela: 'Accela',
  momentum_liferay: 'Momentum',
  aspnet_webforms: 'ASP.NET',
  energov: 'EnerGov',
};

function generateId() {
  return crypto.randomUUID();
}

function matchCredentialToMunicipality(
  credential: PortalCredential,
  municipality: MunicipalityConfig
): boolean {
  const jurisdictionLower = (credential.jurisdiction || '').toLowerCase();
  const displayLower = municipality.display_name.toLowerCase();
  const shortLower = municipality.short_name.toLowerCase();
  const stateLower = municipality.state.toLowerCase();
  const countyLower = (municipality.county || '').toLowerCase();

  if (jurisdictionLower.includes(shortLower) || shortLower.includes(jurisdictionLower)) {
    return true;
  }

  if (jurisdictionLower.includes(displayLower) || displayLower.includes(jurisdictionLower)) {
    return true;
  }

  if (credential.login_url && municipality.login_url) {
    try {
      const credHost = new URL(credential.login_url).hostname;
      const muniHost = new URL(municipality.login_url).hostname;
      if (credHost === muniHost) return true;
    } catch {}
  }

  if (credential.login_url && municipality.portal_base_url) {
    try {
      const credHost = new URL(credential.login_url).hostname;
      const muniHost = new URL(municipality.portal_base_url).hostname;
      if (credHost === muniHost) return true;
    } catch {}
  }

  if (countyLower && jurisdictionLower.includes(countyLower) && jurisdictionLower.includes(stateLower)) {
    return true;
  }

  if (municipality.municipality_key === 'dc_dob' && jurisdictionLower.includes('dc')) {
    return true;
  }

  return false;
}

export function StartFilingDialog({
  open,
  onOpenChange,
  project,
  onFilingStarted,
  onProjectCreated,
}: StartFilingDialogProps) {
  const { user } = useAuth();
  const { createProject } = useProjects();
  const [submitting, setSubmitting] = useState(false);
  const [credentials, setCredentials] = useState<PortalCredential[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [municipalities, setMunicipalities] = useState<MunicipalityConfig[]>([]);
  const [loadingMunicipalities, setLoadingMunicipalities] = useState(false);

  const [createMode, setCreateMode] = useState(!project);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectAddress, setNewProjectAddress] = useState('');
  const [newProjectJurisdiction, setNewProjectJurisdiction] = useState('');
  const [newProjectType, setNewProjectType] = useState<string>('');

  const [propertyAddress, setPropertyAddress] = useState(project?.address || '');
  const [scopeOfWork, setScopeOfWork] = useState(project?.description || '');
  const [constructionValue, setConstructionValue] = useState<string>(
    project?.estimated_value?.toString() || ''
  );
  const [propertyType, setPropertyType] = useState<string>('');
  const [permitType, setPermitType] = useState<string>('');
  const [squareFootage, setSquareFootage] = useState<string>(
    project?.square_footage?.toString() || ''
  );
  const [numberOfStories, setNumberOfStories] = useState<string>('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('');
  const [selectedMunicipalityKey, setSelectedMunicipalityKey] = useState<string>('');

  useEffect(() => {
    if (open && user) {
      loadCredentials();
      loadMunicipalities();
    }
  }, [open, user]);

  useEffect(() => {
    if (open) {
      setCreateMode(!project);
      if (project) {
        setPropertyAddress(project.address || '');
        setScopeOfWork(project.description || '');
        setConstructionValue(project.estimated_value?.toString() || '');
        setSquareFootage(project.square_footage?.toString() || '');
      } else {
        setPropertyAddress('');
        setScopeOfWork('');
        setConstructionValue('');
        setSquareFootage('');
      }
      setNewProjectName('');
      setNewProjectAddress('');
      setNewProjectJurisdiction('');
      setNewProjectType('');
      setPermitType('');
      setNumberOfStories('');
      setOwnerName('');
      setOwnerPhone('');
      setOwnerEmail('');
    }
  }, [open, project]);

  useEffect(() => {
    if (createMode && newProjectAddress) {
      setPropertyAddress(newProjectAddress);
    }
  }, [createMode, newProjectAddress]);

  async function loadMunicipalities() {
    setLoadingMunicipalities(true);
    try {
      const { data, error } = await supabase
        .from('municipality_configs')
        .select('id, municipality_key, display_name, short_name, state, county, portal_type, portal_base_url, login_url, is_active')
        .eq('is_active', true)
        .order('display_name', { ascending: true });

      if (error) throw error;
      setMunicipalities(data && data.length > 0 ? data : FALLBACK_MUNICIPALITIES);
    } catch (err) {
      console.error('Failed to load municipalities, using fallback:', err);
      setMunicipalities(FALLBACK_MUNICIPALITIES);
    } finally {
      setLoadingMunicipalities(false);
    }
  }

  async function loadCredentials() {
    if (!user) return;
    setLoadingCredentials(true);
    try {
      const { data, error } = await supabase
        .from('portal_credentials')
        .select('id, jurisdiction, portal_username, login_url')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setCredentials(data || []);
    } catch (err) {
      console.error('Failed to load credentials:', err);
    } finally {
      setLoadingCredentials(false);
    }
  }

  const selectedMunicipality = municipalities.find(
    (m) => m.municipality_key === selectedMunicipalityKey
  );

  const filteredCredentials = selectedMunicipality
    ? credentials.filter((c) => matchCredentialToMunicipality(c, selectedMunicipality))
    : credentials;

  function handleMunicipalityChange(key: string) {
    setSelectedMunicipalityKey(key);
    const muni = municipalities.find((m) => m.municipality_key === key);
    if (muni && selectedCredentialId) {
      const currentCred = credentials.find((c) => c.id === selectedCredentialId);
      if (currentCred && !matchCredentialToMunicipality(currentCred, muni)) {
        setSelectedCredentialId('');
      }
    }
    if (muni) {
      const matchingCreds = credentials.filter((c) => matchCredentialToMunicipality(c, muni));
      if (matchingCreds.length === 1 && !selectedCredentialId) {
        setSelectedCredentialId(matchingCreds[0].id);
      }
    }
  }

  function handleCredentialChange(credId: string) {
    setSelectedCredentialId(credId);
    if (!selectedMunicipalityKey) {
      const cred = credentials.find((c) => c.id === credId);
      if (cred) {
        const matchingMuni = municipalities.find((m) =>
          matchCredentialToMunicipality(cred, m)
        );
        if (matchingMuni) {
          setSelectedMunicipalityKey(matchingMuni.municipality_key);
        }
      }
    }
  }

  function addProfessional() {
    setProfessionals((prev) => [
      ...prev,
      {
        id: generateId(),
        name: '',
        licenseType: '',
        licenseNumber: '',
        role: '',
      },
    ]);
  }

  function updateProfessional(id: string, field: keyof Professional, value: string) {
    setProfessionals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  function removeProfessional(id: string) {
    setProfessionals((prev) => prev.filter((p) => p.id !== id));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const newDocs: DocumentFile[] = Array.from(files).map((file) => ({
      id: generateId(),
      file,
      documentType: 'plan',
    }));
    setDocuments((prev) => [...prev, ...newDocs]);
    e.target.value = '';
  }

  function updateDocumentType(id: string, type: string) {
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, documentType: type } : d))
    );
  }

  function removeDocument(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [documents, setDocuments] = useState<DocumentFile[]>([]);

  async function handleStartPreflight() {
    if (!user) {
      toast.error('You must be logged in');
      return;
    }

    if (createMode && !newProjectName.trim()) {
      toast.error('Project name is required');
      return;
    }

    if (!selectedMunicipalityKey) {
      toast.error('Please select a municipality');
      return;
    }

    if (!propertyAddress.trim()) {
      toast.error('Property address is required');
      return;
    }

    if (!scopeOfWork.trim()) {
      toast.error('Scope of work is required');
      return;
    }

    if (!propertyType) {
      toast.error('Please select a property type');
      return;
    }

    setSubmitting(true);

    try {
      let projectId = project?.id;

      if (createMode) {
        const newProject = await createProject({
          name: newProjectName.trim(),
          address: newProjectAddress.trim() || undefined,
          jurisdiction: newProjectJurisdiction.trim() || undefined,
          project_type: (newProjectType as ProjectType) || undefined,
          estimated_value: constructionValue ? parseFloat(constructionValue) : undefined,
        });

        if (!newProject) {
          toast.error('Failed to create project');
          setSubmitting(false);
          return;
        }

        projectId = newProject.id;
        onProjectCreated?.(newProject);
      }

      if (!projectId) {
        toast.error('No project available for filing');
        setSubmitting(false);
        return;
      }

      const { data: filing, error: filingError } = await supabase
        .from('permit_filings')
        .insert({
          project_id: projectId,
          user_id: user.id,
          filing_status: 'preflight',
          property_address: propertyAddress.trim(),
          scope_of_work: scopeOfWork.trim(),
          construction_value: constructionValue ? parseFloat(constructionValue) : null,
          property_type: propertyType,
          permit_type: permitType || null,
          square_footage: squareFootage ? parseFloat(squareFootage) : null,
          number_of_stories: numberOfStories ? parseInt(numberOfStories) : null,
          owner_name: ownerName.trim() || null,
          owner_phone: ownerPhone.trim() || null,
          owner_email: ownerEmail.trim() || null,
          municipality: selectedMunicipalityKey,
          credential_id: selectedCredentialId || null,
        })
        .select('id')
        .single();

      if (filingError) throw filingError;

      const filingId = filing.id;

      if (professionals.length > 0) {
        const validProfessionals = professionals.filter(
          (p) => p.name.trim() && p.licenseNumber.trim()
        );

        if (validProfessionals.length > 0) {
          const { error: profError } = await supabase
            .from('filing_professionals')
            .insert(
              validProfessionals.map((p) => ({
                filing_id: filingId,
                professional_name: p.name.trim(),
                license_type: p.licenseType || 'other',
                license_number: p.licenseNumber.trim(),
                role_on_project: p.role || 'other',
              }))
            );

          if (profError) {
            console.error('Failed to insert professionals:', profError);
          }
        }
      }

      if (documents.length > 0) {
        const docInserts = documents.map((d, idx) => ({
          filing_id: filingId,
          document_name: d.file.name,
          document_type: d.documentType,
          file_size_bytes: d.file.size,
          file_format: d.file.name.split('.').pop()?.toLowerCase() || 'unknown',
          validation_status: 'pending' as const,
          upload_order: idx + 1,
        }));

        const { error: docError } = await supabase
          .from('filing_documents')
          .insert(docInserts);

        if (docError) {
          console.error('Failed to insert documents:', docError);
        }
      }

      try {
        await supabase.functions.invoke('permitwizard-preflight', {
          body: {
            filing_id: filingId,
            municipality_key: selectedMunicipalityKey,
            credential_id: selectedCredentialId || null,
          },
        });
      } catch (preflightErr) {
        console.warn('Pre-flight invocation sent (may run async):', preflightErr);
      }

      toast.success('Filing created! Pre-flight pipeline started.');
      onFilingStarted?.(filingId);
      onOpenChange(false);
    } catch (err: any) {
      console.error('Failed to start filing:', err);
      toast.error(err.message || 'Failed to create filing');
    } finally {
      setSubmitting(false);
    }
  }

  const isValid =
    propertyAddress.trim() !== '' &&
    scopeOfWork.trim() !== '' &&
    propertyType !== '' &&
    selectedMunicipalityKey !== '' &&
    (!createMode || newProjectName.trim() !== '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-dialog-title">
            <Rocket className="h-5 w-5" />
            Start Permit Filing
          </DialogTitle>
          <DialogDescription>
            Select a municipality and provide project details to initiate the 9-agent autonomous filing pipeline.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-6">
            {createMode ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    New Project
                  </h4>
                  {project && (
                    <Button
                      variant="link"
                      size="sm"
                      className="text-xs h-auto p-0"
                      onClick={() => {
                        setCreateMode(false);
                        setPropertyAddress(project.address || '');
                        setScopeOfWork(project.description || '');
                        setConstructionValue(project.estimated_value?.toString() || '');
                      }}
                      data-testid="button-use-existing-project"
                    >
                      Use selected project instead
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Project Name *</Label>
                  <Input
                    data-testid="input-new-project-name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="My Building Permit Project"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Project Address</Label>
                  <Input
                    data-testid="input-new-project-address"
                    value={newProjectAddress}
                    onChange={(e) => setNewProjectAddress(e.target.value)}
                    placeholder="123 Main St NW, Washington, DC 20001"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Jurisdiction</Label>
                    <Input
                      data-testid="input-new-project-jurisdiction"
                      value={newProjectJurisdiction}
                      onChange={(e) => setNewProjectJurisdiction(e.target.value)}
                      placeholder="e.g. Washington DC"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Project Type</Label>
                    <Select value={newProjectType} onValueChange={setNewProjectType}>
                      <SelectTrigger data-testid="select-new-project-type">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROJECT_TYPES_LIST.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <span className="text-muted-foreground">Project: </span>
                  <span className="font-medium">{project?.name}</span>
                </div>
                <Button
                  variant="link"
                  size="sm"
                  className="text-xs h-auto p-0"
                  onClick={() => setCreateMode(true)}
                  data-testid="button-create-new-project"
                >
                  Create new project instead
                </Button>
              </div>
            )}

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Municipality
              </h4>

              {loadingMunicipalities ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading municipalities...
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Jurisdiction *</Label>
                  <Select value={selectedMunicipalityKey} onValueChange={handleMunicipalityChange}>
                    <SelectTrigger data-testid="select-municipality">
                      <SelectValue placeholder="Select municipality" />
                    </SelectTrigger>
                    <SelectContent>
                      {municipalities.map((m) => (
                        <SelectItem key={m.municipality_key} value={m.municipality_key}>
                          <span className="flex items-center gap-2">
                            <span>{m.display_name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {m.state}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {PORTAL_TYPE_LABELS[m.portal_type] || m.portal_type}
                            </Badge>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedMunicipality && (
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground" data-testid="text-municipality-context">
                      <span>{selectedMunicipality.short_name}</span>
                      <Badge variant="outline" className="text-xs">
                        {PORTAL_TYPE_LABELS[selectedMunicipality.portal_type] || selectedMunicipality.portal_type}
                      </Badge>
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Project Details
              </h4>

              <div className="space-y-2">
                <Label>Property Address *</Label>
                <Input
                  data-testid="input-property-address"
                  value={propertyAddress}
                  onChange={(e) => setPropertyAddress(e.target.value)}
                  placeholder="123 Main St NW, Washington, DC 20001"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Property Type *</Label>
                  <Select value={propertyType} onValueChange={setPropertyType}>
                    <SelectTrigger data-testid="select-property-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {PROPERTY_TYPE_GROUPS.map((group) => (
                        <SelectGroup key={group.group}>
                          <SelectLabel>{group.group}</SelectLabel>
                          {group.items.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Permit Type</Label>
                  <Select value={permitType} onValueChange={setPermitType}>
                    <SelectTrigger data-testid="select-permit-type">
                      <SelectValue placeholder="Select permit type" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {PERMIT_TYPES.map((pt) => (
                        <SelectItem key={pt.value} value={pt.value}>
                          {pt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Construction Value ($)</Label>
                  <Input
                    data-testid="input-construction-value"
                    type="number"
                    value={constructionValue}
                    onChange={(e) => setConstructionValue(e.target.value)}
                    placeholder="150000"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Square Footage</Label>
                  <Input
                    data-testid="input-square-footage"
                    type="number"
                    value={squareFootage}
                    onChange={(e) => setSquareFootage(e.target.value)}
                    placeholder="2500"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Number of Stories</Label>
                  <Input
                    data-testid="input-number-of-stories"
                    type="number"
                    value={numberOfStories}
                    onChange={(e) => setNumberOfStories(e.target.value)}
                    placeholder="3"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Scope of Work *</Label>
                <Textarea
                  data-testid="input-scope-of-work"
                  rows={3}
                  value={scopeOfWork}
                  onChange={(e) => setScopeOfWork(e.target.value)}
                  placeholder="Describe the construction work to be performed..."
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Home className="h-4 w-4" />
                Owner Information
              </h4>

              <div className="space-y-2">
                <Label>Owner / Applicant Name</Label>
                <Input
                  data-testid="input-owner-name"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Property owner or applicant full name"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    Owner Phone
                  </Label>
                  <Input
                    data-testid="input-owner-phone"
                    type="tel"
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(e.target.value)}
                    placeholder="(202) 555-0100"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    Owner Email
                  </Label>
                  <Input
                    data-testid="input-owner-email"
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="owner@example.com"
                  />
                </div>
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Professionals
                </h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addProfessional}
                  data-testid="button-add-professional"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add
                </Button>
              </div>

              {professionals.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No professionals added yet. Add architects, engineers, or contractors.
                </p>
              )}

              {professionals.map((prof, idx) => (
                <Card key={prof.id}>
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        Professional #{idx + 1}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeProfessional(prof.id)}
                        data-testid={`button-remove-professional-${idx}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Full Name</Label>
                        <Input
                          data-testid={`input-professional-name-${idx}`}
                          value={prof.name}
                          onChange={(e) => updateProfessional(prof.id, 'name', e.target.value)}
                          placeholder="Jane Doe"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">License Number</Label>
                        <Input
                          data-testid={`input-professional-license-${idx}`}
                          value={prof.licenseNumber}
                          onChange={(e) =>
                            updateProfessional(prof.id, 'licenseNumber', e.target.value)
                          }
                          placeholder="DC-12345"
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">License Type</Label>
                        <Select
                          value={prof.licenseType}
                          onValueChange={(v) => updateProfessional(prof.id, 'licenseType', v)}
                        >
                          <SelectTrigger data-testid={`select-license-type-${idx}`}>
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {LICENSE_TYPES.map((lt) => (
                              <SelectItem key={lt.value} value={lt.value}>
                                {lt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Role on Project</Label>
                        <Select
                          value={prof.role}
                          onValueChange={(v) => updateProfessional(prof.id, 'role', v)}
                        >
                          <SelectTrigger data-testid={`select-role-${idx}`}>
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            {PROFESSIONAL_ROLES.map((r) => (
                              <SelectItem key={r.value} value={r.value}>
                                {r.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Separator />

            <div className="space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Documents
                </h4>
                <Label
                  htmlFor="filing-doc-upload"
                  className="cursor-pointer"
                >
                  <Button
                    variant="outline"
                    size="sm"
                    asChild
                    data-testid="button-upload-documents"
                  >
                    <span>
                      <Upload className="h-4 w-4 mr-1" />
                      Upload
                    </span>
                  </Button>
                  <input
                    id="filing-doc-upload"
                    type="file"
                    multiple
                    accept=".pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                    className="hidden"
                    onChange={handleFileSelect}
                    data-testid="input-file-upload"
                  />
                </Label>
              </div>

              {documents.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No documents uploaded. Upload plans, cost estimates, contracts, etc.
                </p>
              )}

              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-3 p-2 rounded-md bg-muted"
                  data-testid={`doc-item-${doc.id}`}
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" data-testid={`text-doc-name-${doc.id}`}>
                      {doc.file.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(doc.file.size)}
                    </p>
                  </div>
                  <Select
                    value={doc.documentType}
                    onValueChange={(v) => updateDocumentType(doc.id, v)}
                  >
                    <SelectTrigger className="w-[140px]" data-testid={`select-doc-type-${doc.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((dt) => (
                        <SelectItem key={dt.value} value={dt.value}>
                          {dt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeDocument(doc.id)}
                    data-testid={`button-remove-doc-${doc.id}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Separator />

            <div className="space-y-4">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Portal Credentials
              </h4>

              {loadingCredentials ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading credentials...
                </div>
              ) : filteredCredentials.length === 0 ? (
                <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    {selectedMunicipalityKey
                      ? 'No matching credentials found for the selected municipality. Add them in Settings.'
                      : 'No portal credentials found. Add them in Settings to enable portal automation.'}
                  </p>
                </div>
              ) : (
                <Select value={selectedCredentialId} onValueChange={handleCredentialChange}>
                  <SelectTrigger data-testid="select-portal-credential">
                    <SelectValue placeholder="Select portal credential" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCredentials.map((cred) => (
                      <SelectItem key={cred.id} value={cred.id}>
                        <span className="flex items-center gap-2">
                          <span>{cred.jurisdiction}</span>
                          <Badge variant="secondary" className="text-xs">
                            {cred.portal_username}
                          </Badge>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-filing"
          >
            Cancel
          </Button>
          <Button
            onClick={handleStartPreflight}
            disabled={submitting || !isValid}
            data-testid="button-start-preflight"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {createMode ? 'Create Project & Start Pre-Flight' : 'Start Pre-Flight'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
