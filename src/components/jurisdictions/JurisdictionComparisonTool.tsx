import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Search, 
  X, 
  Plus, 
  DollarSign, 
  Clock, 
  Building2, 
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Minus,
  Scale
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { US_STATES } from '@/types/jurisdiction';

interface JurisdictionData {
  id: string;
  name: string;
  state: string;
  city: string | null;
  county: string | null;
  base_permit_fee: number | null;
  plan_review_fee: number | null;
  inspection_fee: number | null;
  plan_review_sla_days: number | null;
  permit_issuance_sla_days: number | null;
  inspection_sla_days: number | null;
  expedited_available: boolean | null;
  expedited_fee_multiplier: number | null;
  residential_units_2024: number | null;
  is_high_volume: boolean | null;
  submission_methods: string[] | null;
  website_url: string | null;
}

interface ComparisonMetric {
  label: string;
  getValue: (j: JurisdictionData) => string | number | boolean | null;
  format: (value: any) => string;
  type: 'currency' | 'days' | 'text' | 'boolean' | 'number';
  lowerIsBetter?: boolean;
}

const COMPARISON_METRICS: ComparisonMetric[] = [
  {
    label: 'Base Permit Fee',
    getValue: (j) => j.base_permit_fee,
    format: (v) => v ? `$${v.toLocaleString()}` : '—',
    type: 'currency',
    lowerIsBetter: true,
  },
  {
    label: 'Plan Review Fee',
    getValue: (j) => j.plan_review_fee,
    format: (v) => v ? `$${v.toLocaleString()}` : '—',
    type: 'currency',
    lowerIsBetter: true,
  },
  {
    label: 'Inspection Fee',
    getValue: (j) => j.inspection_fee,
    format: (v) => v ? `$${v.toLocaleString()}` : '—',
    type: 'currency',
    lowerIsBetter: true,
  },
  {
    label: 'Total Estimated Fees',
    getValue: (j) => (j.base_permit_fee || 0) + (j.plan_review_fee || 0) + (j.inspection_fee || 0),
    format: (v) => v > 0 ? `$${v.toLocaleString()}` : '—',
    type: 'currency',
    lowerIsBetter: true,
  },
  {
    label: 'Plan Review SLA',
    getValue: (j) => j.plan_review_sla_days,
    format: (v) => v ? `${v} days` : '—',
    type: 'days',
    lowerIsBetter: true,
  },
  {
    label: 'Permit Issuance SLA',
    getValue: (j) => j.permit_issuance_sla_days,
    format: (v) => v ? `${v} days` : '—',
    type: 'days',
    lowerIsBetter: true,
  },
  {
    label: 'Inspection SLA',
    getValue: (j) => j.inspection_sla_days,
    format: (v) => v ? `${v} days` : '—',
    type: 'days',
    lowerIsBetter: true,
  },
  {
    label: 'Total Review Time',
    getValue: (j) => (j.plan_review_sla_days || 0) + (j.permit_issuance_sla_days || 0),
    format: (v) => v > 0 ? `${v} days` : '—',
    type: 'days',
    lowerIsBetter: true,
  },
  {
    label: 'Expedited Review',
    getValue: (j) => j.expedited_available,
    format: (v) => v === true ? 'Available' : v === false ? 'Not Available' : '—',
    type: 'boolean',
  },
  {
    label: 'Expedited Multiplier',
    getValue: (j) => j.expedited_fee_multiplier,
    format: (v) => v ? `${v}x` : '—',
    type: 'number',
  },
  {
    label: '2024 Permit Volume',
    getValue: (j) => j.residential_units_2024,
    format: (v) => v ? v.toLocaleString() : '—',
    type: 'number',
  },
  {
    label: 'Submission Methods',
    getValue: (j) => j.submission_methods?.join(', ') || null,
    format: (v) => v || '—',
    type: 'text',
  },
];

export function JurisdictionComparisonTool() {
  const [selectedJurisdictions, setSelectedJurisdictions] = useState<JurisdictionData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<string>('');
  const [searchResults, setSearchResults] = useState<JurisdictionData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchQuery.length >= 2 || stateFilter) {
      searchJurisdictions();
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, stateFilter]);

  const searchJurisdictions = async () => {
    setLoading(true);
    let query = supabase
      .from('jurisdictions')
      .select(`
        id, name, state, city, county,
        base_permit_fee, plan_review_fee, inspection_fee,
        plan_review_sla_days, permit_issuance_sla_days, inspection_sla_days,
        expedited_available, expedited_fee_multiplier,
        residential_units_2024, is_high_volume,
        submission_methods, website_url
      `)
      .eq('is_active', true)
      .order('residential_units_2024', { ascending: false, nullsFirst: false })
      .limit(20);

    if (stateFilter) {
      query = query.eq('state', stateFilter);
    }

    if (searchQuery.length >= 2) {
      const SEARCH_ALIASES: Record<string, string[]> = {
        'district of columbia': ['Washington', 'DC'],
        'washington dc': ['Washington', 'DC'],
        'washington d.c.': ['Washington', 'DC'],
        'd.c.': ['Washington', 'DC'],
      };

      const lowerQuery = searchQuery.toLowerCase();
      const aliasTerms = Object.entries(SEARCH_ALIASES)
        .filter(([key]) => key.includes(lowerQuery) || lowerQuery.includes(key))
        .flatMap(([, terms]) => terms);

      const allTerms = [searchQuery, ...aliasTerms];
      const orConditions = allTerms
        .map(term => `name.ilike.%${term}%,city.ilike.%${term}%,county.ilike.%${term}%,state.ilike.%${term}%`)
        .join(',');

      query = query.or(orConditions);
    }

    const { data, error } = await query;

    if (!error && data) {
      // Filter out already selected jurisdictions
      const selectedIds = new Set(selectedJurisdictions.map(j => j.id));
      setSearchResults(data.filter(j => !selectedIds.has(j.id)));
    }
    setLoading(false);
  };

  const addJurisdiction = (jurisdiction: JurisdictionData) => {
    if (selectedJurisdictions.length < 5) {
      setSelectedJurisdictions([...selectedJurisdictions, jurisdiction]);
      setSearchResults(searchResults.filter(j => j.id !== jurisdiction.id));
    }
  };

  const removeJurisdiction = (id: string) => {
    setSelectedJurisdictions(selectedJurisdictions.filter(j => j.id !== id));
  };

  const getBestValue = (metric: ComparisonMetric): number | null => {
    const values = selectedJurisdictions
      .map(j => metric.getValue(j))
      .filter((v): v is number => typeof v === 'number' && v > 0);
    
    if (values.length === 0) return null;
    return metric.lowerIsBetter ? Math.min(...values) : Math.max(...values);
  };

  const getWorstValue = (metric: ComparisonMetric): number | null => {
    const values = selectedJurisdictions
      .map(j => metric.getValue(j))
      .filter((v): v is number => typeof v === 'number' && v > 0);
    
    if (values.length === 0) return null;
    return metric.lowerIsBetter ? Math.max(...values) : Math.min(...values);
  };

  return (
    <div className="space-y-6">
      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Add Jurisdictions to Compare
          </CardTitle>
          <CardDescription>
            Select up to 5 jurisdictions to compare their fees and SLAs side-by-side
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-3">
            <Select value={stateFilter || "all"} onValueChange={(val) => setStateFilter(val === "all" ? "" : val)}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filter by state" />
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
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search jurisdictions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Search Results */}
          {(searchQuery.length >= 2 || stateFilter) && (
            <ScrollArea className="h-48 mt-4 border rounded-lg">
              {loading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  No jurisdictions found
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {searchResults.map(jurisdiction => (
                    <button
                      key={jurisdiction.id}
                      onClick={() => addJurisdiction(jurisdiction)}
                      disabled={selectedJurisdictions.length >= 5}
                      className={cn(
                        "w-full flex items-center justify-between p-3 rounded-lg text-left transition-colors",
                        "hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                      )}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{jurisdiction.name}</span>
                          {jurisdiction.is_high_volume && (
                            <Badge variant="secondary" className="text-xs">High Volume</Badge>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {jurisdiction.city && `${jurisdiction.city}, `}{jurisdiction.state}
                        </span>
                      </div>
                      <Plus className="h-4 w-4 text-primary" />
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}

          {/* Selected Jurisdictions */}
          {selectedJurisdictions.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {selectedJurisdictions.map(jurisdiction => (
                <Badge
                  key={jurisdiction.id}
                  variant="secondary"
                  className="pl-3 pr-1 py-1.5 text-sm flex items-center gap-2"
                >
                  <Building2 className="h-3 w-3" />
                  {jurisdiction.name}, {jurisdiction.state}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 hover:bg-destructive/20"
                    onClick={() => removeJurisdiction(jurisdiction.id)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comparison Table */}
      {selectedJurisdictions.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Comparison Results
            </CardTitle>
            <CardDescription>
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Best value
              </span>
              <span className="inline-flex items-center gap-1 ml-4">
                <AlertCircle className="h-3 w-3 text-amber-500" /> Highest cost/time
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4 font-medium text-muted-foreground min-w-[180px]">
                      Metric
                    </th>
                    {selectedJurisdictions.map(jurisdiction => (
                      <th key={jurisdiction.id} className="text-center py-3 px-4 min-w-[150px]">
                        <div className="font-medium">{jurisdiction.name}</div>
                        <div className="text-xs text-muted-foreground font-normal">
                          {jurisdiction.state}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_METRICS.map((metric, idx) => {
                    const bestValue = getBestValue(metric);
                    const worstValue = getWorstValue(metric);

                    return (
                      <tr key={metric.label} className={idx % 2 === 0 ? 'bg-muted/30' : ''}>
                        <td className="py-3 px-4 font-medium text-sm">
                          <div className="flex items-center gap-2">
                            {metric.type === 'currency' && <DollarSign className="h-4 w-4 text-muted-foreground" />}
                            {metric.type === 'days' && <Clock className="h-4 w-4 text-muted-foreground" />}
                            {metric.label}
                          </div>
                        </td>
                        {selectedJurisdictions.map(jurisdiction => {
                          const value = metric.getValue(jurisdiction);
                          const isBest = typeof value === 'number' && value > 0 && value === bestValue;
                          const isWorst = typeof value === 'number' && value > 0 && value === worstValue && bestValue !== worstValue;
                          
                          return (
                            <td
                              key={jurisdiction.id}
                              className={cn(
                                "text-center py-3 px-4",
                                isBest && "bg-emerald-50 dark:bg-emerald-950/30",
                                isWorst && "bg-amber-50 dark:bg-amber-950/30"
                              )}
                            >
                              <div className="flex items-center justify-center gap-1">
                                {isBest && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                                {isWorst && <AlertCircle className="h-4 w-4 text-amber-500" />}
                                <span className={cn(
                                  "text-sm",
                                  isBest && "font-semibold text-emerald-700 dark:text-emerald-400",
                                  isWorst && "text-amber-700 dark:text-amber-400"
                                )}>
                                  {metric.format(value)}
                                </span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {selectedJurisdictions.length < 2 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Scale className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">Select Jurisdictions to Compare</h3>
            <p className="text-muted-foreground max-w-md">
              Search and add at least 2 jurisdictions above to see a side-by-side comparison of their permit fees, review times, and other metrics.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
