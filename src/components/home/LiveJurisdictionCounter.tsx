import { useEffect, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { MapPin, TrendingUp } from "lucide-react";

interface JurisdictionStats {
  total: number;
  byRegion: { region: string; count: number }[];
  highVolume: number;
}

export const LiveJurisdictionCounter = () => {
  const [stats, setStats] = useState<JurisdictionStats>({
    total: 0,
    byRegion: [],
    highVolume: 0,
  });
  const [loading, setLoading] = useState(true);

  // Animated counter using spring
  const springValue = useSpring(0, { stiffness: 50, damping: 20 });
  const displayValue = useTransform(springValue, (val) => Math.round(val));
  const [displayCount, setDisplayCount] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Get total count
        const { count: totalCount } = await supabase
          .from("jurisdictions")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true);

        // Get high volume count
        const { count: highVolumeCount } = await supabase
          .from("jurisdictions")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("is_high_volume", true);

        // Get counts by state/region
        const { data: jurisdictions } = await supabase
          .from("jurisdictions")
          .select("state")
          .eq("is_active", true);

        // Group by region
        const regionMap: Record<string, string[]> = {
          "East Coast": ["FL", "GA", "SC", "NC", "VA", "MD", "DC", "PA", "NJ", "NY", "CT", "MA", "ME", "NH", "VT", "RI", "DE"],
          "Midwest": ["IL", "OH", "MI", "IN", "WI", "MN", "MO", "IA", "KS", "NE", "SD", "ND"],
          "South": ["TX", "TN", "KY", "AL", "LA", "MS", "AR", "OK", "WV"],
          "West": ["CA", "AZ", "CO", "WA", "OR", "NV", "UT", "NM", "ID", "MT", "WY", "HI", "AK"],
        };

        const regionCounts: Record<string, number> = {};
        jurisdictions?.forEach((j) => {
          for (const [region, states] of Object.entries(regionMap)) {
            if (states.includes(j.state)) {
              regionCounts[region] = (regionCounts[region] || 0) + 1;
              break;
            }
          }
        });

        const byRegion = Object.entries(regionCounts)
          .map(([region, count]) => ({ region, count }))
          .sort((a, b) => b.count - a.count);

        setStats({
          total: totalCount || 0,
          byRegion,
          highVolume: highVolumeCount || 0,
        });

        // Animate the counter
        springValue.set(totalCount || 0);
      } catch (error) {
        console.error("Error fetching jurisdiction stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();

    // Subscribe to display value changes
    const unsubscribe = displayValue.on("change", (val) => {
      setDisplayCount(val);
    });

    return () => unsubscribe();
  }, [springValue, displayValue]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-primary-foreground/70">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
        <span className="text-sm">Loading jurisdictions...</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6"
    >
      {/* Main Counter */}
      <div className="flex items-center gap-3 bg-primary-foreground/10 rounded-full px-5 py-2.5">
        <MapPin className="h-5 w-5 text-accent" />
        <div className="flex items-baseline gap-1.5">
          <motion.span
            className="text-2xl font-bold text-accent"
            key={displayCount}
          >
            {displayCount}+
          </motion.span>
          <span className="text-sm text-primary-foreground/80">Jurisdictions</span>
        </div>
        <div className="h-4 w-px bg-primary-foreground/20 mx-1" />
        <div className="flex items-center gap-1 text-green-400">
          <TrendingUp className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Live</span>
        </div>
      </div>

      {/* Region Breakdown */}
      <div className="flex items-center gap-3 text-sm text-primary-foreground/70">
        {stats.byRegion.map((region, index) => (
          <div key={region.region} className="flex items-center gap-1.5">
            {index > 0 && <span className="text-primary-foreground/30">•</span>}
            <span className="font-medium text-primary-foreground/90">{region.count}</span>
            <span>{region.region}</span>
          </div>
        ))}
        {stats.highVolume > 0 && (
          <>
            <span className="text-primary-foreground/30">•</span>
            <span className="font-medium text-accent">{stats.highVolume}</span>
            <span>High-Volume</span>
          </>
        )}
      </div>
    </motion.div>
  );
};
