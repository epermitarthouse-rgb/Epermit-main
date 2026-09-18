import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Plus,
  Search,
  MoreHorizontal,
  Pencil,
  Trash2,
  CheckCircle,
  ExternalLink,
  Loader2,
  Building2,
  Clock,
  DollarSign,
  Upload,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import { useJurisdictions } from '@/hooks/useJurisdictions';
import { JurisdictionFormDialog } from './JurisdictionFormDialog';
import { JurisdictionCsvImportDialog } from './JurisdictionCsvImportDialog';
import {
  Jurisdiction,
  CreateJurisdictionData,
  US_STATES,
  isJurisdictionVerified,
} from '@/types/jurisdiction';
import { subscriptionBlockMessage } from '@/lib/jurisdictionSubscriptionIntegrity';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

interface JurisdictionManagerProps {
  formPrefill?: Partial<CreateJurisdictionData> | null;
  onFormPrefillConsumed?: () => void;
  coverageRequestId?: string | null;
  onCoverageRequestResolved?: (id: string) => void;
}

export function JurisdictionManager({
  formPrefill,
  onFormPrefillConsumed,
  coverageRequestId,
  onCoverageRequestResolved,
}: JurisdictionManagerProps) {
  const {
    jurisdictions,
    loading,
    createJurisdiction,
    updateJurisdiction,
    deleteJurisdiction,
    deactivateJurisdiction,
    verifyJurisdiction,
    fetchJurisdictions,
    getSubscriptionCount,
  } = useJurisdictions();

  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<Jurisdiction | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [jurisdictionToDelete, setJurisdictionToDelete] = useState<Jurisdiction | null>(null);
  const [subscriptionCount, setSubscriptionCount] = useState<number | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  useEffect(() => {
    if (formPrefill) {
      setSelectedJurisdiction(null);
      setFormDialogOpen(true);
    }
  }, [formPrefill]);

  const filteredJurisdictions = jurisdictions.filter((j) => {
    const matchesSearch =
      j.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.city?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.county?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesState = stateFilter === 'all' || j.state === stateFilter;
    return matchesSearch && matchesState;
  });

  const handleCreate = () => {
    setSelectedJurisdiction(null);
    setFormDialogOpen(true);
  };

  const handleEdit = (jurisdiction: Jurisdiction) => {
    setSelectedJurisdiction(jurisdiction);
    setFormDialogOpen(true);
  };

  const handleSubmit = async (data: CreateJurisdictionData) => {
    setFormLoading(true);
    let success = false;

    if (selectedJurisdiction) {
      success = Boolean(await updateJurisdiction(selectedJurisdiction.id, data));
    } else {
      const created = await createJurisdiction(data);
      success = Boolean(created);

      if (success && coverageRequestId) {
        try {
          const { error } = await supabase
            .from('coverage_requests')
            .update({ status: 'added' })
            .eq('id', coverageRequestId);
          if (error) throw error;
          onCoverageRequestResolved?.(coverageRequestId);
        } catch (err) {
          console.error('Failed to mark coverage request as added:', err);
          toast.error('Jurisdiction created, but failed to update coverage request status');
        }
      }
    }

    setFormLoading(false);
    if (success) {
      setFormDialogOpen(false);
      setSelectedJurisdiction(null);
      onFormPrefillConsumed?.();
    }
  };

  const openDeleteDialog = async (jurisdiction: Jurisdiction) => {
    setJurisdictionToDelete(jurisdiction);
    setSubscriptionCount(await getSubscriptionCount(jurisdiction.id));
    setDeleteDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!jurisdictionToDelete) return;
    setDeleting(true);
    const deleted = await deleteJurisdiction(jurisdictionToDelete.id);
    setDeleting(false);
    if (deleted) {
      setDeleteDialogOpen(false);
      setJurisdictionToDelete(null);
      setSubscriptionCount(null);
    }
  };

  const handleDeactivate = async () => {
    if (!jurisdictionToDelete) return;
    setDeactivating(true);
    const deactivated = await deactivateJurisdiction(jurisdictionToDelete.id);
    setDeactivating(false);
    if (deactivated) {
      setDeleteDialogOpen(false);
      setJurisdictionToDelete(null);
      setSubscriptionCount(null);
    }
  };

  const handleVerify = async (jurisdiction: Jurisdiction) => {
    setVerifyingId(jurisdiction.id);
    await verifyJurisdiction(jurisdiction.id);
    setVerifyingId(null);
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);

  const getStateName = (code: string) => US_STATES.find((s) => s.code === code)?.name || code;
  const uniqueStates = [...new Set(jurisdictions.map((j) => j.state))].sort();
  const hasBlockingSubscriptions = subscriptionCount !== null && subscriptionCount > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Jurisdiction Database
            </CardTitle>
            <CardDescription>
              Manage jurisdiction information, fees, SLAs, and reviewer contacts
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import CSV
            </Button>
            <Button onClick={handleCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Add Jurisdiction
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search jurisdictions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="px-3 py-2 border rounded-md bg-background text-sm"
          >
            <option value="all">All States</option>
            {uniqueStates.map((state) => (
              <option key={state} value={state}>
                {getStateName(state)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold">{jurisdictions.length}</p>
            <p className="text-xs text-muted-foreground">Total Jurisdictions</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold">{jurisdictions.filter((j) => j.is_active).length}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold text-amber-600">
              {jurisdictions.filter((j) => j.is_high_volume).length}
            </p>
            <p className="text-xs text-muted-foreground">High Volume</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold">{uniqueStates.length}</p>
            <p className="text-xs text-muted-foreground">States Covered</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold">
              {jurisdictions.filter((j) => isJurisdictionVerified(j)).length}
            </p>
            <p className="text-xs text-muted-foreground">Verified</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredJurisdictions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {searchQuery || stateFilter !== 'all' ? (
              <p>No jurisdictions match your search criteria</p>
            ) : (
              <>
                <Building2 className="h-12 w-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No jurisdictions added yet</p>
                <p className="text-sm">Click &quot;Add Jurisdiction&quot; to get started</p>
              </>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead className="text-center">State</TableHead>
                  <TableHead className="text-center">2024 Units</TableHead>
                  <TableHead className="text-center">Fees</TableHead>
                  <TableHead className="text-center">SLA</TableHead>
                  <TableHead className="text-center">Verified</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJurisdictions.map((jurisdiction) => {
                  const verified = isJurisdictionVerified(jurisdiction);
                  return (
                    <TableRow key={jurisdiction.id}>
                      <TableCell>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium">{jurisdiction.name}</p>
                            {jurisdiction.is_high_volume && (
                              <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
                                High Volume
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {jurisdiction.data_source || 'Manual Entry'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{jurisdiction.state}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {jurisdiction.residential_units_2024 ? (
                          <div className="text-sm">
                            <span className="font-medium">
                              {jurisdiction.residential_units_2024.toLocaleString()}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              SF: {jurisdiction.sf_1unit_units_2024?.toLocaleString() || 0} | MF:{' '}
                              {jurisdiction.mf_3plus_units_2024?.toLocaleString() || 0}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <DollarSign className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">
                            {formatCurrency(jurisdiction.base_permit_fee + jurisdiction.plan_review_fee)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {jurisdiction.plan_review_sla_days ? (
                          <div className="flex items-center justify-center gap-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-sm">{jurisdiction.plan_review_sla_days}d</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {verified ? (
                          <div className="flex flex-col items-center gap-1">
                            <Badge className="bg-green-500/10 text-green-700 border-green-500/20">
                              <ShieldCheck className="h-3 w-3 mr-1" />
                              Verified
                            </Badge>
                            {jurisdiction.last_verified_at && (
                              <span className="text-[10px] text-muted-foreground">
                                {format(new Date(jurisdiction.last_verified_at), 'MMM d, yyyy')}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            <ShieldAlert className="h-3 w-3 mr-1" />
                            Unverified
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={jurisdiction.is_active ? 'default' : 'secondary'}>
                          {jurisdiction.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEdit(jurisdiction)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleVerify(jurisdiction)}
                              disabled={verifyingId === jurisdiction.id}
                            >
                              {verifyingId === jurisdiction.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle className="mr-2 h-4 w-4" />
                              )}
                              Mark as Verified
                            </DropdownMenuItem>
                            {jurisdiction.website_url && (
                              <DropdownMenuItem asChild>
                                <a
                                  href={jurisdiction.website_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Visit Website
                                </a>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => void openDeleteDialog(jurisdiction)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <JurisdictionFormDialog
        open={formDialogOpen}
        onOpenChange={(open) => {
          setFormDialogOpen(open);
          if (!open) {
            setSelectedJurisdiction(null);
            onFormPrefillConsumed?.();
          }
        }}
        jurisdiction={selectedJurisdiction}
        initialData={selectedJurisdiction ? null : formPrefill}
        onSubmit={handleSubmit}
        loading={formLoading}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasBlockingSubscriptions ? 'Deactivate Jurisdiction?' : 'Delete Jurisdiction?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasBlockingSubscriptions
                ? subscriptionBlockMessage(subscriptionCount ?? 0)
                : `Are you sure you want to delete "${jurisdictionToDelete?.name}"? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {hasBlockingSubscriptions ? (
              <AlertDialogAction onClick={handleDeactivate} disabled={deactivating}>
                {deactivating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Deactivate
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleting}
              >
                {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <JurisdictionCsvImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportComplete={fetchJurisdictions}
      />
    </Card>
  );
}
