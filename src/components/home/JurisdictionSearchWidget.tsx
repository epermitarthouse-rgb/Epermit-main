import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { 
  Search, 
  MapPin, 
  Clock, 
  DollarSign, 
  FileText, 
  CheckCircle2, 
  XCircle,
  Building2,
  ExternalLink,
  Loader2
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { CoverageRequestForm } from "@/components/jurisdictions/CoverageRequestForm";

interface JurisdictionResult {
  id: string;
  name: string;
  city: string | null;
  state: string;
  county: string | null;
  base_permit_fee: number | null;
  plan_review_fee: number | null;
  plan_review_sla_days: number | null;
  permit_issuance_sla_days: number | null;
  submission_methods: string[] | null;
  website_url: string | null;
  is_high_volume: boolean | null;
  residential_units_2024: number | null;
  expedited_available: boolean | null;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia"
};

export function JurisdictionSearchWidget() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<JurisdictionResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<JurisdictionResult | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>();

  // Get total count on mount
  useEffect(() => {
    async function fetchCount() {
      const { count } = await supabase
        .from("jurisdictions")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true);
      setTotalCount(count || 0);
    }
    fetchCount();
  }, []);

  // Handle click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Search function
  const searchJurisdictions = async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    
    // Search by name, city, state, or county
    const { data, error } = await supabase
      .from("jurisdictions")
      .select(`
        id, name, city, state, county, 
        base_permit_fee, plan_review_fee, 
        plan_review_sla_days, permit_issuance_sla_days,
        submission_methods, website_url, is_high_volume,
        residential_units_2024, expedited_available
      `)
      .eq("is_active", true)
      .or(`name.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%,state.ilike.%${searchQuery}%,county.ilike.%${searchQuery}%`)
      .order("residential_units_2024", { ascending: false, nullsFirst: false })
      .limit(10);

    if (error) {
      console.error("Search error:", error);
      setResults([]);
    } else {
      setResults(data || []);
    }
    setLoading(false);
  };

  // Debounced search
  const handleSearch = (value: string) => {
    setQuery(value);
    setShowResults(true);
    setSelectedJurisdiction(null);
    
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    debounceRef.current = setTimeout(() => {
      searchJurisdictions(value);
    }, 300);
  };

  const handleSelectJurisdiction = (jurisdiction: JurisdictionResult) => {
    setSelectedJurisdiction(jurisdiction);
    setShowResults(false);
    setQuery(`${jurisdiction.name}, ${jurisdiction.state}`);
  };

  return (
    <section className="py-16 bg-gradient-to-b from-muted/50 to-background">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-8"
        >
          <Badge variant="outline" className="mb-4">
            <Search className="w-3 h-3 mr-1" />
            Instant Lookup
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Search Our Jurisdiction Database
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Check if we cover your target jurisdiction. Search {totalCount.toLocaleString()}+ verified jurisdictions across all 50 states.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="max-w-2xl mx-auto"
          ref={searchRef}
        >
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Enter city, state, or county..."
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => setShowResults(true)}
              className="pl-12 pr-4 py-6 text-lg rounded-xl border-2 focus:border-primary transition-colors"
            />
            {loading && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Results Dropdown */}
          <AnimatePresence>
            {showResults && query.length >= 2 && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute z-50 w-full max-w-2xl mt-2 bg-card border rounded-xl shadow-xl overflow-hidden"
              >
                {results.length > 0 ? (
                  <div className="max-h-80 overflow-auto">
                    {results.map((jurisdiction) => (
                      <button
                        key={jurisdiction.id}
                        onClick={() => handleSelectJurisdiction(jurisdiction)}
                        className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b last:border-b-0 flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3">
                          <MapPin className="h-4 w-4 text-primary shrink-0" />
                          <div>
                            <p className="font-medium">{jurisdiction.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {jurisdiction.city && `${jurisdiction.city}, `}
                              {STATE_NAMES[jurisdiction.state] || jurisdiction.state}
                              {jurisdiction.county && ` • ${jurisdiction.county} County`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {jurisdiction.is_high_volume && (
                            <Badge variant="secondary" className="text-xs">High Volume</Badge>
                          )}
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : !loading ? (
                  <div className="p-6 text-center">
                    <XCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="font-medium">No jurisdictions found</p>
                    <p className="text-sm text-muted-foreground mt-1 mb-3">
                      We don't have this jurisdiction yet.
                    </p>
                    <CoverageRequestForm
                      triggerButton={
                        <Button size="sm" variant="outline">
                          <MapPin className="h-3 w-3 mr-1" />
                          Request Coverage
                        </Button>
                      }
                    />
                  </div>
                ) : null}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Selected Jurisdiction Details */}
        <AnimatePresence>
          {selectedJurisdiction && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="max-w-4xl mx-auto mt-8"
            >
              <div className="bg-card border rounded-xl p-6 shadow-lg">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="h-5 w-5 text-primary" />
                      <h3 className="text-xl font-bold">{selectedJurisdiction.name}</h3>
                      {selectedJurisdiction.is_high_volume && (
                        <Badge>High Volume</Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground">
                      {selectedJurisdiction.city && `${selectedJurisdiction.city}, `}
                      {STATE_NAMES[selectedJurisdiction.state] || selectedJurisdiction.state}
                      {selectedJurisdiction.county && ` • ${selectedJurisdiction.county} County`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {selectedJurisdiction.website_url && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={selectedJurisdiction.website_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Official Website
                        </a>
                      </Button>
                    )}
                    <Button size="sm" asChild>
                      <Link to="/contact">Request Full Details</Link>
                    </Button>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Permit Fee */}
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <DollarSign className="h-4 w-4" />
                      <span className="text-sm">Base Permit Fee</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {selectedJurisdiction.base_permit_fee 
                        ? `$${selectedJurisdiction.base_permit_fee.toLocaleString()}`
                        : "Contact Us"}
                    </p>
                  </div>

                  {/* Plan Review Fee */}
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <FileText className="h-4 w-4" />
                      <span className="text-sm">Plan Review Fee</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {selectedJurisdiction.plan_review_fee 
                        ? `$${selectedJurisdiction.plan_review_fee.toLocaleString()}`
                        : "Included"}
                    </p>
                  </div>

                  {/* Review Timeline */}
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Clock className="h-4 w-4" />
                      <span className="text-sm">Plan Review SLA</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {selectedJurisdiction.plan_review_sla_days 
                        ? `${selectedJurisdiction.plan_review_sla_days} days`
                        : "Varies"}
                    </p>
                  </div>

                  {/* Permit Issuance */}
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm">Permit Issuance</span>
                    </div>
                    <p className="text-2xl font-bold">
                      {selectedJurisdiction.permit_issuance_sla_days 
                        ? `${selectedJurisdiction.permit_issuance_sla_days} days`
                        : "Same day"}
                    </p>
                  </div>
                </div>

                {/* Additional Info */}
                <div className="mt-4 pt-4 border-t flex flex-wrap gap-4">
                  {selectedJurisdiction.submission_methods && selectedJurisdiction.submission_methods.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Submission:</span>
                      <div className="flex gap-1">
                        {selectedJurisdiction.submission_methods.slice(0, 3).map((method) => (
                          <Badge key={method} variant="outline" className="text-xs">
                            {method}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedJurisdiction.expedited_available && (
                    <div className="flex items-center gap-2">
                      <Badge variant="default" className="bg-green-600">
                        Expedited Available
                      </Badge>
                    </div>
                  )}
                  {selectedJurisdiction.residential_units_2024 && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">2024 Permits:</span>
                      <span className="text-sm font-medium">
                        {selectedJurisdiction.residential_units_2024.toLocaleString()} residential units
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* CTA */}
              <div className="mt-6 text-center">
                <p className="text-muted-foreground mb-4">
                  Want the full breakdown including fee schedules, reviewer contacts, and special requirements?
                </p>
                <div className="flex justify-center gap-4">
                  <Button variant="outline" asChild>
                    <Link to="/jurisdictions/compare">Compare Jurisdictions</Link>
                  </Button>
                  <Button asChild>
                    <Link to="/auth">Start Free Trial</Link>
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Stats */}
        {!selectedJurisdiction && (
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto"
          >
            <div className="text-center p-4">
              <div className="text-2xl font-bold text-primary">{totalCount}+</div>
              <div className="text-sm text-muted-foreground">Jurisdictions</div>
            </div>
            <div className="text-center p-4">
              <div className="text-2xl font-bold text-primary">50</div>
              <div className="text-sm text-muted-foreground">States Covered</div>
            </div>
            <div className="text-center p-4">
              <div className="text-2xl font-bold text-primary">Weekly</div>
              <div className="text-sm text-muted-foreground">Data Updates</div>
            </div>
            <div className="text-center p-4">
              <div className="text-2xl font-bold text-primary">100%</div>
              <div className="text-sm text-muted-foreground">Verified</div>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
