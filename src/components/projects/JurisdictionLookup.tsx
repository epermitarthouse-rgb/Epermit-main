import { useState, useEffect, useRef, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Building2, 
  Search, 
  Clock, 
  DollarSign, 
  Loader2,
  CheckCircle,
  X,
  History
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useRecentlyUsed } from '@/hooks/useRecentlyUsed';
interface JurisdictionResult {
  id: string;
  name: string;
  state: string;
  city: string | null;
  base_permit_fee: number;
  plan_review_fee: number;
  inspection_fee: number;
  plan_review_sla_days: number | null;
  permit_issuance_sla_days: number | null;
  inspection_sla_days: number | null;
  is_high_volume: boolean;
  residential_units_2024: number | null;
}

interface JurisdictionLookupProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (jurisdiction: JurisdictionResult | null) => void;
  stateFilter?: string;
  className?: string;
}

const RECENT_JURISDICTIONS_KEY = 'recent-jurisdictions';

export function JurisdictionLookup({
  value,
  onChange,
  onSelect,
  stateFilter,
  className,
}: JurisdictionLookupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<JurisdictionResult[]>([]);
  const [recentJurisdictions, setRecentJurisdictions] = useState<JurisdictionResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<JurisdictionResult | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { recentItems, addRecentItem } = useRecentlyUsed(RECENT_JURISDICTIONS_KEY);

  // Fetch recent jurisdictions from IDs
  useEffect(() => {
    const fetchRecentJurisdictions = async () => {
      if (recentItems.length === 0) {
        setRecentJurisdictions([]);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('jurisdictions')
          .select('id, name, state, city, base_permit_fee, plan_review_fee, inspection_fee, plan_review_sla_days, permit_issuance_sla_days, inspection_sla_days, is_high_volume, residential_units_2024')
          .in('id', recentItems)
          .eq('is_active', true);

        if (error) throw error;

        // Sort by the order in recentItems
        const sorted = recentItems
          .map(id => data?.find(j => j.id === id))
          .filter((j): j is JurisdictionResult => j !== undefined);
        
        setRecentJurisdictions(sorted);
      } catch (err) {
        console.error('Error fetching recent jurisdictions:', err);
      }
    };

    fetchRecentJurisdictions();
  }, [recentItems]);
  // Search jurisdictions
  useEffect(() => {
    const searchJurisdictions = async () => {
      if (value.length < 2) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        // Check if search term matches "District of Columbia" alias for DC
        const searchLower = value.toLowerCase();
        const isDistrictSearch = 'district of columbia'.includes(searchLower) && searchLower.length >= 2;
        
        // Build OR conditions for search
        let orConditions = `name.ilike.%${value}%,state.ilike.${value}`;
        if (isDistrictSearch) {
          orConditions += `,state.eq.DC`;
        }

        let query = supabase
          .from('jurisdictions')
          .select('id, name, state, city, base_permit_fee, plan_review_fee, inspection_fee, plan_review_sla_days, permit_issuance_sla_days, inspection_sla_days, is_high_volume, residential_units_2024')
          .eq('is_active', true)
          .or(orConditions)
          .order('residential_units_2024', { ascending: false, nullsFirst: false })
          .limit(10);

        if (stateFilter) {
          query = query.eq('state', stateFilter);
        }

        const { data, error } = await query;

        if (error) throw error;
        setResults(data || []);
      } catch (err) {
        console.error('Error searching jurisdictions:', err);
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchJurisdictions, 300);
    return () => clearTimeout(debounce);
  }, [value, stateFilter]);

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (jurisdiction: JurisdictionResult) => {
    setSelectedJurisdiction(jurisdiction);
    onChange(jurisdiction.name);
    onSelect(jurisdiction);
    addRecentItem(jurisdiction.id); // Track as recently used
    setIsOpen(false);
  };

  const handleClear = () => {
    setSelectedJurisdiction(null);
    onChange('');
    onSelect(null);
    inputRef.current?.focus();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setSelectedJurisdiction(null);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search jurisdictions..."
          className="pl-10 pr-10"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Selected jurisdiction info */}
      {selectedJurisdiction && (
        <div className="mt-2 p-3 border rounded-lg bg-muted/30 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="font-medium text-sm">{selectedJurisdiction.name}</span>
              <Badge variant="outline" className="text-xs">{selectedJurisdiction.state}</Badge>
              {selectedJurisdiction.is_high_volume && (
                <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">High Volume</Badge>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Base:</span>
              <span className="font-medium">{formatCurrency(selectedJurisdiction.base_permit_fee)}</span>
            </div>
            <div className="flex items-center gap-1">
              <DollarSign className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Review:</span>
              <span className="font-medium">{formatCurrency(selectedJurisdiction.plan_review_fee)}</span>
            </div>
            {selectedJurisdiction.plan_review_sla_days && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-muted-foreground">SLA:</span>
                <span className="font-medium">{selectedJurisdiction.plan_review_sla_days}d</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dropdown results */}
      {isOpen && !selectedJurisdiction && (
        <div className="absolute z-50 w-full mt-1 border rounded-lg bg-background shadow-lg">
          {loading ? (
            <div className="p-4 text-center">
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="max-h-[300px]">
              {/* Recent jurisdictions section - show when no search or short search */}
              {value.length < 2 && recentJurisdictions.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-xs font-medium text-muted-foreground flex items-center gap-1 border-b bg-muted/30">
                    <History className="h-3 w-3" />
                    Recently Used
                  </div>
                  {recentJurisdictions.map((jurisdiction) => (
                    <JurisdictionResultItem
                      key={jurisdiction.id}
                      jurisdiction={jurisdiction}
                      onSelect={handleSelect}
                      formatCurrency={formatCurrency}
                    />
                  ))}
                </div>
              )}

              {/* Search results */}
              {value.length >= 2 && (
                <>
                  {results.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      No jurisdictions found
                    </div>
                  ) : (
                    results.map((jurisdiction) => (
                      <JurisdictionResultItem
                        key={jurisdiction.id}
                        jurisdiction={jurisdiction}
                        onSelect={handleSelect}
                        formatCurrency={formatCurrency}
                      />
                    ))
                  )}
                </>
              )}

              {/* Empty state when no search and no recents */}
              {value.length < 2 && recentJurisdictions.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Type to search jurisdictions...
                </div>
              )}
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}

// Extracted component for jurisdiction result item
function JurisdictionResultItem({
  jurisdiction,
  onSelect,
  formatCurrency,
}: {
  jurisdiction: JurisdictionResult;
  onSelect: (jurisdiction: JurisdictionResult) => void;
  formatCurrency: (amount: number) => string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(jurisdiction)}
      className="w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors flex items-start justify-between gap-2 border-b last:border-b-0"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <span className="font-medium text-sm truncate">{jurisdiction.name}</span>
          <Badge variant="outline" className="text-xs flex-shrink-0">{jurisdiction.state}</Badge>
          {jurisdiction.is_high_volume && (
            <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs flex-shrink-0">
              High Vol
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            {formatCurrency(jurisdiction.base_permit_fee + jurisdiction.plan_review_fee)}
          </span>
          {jurisdiction.plan_review_sla_days && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {jurisdiction.plan_review_sla_days}d review
            </span>
          )}
          {jurisdiction.residential_units_2024 && (
            <span>{jurisdiction.residential_units_2024.toLocaleString()} units/yr</span>
          )}
        </div>
      </div>
    </button>
  );
}
