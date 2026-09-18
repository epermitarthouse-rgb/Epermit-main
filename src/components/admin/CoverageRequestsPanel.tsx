import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, MapPin, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  COVERAGE_REQUEST_STATUSES,
  CoverageRequestPrefill,
  CoverageRequestRow,
  CoverageRequestStatus,
} from '@/types/jurisdiction';

interface CoverageRequestsPanelProps {
  onAddJurisdiction: (prefill: CoverageRequestPrefill) => void;
}

function statusBadgeVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'pending':
      return 'default';
    case 'reviewed':
      return 'secondary';
    case 'added':
      return 'outline';
    case 'dismissed':
      return 'destructive';
    default:
      return 'outline';
  }
}

export function CoverageRequestsPanel({ onAddJurisdiction }: CoverageRequestsPanelProps) {
  const [requests, setRequests] = useState<CoverageRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<CoverageRequestStatus | 'all'>('pending');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchRequests = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { data, error } = await supabase
        .from('coverage_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data ?? []);
    } catch (err) {
      console.error('Error fetching coverage requests:', err);
      toast.error('Failed to load coverage requests');
    } finally {
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const updateStatus = async (request: CoverageRequestRow, status: CoverageRequestStatus) => {
    setUpdatingId(request.id);
    try {
      const { error } = await supabase
        .from('coverage_requests')
        .update({ status })
        .eq('id', request.id);

      if (error) throw error;

      setRequests((prev) => prev.map((row) => (row.id === request.id ? { ...row, status } : row)));
      toast.success(`Request marked as ${status}`);
    } catch (err) {
      console.error('Error updating coverage request:', err);
      toast.error('Failed to update coverage request');
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredRequests = requests.filter((request) =>
    statusFilter === 'all' ? true : request.status === statusFilter,
  );

  const handleAddJurisdiction = (request: CoverageRequestRow) => {
    onAddJurisdiction({
      name: request.jurisdiction_name,
      state: request.state,
      city: request.city,
      county: request.county,
      notes: request.notes,
      coverageRequestId: request.id,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Coverage Requests
            </CardTitle>
            <CardDescription>
              Review public requests for jurisdictions not yet in the catalog
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as CoverageRequestStatus | 'all')}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {COVERAGE_REQUEST_STATUSES.map((status) => (
                  <SelectItem key={status} value={status} className="capitalize">
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void fetchRequests(true)} disabled={refreshing}>
              {refreshing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filteredRequests.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <p>No coverage requests{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Jurisdiction</TableHead>
                  <TableHead>Requester</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>
                      <div className="font-medium">{request.jurisdiction_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[request.city, request.state, request.county].filter(Boolean).join(', ')}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{request.email}</div>
                      {request.company_name && (
                        <div className="text-xs text-muted-foreground">{request.company_name}</div>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <div className="text-sm text-muted-foreground line-clamp-2">
                        {request.notes || '—'}
                      </div>
                      {request.estimated_permits_per_year != null && (
                        <div className="text-xs text-muted-foreground mt-1">
                          ~{request.estimated_permits_per_year} permits/yr
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(request.status)} className="capitalize">
                        {request.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(request.created_at), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddJurisdiction(request)}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add jurisdiction
                        </Button>
                        <Select
                          value={request.status}
                          onValueChange={(value) =>
                            void updateStatus(request, value as CoverageRequestStatus)
                          }
                          disabled={updatingId === request.id}
                        >
                          <SelectTrigger className="w-[130px] h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {COVERAGE_REQUEST_STATUSES.map((status) => (
                              <SelectItem key={status} value={status} className="capitalize">
                                {status}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
