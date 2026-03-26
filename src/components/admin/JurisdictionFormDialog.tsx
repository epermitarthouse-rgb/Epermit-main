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
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Plus, X, User } from 'lucide-react';
import { 
  Jurisdiction, 
  ReviewerContact,
  US_STATES, 
  SUBMISSION_METHODS, 
  FILE_FORMATS,
  CreateJurisdictionData 
} from '@/types/jurisdiction';

interface JurisdictionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jurisdiction?: Jurisdiction | null;
  onSubmit: (data: CreateJurisdictionData) => Promise<void>;
  loading?: boolean;
}

const emptyContact: ReviewerContact = {
  name: '',
  title: '',
  email: '',
  phone: '',
};

export function JurisdictionFormDialog({
  open,
  onOpenChange,
  jurisdiction,
  onSubmit,
  loading = false,
}: JurisdictionFormDialogProps) {
  const [formData, setFormData] = useState<CreateJurisdictionData>({
    name: '',
    state: '',
    city: null,
    county: null,
    website_url: null,
    phone: null,
    email: null,
    address: null,
    reviewer_contacts: [],
    base_permit_fee: 0,
    plan_review_fee: 0,
    inspection_fee: 0,
    fee_notes: null,
    fee_schedule_url: null,
    plan_review_sla_days: null,
    permit_issuance_sla_days: null,
    inspection_sla_days: null,
    expedited_available: false,
    expedited_fee_multiplier: 1.5,
    submission_methods: [],
    accepted_file_formats: [],
    special_requirements: null,
    notes: null,
    is_active: true,
    last_verified_at: null,
    verified_by: null,
  });

  useEffect(() => {
    if (jurisdiction) {
      setFormData({
        name: jurisdiction.name,
        state: jurisdiction.state,
        city: jurisdiction.city,
        county: jurisdiction.county,
        website_url: jurisdiction.website_url,
        phone: jurisdiction.phone,
        email: jurisdiction.email,
        address: jurisdiction.address,
        reviewer_contacts: jurisdiction.reviewer_contacts || [],
        base_permit_fee: jurisdiction.base_permit_fee || 0,
        plan_review_fee: jurisdiction.plan_review_fee || 0,
        inspection_fee: jurisdiction.inspection_fee || 0,
        fee_notes: jurisdiction.fee_notes,
        fee_schedule_url: jurisdiction.fee_schedule_url,
        plan_review_sla_days: jurisdiction.plan_review_sla_days,
        permit_issuance_sla_days: jurisdiction.permit_issuance_sla_days,
        inspection_sla_days: jurisdiction.inspection_sla_days,
        expedited_available: jurisdiction.expedited_available,
        expedited_fee_multiplier: jurisdiction.expedited_fee_multiplier,
        submission_methods: jurisdiction.submission_methods || [],
        accepted_file_formats: jurisdiction.accepted_file_formats || [],
        special_requirements: jurisdiction.special_requirements,
        notes: jurisdiction.notes,
        is_active: jurisdiction.is_active,
        last_verified_at: jurisdiction.last_verified_at,
        verified_by: jurisdiction.verified_by,
      });
    } else {
      setFormData({
        name: '',
        state: '',
        city: null,
        county: null,
        website_url: null,
        phone: null,
        email: null,
        address: null,
        reviewer_contacts: [],
        base_permit_fee: 0,
        plan_review_fee: 0,
        inspection_fee: 0,
        fee_notes: null,
        fee_schedule_url: null,
        plan_review_sla_days: null,
        permit_issuance_sla_days: null,
        inspection_sla_days: null,
        expedited_available: false,
        expedited_fee_multiplier: 1.5,
        submission_methods: [],
        accepted_file_formats: [],
        special_requirements: null,
        notes: null,
        is_active: true,
        last_verified_at: null,
        verified_by: null,
      });
    }
  }, [jurisdiction, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
  };

  const addReviewerContact = () => {
    setFormData(prev => ({
      ...prev,
      reviewer_contacts: [...prev.reviewer_contacts, { ...emptyContact }],
    }));
  };

  const updateReviewerContact = (index: number, field: keyof ReviewerContact, value: string) => {
    setFormData(prev => ({
      ...prev,
      reviewer_contacts: prev.reviewer_contacts.map((c, i) => 
        i === index ? { ...c, [field]: value } : c
      ),
    }));
  };

  const removeReviewerContact = (index: number) => {
    setFormData(prev => ({
      ...prev,
      reviewer_contacts: prev.reviewer_contacts.filter((_, i) => i !== index),
    }));
  };

  const toggleArrayItem = (field: 'submission_methods' | 'accepted_file_formats', item: string) => {
    setFormData(prev => {
      const current = prev[field] || [];
      const updated = current.includes(item)
        ? current.filter(i => i !== item)
        : [...current, item];
      return { ...prev, [field]: updated };
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{jurisdiction ? 'Edit Jurisdiction' : 'Add New Jurisdiction'}</DialogTitle>
          <DialogDescription>
            Enter jurisdiction details including fees, SLAs, and reviewer contacts.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <Tabs defaultValue="basic" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basic">Basic Info</TabsTrigger>
              <TabsTrigger value="fees">Fees</TabsTrigger>
              <TabsTrigger value="sla">SLA</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
            </TabsList>

            {/* Basic Info Tab */}
            <TabsContent value="basic" className="space-y-4 mt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="name">Jurisdiction Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., City of Austin Building Department"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="state">State *</Label>
                  <Select
                    value={formData.state}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, state: value }))}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {US_STATES.map((state) => (
                        <SelectItem key={state.code} value={state.code}>
                          {state.name} ({state.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.city || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value || null }))}
                    placeholder="City name"
                  />
                </div>

                <div>
                  <Label htmlFor="county">County</Label>
                  <Input
                    id="county"
                    value={formData.county || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, county: e.target.value || null }))}
                    placeholder="County name"
                  />
                </div>

                <div>
                  <Label htmlFor="website_url">Website URL</Label>
                  <Input
                    id="website_url"
                    type="url"
                    value={formData.website_url || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, website_url: e.target.value || null }))}
                    placeholder="https://..."
                  />
                </div>

                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={formData.phone || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value || null }))}
                    placeholder="(555) 123-4567"
                  />
                </div>

                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value || null }))}
                    placeholder="permits@city.gov"
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={formData.address || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value || null }))}
                    placeholder="Full mailing address"
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label>Submission Methods</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {SUBMISSION_METHODS.map(method => (
                      <Badge
                        key={method}
                        variant={(formData.submission_methods || []).includes(method) ? "default" : "outline"}
                        className="cursor-pointer capitalize"
                        onClick={() => toggleArrayItem('submission_methods', method)}
                      >
                        {method}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <Label>Accepted File Formats</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {FILE_FORMATS.map(format => (
                      <Badge
                        key={format}
                        variant={(formData.accepted_file_formats || []).includes(format) ? "default" : "outline"}
                        className="cursor-pointer uppercase"
                        onClick={() => toggleArrayItem('accepted_file_formats', format)}
                      >
                        {format}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="sm:col-span-2 flex items-center gap-2">
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
                  />
                  <Label htmlFor="is_active">Active Jurisdiction</Label>
                </div>
              </div>
            </TabsContent>

            {/* Fees Tab */}
            <TabsContent value="fees" className="space-y-4 mt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="base_permit_fee">Base Permit Fee ($)</Label>
                  <Input
                    id="base_permit_fee"
                    type="number"
                    value={formData.base_permit_fee}
                    onChange={(e) => setFormData(prev => ({ ...prev, base_permit_fee: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <Label htmlFor="plan_review_fee">Plan Review Fee ($)</Label>
                  <Input
                    id="plan_review_fee"
                    type="number"
                    value={formData.plan_review_fee}
                    onChange={(e) => setFormData(prev => ({ ...prev, plan_review_fee: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <Label htmlFor="inspection_fee">Inspection Fee ($)</Label>
                  <Input
                    id="inspection_fee"
                    type="number"
                    value={formData.inspection_fee}
                    onChange={(e) => setFormData(prev => ({ ...prev, inspection_fee: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <Label htmlFor="fee_schedule_url">Fee Schedule URL</Label>
                  <Input
                    id="fee_schedule_url"
                    type="url"
                    value={formData.fee_schedule_url || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fee_schedule_url: e.target.value || null }))}
                    placeholder="https://..."
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label htmlFor="fee_notes">Fee Notes</Label>
                  <Textarea
                    id="fee_notes"
                    value={formData.fee_notes || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, fee_notes: e.target.value || null }))}
                    placeholder="Additional fee information, multipliers, etc."
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            {/* SLA Tab */}
            <TabsContent value="sla" className="space-y-4 mt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="plan_review_sla_days">Plan Review SLA (business days)</Label>
                  <Input
                    id="plan_review_sla_days"
                    type="number"
                    value={formData.plan_review_sla_days || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, plan_review_sla_days: parseInt(e.target.value) || null }))}
                    placeholder="e.g., 10"
                  />
                </div>

                <div>
                  <Label htmlFor="permit_issuance_sla_days">Permit Issuance SLA (business days)</Label>
                  <Input
                    id="permit_issuance_sla_days"
                    type="number"
                    value={formData.permit_issuance_sla_days || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, permit_issuance_sla_days: parseInt(e.target.value) || null }))}
                    placeholder="e.g., 5"
                  />
                </div>

                <div>
                  <Label htmlFor="inspection_sla_days">Inspection SLA (business days)</Label>
                  <Input
                    id="inspection_sla_days"
                    type="number"
                    value={formData.inspection_sla_days || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, inspection_sla_days: parseInt(e.target.value) || null }))}
                    placeholder="e.g., 2"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="expedited_available"
                      checked={formData.expedited_available}
                      onCheckedChange={(checked) => setFormData(prev => ({ ...prev, expedited_available: checked }))}
                    />
                    <Label htmlFor="expedited_available">Expedited Review Available</Label>
                  </div>
                </div>

                {formData.expedited_available && (
                  <div>
                    <Label htmlFor="expedited_fee_multiplier">Expedited Fee Multiplier</Label>
                    <Input
                      id="expedited_fee_multiplier"
                      type="number"
                      step="0.1"
                      value={formData.expedited_fee_multiplier}
                      onChange={(e) => setFormData(prev => ({ ...prev, expedited_fee_multiplier: parseFloat(e.target.value) || 1.5 }))}
                      placeholder="1.5"
                    />
                  </div>
                )}

                <div className="sm:col-span-2">
                  <Label htmlFor="special_requirements">Special Requirements</Label>
                  <Textarea
                    id="special_requirements"
                    value={formData.special_requirements || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, special_requirements: e.target.value || null }))}
                    placeholder="Any special requirements or notes about this jurisdiction..."
                    rows={3}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label htmlFor="notes">General Notes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes || ''}
                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value || null }))}
                    placeholder="Additional notes..."
                    rows={3}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Contacts Tab */}
            <TabsContent value="contacts" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <Label>Reviewer Contacts</Label>
                <Button type="button" variant="outline" size="sm" onClick={addReviewerContact}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Contact
                </Button>
              </div>

              {formData.reviewer_contacts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                  <User className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No reviewer contacts added yet</p>
                  <p className="text-sm">Click "Add Contact" to add a plan reviewer</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {formData.reviewer_contacts.map((contact, index) => (
                    <div key={index} className="p-4 border rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Contact #{index + 1}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeReviewerContact(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label>Name</Label>
                          <Input
                            value={contact.name}
                            onChange={(e) => updateReviewerContact(index, 'name', e.target.value)}
                            placeholder="John Smith"
                          />
                        </div>
                        <div>
                          <Label>Title</Label>
                          <Input
                            value={contact.title}
                            onChange={(e) => updateReviewerContact(index, 'title', e.target.value)}
                            placeholder="Senior Plan Reviewer"
                          />
                        </div>
                        <div>
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={contact.email}
                            onChange={(e) => updateReviewerContact(index, 'email', e.target.value)}
                            placeholder="john.smith@city.gov"
                          />
                        </div>
                        <div>
                          <Label>Phone</Label>
                          <Input
                            value={contact.phone}
                            onChange={(e) => updateReviewerContact(index, 'phone', e.target.value)}
                            placeholder="(555) 123-4567"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !formData.name || !formData.state}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {jurisdiction ? 'Save Changes' : 'Create Jurisdiction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
