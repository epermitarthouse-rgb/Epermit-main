import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, MapPin, Building2, TrendingUp, X, ExternalLink } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { US_STATES } from '@/types/jurisdiction';

interface JurisdictionMapData {
  id: string;
  name: string;
  state: string;
  city: string | null;
  residential_units_2024: number | null;
  commercial_permits_2024: number | null;
  total_permits_2024: number | null;
  is_high_volume: boolean | null;
  base_permit_fee: number | null;
  plan_review_sla_days: number | null;
  avg_review_days_actual: number | null;
  avg_issuance_days_actual: number | null;
  permit_portal_url: string | null;
}

const STATE_COORDINATES: Record<string, [number, number]> = {
  AL: [-86.9023, 32.3182], AK: [-153.4937, 64.2008], AZ: [-111.0937, 34.0489],
  AR: [-92.3731, 34.9697], CA: [-119.4179, 36.7783], CO: [-105.3111, 39.0598],
  CT: [-72.7554, 41.6032], DE: [-75.5277, 38.9108], FL: [-81.5158, 27.6648],
  GA: [-83.6431, 32.1656], HI: [-155.5828, 19.8968], ID: [-114.7420, 44.0682],
  IL: [-89.3985, 40.6331], IN: [-86.1349, 40.2672], IA: [-93.0977, 41.8780],
  KS: [-98.4842, 39.0119], KY: [-84.2700, 37.8393], LA: [-92.1450, 30.9843],
  ME: [-69.4455, 45.2538], MD: [-76.6413, 39.0458], MA: [-71.5314, 42.4072],
  MI: [-84.5361, 44.3148], MN: [-94.6859, 46.7296], MS: [-89.3985, 32.3547],
  MO: [-91.8318, 37.9643], MT: [-110.3626, 46.8797], NE: [-99.9018, 41.4925],
  NV: [-116.4194, 38.8026], NH: [-71.5724, 43.1939], NJ: [-74.4057, 40.0583],
  NM: [-105.8701, 34.5199], NY: [-75.4999, 43.2994], NC: [-79.0193, 35.7596],
  ND: [-100.7837, 47.5515], OH: [-82.9071, 40.4173], OK: [-97.0929, 35.0078],
  OR: [-120.5542, 43.8041], PA: [-77.1945, 41.2033], RI: [-71.4774, 41.5801],
  SC: [-80.9450, 33.8361], SD: [-99.9018, 43.9695], TN: [-86.5804, 35.5175],
  TX: [-99.9018, 31.9686], UT: [-111.0937, 39.3210], VT: [-72.5778, 44.5588],
  VA: [-78.6569, 37.4316], WA: [-120.7401, 47.7511], WV: [-80.4549, 38.5976],
  WI: [-89.6165, 43.7844], WY: [-107.2903, 43.0760], DC: [-77.0369, 38.9072],
};

const EAST_COAST_STATES = ['ME', 'NH', 'VT', 'MA', 'RI', 'CT', 'NY', 'NJ', 'PA', 'DE', 'MD', 'DC', 'VA', 'NC', 'SC', 'GA', 'FL'];

interface JurisdictionMapProps {
  mapboxToken: string;
}

export function JurisdictionMap({ mapboxToken }: JurisdictionMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  
  const [jurisdictions, setJurisdictions] = useState<JurisdictionMapData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<string>('all');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<JurisdictionMapData | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const fetchJurisdictions = async () => {
      setLoading(true);
      
      const allColumns = 'id, name, state, city, residential_units_2024, commercial_permits_2024, total_permits_2024, is_high_volume, base_permit_fee, plan_review_sla_days, avg_review_days_actual, avg_issuance_days_actual, permit_portal_url';
      const basicColumns = 'id, name, state, city, residential_units_2024, is_high_volume, base_permit_fee, plan_review_sla_days';

      let columns = allColumns;
      let useTotal = true;
      let query = supabase
        .from('jurisdictions')
        .select(columns)
        .eq('is_active', true)
        .order('total_permits_2024', { ascending: false, nullsFirst: false });

      if (selectedState && selectedState !== 'all') {
        query = query.eq('state', selectedState);
      } else {
        query = query.in('state', EAST_COAST_STATES);
      }

      let { data, error } = await query.limit(100);

      if (error && error.message?.includes('does not exist')) {
        columns = basicColumns;
        useTotal = false;
        let fallbackQuery = supabase
          .from('jurisdictions')
          .select(columns)
          .eq('is_active', true)
          .order('residential_units_2024', { ascending: false, nullsFirst: false });

        if (selectedState && selectedState !== 'all') {
          fallbackQuery = fallbackQuery.eq('state', selectedState);
        } else {
          fallbackQuery = fallbackQuery.in('state', EAST_COAST_STATES);
        }

        const fallback = await fallbackQuery.limit(100);
        data = fallback.data;
        error = fallback.error;
      }

      if (!error && data) {
        setJurisdictions(data as JurisdictionMapData[]);
      }
      setLoading(false);
    };

    fetchJurisdictions();
  }, [selectedState]);

  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-77.0, 38.9],
      zoom: 5,
    });

    map.current.addControl(
      new mapboxgl.NavigationControl({ visualizePitch: true }),
      'top-right'
    );

    map.current.on('load', () => {
      setMapReady(true);
    });

    return () => {
      markersRef.current.forEach(marker => marker.remove());
      map.current?.remove();
    };
  }, [mapboxToken]);

  useEffect(() => {
    if (!map.current || !mapReady || jurisdictions.length === 0) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    const maxUnits = Math.max(...jurisdictions.map(j => j.total_permits_2024 ?? j.residential_units_2024 ?? 100));

    jurisdictions.forEach((jurisdiction) => {
      const coords = STATE_COORDINATES[jurisdiction.state];
      if (!coords) return;

      const hash = jurisdiction.name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      const offsetLng = ((hash % 100) / 100 - 0.5) * 2;
      const offsetLat = (((hash * 7) % 100) / 100 - 0.5) * 1.5;

      const units = jurisdiction.total_permits_2024 ?? jurisdiction.residential_units_2024 ?? 50;
      const sizeMultiplier = Math.max(0.5, Math.min(2, (units / maxUnits) * 3 + 0.5));
      const baseSize = 24;
      const size = Math.round(baseSize * sizeMultiplier);

      const el = document.createElement('div');
      el.className = 'jurisdiction-marker';
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = '50%';
      el.style.cursor = 'pointer';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.transition = 'transform 0.2s, box-shadow 0.2s';
      el.style.transformOrigin = 'center center';
      
      if (jurisdiction.is_high_volume) {
        el.style.background = 'linear-gradient(135deg, hsl(142, 76%, 36%), hsl(142, 71%, 45%))';
        el.style.boxShadow = '0 2px 8px rgba(34, 197, 94, 0.4)';
      } else {
        el.style.background = 'linear-gradient(135deg, hsl(221, 83%, 53%), hsl(221, 83%, 63%))';
        el.style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.4)';
      }

      el.addEventListener('mouseenter', () => {
        el.style.transform = 'scale(1.2)';
        el.style.boxShadow = jurisdiction.is_high_volume 
          ? '0 4px 16px rgba(34, 197, 94, 0.6)'
          : '0 4px 16px rgba(59, 130, 246, 0.6)';
      });

      el.addEventListener('mouseleave', () => {
        el.style.transform = 'scale(1)';
        el.style.boxShadow = jurisdiction.is_high_volume 
          ? '0 2px 8px rgba(34, 197, 94, 0.4)'
          : '0 2px 8px rgba(59, 130, 246, 0.4)';
      });

      el.addEventListener('click', () => {
        setSelectedJurisdiction(jurisdiction);
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([coords[0] + offsetLng, coords[1] + offsetLat])
        .addTo(map.current!);

      markersRef.current.push(marker);
    });

    if (jurisdictions.length > 0 && selectedState && selectedState !== 'all') {
      const coords = STATE_COORDINATES[selectedState];
      if (coords) {
        map.current.flyTo({
          center: coords,
          zoom: 6,
          duration: 1000,
        });
      }
    }
  }, [jurisdictions, mapReady]);

  const getVolumeColor = (units: number | null) => {
    if (!units) return 'bg-muted text-muted-foreground';
    if (units >= 10000) return 'bg-emerald-500/10 text-emerald-400';
    if (units >= 5000) return 'bg-blue-500/10 text-blue-400';
    if (units >= 1000) return 'bg-amber-500/10 text-amber-400';
    return 'bg-[#6B9AC4]/10 text-[#6B9AC4]';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <Select value={selectedState} onValueChange={setSelectedState}>
          <SelectTrigger className="w-full sm:w-64" data-testid="select-map-state">
            <SelectValue placeholder="Filter by state (East Coast default)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All East Coast States</SelectItem>
            {US_STATES.map(state => (
              <SelectItem key={state.code} value={state.code}>
                {state.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">High Volume</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Standard</span>
          </div>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading jurisdictions...</span>
          </div>
        )}
      </div>

      <div className="relative h-[500px] rounded-lg overflow-hidden border shadow-sm">
        <div ref={mapContainer} className="absolute inset-0" />
        
        {selectedJurisdiction && (
          <Card className="absolute top-4 left-4 w-80 shadow-lg z-10">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {selectedJurisdiction.name}
                  </CardTitle>
                  <CardDescription>
                    {selectedJurisdiction.city && `${selectedJurisdiction.city}, `}
                    {selectedJurisdiction.state}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setSelectedJurisdiction(null)}
                  data-testid="button-close-jurisdiction"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {selectedJurisdiction.is_high_volume && (
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    High Volume
                  </Badge>
                )}
                <Badge className={getVolumeColor(selectedJurisdiction.total_permits_2024 ?? selectedJurisdiction.residential_units_2024)}>
                  {(selectedJurisdiction.total_permits_2024 ?? selectedJurisdiction.residential_units_2024)?.toLocaleString() ?? 'N/A'} total permits
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Residential:</span>
                  <p className="font-medium">{selectedJurisdiction.residential_units_2024?.toLocaleString() || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Commercial:</span>
                  <p className="font-medium">{selectedJurisdiction.commercial_permits_2024?.toLocaleString() || 'N/A'}</p>
                </div>
                {selectedJurisdiction.base_permit_fee != null && (
                  <div>
                    <span className="text-muted-foreground">Base Fee:</span>
                    <p className="font-medium">${selectedJurisdiction.base_permit_fee.toLocaleString()}</p>
                  </div>
                )}
                {(selectedJurisdiction.avg_review_days_actual || selectedJurisdiction.plan_review_sla_days) != null && (
                  <div>
                    <span className="text-muted-foreground">Avg Review:</span>
                    <p className="font-medium">
                      {selectedJurisdiction.avg_review_days_actual || selectedJurisdiction.plan_review_sla_days} days
                      {selectedJurisdiction.avg_review_days_actual && selectedJurisdiction.plan_review_sla_days && selectedJurisdiction.avg_review_days_actual !== selectedJurisdiction.plan_review_sla_days && (
                        <span className="text-xs text-muted-foreground ml-1">(SLA: {selectedJurisdiction.plan_review_sla_days}d)</span>
                      )}
                    </p>
                  </div>
                )}
                {selectedJurisdiction.avg_issuance_days_actual != null && (
                  <div>
                    <span className="text-muted-foreground">Avg Issuance:</span>
                    <p className="font-medium">{selectedJurisdiction.avg_issuance_days_actual} days</p>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button 
                  size="sm" 
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.open(`/jurisdictions/compare?add=${selectedJurisdiction.id}`, '_blank')}
                  data-testid="button-add-comparison"
                >
                  <MapPin className="h-4 w-4 mr-1" />
                  Compare
                </Button>
                {selectedJurisdiction.permit_portal_url && (
                  <Button 
                    size="sm" 
                    className="flex-1"
                    onClick={() => window.open(selectedJurisdiction.permit_portal_url!, '_blank', 'noopener,noreferrer')}
                    data-testid="button-view-portal"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Permit Portal
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="absolute bottom-4 right-4 bg-background/95 backdrop-blur rounded-lg px-4 py-2 shadow-lg border">
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Showing:</span>
              <span className="font-medium ml-1">{jurisdictions.length} jurisdictions</span>
            </div>
            {selectedState === 'all' && (
              <Badge variant="outline">East Coast</Badge>
            )}
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Top Permit Volume Jurisdictions</CardTitle>
          <CardDescription>
            {selectedState && selectedState !== 'all'
              ? `Highest permit activity in ${US_STATES.find(s => s.code === selectedState)?.name}`
              : 'Highest permit activity across East Coast states'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {jurisdictions.slice(0, 9).map((jurisdiction, index) => (
              <button
                key={jurisdiction.id}
                onClick={() => setSelectedJurisdiction(jurisdiction)}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors text-left"
                data-testid={`button-jurisdiction-${jurisdiction.id}`}
              >
                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{jurisdiction.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(jurisdiction.total_permits_2024 ?? jurisdiction.residential_units_2024)?.toLocaleString() ?? '—'} permits • {jurisdiction.state}
                  </p>
                </div>
                {jurisdiction.is_high_volume && (
                  <TrendingUp className="h-4 w-4 text-emerald-500 shrink-0" />
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
