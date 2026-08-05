import { useState, useEffect } from 'react';
import { JurisdictionMap } from '@/components/jurisdictions/JurisdictionMap';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Map, Loader2, AlertCircle } from 'lucide-react';
import { PageHeader, Panel } from '@/components/design/ProductPrimitives';
import { useAuth } from '@/hooks/useAuth';
import { useGettingStarted } from '@/hooks/useGettingStarted';
import { FeatureTooltip } from '@/components/onboarding/FeatureTooltip';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function JurisdictionMapPage() {
  const { user, loading: authLoading } = useAuth();
  const { completeItem } = useGettingStarted();
  const [mapboxToken, setMapboxToken] = useState<string>('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mark as explored when page loads
  useEffect(() => {
    if (user) {
      completeItem('explore_jurisdictions');
    }
  }, [user, completeItem]);

  useEffect(() => {
    // Try to get the token from an edge function that reads the secret
    const fetchToken = async () => {
      try {
        // Check if token is stored in localStorage (user-provided fallback)
        const storedToken = localStorage.getItem('mapbox_public_token');
        if (storedToken) {
          setMapboxToken(storedToken);
          setLoading(false);
          return;
        }

        // Try to fetch from edge function
        const { data, error } = await supabase.functions.invoke('get-mapbox-token');
        
        if (error) {
          console.log('Could not fetch Mapbox token from server:', error);
          setError('Mapbox token not configured. Please enter your public token below.');
        } else if (data?.token) {
          setMapboxToken(data.token);
        } else {
          setError('Mapbox token not configured. Please enter your public token below.');
        }
      } catch (err) {
        console.error('Error fetching Mapbox token:', err);
        setError('Mapbox token not configured. Please enter your public token below.');
      } finally {
        setLoading(false);
      }
    };

    fetchToken();
  }, []);

  const handleTokenSubmit = () => {
    if (tokenInput.startsWith('pk.')) {
      localStorage.setItem('mapbox_public_token', tokenInput);
      setMapboxToken(tokenInput);
      setError(null);
    } else {
      setError('Invalid token format. Mapbox public tokens start with "pk."');
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Geo Data"
        title="Jurisdiction Map"
        body={
          <FeatureTooltip
            id="jurisdiction_map_intro"
            title="Explore Permit Hotspots"
            description="Click on markers to view jurisdiction details, compare fees, and see processing times. Use the search and filters to find specific jurisdictions."
            position="bottom"
          >
            <span className="cursor-help text-muted-foreground">
              Visualize permit volume hotspots across jurisdictions
            </span>
          </FeatureTooltip>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : mapboxToken ? (
        <Panel className="overflow-hidden p-0">
          <JurisdictionMap mapboxToken={mapboxToken} />
        </Panel>
      ) : (
        <Panel className="mx-auto max-w-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <h3 className="font-tight font-semibold text-foreground">Mapbox Token Required</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {error || 'Enter your Mapbox public token to view the map.'}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <Input
              placeholder="pk.eyJ1Ijoi..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Get your public token at{' '}
              <a
                href="https://account.mapbox.com/access-tokens/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline underline-offset-2"
              >
                mapbox.com/access-tokens
              </a>
            </p>
          </div>

          <Button onClick={handleTokenSubmit} className="mt-4 w-full">
            Load Map
          </Button>
        </Panel>
      )}
    </div>
  );
}
