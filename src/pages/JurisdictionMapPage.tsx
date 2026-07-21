import { useState, useEffect } from 'react';
import { JurisdictionMap } from '@/components/jurisdictions/JurisdictionMap';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Map, Loader2, AlertCircle } from 'lucide-react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { EDITORIAL_FORM_CARD } from '@/components/layout/editorialPageChrome';
import { cn } from '@/lib/utils';
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
      <div className="flex items-center justify-center h-64 bg-cream">
        <Loader2 className="h-8 w-8 animate-spin text-teal" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <div className="min-h-full w-full bg-background text-foreground">
      <EditorialPageHeader
        eyebrow="GEO DATA"
        title="Jurisdiction Map"
        description={
          <FeatureTooltip
            id="jurisdiction_map_intro"
            title="Explore Permit Hotspots"
            description="Click on markers to view jurisdiction details, compare fees, and see processing times. Use the search and filters to find specific jurisdictions."
            position="bottom"
          >
            <span className="cursor-help text-ink-secondary-light">
              Visualize permit volume hotspots across jurisdictions
            </span>
          </FeatureTooltip>
        }
        icon={Map}
        iconClassName="text-teal"
      />

      <div className="w-full max-w-7xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-4 sm:py-6 md:py-8">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-teal" />
          </div>
        ) : mapboxToken ? (
          <JurisdictionMap mapboxToken={mapboxToken} />
        ) : (
          <Card className={cn(EDITORIAL_FORM_CARD, "max-w-lg mx-auto")}>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-gold-deep shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-medium text-ink-primary-light">Mapbox Token Required</h3>
                  <p className="text-sm text-ink-secondary-light mt-1">
                    {error || 'Enter your Mapbox public token to view the map.'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Input
                  placeholder="pk.eyJ1Ijoi..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  className="border-cream-sunken bg-cream shadow-cream"
                />
                <p className="text-xs text-ink-secondary-light">
                  Get your public token at{' '}
                  <a
                    href="https://account.mapbox.com/access-tokens/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold-deep hover:underline underline-offset-2"
                  >
                    mapbox.com/access-tokens
                  </a>
                </p>
              </div>

              <Button variant="gold" onClick={handleTokenSubmit} className="w-full">
                Load Map
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
