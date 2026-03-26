import { useState, useRef, useCallback, useEffect } from 'react';
import { format } from 'date-fns';
import { Printer, Plus, Trash2, Save, FolderOpen, Star, QrCode, CloudOff, Download, Share2, Users, Building2, Lock, PenTool, Mail, SendHorizonal, Paperclip, FileText, Database, History, Copy, MoreHorizontal, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SignaturePad } from './SignaturePad';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChecklistTemplates, TemplateCategory, TemplateVisibility } from '@/hooks/useChecklistTemplates';
import { useSavedChecklists, SavedChecklist } from '@/hooks/useSavedChecklists';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { ChecklistPhotoUpload } from './ChecklistPhotoUpload';
import { ChecklistQRCode } from './ChecklistQRCode';
import { OfflineChecklistManager } from './OfflineChecklistManager';
import { useOfflineStorage, OfflineChecklist } from '@/hooks/useOfflineStorage';
import { useChecklistNotification } from '@/hooks/useChecklistNotification';
import { downloadChecklistPDF } from '@/lib/checklistPDF';

interface ChecklistItem {
  id: string;
  category: string;
  item: string;
  requirement: string;
  checked: boolean;
  notes: string;
  status: 'pending' | 'pass' | 'fail' | 'na';
}

interface ChecklistCategory {
  name: string;
  items: Omit<ChecklistItem, 'id' | 'checked' | 'notes' | 'status'>[];
}

const DEFAULT_CATEGORIES: ChecklistCategory[] = [
  {
    name: 'Site Conditions',
    items: [
      { category: 'Site Conditions', item: 'Site access and safety', requirement: 'Clear access paths, proper signage' },
      { category: 'Site Conditions', item: 'Erosion control measures', requirement: 'Silt fencing, sediment basins in place' },
      { category: 'Site Conditions', item: 'Material storage', requirement: 'Proper storage away from drainage' },
      { category: 'Site Conditions', item: 'Temporary facilities', requirement: 'Sanitation, first aid, fire extinguishers' },
    ],
  },
  {
    name: 'Foundation',
    items: [
      { category: 'Foundation', item: 'Excavation depth', requirement: 'Per approved plans' },
      { category: 'Foundation', item: 'Footing dimensions', requirement: 'Width and depth per plans' },
      { category: 'Foundation', item: 'Rebar placement', requirement: 'Size, spacing, and cover per plans' },
      { category: 'Foundation', item: 'Anchor bolt placement', requirement: 'Location and embedment depth' },
      { category: 'Foundation', item: 'Waterproofing', requirement: 'Membrane applied per specs' },
    ],
  },
  {
    name: 'Framing',
    items: [
      { category: 'Framing', item: 'Wall stud spacing', requirement: '16" or 24" O.C. per plans' },
      { category: 'Framing', item: 'Header sizes', requirement: 'Per structural plans' },
      { category: 'Framing', item: 'Shear wall installation', requirement: 'Nailing pattern and hold-downs' },
      { category: 'Framing', item: 'Fire blocking', requirement: 'At required locations' },
      { category: 'Framing', item: 'Roof framing', requirement: 'Rafters/trusses per plans' },
    ],
  },
  {
    name: 'Electrical',
    items: [
      { category: 'Electrical', item: 'Panel location and clearance', requirement: '36" clearance, proper height' },
      { category: 'Electrical', item: 'Wire sizing', requirement: 'Per load calculations' },
      { category: 'Electrical', item: 'GFCI protection', requirement: 'Kitchens, baths, outdoors, garage' },
      { category: 'Electrical', item: 'Smoke/CO detectors', requirement: 'Locations per code' },
      { category: 'Electrical', item: 'Grounding and bonding', requirement: 'Proper connections' },
    ],
  },
  {
    name: 'Plumbing',
    items: [
      { category: 'Plumbing', item: 'Pipe sizing', requirement: 'Per fixture unit calculations' },
      { category: 'Plumbing', item: 'Venting', requirement: 'Proper vent sizing and termination' },
      { category: 'Plumbing', item: 'Water heater', requirement: 'Seismic strapping, TPR valve' },
      { category: 'Plumbing', item: 'Fixture installation', requirement: 'Proper connections, no leaks' },
      { category: 'Plumbing', item: 'Drain slope', requirement: '1/4" per foot minimum' },
    ],
  },
  {
    name: 'Mechanical/HVAC',
    items: [
      { category: 'Mechanical/HVAC', item: 'Equipment sizing', requirement: 'Per Manual J calculations' },
      { category: 'Mechanical/HVAC', item: 'Ductwork installation', requirement: 'Sealed connections, proper support' },
      { category: 'Mechanical/HVAC', item: 'Combustion air', requirement: 'Adequate ventilation' },
      { category: 'Mechanical/HVAC', item: 'Refrigerant lines', requirement: 'Proper insulation' },
      { category: 'Mechanical/HVAC', item: 'Thermostat location', requirement: 'Interior wall, proper height' },
    ],
  },
  {
    name: 'Insulation & Energy',
    items: [
      { category: 'Insulation & Energy', item: 'Wall insulation', requirement: 'R-value per energy code' },
      { category: 'Insulation & Energy', item: 'Ceiling insulation', requirement: 'R-value per energy code' },
      { category: 'Insulation & Energy', item: 'Air sealing', requirement: 'Penetrations sealed' },
      { category: 'Insulation & Energy', item: 'Window U-factor', requirement: 'Per energy calculations' },
      { category: 'Insulation & Energy', item: 'Vapor barrier', requirement: 'Proper installation' },
    ],
  },
  {
    name: 'Fire Safety',
    items: [
      { category: 'Fire Safety', item: 'Fire-rated assemblies', requirement: 'Per plans and code' },
      { category: 'Fire Safety', item: 'Firestopping', requirement: 'Penetrations sealed' },
      { category: 'Fire Safety', item: 'Egress windows', requirement: 'Size and operation per code' },
      { category: 'Fire Safety', item: 'Sprinkler system', requirement: 'If required, per NFPA 13D' },
      { category: 'Fire Safety', item: 'Fire extinguishers', requirement: 'Proper type and location' },
    ],
  },
];

interface PrintableInspectionChecklistProps {
  projectId?: string;
  inspectionId?: string;
  projectName?: string;
  projectAddress?: string;
  inspectionType?: string;
  inspectorName?: string;
  permitNumber?: string;
}

const INSPECTION_TYPE_OPTIONS = [
  { value: 'foundation', label: 'Foundation' },
  { value: 'framing', label: 'Framing' },
  { value: 'electrical_rough', label: 'Electrical Rough' },
  { value: 'electrical_final', label: 'Electrical Final' },
  { value: 'plumbing_rough', label: 'Plumbing Rough' },
  { value: 'plumbing_final', label: 'Plumbing Final' },
  { value: 'mechanical_rough', label: 'Mechanical Rough' },
  { value: 'mechanical_final', label: 'Mechanical Final' },
  { value: 'insulation', label: 'Insulation' },
  { value: 'drywall', label: 'Drywall' },
  { value: 'fire_safety', label: 'Fire Safety' },
  { value: 'final', label: 'Final' },
  { value: 'other', label: 'Other' },
];

export function PrintableInspectionChecklist({
  projectId,
  inspectionId,
  projectName = '',
  projectAddress = '',
  inspectionType = '',
  inspectorName = '',
  permitNumber = '',
}: PrintableInspectionChecklistProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [showQRCode, setShowQRCode] = useState(true);
  const [currentOfflineId, setCurrentOfflineId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  const { user } = useAuth();
  const { 
    templates, 
    loading: templatesLoading, 
    createTemplate, 
    deleteTemplate,
    getTemplatesByType,
    getOwnTemplates,
    getSharedTemplates,
    shareTemplate,
  } = useChecklistTemplates();

  const {
    isOnline,
    isDBReady,
    saveChecklist: saveOfflineChecklist,
    savedChecklists,
  } = useOfflineStorage();

  const {
    savedChecklists: dbSavedChecklists,
    loading: dbChecklistsLoading,
    saveChecklist: saveToDatabase,
    updateChecklist: updateInDatabase,
    deleteChecklist: deleteFromDatabase,
    duplicateChecklist,
  } = useSavedChecklists(projectId);

  const { sendSignedNotification, isSending: isSendingNotification, lastSentAt } = useChecklistNotification();
  
  // Template save form
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateType, setTemplateType] = useState(inspectionType || 'foundation');
  const [isDefault, setIsDefault] = useState(false);
  const [templateVisibility, setTemplateVisibility] = useState<TemplateVisibility>('private');

  // Database save form
  const [saveToDbDialogOpen, setSaveToDbDialogOpen] = useState(false);
  const [loadFromDbDialogOpen, setLoadFromDbDialogOpen] = useState(false);
  const [dbChecklistName, setDbChecklistName] = useState('');
  const [currentDbChecklistId, setCurrentDbChecklistId] = useState<string | null>(null);
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateName, setDuplicateName] = useState('');
  const [checklistToDuplicate, setChecklistToDuplicate] = useState<string | null>(null);

  // Notification email
  const [notificationEmails, setNotificationEmails] = useState('');
  const [attachPDF, setAttachPDF] = useState(true);
  const [showEmailInput, setShowEmailInput] = useState(false);
  
  // Form fields
  const [formData, setFormData] = useState({
    projectName,
    projectAddress,
    inspectionType,
    inspectorName,
    permitNumber,
    inspectionDate: format(new Date(), 'yyyy-MM-dd'),
    weather: '',
    temperature: '',
    generalNotes: '',
  });

  // Signature states
  const [inspectorSignature, setInspectorSignature] = useState<string | null>(null);
  const [contractorSignature, setContractorSignature] = useState<string | null>(null);
  const [inspectorSignedAt, setInspectorSignedAt] = useState<string | null>(null);
  const [contractorSignedAt, setContractorSignedAt] = useState<string | null>(null);
  const [bothSigned, setBothSigned] = useState(false);

  // Initialize checklist items from categories
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(() => {
    return DEFAULT_CATEGORIES.flatMap(category =>
      category.items.map((item, index) => ({
        ...item,
        id: `${category.name}-${index}`,
        checked: false,
        notes: '',
        status: 'pending' as const,
      }))
    );
  });

  const [customItems, setCustomItems] = useState<ChecklistItem[]>([]);
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemText, setNewItemText] = useState('');
  const [newItemRequirement, setNewItemRequirement] = useState('');

  // Mark as having unsaved changes when data changes
  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [formData, checklistItems, customItems]);

  // Auto-save to offline storage periodically when offline
  const saveToOffline = useCallback(async () => {
    if (!isDBReady) return;
    
    try {
      const result = await saveOfflineChecklist({
        id: currentOfflineId || undefined,
        projectId,
        inspectionId,
        formData,
        checklistItems,
        customItems,
      });
      
      if (result) {
        setCurrentOfflineId(result.id);
        setHasUnsavedChanges(false);
      }
    } catch (error) {
      console.error('Failed to save offline:', error);
    }
  }, [isDBReady, currentOfflineId, projectId, inspectionId, formData, checklistItems, customItems, saveOfflineChecklist]);

  // Load checklist from offline storage
  const loadFromOffline = useCallback((checklist: OfflineChecklist) => {
    setFormData(checklist.formData);
    setChecklistItems(checklist.checklistItems);
    setCustomItems(checklist.customItems);
    setCurrentOfflineId(checklist.id);
    setHasUnsavedChanges(false);
  }, []);

  // Handle inspector signature change
  const handleInspectorSignature = useCallback((signature: string | null) => {
    setInspectorSignature(signature);
    if (signature && !inspectorSignedAt) {
      setInspectorSignedAt(format(new Date(), 'MMM d, yyyy h:mm a'));
    } else if (!signature) {
      setInspectorSignedAt(null);
    }
  }, [inspectorSignedAt]);

  // Handle contractor signature change
  const handleContractorSignature = useCallback((signature: string | null) => {
    setContractorSignature(signature);
    if (signature && !contractorSignedAt) {
      setContractorSignedAt(format(new Date(), 'MMM d, yyyy h:mm a'));
    } else if (!signature) {
      setContractorSignedAt(null);
    }
  }, [contractorSignedAt]);

  // Detect when both parties have signed
  useEffect(() => {
    const newBothSigned = !!inspectorSignature && !!contractorSignature;
    if (newBothSigned && !bothSigned) {
      setBothSigned(true);
      setShowEmailInput(true);
      toast.success('Both parties have signed! You can now send an email notification.', {
        duration: 5000,
      });
    } else if (!newBothSigned) {
      setBothSigned(false);
    }
  }, [inspectorSignature, contractorSignature, bothSigned]);

  // Send notification email
  const handleSendNotification = useCallback(async () => {
    if (!bothSigned) {
      toast.error('Both parties must sign before sending notification');
      return;
    }

    const emails = notificationEmails
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0 && e.includes('@'));

    if (emails.length === 0) {
      toast.error('Please enter at least one valid email address');
      return;
    }

    const allItems = [...checklistItems, ...customItems];
    const checklistSummary = {
      total: allItems.length,
      passed: allItems.filter(i => i.status === 'pass').length,
      failed: allItems.filter(i => i.status === 'fail').length,
      na: allItems.filter(i => i.status === 'na').length,
      pending: allItems.filter(i => i.status === 'pending').length,
    };

    await sendSignedNotification({
      projectId,
      inspectionId,
      projectName: formData.projectName,
      projectAddress: formData.projectAddress,
      inspectionType: formData.inspectionType,
      inspectorName: formData.inspectorName,
      permitNumber: formData.permitNumber,
      inspectionDate: formData.inspectionDate,
      inspectorSignedAt: inspectorSignedAt || format(new Date(), 'MMM d, yyyy h:mm a'),
      contractorSignedAt: contractorSignedAt || format(new Date(), 'MMM d, yyyy h:mm a'),
      recipientEmails: emails,
      checklistSummary,
      generalNotes: formData.generalNotes,
      // PDF attachment data
      attachPDF,
      checklistItems,
      customItems,
      weather: formData.weather,
      temperature: formData.temperature,
    });

    setShowEmailInput(false);
  }, [
    bothSigned,
    notificationEmails,
    checklistItems,
    customItems,
    projectId,
    inspectionId,
    formData,
    inspectorSignedAt,
    contractorSignedAt,
    sendSignedNotification,
    attachPDF,
  ]);

  // Download PDF
  const handleDownloadPDF = useCallback(() => {
    downloadChecklistPDF({
      formData,
      checklistItems,
      customItems,
      inspectorSignedAt,
      contractorSignedAt,
    });
    toast.success('PDF downloaded successfully');
  }, [formData, checklistItems, customItems, inspectorSignedAt, contractorSignedAt]);

  // Calculate current checklist status based on items and signatures
  const calculateStatus = useCallback(() => {
    if (inspectorSignature && contractorSignature) return 'signed';
    const allItems = [...checklistItems, ...customItems];
    const pendingCount = allItems.filter(i => i.status === 'pending').length;
    if (pendingCount === allItems.length) return 'draft';
    if (pendingCount === 0) return 'completed';
    return 'in_progress';
  }, [checklistItems, customItems, inspectorSignature, contractorSignature]);

  // Save checklist to database
  const handleSaveToDatabase = useCallback(async () => {
    if (!dbChecklistName.trim()) {
      toast.error('Please enter a name for this checklist');
      return;
    }

    setIsSavingToDb(true);
    try {
      const status = calculateStatus();

      if (currentDbChecklistId) {
        // Update existing checklist
        await updateInDatabase(currentDbChecklistId, {
          name: dbChecklistName,
          form_data: formData,
          checklist_items: checklistItems,
          custom_items: customItems,
          inspector_signature: inspectorSignature,
          contractor_signature: contractorSignature,
          inspector_signed_at: inspectorSignedAt,
          contractor_signed_at: contractorSignedAt,
          status,
        });
      } else {
        // Save new checklist
        const result = await saveToDatabase({
          project_id: projectId || null,
          inspection_id: inspectionId || null,
          name: dbChecklistName,
          form_data: formData,
          checklist_items: checklistItems,
          custom_items: customItems,
          inspector_signature: inspectorSignature,
          contractor_signature: contractorSignature,
          inspector_signed_at: inspectorSignedAt,
          contractor_signed_at: contractorSignedAt,
          status,
        });

        if (result) {
          setCurrentDbChecklistId(result.id);
        }
      }

      setSaveToDbDialogOpen(false);
      setHasUnsavedChanges(false);
    } finally {
      setIsSavingToDb(false);
    }
  }, [
    dbChecklistName,
    currentDbChecklistId,
    formData,
    checklistItems,
    customItems,
    inspectorSignature,
    contractorSignature,
    inspectorSignedAt,
    contractorSignedAt,
    projectId,
    inspectionId,
    calculateStatus,
    saveToDatabase,
    updateInDatabase,
  ]);

  // Load checklist from database
  const loadFromDatabase = useCallback((checklist: SavedChecklist) => {
    setFormData(checklist.form_data);
    setChecklistItems(checklist.checklist_items);
    setCustomItems(checklist.custom_items);
    setInspectorSignature(checklist.inspector_signature);
    setContractorSignature(checklist.contractor_signature);
    setInspectorSignedAt(checklist.inspector_signed_at);
    setContractorSignedAt(checklist.contractor_signed_at);
    setCurrentDbChecklistId(checklist.id);
    setDbChecklistName(checklist.name);
    setLoadFromDbDialogOpen(false);
    setHasUnsavedChanges(false);
    toast.success(`Loaded checklist: ${checklist.name}`);
  }, []);

  // Handle duplicate checklist
  const handleDuplicateChecklist = useCallback(async () => {
    if (!checklistToDuplicate || !duplicateName.trim()) {
      toast.error('Please enter a name for the duplicate');
      return;
    }

    const result = await duplicateChecklist(checklistToDuplicate, duplicateName);
    if (result) {
      setDuplicateDialogOpen(false);
      setDuplicateName('');
      setChecklistToDuplicate(null);
    }
  }, [checklistToDuplicate, duplicateName, duplicateChecklist]);

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'signed': return 'bg-green-600';
      case 'completed': return 'bg-blue-600';
      case 'in_progress': return 'bg-yellow-600';
      default: return 'bg-[#6B9AC4]';
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleItemStatusChange = (id: string, status: ChecklistItem['status']) => {
    setChecklistItems(items =>
      items.map(item =>
        item.id === id ? { ...item, status, checked: status === 'pass' } : item
      )
    );
  };

  const handleItemNotesChange = (id: string, notes: string) => {
    setChecklistItems(items =>
      items.map(item => (item.id === id ? { ...item, notes } : item))
    );
  };

  const handleCustomItemStatusChange = (id: string, status: ChecklistItem['status']) => {
    setCustomItems(items =>
      items.map(item =>
        item.id === id ? { ...item, status, checked: status === 'pass' } : item
      )
    );
  };

  const handleCustomItemNotesChange = (id: string, notes: string) => {
    setCustomItems(items =>
      items.map(item => (item.id === id ? { ...item, notes } : item))
    );
  };

  // Convert current checklist to template categories
  const getCurrentCategories = (): TemplateCategory[] => {
    const grouped = checklistItems.reduce((acc, item) => {
      if (!acc[item.category]) {
        acc[item.category] = [];
      }
      acc[item.category].push({
        category: item.category,
        item: item.item,
        requirement: item.requirement,
      });
      return acc;
    }, {} as Record<string, { category: string; item: string; requirement: string }[]>);

    // Add custom items
    customItems.forEach(item => {
      const cat = item.category || 'Custom Items';
      if (!grouped[cat]) {
        grouped[cat] = [];
      }
      grouped[cat].push({
        category: cat,
        item: item.item,
        requirement: item.requirement,
      });
    });

    return Object.entries(grouped).map(([name, items]) => ({
      name,
      items,
    }));
  };

  // Save current checklist as template
  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }

    const categories = getCurrentCategories();
    const result = await createTemplate({
      name: templateName,
      inspection_type: templateType,
      description: templateDescription || undefined,
      categories,
      is_default: isDefault,
      visibility: templateVisibility,
    });

    if (result) {
      setSaveDialogOpen(false);
      setTemplateName('');
      setTemplateDescription('');
      setIsDefault(false);
      setTemplateVisibility('private');
    }
  };

  // Handle sharing/unsharing a template
  const handleShareTemplate = async (templateId: string, visibility: TemplateVisibility) => {
    await shareTemplate(templateId, visibility);
  };

  // Load template into checklist
  const loadTemplate = (template: { categories: TemplateCategory[] }) => {
    const newItems: ChecklistItem[] = template.categories.flatMap(category =>
      category.items.map((item, index) => ({
        ...item,
        id: `${category.name}-${index}-${Date.now()}`,
        checked: false,
        notes: '',
        status: 'pending' as const,
      }))
    );

    setChecklistItems(newItems);
    setCustomItems([]);
    setLoadDialogOpen(false);
    toast.success('Template loaded successfully');
  };

  // Handle template deletion
  const handleDeleteTemplate = async (templateId: string) => {
    await deleteTemplate(templateId);
  };


  const addCustomItem = () => {
    if (!newItemText.trim()) return;
    
    const newItem: ChecklistItem = {
      id: `custom-${Date.now()}`,
      category: newItemCategory || 'Custom Items',
      item: newItemText,
      requirement: newItemRequirement,
      checked: false,
      notes: '',
      status: 'pending',
    };
    
    setCustomItems([...customItems, newItem]);
    setNewItemText('');
    setNewItemRequirement('');
  };

  const removeCustomItem = (id: string) => {
    setCustomItems(items => items.filter(item => item.id !== id));
  };

  // Group items by category
  const groupedItems = checklistItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);

  const allCategories = [...new Set([...Object.keys(groupedItems), 'Custom Items'])];

  const getStatusCounts = () => {
    const allItems = [...checklistItems, ...customItems];
    return {
      total: allItems.length,
      pass: allItems.filter(i => i.status === 'pass').length,
      fail: allItems.filter(i => i.status === 'fail').length,
      na: allItems.filter(i => i.status === 'na').length,
      pending: allItems.filter(i => i.status === 'pending').length,
    };
  };

  const counts = getStatusCounts();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Printer className="h-4 w-4" />
          Print Checklist
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="print:hidden">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Inspection Checklist</DialogTitle>
              <DialogDescription>
                Create, customize, and print inspection checklists. Save as templates for reuse.
              </DialogDescription>
            </div>
            {/* Offline status indicator */}
            <OfflineChecklistManager 
              compact 
              onLoadChecklist={loadFromOffline}
            />
          </div>
        </DialogHeader>

        {/* Print Controls - hidden when printing */}
        <div className="flex flex-wrap gap-2 mb-4 print:hidden">
          <Button onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" />
            Print Checklist
          </Button>

          <Button 
            variant={showQRCode ? "default" : "outline"} 
            className="gap-2"
            onClick={() => setShowQRCode(!showQRCode)}
          >
            <QrCode className="h-4 w-4" />
            {showQRCode ? 'Hide QR Code' : 'Show QR Code'}
          </Button>

          {/* Offline Save Button */}
          {isDBReady && (
            <Button 
              variant="outline" 
              className="gap-2"
              onClick={saveToOffline}
            >
              {isOnline ? (
                <>
                  <Download className="h-4 w-4" />
                  Save Offline
                </>
              ) : (
                <>
                  <CloudOff className="h-4 w-4" />
                  Save Locally
                </>
              )}
              {hasUnsavedChanges && (
                <span className="ml-1 w-2 h-2 bg-yellow-500 rounded-full" />
              )}
            </Button>
          )}

          {user && (
            <>
              {/* Save to Database Button */}
              <Dialog open={saveToDbDialogOpen} onOpenChange={setSaveToDbDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Database className="h-4 w-4" />
                    {currentDbChecklistId ? 'Update Checklist' : 'Save Checklist'}
                    {hasUnsavedChanges && currentDbChecklistId && (
                      <span className="ml-1 w-2 h-2 bg-yellow-500 rounded-full" />
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>{currentDbChecklistId ? 'Update Checklist' : 'Save Checklist'}</DialogTitle>
                    <DialogDescription>
                      Save this checklist to your account for future reference and tracking.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Checklist Name *</Label>
                      <Input
                        value={dbChecklistName}
                        onChange={e => setDbChecklistName(e.target.value)}
                        placeholder="e.g., 123 Main St - Foundation Inspection"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Badge className={getStatusColor(calculateStatus())}>
                        {calculateStatus().replace('_', ' ')}
                      </Badge>
                      <span>•</span>
                      <span>{counts.pass}/{counts.total} items passed</span>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSaveToDbDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveToDatabase} disabled={isSavingToDb}>
                      {isSavingToDb && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {currentDbChecklistId ? 'Update' : 'Save'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Load from Database Button */}
              <Dialog open={loadFromDbDialogOpen} onOpenChange={setLoadFromDbDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <History className="h-4 w-4" />
                    Load History
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Saved Checklists</DialogTitle>
                    <DialogDescription>
                      Load a previously saved checklist or continue where you left off.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4 space-y-4">
                    {dbChecklistsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    ) : dbSavedChecklists.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Database className="h-12 w-12 mx-auto mb-3 opacity-50" />
                        <p>No saved checklists yet.</p>
                        <p className="text-sm mt-1">
                          Save your current checklist to access it later.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {dbSavedChecklists.map(checklist => (
                          <div
                            key={checklist.id}
                            className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium truncate">{checklist.name}</span>
                                <Badge className={`text-xs ${getStatusColor(checklist.status)}`}>
                                  {checklist.status.replace('_', ' ')}
                                </Badge>
                                {checklist.id === currentDbChecklistId && (
                                  <Badge variant="outline" className="text-xs">Current</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                <span>{checklist.form_data.projectName || 'Untitled Project'}</span>
                                <span>•</span>
                                <span>{format(new Date(checklist.updated_at), 'MMM d, yyyy h:mm a')}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={() => loadFromDatabase(checklist)}
                              >
                                Load
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="h-4 w-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setChecklistToDuplicate(checklist.id);
                                      setDuplicateName(`${checklist.name} (copy)`);
                                      setDuplicateDialogOpen(true);
                                    }}
                                  >
                                    <Copy className="h-4 w-4 mr-2" />
                                    Duplicate
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => deleteFromDatabase(checklist.id)}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </DialogContent>
              </Dialog>

              {/* Duplicate Dialog */}
              <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Duplicate Checklist</DialogTitle>
                    <DialogDescription>
                      Create a copy of this checklist with a new name. All items will be reset to pending.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Label>New Checklist Name</Label>
                    <Input
                      value={duplicateName}
                      onChange={e => setDuplicateName(e.target.value)}
                      placeholder="Enter a name for the copy"
                      className="mt-2"
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleDuplicateChecklist}>
                      <Copy className="h-4 w-4 mr-2" />
                      Duplicate
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Save Template Button */}
              <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <Save className="h-4 w-4" />
                    Save as Template
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-md">
                  <DialogHeader>
                    <DialogTitle>Save Checklist Template</DialogTitle>
                    <DialogDescription>
                      Save your current checklist configuration as a reusable template.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Template Name *</Label>
                      <Input
                        value={templateName}
                        onChange={e => setTemplateName(e.target.value)}
                        placeholder="e.g., Foundation Inspection - Residential"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Inspection Type</Label>
                      <Select value={templateType} onValueChange={setTemplateType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INSPECTION_TYPE_OPTIONS.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Description (optional)</Label>
                      <Textarea
                        value={templateDescription}
                        onChange={e => setTemplateDescription(e.target.value)}
                        placeholder="Describe when to use this template..."
                        rows={2}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="isDefault"
                        checked={isDefault}
                        onChange={e => setIsDefault(e.target.checked)}
                        className="rounded"
                      />
                      <Label htmlFor="isDefault" className="text-sm font-normal cursor-pointer">
                        Set as default for this inspection type
                      </Label>
                    </div>
                    <div className="space-y-2">
                      <Label>Share with</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={templateVisibility === 'private' ? 'default' : 'outline'}
                          size="sm"
                          className="gap-1.5 flex-1"
                          onClick={() => setTemplateVisibility('private')}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Private
                        </Button>
                        <Button
                          type="button"
                          variant={templateVisibility === 'team' ? 'default' : 'outline'}
                          size="sm"
                          className="gap-1.5 flex-1"
                          onClick={() => setTemplateVisibility('team')}
                        >
                          <Users className="h-3.5 w-3.5" />
                          Team
                        </Button>
                        <Button
                          type="button"
                          variant={templateVisibility === 'organization' ? 'default' : 'outline'}
                          size="sm"
                          className="gap-1.5 flex-1"
                          onClick={() => setTemplateVisibility('organization')}
                        >
                          <Building2 className="h-3.5 w-3.5" />
                          Organization
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {templateVisibility === 'private' && 'Only you can see this template'}
                        {templateVisibility === 'team' && 'All team members can use this template'}
                        {templateVisibility === 'organization' && 'Everyone in your organization can use this template'}
                      </p>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveTemplate}>
                      Save Template
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Load Template Button */}
              <Dialog open={loadDialogOpen} onOpenChange={setLoadDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Load Template
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Load Checklist Template</DialogTitle>
                    <DialogDescription>
                      Select a saved or shared template to load into your checklist.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4 space-y-6">
                    {templatesLoading ? (
                      <div className="text-center py-8 text-muted-foreground">
                        Loading templates...
                      </div>
                    ) : templates.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <p>No saved templates yet.</p>
                        <p className="text-sm mt-1">
                          Customize your checklist and save it as a template for reuse.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* My Templates */}
                        {getOwnTemplates().length > 0 && (
                          <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2">
                              <Lock className="h-4 w-4" />
                              My Templates
                            </h3>
                            <div className="space-y-2">
                              {INSPECTION_TYPE_OPTIONS.map(typeOpt => {
                                const typeTemplates = getOwnTemplates().filter(t => t.inspection_type === typeOpt.value);
                                if (typeTemplates.length === 0) return null;

                                return (
                                  <div key={typeOpt.value} className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground">
                                      {typeOpt.label}
                                    </h4>
                                    {typeTemplates.map(template => (
                                      <div
                                        key={template.id}
                                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                                      >
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium">{template.name}</span>
                                            {template.is_default && (
                                              <Badge variant="secondary" className="gap-1">
                                                <Star className="h-3 w-3" />
                                                Default
                                              </Badge>
                                            )}
                                            {template.visibility === 'team' && (
                                              <Badge variant="outline" className="gap-1">
                                                <Users className="h-3 w-3" />
                                                Team
                                              </Badge>
                                            )}
                                            {template.visibility === 'organization' && (
                                              <Badge variant="outline" className="gap-1">
                                                <Building2 className="h-3 w-3" />
                                                Org
                                              </Badge>
                                            )}
                                          </div>
                                          {template.description && (
                                            <p className="text-sm text-muted-foreground mt-0.5">
                                              {template.description}
                                            </p>
                                          )}
                                          <p className="text-xs text-muted-foreground mt-1">
                                            {template.categories.length} categories •{' '}
                                            {template.categories.reduce((sum, cat) => sum + cat.items.length, 0)} items
                                          </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            size="sm"
                                            onClick={() => loadTemplate(template)}
                                          >
                                            Load
                                          </Button>
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                                <Share2 className="h-4 w-4 text-muted-foreground" />
                                              </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end">
                                              <DropdownMenuItem
                                                onClick={() => handleShareTemplate(template.id, 'private')}
                                                className={template.visibility === 'private' ? 'bg-muted' : ''}
                                              >
                                                <Lock className="h-4 w-4 mr-2" />
                                                Private
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                onClick={() => handleShareTemplate(template.id, 'team')}
                                                className={template.visibility === 'team' ? 'bg-muted' : ''}
                                              >
                                                <Users className="h-4 w-4 mr-2" />
                                                Share with Team
                                              </DropdownMenuItem>
                                              <DropdownMenuItem
                                                onClick={() => handleShareTemplate(template.id, 'organization')}
                                                className={template.visibility === 'organization' ? 'bg-muted' : ''}
                                              >
                                                <Building2 className="h-4 w-4 mr-2" />
                                                Share with Organization
                                              </DropdownMenuItem>
                                              <DropdownMenuSeparator />
                                              <DropdownMenuItem
                                                className="text-destructive focus:text-destructive"
                                                onClick={() => handleDeleteTemplate(template.id)}
                                              >
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                Delete Template
                                              </DropdownMenuItem>
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Shared Templates */}
                        {getSharedTemplates().length > 0 && (
                          <div className="space-y-3">
                            <h3 className="font-semibold flex items-center gap-2">
                              <Share2 className="h-4 w-4" />
                              Shared Templates
                            </h3>
                            <div className="space-y-2">
                              {INSPECTION_TYPE_OPTIONS.map(typeOpt => {
                                const typeTemplates = getSharedTemplates().filter(t => t.inspection_type === typeOpt.value);
                                if (typeTemplates.length === 0) return null;

                                return (
                                  <div key={`shared-${typeOpt.value}`} className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground">
                                      {typeOpt.label}
                                    </h4>
                                    {typeTemplates.map(template => (
                                      <div
                                        key={template.id}
                                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                                      >
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-medium">{template.name}</span>
                                            {template.visibility === 'team' && (
                                              <Badge variant="outline" className="gap-1">
                                                <Users className="h-3 w-3" />
                                                Team
                                              </Badge>
                                            )}
                                            {template.visibility === 'organization' && (
                                              <Badge variant="outline" className="gap-1">
                                                <Building2 className="h-3 w-3" />
                                                Org
                                              </Badge>
                                            )}
                                          </div>
                                          {template.description && (
                                            <p className="text-sm text-muted-foreground mt-0.5">
                                              {template.description}
                                            </p>
                                          )}
                                          <p className="text-xs text-muted-foreground mt-1">
                                            {template.categories.length} categories •{' '}
                                            {template.categories.reduce((sum, cat) => sum + cat.items.length, 0)} items
                                          </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <Button
                                            size="sm"
                                            onClick={() => loadTemplate(template)}
                                          >
                                            Load
                                          </Button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}

          {!user && (
            <span className="text-sm text-muted-foreground self-center">
              Sign in to save templates
            </span>
          )}
        </div>

        {/* Printable Content */}
        <div ref={printRef} className="print:p-0 space-y-6">
          {/* Header with QR Code */}
          <div className="border-b-2 border-foreground pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h1 className="text-2xl font-bold mb-2">
                  SITE INSPECTION CHECKLIST
                </h1>
                <p className="text-muted-foreground text-sm">
                  Building Permit Compliance Verification
                </p>
              </div>
              {showQRCode && (
                <div className="flex-shrink-0 print:block">
                  <ChecklistQRCode
                    projectId={projectId}
                    inspectionId={inspectionId}
                    checklistData={{
                      projectName: formData.projectName,
                      inspectionType: formData.inspectionType,
                      inspectionDate: formData.inspectionDate,
                    }}
                    size={80}
                    showLabel={true}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Project Information */}
          <div className="grid grid-cols-2 gap-4 print:gap-2">
            <div className="space-y-3 print:space-y-2">
              <div>
                <Label className="text-xs text-muted-foreground">Project Name</Label>
                <Input
                  value={formData.projectName}
                  onChange={e => setFormData({ ...formData, projectName: e.target.value })}
                  className="print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                  placeholder="Enter project name"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Project Address</Label>
                <Input
                  value={formData.projectAddress}
                  onChange={e => setFormData({ ...formData, projectAddress: e.target.value })}
                  className="print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                  placeholder="Enter address"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Permit Number</Label>
                <Input
                  value={formData.permitNumber}
                  onChange={e => setFormData({ ...formData, permitNumber: e.target.value })}
                  className="print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                  placeholder="Enter permit number"
                />
              </div>
            </div>
            <div className="space-y-3 print:space-y-2">
              <div>
                <Label className="text-xs text-muted-foreground">Inspection Date</Label>
                <Input
                  type="date"
                  value={formData.inspectionDate}
                  onChange={e => setFormData({ ...formData, inspectionDate: e.target.value })}
                  className="print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Inspector Name</Label>
                <Input
                  value={formData.inspectorName}
                  onChange={e => setFormData({ ...formData, inspectorName: e.target.value })}
                  className="print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                  placeholder="Enter inspector name"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Weather</Label>
                  <Input
                    value={formData.weather}
                    onChange={e => setFormData({ ...formData, weather: e.target.value })}
                    className="print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                    placeholder="Clear, Rain, etc."
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Temperature</Label>
                  <Input
                    value={formData.temperature}
                    onChange={e => setFormData({ ...formData, temperature: e.target.value })}
                    className="print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                    placeholder="72°F"
                  />
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Status Legend */}
          <div className="flex items-center justify-between text-sm bg-muted/50 p-3 rounded-lg print:bg-transparent print:border">
            <div className="flex gap-4">
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 border-2 border-green-600 bg-green-100 rounded" /> Pass
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 border-2 border-red-600 bg-red-100 rounded" /> Fail
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 border-2 border-[#6B9AC4] bg-[#6B9AC4]/10 rounded" /> N/A
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-4 border-2 border-[#1A3055] rounded" /> Pending
              </span>
            </div>
            <div className="text-muted-foreground">
              {counts.pass}/{counts.total} Pass | {counts.fail} Fail | {counts.pending} Pending
            </div>
          </div>

          {/* Checklist Categories */}
          {Object.entries(groupedItems).map(([category, items]) => (
            <div key={category} className="break-inside-avoid">
              <h3 className="font-semibold text-lg border-b pb-1 mb-3">{category}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 w-8">P</th>
                    <th className="text-left py-2 w-8">F</th>
                    <th className="text-left py-2 w-8">NA</th>
                    <th className="text-left py-2">Item</th>
                    <th className="text-left py-2">Requirement</th>
                    <th className="text-left py-2 w-1/5">Notes</th>
                    <th className="text-left py-2 w-16 print:hidden">Photos</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id} className="border-b hover:bg-muted/30">
                      <td className="py-2">
                        <input
                          type="radio"
                          name={`status-${item.id}`}
                          checked={item.status === 'pass'}
                          onChange={() => handleItemStatusChange(item.id, 'pass')}
                          className="w-4 h-4 accent-green-600"
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="radio"
                          name={`status-${item.id}`}
                          checked={item.status === 'fail'}
                          onChange={() => handleItemStatusChange(item.id, 'fail')}
                          className="w-4 h-4 accent-red-600"
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="radio"
                          name={`status-${item.id}`}
                          checked={item.status === 'na'}
                          onChange={() => handleItemStatusChange(item.id, 'na')}
                          className="w-4 h-4 accent-gray-400"
                        />
                      </td>
                      <td className="py-2 font-medium">{item.item}</td>
                      <td className="py-2 text-muted-foreground">{item.requirement}</td>
                      <td className="py-2">
                        <Input
                          value={item.notes}
                          onChange={e => handleItemNotesChange(item.id, e.target.value)}
                          placeholder="Add notes..."
                          className="h-7 text-xs print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                        />
                      </td>
                      <td className="py-2 print:hidden">
                        {user && (
                          <ChecklistPhotoUpload
                            checklistItemId={item.id}
                            compact
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {/* Custom Items */}
          {customItems.length > 0 && (
            <div className="break-inside-avoid">
              <h3 className="font-semibold text-lg border-b pb-1 mb-3">Custom Items</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 w-8">P</th>
                    <th className="text-left py-2 w-8">F</th>
                    <th className="text-left py-2 w-8">NA</th>
                    <th className="text-left py-2">Item</th>
                    <th className="text-left py-2">Requirement</th>
                    <th className="text-left py-2 w-1/5">Notes</th>
                    <th className="text-left py-2 w-16 print:hidden">Photos</th>
                    <th className="text-left py-2 w-8 print:hidden"></th>
                  </tr>
                </thead>
                <tbody>
                  {customItems.map(item => (
                    <tr key={item.id} className="border-b hover:bg-muted/30">
                      <td className="py-2">
                        <input
                          type="radio"
                          name={`status-${item.id}`}
                          checked={item.status === 'pass'}
                          onChange={() => handleCustomItemStatusChange(item.id, 'pass')}
                          className="w-4 h-4 accent-green-600"
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="radio"
                          name={`status-${item.id}`}
                          checked={item.status === 'fail'}
                          onChange={() => handleCustomItemStatusChange(item.id, 'fail')}
                          className="w-4 h-4 accent-red-600"
                        />
                      </td>
                      <td className="py-2">
                        <input
                          type="radio"
                          name={`status-${item.id}`}
                          checked={item.status === 'na'}
                          onChange={() => handleCustomItemStatusChange(item.id, 'na')}
                          className="w-4 h-4 accent-gray-400"
                        />
                      </td>
                      <td className="py-2 font-medium">{item.item}</td>
                      <td className="py-2 text-muted-foreground">{item.requirement}</td>
                      <td className="py-2">
                        <Input
                          value={item.notes}
                          onChange={e => handleCustomItemNotesChange(item.id, e.target.value)}
                          placeholder="Add notes..."
                          className="h-7 text-xs print:border-b print:border-t-0 print:border-x-0 print:rounded-none print:px-0 print:shadow-none"
                        />
                      </td>
                      <td className="py-2 print:hidden">
                        {user && (
                          <ChecklistPhotoUpload
                            checklistItemId={item.id}
                            compact
                          />
                        )}
                      </td>
                      <td className="py-2 print:hidden">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeCustomItem(item.id)}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Add Custom Item - hidden when printing */}
          <Card className="print:hidden">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Add Custom Item</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Category</Label>
                  <Select value={newItemCategory} onValueChange={setNewItemCategory}>
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {allCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Item Description</Label>
                  <Input
                    value={newItemText}
                    onChange={e => setNewItemText(e.target.value)}
                    placeholder="e.g., Window flashing"
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">Requirement</Label>
                  <Input
                    value={newItemRequirement}
                    onChange={e => setNewItemRequirement(e.target.value)}
                    placeholder="e.g., Per manufacturer specs"
                    className="h-8"
                  />
                </div>
              </div>
              <Button onClick={addCustomItem} size="sm" className="gap-1">
                <Plus className="h-3 w-3" />
                Add Item
              </Button>
            </CardContent>
          </Card>

          <Separator />

          {/* General Notes */}
          <div className="break-inside-avoid">
            <h3 className="font-semibold text-lg border-b pb-1 mb-3">General Notes & Observations</h3>
            <Textarea
              value={formData.generalNotes}
              onChange={e => setFormData({ ...formData, generalNotes: e.target.value })}
              placeholder="Enter general observations, concerns, or follow-up items..."
              className="min-h-[120px] print:border print:min-h-[150px]"
            />
          </div>

          {/* Digital Signature Section */}
          <div className="break-inside-avoid space-y-6 pt-4">
            <div className="flex items-center justify-between border-b pb-1 mb-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <PenTool className="h-5 w-5" />
                Signatures
              </h3>
              {bothSigned && (
                <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700">
                  <Mail className="h-3 w-3" />
                  Both parties signed
                </Badge>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 print:grid-cols-2">
              <div className="space-y-2">
                <SignaturePad
                  label="Inspector Signature"
                  onSignatureChange={handleInspectorSignature}
                  initialSignature={inspectorSignature}
                  height={100}
                />
                {inspectorSignedAt && (
                  <p className="text-xs text-muted-foreground text-center">
                    Signed: {inspectorSignedAt}
                  </p>
                )}
              </div>
              
              <div className="space-y-2">
                <SignaturePad
                  label="Contractor/Owner Signature"
                  onSignatureChange={handleContractorSignature}
                  initialSignature={contractorSignature}
                  height={100}
                />
                {contractorSignedAt && (
                  <p className="text-xs text-muted-foreground text-center">
                    Signed: {contractorSignedAt}
                  </p>
                )}
              </div>
            </div>

            {/* Email Notification Section - shows when both signed */}
            {bothSigned && (
              <Card className="print:hidden border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Mail className="h-4 w-4 text-green-600" />
                    Send Email Notification
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Both parties have signed. Send an email notification with the checklist summary.
                  </p>
                  
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                      value={notificationEmails}
                      onChange={e => setNotificationEmails(e.target.value)}
                      placeholder="Enter email addresses (comma-separated)"
                      className="flex-1"
                    />
                  </div>
                  
                  {/* PDF Attachment Toggle */}
                  <div className="flex items-center justify-between p-3 bg-background/80 rounded-lg border">
                    <div className="flex items-center gap-2">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Attach PDF</p>
                        <p className="text-xs text-muted-foreground">Include a complete checklist PDF with the email</p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={attachPDF}
                        onChange={e => setAttachPDF(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#1A3055] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div>
                    </label>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button 
                      onClick={handleSendNotification}
                      disabled={isSendingNotification || !notificationEmails.trim()}
                      className="gap-2 flex-1"
                    >
                      {isSendingNotification ? (
                        <>
                          <span className="animate-spin">⏳</span>
                          Sending...
                        </>
                      ) : (
                        <>
                          <SendHorizonal className="h-4 w-4" />
                          Send Notification{attachPDF ? ' with PDF' : ''}
                        </>
                      )}
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={handleDownloadPDF}
                      className="gap-2"
                    >
                      <FileText className="h-4 w-4" />
                      Download PDF
                    </Button>
                  </div>
                  
                  {lastSentAt && (
                    <p className="text-xs text-green-600">
                      ✓ Last sent: {format(lastSentAt, 'MMM d, yyyy h:mm a')}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
            
            {/* Print fallback lines for when signatures aren't captured digitally */}
            {!inspectorSignature && !contractorSignature && (
              <div className="hidden print:block space-y-4">
                <p className="text-xs text-muted-foreground text-center">
                  If digital signatures are not available, sign below:
                </p>
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <div className="border-b border-foreground mb-1 h-10"></div>
                    <p className="text-sm text-muted-foreground">Inspector Signature / Date</p>
                  </div>
                  <div>
                    <div className="border-b border-foreground mb-1 h-10"></div>
                    <p className="text-sm text-muted-foreground">Contractor/Owner Signature / Date</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="text-center text-xs text-muted-foreground pt-4 border-t">
            <p>This checklist is for reference purposes. Official inspection results are recorded by the jurisdiction.</p>
            <p className="mt-1">Generated on {format(new Date(), 'MMMM d, yyyy')} | PermitFlow Compliance Checklist</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
