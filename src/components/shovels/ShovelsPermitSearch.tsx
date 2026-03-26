import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Search, 
  Building2, 
  HardHat, 
  DollarSign, 
  Calendar, 
  MapPin, 
  FileText,
  Loader2,
  AlertCircle,
  ExternalLink,
  TrendingUp,
  Users
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { US_STATES } from '@/types/jurisdiction';
import { format } from 'date-fns';

interface ShovelsPermit {
  id: string;
  number: string;
  description: string;
  jurisdiction: string;
  job_value: number | null;
  status: string;
  type: string;
  subtype: string;
  issue_date: string | null;
  final_date: string | null;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  property_type: string;
  contractor_name: string | null;
  contractor_license_number: string | null;
}

interface ShovelsContractor {
  id: string;
  name: string;
  license_number: string;
  license_state: string;
  license_type: string;
  business_types: string[];
  address: string;
  city: string;
  state: string;
  permit_count: number;
  total_job_value: number;
}

interface ShovelsResponse<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

const PERMIT_TYPES = [
  { value: "all", label: "All Types" },
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "industrial", label: "Industrial" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "mechanical", label: "Mechanical" },
  { value: "roofing", label: "Roofing" },
  { value: "demolition", label: "Demolition" },
];

const PERMIT_SUBTYPES = [
  { value: "all", label: "All Subtypes" },
  { value: "new_construction", label: "New Construction" },
  { value: "renovation", label: "Renovation" },
  { value: "addition", label: "Addition" },
  { value: "alteration", label: "Alteration" },
  { value: "repair", label: "Repair" },
];

/** Default date range: last 12 months (Shovels v2 requires permit_from and permit_to) */
function getDefaultDateRange(): { permitFrom: string; permitTo: string } {
  const now = new Date();
  const permitTo = now.toISOString().slice(0, 10);
  const permitFrom = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  return { permitFrom, permitTo };
}

export function ShovelsPermitSearch() {
  const [activeTab, setActiveTab] = useState<"address" | "permits" | "contractors">("address");
  
  // Address lookup state (fetch-permit-data)
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResults, setAddressResults] = useState<unknown>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  
  const searchByAddress = async () => {
    if (!addressQuery.trim()) {
      toast.error("Please enter an address");
      return;
    }
    setAddressLoading(true);
    setAddressError(null);
    setAddressResults(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("fetch-permit-data", {
        body: { address: addressQuery.trim() },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setAddressResults(data);
      if (!data?.items?.length) {
        toast.info("No results found for this address");
      }
    } catch (err) {
      console.error("Address search error:", err);
      const message = err instanceof Error ? err.message : "Failed to fetch permit data";
      setAddressError(message);
      toast.error(message);
    } finally {
      setAddressLoading(false);
    }
  };
  
  const defaultDates = getDefaultDateRange();

  // Permit search state (Shovels v2 requires permit_from, permit_to, geo_id)
  const [permitSearch, setPermitSearch] = useState({
    jurisdiction: "",
    state: "",
    zipCode: "",
    permitFrom: defaultDates.permitFrom,
    permitTo: defaultDates.permitTo,
    type: "",
    subtype: "",
    minJobValue: "",
    maxJobValue: "",
  });

  // Contractor search state (Shovels v2 requires permit_from, permit_to, geo_id)
  const [contractorSearch, setContractorSearch] = useState({
    name: "",
    state: "",
    jurisdiction: "",
    zipCode: "",
    permitFrom: defaultDates.permitFrom,
    permitTo: defaultDates.permitTo,
    licenseNumber: "",
  });

  const [permits, setPermits] = useState<ShovelsPermit[]>([]);
  const [contractors, setContractors] = useState<ShovelsContractor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalResults, setTotalResults] = useState(0);

  const searchPermits = async () => {
    const hasGeo = permitSearch.jurisdiction || (permitSearch.state && permitSearch.state !== "all") || permitSearch.zipCode;
    if (!hasGeo) {
      toast.error("Please enter a jurisdiction, state, or zip code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string | number> = {
        size: 50,
        permit_from: permitSearch.permitFrom,
        permit_to: permitSearch.permitTo,
      };

      if (permitSearch.jurisdiction) params.jurisdiction = permitSearch.jurisdiction;
      if (permitSearch.state && permitSearch.state !== "all") params.state = permitSearch.state;
      if (permitSearch.zipCode) params.zip_code = permitSearch.zipCode;
      if (permitSearch.type && permitSearch.type !== "all") params.type = permitSearch.type;
      if (permitSearch.subtype && permitSearch.subtype !== "all") params.subtype = permitSearch.subtype;
      if (permitSearch.minJobValue) params.minJobValue = Number(permitSearch.minJobValue);
      if (permitSearch.maxJobValue) params.maxJobValue = Number(permitSearch.maxJobValue);

      const { data, error: fnError } = await supabase.functions.invoke('shovels-api', {
        body: { endpoint: 'permits', params },
      });

      if (fnError) throw fnError;

      if (data.error) {
        throw new Error(data.error);
      }

      const response = data as ShovelsResponse<ShovelsPermit>;
      setPermits(response.items || []);
      setTotalResults(response.total || 0);

      if (response.items?.length === 0) {
        toast.info("No permits found matching your criteria");
      }
    } catch (err) {
      console.error("Permit search error:", err);
      const message = err instanceof Error ? err.message : "Failed to search permits";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const searchContractors = async () => {
    const hasGeo = contractorSearch.jurisdiction || (contractorSearch.state && contractorSearch.state !== "all") || contractorSearch.zipCode;
    if (!hasGeo) {
      toast.error("Please enter a jurisdiction, state, or zip code");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string | number> = {
        size: 50,
        permit_from: contractorSearch.permitFrom,
        permit_to: contractorSearch.permitTo,
      };

      if (contractorSearch.name) params.name = contractorSearch.name;
      if (contractorSearch.state && contractorSearch.state !== "all") params.state = contractorSearch.state;
      if (contractorSearch.jurisdiction) params.jurisdiction = contractorSearch.jurisdiction;
      if (contractorSearch.zipCode) params.zip_code = contractorSearch.zipCode;
      if (contractorSearch.licenseNumber) params.licenseNumber = contractorSearch.licenseNumber;

      const { data, error: fnError } = await supabase.functions.invoke('shovels-api', {
        body: { endpoint: 'contractors', params },
      });

      if (fnError) throw fnError;

      if (data.error) {
        throw new Error(data.error);
      }

      const response = data as ShovelsResponse<ShovelsContractor>;
      setContractors(response.items || []);
      setTotalResults(response.total || 0);

      if (response.items?.length === 0) {
        toast.info("No contractors found matching your criteria");
      }
    } catch (err) {
      console.error("Contractor search error:", err);
      const message = err instanceof Error ? err.message : "Failed to search contractors";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number | null) => {
    if (!value) return "N/A";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    try {
      return format(new Date(dateStr), 'MMM d, yyyy');
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "address" | "permits" | "contractors")}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="address" className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Address Lookup
          </TabsTrigger>
          <TabsTrigger value="permits" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Permit Search
          </TabsTrigger>
          <TabsTrigger value="contractors" className="flex items-center gap-2">
            <HardHat className="h-4 w-4" />
            Contractor Lookup
          </TabsTrigger>
        </TabsList>

        {/* Address Lookup Tab */}
        <TabsContent value="address" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Search by Address
              </CardTitle>
              <CardDescription>
                Enter an address to fetch permit and property data from Shovels
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="e.g., 123 Market St, San Francisco, CA"
                  value={addressQuery}
                  onChange={(e) => setAddressQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchByAddress()}
                  className="flex-1"
                />
                <Button
                  onClick={searchByAddress}
                  disabled={addressLoading}
                  className="shrink-0"
                >
                  {addressLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Searching...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Search
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {addressError && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="flex items-center gap-3 py-4">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                <p className="text-destructive">{addressError}</p>
              </CardContent>
            </Card>
          )}

          {addressResults && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Results</CardTitle>
                <CardDescription>
                  Raw JSON response from Shovels API
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="p-4 rounded-lg bg-muted text-sm overflow-x-auto max-h-[500px] overflow-y-auto">
                  {JSON.stringify(addressResults, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Permit Search Tab */}
        <TabsContent value="permits" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Search className="h-5 w-5" />
                Search Commercial Permits
              </CardTitle>
              <CardDescription>
                Find building permits by jurisdiction, type, and value range
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Shovels v2 requires a location (jurisdiction, state, or zip) and date range. At least one location field is required.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Jurisdiction</label>
                  <Input
                    placeholder="e.g., Los Angeles, Berkeley"
                    value={permitSearch.jurisdiction}
                    onChange={(e) => setPermitSearch({ ...permitSearch, jurisdiction: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">State</label>
                  <Select
                    value={permitSearch.state}
                    onValueChange={(v) => setPermitSearch({ ...permitSearch, state: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All States</SelectItem>
                      {US_STATES.map(state => (
                        <SelectItem key={state.code} value={state.code}>
                          {state.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">ZIP Code</label>
                  <Input
                    placeholder="e.g., 94102"
                    value={permitSearch.zipCode}
                    onChange={(e) => setPermitSearch({ ...permitSearch, zipCode: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Date From</label>
                  <Input
                    type="date"
                    value={permitSearch.permitFrom}
                    onChange={(e) => setPermitSearch({ ...permitSearch, permitFrom: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Date To</label>
                  <Input
                    type="date"
                    value={permitSearch.permitTo}
                    onChange={(e) => setPermitSearch({ ...permitSearch, permitTo: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Permit Type</label>
                  <Select
                    value={permitSearch.type}
                    onValueChange={(v) => setPermitSearch({ ...permitSearch, type: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      {PERMIT_TYPES.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Subtype</label>
                  <Select
                    value={permitSearch.subtype}
                    onValueChange={(v) => setPermitSearch({ ...permitSearch, subtype: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All subtypes" />
                    </SelectTrigger>
                    <SelectContent>
                      {PERMIT_SUBTYPES.map(subtype => (
                        <SelectItem key={subtype.value} value={subtype.value}>
                          {subtype.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Min Job Value ($)</label>
                  <Input
                    type="number"
                    placeholder="e.g., 100000"
                    value={permitSearch.minJobValue}
                    onChange={(e) => setPermitSearch({ ...permitSearch, minJobValue: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Job Value ($)</label>
                  <Input
                    type="number"
                    placeholder="e.g., 5000000"
                    value={permitSearch.maxJobValue}
                    onChange={(e) => setPermitSearch({ ...permitSearch, maxJobValue: e.target.value })}
                  />
                </div>
              </div>

              <Button
                onClick={searchPermits}
                disabled={loading || !(permitSearch.jurisdiction || (permitSearch.state && permitSearch.state !== "all") || permitSearch.zipCode)}
                className="mt-4 w-full sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Search Permits
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Permit Results */}
          {error ? (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="flex items-center gap-3 py-4">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <p className="text-destructive">{error}</p>
              </CardContent>
            </Card>
          ) : permits.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    Permit Results
                  </CardTitle>
                  <Badge variant="secondary">
                    {permits.length} of {totalResults.toLocaleString()} results
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="space-y-3">
                    {permits.map((permit) => (
                      <Card key={permit.id} className="hover:bg-muted/50 transition-colors">
                        <CardContent className="py-4">
                          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                            <div className="space-y-2 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline">{permit.number}</Badge>
                                <Badge className="capitalize">{permit.type || "General"}</Badge>
                                {permit.subtype && (
                                  <Badge variant="secondary" className="capitalize">
                                    {permit.subtype.replace(/_/g, " ")}
                                  </Badge>
                                )}
                                <Badge 
                                  variant={permit.status === "finaled" ? "default" : "outline"}
                                  className="capitalize"
                                >
                                  {permit.status || "Unknown"}
                                </Badge>
                              </div>

                              <p className="text-sm font-medium line-clamp-2">
                                {permit.description || "No description available"}
                              </p>

                              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />
                                  {permit.property_address}, {permit.property_city}, {permit.property_state}
                                </span>
                                <span className="flex items-center gap-1">
                                  <Building2 className="h-3 w-3" />
                                  {permit.jurisdiction}
                                </span>
                              </div>

                              {permit.contractor_name && (
                                <div className="flex items-center gap-2 text-sm">
                                  <HardHat className="h-3 w-3 text-muted-foreground" />
                                  <span>{permit.contractor_name}</span>
                                  {permit.contractor_license_number && (
                                    <Badge variant="outline" className="text-xs">
                                      #{permit.contractor_license_number}
                                    </Badge>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-row lg:flex-col gap-4 lg:gap-2 lg:text-right shrink-0">
                              {permit.job_value && (
                                <div>
                                  <p className="text-xs text-muted-foreground">Job Value</p>
                                  <p className="font-semibold text-emerald-600">
                                    {formatCurrency(permit.job_value)}
                                  </p>
                                </div>
                              )}
                              <div>
                                <p className="text-xs text-muted-foreground">Issued</p>
                                <p className="text-sm">{formatDate(permit.issue_date)}</p>
                              </div>
                              {permit.final_date && (
                                <div>
                                  <p className="text-xs text-muted-foreground">Finaled</p>
                                  <p className="text-sm">{formatDate(permit.final_date)}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Contractor Search Tab */}
        <TabsContent value="contractors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <HardHat className="h-5 w-5" />
                Contractor Intelligence
              </CardTitle>
              <CardDescription>
                Look up contractors by name, license number, or state
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Shovels v2 requires a location (jurisdiction, state, or zip) and date range. At least one location field is required.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Jurisdiction</label>
                  <Input
                    placeholder="e.g., Los Angeles, Berkeley"
                    value={contractorSearch.jurisdiction}
                    onChange={(e) => setContractorSearch({ ...contractorSearch, jurisdiction: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">State</label>
                  <Select
                    value={contractorSearch.state}
                    onValueChange={(v) => setContractorSearch({ ...contractorSearch, state: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All States</SelectItem>
                      {US_STATES.map(state => (
                        <SelectItem key={state.code} value={state.code}>
                          {state.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">ZIP Code</label>
                  <Input
                    placeholder="e.g., 94102"
                    value={contractorSearch.zipCode}
                    onChange={(e) => setContractorSearch({ ...contractorSearch, zipCode: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Date From</label>
                  <Input
                    type="date"
                    value={contractorSearch.permitFrom}
                    onChange={(e) => setContractorSearch({ ...contractorSearch, permitFrom: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Date To</label>
                  <Input
                    type="date"
                    value={contractorSearch.permitTo}
                    onChange={(e) => setContractorSearch({ ...contractorSearch, permitTo: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Contractor Name</label>
                  <Input
                    placeholder="e.g., Smith Construction"
                    value={contractorSearch.name}
                    onChange={(e) => setContractorSearch({ ...contractorSearch, name: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">License Number</label>
                  <Input
                    placeholder="e.g., ABC123456"
                    value={contractorSearch.licenseNumber}
                    onChange={(e) => setContractorSearch({ ...contractorSearch, licenseNumber: e.target.value })}
                  />
                </div>
              </div>

              <Button
                onClick={searchContractors}
                disabled={loading || !(contractorSearch.jurisdiction || (contractorSearch.state && contractorSearch.state !== "all") || contractorSearch.zipCode)}
                className="mt-4 w-full sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Search Contractors
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Contractor Results */}
          {error ? (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="flex items-center gap-3 py-4">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <p className="text-destructive">{error}</p>
              </CardContent>
            </Card>
          ) : contractors.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">
                    Contractor Results
                  </CardTitle>
                  <Badge variant="secondary">
                    {contractors.length} of {totalResults.toLocaleString()} results
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  <div className="grid sm:grid-cols-2 gap-4">
                    {contractors.map((contractor) => (
                      <Card key={contractor.id} className="hover:bg-muted/50 transition-colors">
                        <CardContent className="py-4 space-y-3">
                          <div>
                            <h4 className="font-semibold">{contractor.name}</h4>
                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {contractor.city}, {contractor.state}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">
                              License: {contractor.license_number}
                            </Badge>
                            <Badge variant="secondary">
                              {contractor.license_type}
                            </Badge>
                          </div>

                          <Separator />

                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                Permits
                              </p>
                              <p className="font-semibold">{contractor.permit_count?.toLocaleString() || 0}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground flex items-center gap-1">
                                <TrendingUp className="h-3 w-3" />
                                Total Value
                              </p>
                              <p className="font-semibold text-emerald-600">
                                {formatCurrency(contractor.total_job_value)}
                              </p>
                            </div>
                          </div>

                          {contractor.business_types?.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {contractor.business_types.slice(0, 3).map((type, idx) => (
                                <Badge key={idx} variant="outline" className="text-xs capitalize">
                                  {type.replace(/_/g, " ")}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
