import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
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
  Upload
} from 'lucide-react';
import { useJurisdictions } from '@/hooks/useJurisdictions';
import { JurisdictionFormDialog } from './JurisdictionFormDialog';
import { JurisdictionCsvImportDialog } from './JurisdictionCsvImportDialog';
import { Jurisdiction, CreateJurisdictionData, US_STATES } from '@/types/jurisdiction';
import { format } from 'date-fns';

export function JurisdictionManager() {
  const { 
    jurisdictions, 
    loading, 
    createJurisdiction, 
    updateJurisdiction, 
    deleteJurisdiction,
    verifyJurisdiction,
    fetchJurisdictions
  } = useJurisdictions();

  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<Jurisdiction | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [jurisdictionToDelete, setJurisdictionToDelete] = useState<Jurisdiction | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filteredJurisdictions = jurisdictions.filter(j => {
    const matchesSearch = j.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
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
    if (selectedJurisdiction) {
      await updateJurisdiction(selectedJurisdiction.id, data);
    } else {
      await createJurisdiction(data);
    }
    setFormLoading(false);
    setFormDialogOpen(false);
  };

  const handleDelete = async () => {
    if (!jurisdictionToDelete) return;
    setDeleting(true);
    await deleteJurisdiction(jurisdictionToDelete.id);
    setDeleting(false);
    setDeleteDialogOpen(false);
    setJurisdictionToDelete(null);
  };

  const handleVerify = async (jurisdiction: Jurisdiction) => {
    await verifyJurisdiction(jurisdiction.id);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStateName = (code: string) => {
    return US_STATES.find(s => s.code === code)?.name || code;
  };

  const uniqueStates = [...new Set(jurisdictions.map(j => j.state))].sort();

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
        {/* Filters */}
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
            {uniqueStates.map(state => (
              <option key={state} value={state}>{getStateName(state)}</option>
            ))}
          </select>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold">{jurisdictions.length}</p>
            <p className="text-xs text-muted-foreground">Total Jurisdictions</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold">{jurisdictions.filter(j => j.is_active).length}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold text-amber-600">
              {jurisdictions.filter(j => (j as any).is_high_volume).length}
            </p>
            <p className="text-xs text-muted-foreground">High Volume</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold">{uniqueStates.length}</p>
            <p className="text-xs text-muted-foreground">States Covered</p>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg text-center">
            <p className="text-2xl font-bold">
              {jurisdictions.reduce((sum, j) => sum + (j.reviewer_contacts?.length || 0), 0)}
            </p>
            <p className="text-xs text-muted-foreground">Contacts</p>
          </div>
        </div>

        {/* Table */}
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
                <p className="text-sm">Click "Add Jurisdiction" to get started</p>
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
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJurisdictions.map((jurisdiction) => {
                  const jData = jurisdiction as any;
                  return (
                    <TableRow key={jurisdiction.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium">{jurisdiction.name}</p>
                              {jData.is_high_volume && (
                                <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
                                  High Volume
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {jData.data_source || 'Manual Entry'}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{jurisdiction.state}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {jData.residential_units_2024 ? (
                          <div className="text-sm">
                            <span className="font-medium">{jData.residential_units_2024.toLocaleString()}</span>
                            <p className="text-xs text-muted-foreground">
                              SF: {jData.sf_1unit_units_2024?.toLocaleString() || 0} | MF: {jData.mf_3plus_units_2024?.toLocaleString() || 0}
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
                        <Badge variant={jurisdiction.is_active ? "default" : "secondary"}>
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
                            <DropdownMenuItem onClick={() => handleVerify(jurisdiction)}>
                              <CheckCircle className="mr-2 h-4 w-4" />
                              Mark as Verified
                            </DropdownMenuItem>
                            {jurisdiction.website_url && (
                              <DropdownMenuItem asChild>
                                <a href={jurisdiction.website_url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="mr-2 h-4 w-4" />
                                  Visit Website
                                </a>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem 
                              className="text-destructive"
                              onClick={() => {
                                setJurisdictionToDelete(jurisdiction);
                                setDeleteDialogOpen(true);
                              }}
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

      {/* Form Dialog */}
      <JurisdictionFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        jurisdiction={selectedJurisdiction}
        onSubmit={handleSubmit}
        loading={formLoading}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Jurisdiction</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{jurisdictionToDelete?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CSV Import Dialog */}
      <JurisdictionCsvImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportComplete={fetchJurisdictions}
      />
    </Card>
  );
}
