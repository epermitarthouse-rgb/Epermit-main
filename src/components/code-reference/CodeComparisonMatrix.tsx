import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Flame,
  DoorOpen,
  Accessibility,
  Building2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Scale,
  ArrowUpDown,
  Info
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ComparisonValue {
  value: string;
  notes?: string;
  isMoreRestrictive?: boolean;
  isLessRestrictive?: boolean;
}

interface ComparisonTopic {
  id: string;
  category: string;
  topic: string;
  description: string;
  ibcReference: string;
  jurisdictions: Record<string, ComparisonValue>;
}

// Comprehensive comparison data for key topics
const comparisonTopics: ComparisonTopic[] = [
  // ============ SPRINKLER THRESHOLDS ============
  {
    id: 'sprinkler-group-a',
    category: 'Sprinkler Thresholds',
    topic: 'Group A (Assembly) Sprinkler Threshold',
    description: 'Occupant load threshold requiring automatic sprinklers in assembly occupancies',
    ibcReference: 'IBC 903.2.1',
    jurisdictions: {
      'IBC 2024': { value: '>100 occupants', notes: 'Or fire area >12,000 sq ft' },
      'NYC BC': { value: 'All new buildings', notes: 'Regardless of occupant load', isMoreRestrictive: true },
      'CA CBC': { value: '>100 occupants', notes: 'Aligns with IBC' },
      'Chicago BC': { value: '>100 occupants', notes: 'Additional high-rise requirements' },
      'LA BC': { value: '>100 occupants', notes: 'With local fire dept. amendments' },
      'FL FBC': { value: '>100 occupants', notes: 'Per IBC with state amendments' },
      'TX (Local)': { value: 'Varies by city', notes: 'Houston, Dallas, Austin differ' },
      'WA State': { value: '>100 occupants', notes: 'Seattle may have stricter' },
      'MA State': { value: '>100 occupants', notes: 'Boston local amendments apply' },
      'DC Code': { value: 'All new buildings', notes: 'Comprehensive sprinkler requirement', isMoreRestrictive: true },
    }
  },
  {
    id: 'sprinkler-group-r',
    category: 'Sprinkler Thresholds',
    topic: 'Group R (Residential) Sprinkler Threshold',
    description: 'Requirements for residential occupancy sprinkler systems',
    ibcReference: 'IBC 903.2.8',
    jurisdictions: {
      'IBC 2024': { value: 'All R-1, R-2, R-4', notes: 'R-3 per IRC (townhouses 3+ units)' },
      'NYC BC': { value: 'All residential', notes: 'Including 1-2 family', isMoreRestrictive: true },
      'CA CBC': { value: 'All new residential', notes: 'Including 1-2 family per CRC', isMoreRestrictive: true },
      'Chicago BC': { value: 'R-1, R-2 only', notes: 'Some R-3 exempt' },
      'LA BC': { value: 'All new residential', notes: 'Follows CA state requirement' },
      'FL FBC': { value: 'R-1, R-2 only', notes: 'Single-family optional' },
      'TX (Local)': { value: 'Varies', notes: 'Local adoption varies significantly' },
      'WA State': { value: 'R-1, R-2 only', notes: 'Single-family exempt in most areas' },
      'MA State': { value: 'All new residential', notes: 'One of most restrictive states', isMoreRestrictive: true },
      'DC Code': { value: 'All residential', notes: 'Including townhouses', isMoreRestrictive: true },
    }
  },
  {
    id: 'sprinkler-high-rise',
    category: 'Sprinkler Thresholds',
    topic: 'High-Rise Sprinkler Threshold',
    description: 'Height at which high-rise provisions apply',
    ibcReference: 'IBC 403/903',
    jurisdictions: {
      'IBC 2024': { value: '>75 ft', notes: 'To highest occupied floor' },
      'NYC BC': { value: '>75 ft', notes: 'Plus Local Law 5 provisions', isMoreRestrictive: true },
      'CA CBC': { value: '>75 ft', notes: 'Aligns with IBC' },
      'Chicago BC': { value: '>80 ft', notes: 'Slightly different threshold' },
      'LA BC': { value: '>75 ft', notes: 'With LAFD amendments' },
      'FL FBC': { value: '>75 ft', notes: 'Consistent with IBC' },
      'TX (Local)': { value: '>75 ft', notes: 'Most major cities follow IBC' },
      'WA State': { value: '>75 ft', notes: 'Seattle aligns with IBC' },
      'MA State': { value: '>70 ft', notes: 'More restrictive threshold', isMoreRestrictive: true },
      'DC Code': { value: '>75 ft', notes: 'With federal overlay requirements' },
    }
  },

  // ============ EGRESS REQUIREMENTS ============
  {
    id: 'egress-stair-width',
    category: 'Egress Requirements',
    topic: 'Stair Width (per occupant)',
    description: 'Required stair width per occupant for means of egress',
    ibcReference: 'IBC 1005.1',
    jurisdictions: {
      'IBC 2024': { value: '0.3" sprinklered / 0.2" unsprinklered', notes: 'Per occupant served' },
      'NYC BC': { value: '0.2" per occupant', notes: 'More generous allowance', isLessRestrictive: true },
      'CA CBC': { value: '0.3" / 0.2"', notes: 'Follows IBC' },
      'Chicago BC': { value: '0.3" / 0.2"', notes: 'Follows IBC standard' },
      'LA BC': { value: '0.3" / 0.2"', notes: 'Per CBC' },
      'FL FBC': { value: '0.3" / 0.2"', notes: 'Consistent with IBC' },
      'TX (Local)': { value: '0.3" / 0.2"', notes: 'Most jurisdictions follow IBC' },
      'WA State': { value: '0.3" / 0.2"', notes: 'Per IBC' },
      'MA State': { value: '0.3" / 0.2"', notes: 'Follows IBC' },
      'DC Code': { value: '0.3" / 0.2"', notes: 'Aligns with IBC' },
    }
  },
  {
    id: 'egress-travel-distance',
    category: 'Egress Requirements',
    topic: 'Max Travel Distance (Sprinklered)',
    description: 'Maximum travel distance to an exit in sprinklered buildings',
    ibcReference: 'IBC 1017.1',
    jurisdictions: {
      'IBC 2024': { value: '250 ft (most) / 300 ft (B)', notes: 'F-1, S-1: 400 ft' },
      'NYC BC': { value: '200 ft (most)', notes: 'More restrictive for dense urban', isMoreRestrictive: true },
      'CA CBC': { value: '250 ft / 300 ft', notes: 'Follows IBC thresholds' },
      'Chicago BC': { value: '250 ft / 300 ft', notes: 'Per IBC with local mods' },
      'LA BC': { value: '250 ft / 300 ft', notes: 'Follows CBC' },
      'FL FBC': { value: '250 ft / 300 ft', notes: 'Aligns with IBC' },
      'TX (Local)': { value: '250 ft / 300 ft', notes: 'Standard IBC adoption' },
      'WA State': { value: '250 ft / 300 ft', notes: 'Per IBC' },
      'MA State': { value: '250 ft / 300 ft', notes: 'Follows IBC' },
      'DC Code': { value: '250 ft / 300 ft', notes: 'Federal buildings may differ' },
    }
  },
  {
    id: 'egress-min-exits',
    category: 'Egress Requirements',
    topic: 'Minimum Number of Exits',
    description: 'Required number of exits based on occupant load',
    ibcReference: 'IBC 1006.2',
    jurisdictions: {
      'IBC 2024': { value: '2 (1-500), 3 (501-1000), 4 (>1000)', notes: 'Single exit for limited occupancies' },
      'NYC BC': { value: '2 minimum always', notes: 'More restrictive for high-rise', isMoreRestrictive: true },
      'CA CBC': { value: '2 (1-500), 3 (501-1000), 4 (>1000)', notes: 'Aligns with IBC' },
      'Chicago BC': { value: '2 (1-500), 3 (501-1000), 4 (>1000)', notes: 'Standard IBC' },
      'LA BC': { value: '2 (1-500), 3 (501-1000), 4 (>1000)', notes: 'Follows CBC' },
      'FL FBC': { value: '2 (1-500), 3 (501-1000), 4 (>1000)', notes: 'Per IBC' },
      'TX (Local)': { value: '2 (1-500), 3 (501-1000), 4 (>1000)', notes: 'Standard adoption' },
      'WA State': { value: '2 (1-500), 3 (501-1000), 4 (>1000)', notes: 'Follows IBC' },
      'MA State': { value: '2 minimum', notes: 'Some stricter requirements' },
      'DC Code': { value: '2 (1-500), 3 (501-1000), 4 (>1000)', notes: 'Per IBC' },
    }
  },
  {
    id: 'egress-door-width',
    category: 'Egress Requirements',
    topic: 'Minimum Door Width',
    description: 'Minimum clear width for egress doors',
    ibcReference: 'IBC 1010.1.1',
    jurisdictions: {
      'IBC 2024': { value: '32" clear', notes: 'Accessible: 32" min clear' },
      'NYC BC': { value: '32" clear', notes: 'Same as IBC' },
      'CA CBC': { value: '32" clear', notes: 'ADA 32" clear minimum' },
      'Chicago BC': { value: '32" clear', notes: 'Per IBC' },
      'LA BC': { value: '32" clear', notes: 'Follows CBC' },
      'FL FBC': { value: '32" clear', notes: 'Consistent with IBC' },
      'TX (Local)': { value: '32" clear', notes: 'Standard' },
      'WA State': { value: '32" clear', notes: 'Per IBC' },
      'MA State': { value: '32" clear', notes: 'AAB requires 32"' },
      'DC Code': { value: '32" clear', notes: 'ADA overlay' },
    }
  },

  // ============ ACCESSIBILITY REQUIREMENTS ============
  {
    id: 'access-type-a-units',
    category: 'Accessibility',
    topic: 'Type A Accessible Dwelling Units',
    description: 'Percentage of Type A accessible units required in multi-family',
    ibcReference: 'IBC 1107.6.1.1',
    jurisdictions: {
      'IBC 2024': { value: '2% of units', notes: 'In buildings with 4+ units' },
      'NYC BC': { value: '5% of units', notes: 'More restrictive requirement', isMoreRestrictive: true },
      'CA CBC': { value: '5% of units', notes: 'Matches NYC requirement', isMoreRestrictive: true },
      'Chicago BC': { value: '2% of units', notes: 'Per IBC baseline' },
      'LA BC': { value: '5% of units', notes: 'Follows CA state', isMoreRestrictive: true },
      'FL FBC': { value: '2% of units', notes: 'Follows IBC' },
      'TX (Local)': { value: '2% of units', notes: 'Most cities follow IBC' },
      'WA State': { value: '2% of units', notes: 'Per IBC' },
      'MA State': { value: '5% of units', notes: 'AAB requirements', isMoreRestrictive: true },
      'DC Code': { value: '5% of units', notes: 'Federal overlay', isMoreRestrictive: true },
    }
  },
  {
    id: 'access-type-b-units',
    category: 'Accessibility',
    topic: 'Type B (Fair Housing) Units',
    description: 'Percentage of Type B accessible units in covered buildings',
    ibcReference: 'IBC 1107.6.2',
    jurisdictions: {
      'IBC 2024': { value: '100% ground floor + elevator floors', notes: 'Per Fair Housing Act' },
      'NYC BC': { value: '100% ground + elevator', notes: 'Same as federal requirement' },
      'CA CBC': { value: '100% ground + elevator', notes: 'Plus state adaptability requirements' },
      'Chicago BC': { value: '100% ground + elevator', notes: 'Per Fair Housing' },
      'LA BC': { value: '100% ground + elevator', notes: 'Follows CBC' },
      'FL FBC': { value: '100% ground + elevator', notes: 'Federal requirement' },
      'TX (Local)': { value: '100% ground + elevator', notes: 'Per FHA' },
      'WA State': { value: '100% ground + elevator', notes: 'Per FHA' },
      'MA State': { value: '100% ground + elevator', notes: 'AAB may exceed' },
      'DC Code': { value: '100% ground + elevator', notes: 'Federal standards' },
    }
  },
  {
    id: 'access-accessible-route',
    category: 'Accessibility',
    topic: 'Accessible Route Width',
    description: 'Minimum clear width for accessible routes',
    ibcReference: 'IBC 1104.1',
    jurisdictions: {
      'IBC 2024': { value: '36" clear', notes: 'Per ADA Standards' },
      'NYC BC': { value: '36" clear', notes: 'Same as ADA' },
      'CA CBC': { value: '36" clear', notes: 'CBC Title 24 matches' },
      'Chicago BC': { value: '36" clear', notes: 'Per ADA' },
      'LA BC': { value: '36" clear', notes: 'Follows CBC' },
      'FL FBC': { value: '36" clear', notes: 'Accessibility code' },
      'TX (Local)': { value: '36" clear', notes: 'TDLR requirements' },
      'WA State': { value: '36" clear', notes: 'Per ADA' },
      'MA State': { value: '36" clear', notes: 'AAB standards' },
      'DC Code': { value: '36" clear', notes: 'ADA overlay' },
    }
  },
  {
    id: 'access-parking',
    category: 'Accessibility',
    topic: 'Accessible Parking Spaces',
    description: 'Required number of accessible parking spaces',
    ibcReference: 'IBC 1106.1',
    jurisdictions: {
      'IBC 2024': { value: '1 per 25 (1-25), then 2% to 4%', notes: 'Plus van spaces' },
      'NYC BC': { value: 'Per ADA standards', notes: 'Plus local zoning overlay' },
      'CA CBC': { value: '1 per 25 + additional', notes: 'Title 24 has stricter ratio', isMoreRestrictive: true },
      'Chicago BC': { value: 'Per ADA standards', notes: 'With zoning requirements' },
      'LA BC': { value: 'Per CA Title 24', notes: 'More restrictive than ADA', isMoreRestrictive: true },
      'FL FBC': { value: 'Per ADA standards', notes: 'Plus Florida Accessibility Code' },
      'TX (Local)': { value: 'Per ADA standards', notes: 'TDLR requirements' },
      'WA State': { value: 'Per ADA standards', notes: 'Local may exceed' },
      'MA State': { value: 'Per AAB standards', notes: 'Often exceeds ADA', isMoreRestrictive: true },
      'DC Code': { value: 'Per ADA standards', notes: 'Federal buildings may differ' },
    }
  },

  // ============ FIRE SAFETY ============
  {
    id: 'fire-construction-type',
    category: 'Fire Safety',
    topic: 'Type I Construction Height Limit',
    description: 'Maximum height for Type I-A construction',
    ibcReference: 'IBC Table 504.3',
    jurisdictions: {
      'IBC 2024': { value: 'Unlimited', notes: 'For most occupancies' },
      'NYC BC': { value: 'Unlimited', notes: 'With high-rise provisions' },
      'CA CBC': { value: 'Unlimited', notes: 'Same as IBC' },
      'Chicago BC': { value: 'Unlimited', notes: 'Per IBC' },
      'LA BC': { value: 'Unlimited', notes: 'Follows CBC' },
      'FL FBC': { value: 'Unlimited', notes: 'Consistent with IBC' },
      'TX (Local)': { value: 'Unlimited', notes: 'Per IBC adoption' },
      'WA State': { value: 'Unlimited', notes: 'Same as IBC' },
      'MA State': { value: 'Unlimited', notes: 'Per IBC' },
      'DC Code': { value: 'Varies by zone', notes: 'Height Act of 1910 limits', isMoreRestrictive: true },
    }
  },
  {
    id: 'fire-shaft-enclosure',
    category: 'Fire Safety',
    topic: 'Shaft Enclosure Rating (4+ stories)',
    description: 'Fire-resistance rating for vertical shafts in buildings 4+ stories',
    ibcReference: 'IBC 713.4',
    jurisdictions: {
      'IBC 2024': { value: '2-hour', notes: 'For 4+ stories' },
      'NYC BC': { value: '2-hour', notes: 'Same as IBC' },
      'CA CBC': { value: '2-hour', notes: 'Follows IBC' },
      'Chicago BC': { value: '2-hour', notes: 'Per IBC' },
      'LA BC': { value: '2-hour', notes: 'Per CBC' },
      'FL FBC': { value: '2-hour', notes: 'Consistent' },
      'TX (Local)': { value: '2-hour', notes: 'Standard' },
      'WA State': { value: '2-hour', notes: 'Per IBC' },
      'MA State': { value: '2-hour', notes: 'Per IBC' },
      'DC Code': { value: '2-hour', notes: 'Per IBC' },
    }
  },
  {
    id: 'fire-corridor-rating',
    category: 'Fire Safety',
    topic: 'Corridor Fire Rating (Sprinklered)',
    description: 'Required fire-resistance rating for corridors in sprinklered buildings',
    ibcReference: 'IBC Table 1020.1',
    jurisdictions: {
      'IBC 2024': { value: '0-hour (most) / 1-hour (I, H)', notes: 'Sprinklered buildings' },
      'NYC BC': { value: '1-hour (most)', notes: 'More conservative approach', isMoreRestrictive: true },
      'CA CBC': { value: '0-hour (most) / 1-hour (I, H)', notes: 'Follows IBC' },
      'Chicago BC': { value: '0-hour / 1-hour', notes: 'Per IBC table' },
      'LA BC': { value: '0-hour / 1-hour', notes: 'Per CBC' },
      'FL FBC': { value: '0-hour / 1-hour', notes: 'Follows IBC' },
      'TX (Local)': { value: '0-hour / 1-hour', notes: 'Per IBC' },
      'WA State': { value: '0-hour / 1-hour', notes: 'Per IBC' },
      'MA State': { value: '1-hour (most)', notes: 'More restrictive', isMoreRestrictive: true },
      'DC Code': { value: '0-hour / 1-hour', notes: 'Per IBC' },
    }
  },

  // ============ STRUCTURAL ============
  {
    id: 'struct-seismic',
    category: 'Structural',
    topic: 'Seismic Design Category',
    description: 'Typical seismic design category for major cities',
    ibcReference: 'IBC 1613',
    jurisdictions: {
      'IBC 2024': { value: 'A-F (varies)', notes: 'Based on location and risk' },
      'NYC BC': { value: 'A-B typically', notes: 'Moderate seismic zone' },
      'CA CBC': { value: 'D-F typically', notes: 'High seismic requirements', isMoreRestrictive: true },
      'Chicago BC': { value: 'A-B typically', notes: 'Low seismic zone' },
      'LA BC': { value: 'D-E typically', notes: 'Very high seismic', isMoreRestrictive: true },
      'FL FBC': { value: 'A-B typically', notes: 'Low seismic risk' },
      'TX (Local)': { value: 'A-B typically', notes: 'Low seismic' },
      'WA State': { value: 'C-D (Seattle)', notes: 'Moderate-high seismic' },
      'MA State': { value: 'A-B typically', notes: 'Low seismic' },
      'DC Code': { value: 'A-B typically', notes: 'Low seismic zone' },
    }
  },
  {
    id: 'struct-wind-speed',
    category: 'Structural',
    topic: 'Basic Wind Speed (Risk Cat II)',
    description: 'Design wind speed for typical commercial buildings',
    ibcReference: 'IBC 1609',
    jurisdictions: {
      'IBC 2024': { value: '90-180 mph (varies)', notes: 'Per ASCE 7 maps' },
      'NYC BC': { value: '110 mph', notes: 'Standard for NYC' },
      'CA CBC': { value: '85-110 mph', notes: 'Generally lower wind' },
      'Chicago BC': { value: '115 mph', notes: 'High wind region' },
      'LA BC': { value: '85-95 mph', notes: 'Lower wind speeds' },
      'FL FBC': { value: '130-180 mph', notes: 'Hurricane region', isMoreRestrictive: true },
      'TX (Local)': { value: '115-150 mph', notes: 'Coastal areas higher' },
      'WA State': { value: '95-110 mph', notes: 'Varies by location' },
      'MA State': { value: '110-130 mph', notes: 'Coastal higher' },
      'DC Code': { value: '105 mph', notes: 'Moderate wind zone' },
    }
  },

  // ============ ENERGY ============
  {
    id: 'energy-climate-zone',
    category: 'Energy',
    topic: 'Climate Zone',
    description: 'IECC climate zone for energy code compliance',
    ibcReference: 'IECC C301',
    jurisdictions: {
      'IBC 2024': { value: '1-8 (varies)', notes: 'Based on location' },
      'NYC BC': { value: 'Zone 4A', notes: 'Mixed-humid climate' },
      'CA CBC': { value: 'Zone 3-4', notes: 'Title 24 has 16 zones' },
      'Chicago BC': { value: 'Zone 5A', notes: 'Cold climate' },
      'LA BC': { value: 'Zone 3B', notes: 'Warm-dry climate' },
      'FL FBC': { value: 'Zone 1-2', notes: 'Hot-humid climate' },
      'TX (Local)': { value: 'Zone 2-3', notes: 'Hot climate' },
      'WA State': { value: 'Zone 4-5', notes: 'Marine to cold' },
      'MA State': { value: 'Zone 5A', notes: 'Cold climate' },
      'DC Code': { value: 'Zone 4A', notes: 'Mixed-humid' },
    }
  },
  {
    id: 'energy-wall-r-value',
    category: 'Energy',
    topic: 'Wall Insulation R-Value (Commercial)',
    description: 'Minimum wall insulation for commercial buildings',
    ibcReference: 'IECC Table C402.1.3',
    jurisdictions: {
      'IBC 2024': { value: 'R-13 to R-25 (varies)', notes: 'By climate zone' },
      'NYC BC': { value: 'R-13 + R-7.5 c.i.', notes: 'Zone 4A requirement' },
      'CA CBC': { value: 'Per Title 24', notes: 'Performance-based options' },
      'Chicago BC': { value: 'R-13 + R-10 c.i.', notes: 'Zone 5A colder climate' },
      'LA BC': { value: 'R-13', notes: 'Warmer climate, lower R' },
      'FL FBC': { value: 'R-13', notes: 'Zone 1-2, minimal' },
      'TX (Local)': { value: 'R-13', notes: 'Zone 2-3' },
      'WA State': { value: 'R-13 + R-7.5 c.i.', notes: 'Seattle Energy Code' },
      'MA State': { value: 'R-13 + R-10 c.i.', notes: 'Stretch code available', isMoreRestrictive: true },
      'DC Code': { value: 'R-13 + R-7.5 c.i.', notes: 'Zone 4A' },
    }
  },
];

const categories = [...new Set(comparisonTopics.map(t => t.category))];

const categoryIcons: Record<string, React.ReactNode> = {
  'Sprinkler Thresholds': <Flame className="h-4 w-4" />,
  'Egress Requirements': <DoorOpen className="h-4 w-4" />,
  'Accessibility': <Accessibility className="h-4 w-4" />,
  'Fire Safety': <Flame className="h-4 w-4" />,
  'Structural': <Building2 className="h-4 w-4" />,
  'Energy': <Scale className="h-4 w-4" />,
};

const jurisdictionOrder = [
  'IBC 2024',
  'NYC BC',
  'CA CBC',
  'Chicago BC',
  'LA BC',
  'FL FBC',
  'TX (Local)',
  'WA State',
  'MA State',
  'DC Code',
];

export function CodeComparisonMatrix() {
  const [activeCategory, setActiveCategory] = useState<string>(categories[0]);
  const [showMoreRestrictive, setShowMoreRestrictive] = useState(false);

  const filteredTopics = comparisonTopics.filter(
    t => t.category === activeCategory
  );

  const moreRestrictiveCount = comparisonTopics.reduce((count, topic) => {
    return count + Object.values(topic.jurisdictions).filter(j => j.isMoreRestrictive).length;
  }, 0);

  return (
    <div className="space-y-6">
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5" />
            Code Comparison Matrix
          </CardTitle>
          <CardDescription>
            Side-by-side comparison of key code requirements across jurisdictions. 
            <span className="ml-1 font-medium text-destructive">Red cells</span> indicate more restrictive than IBC.
            <span className="ml-1 font-medium text-green-600 dark:text-green-400">Green cells</span> indicate less restrictive.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant={showMoreRestrictive ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowMoreRestrictive(!showMoreRestrictive)}
          className="gap-2"
        >
          <AlertTriangle className="h-4 w-4" />
          More Restrictive ({moreRestrictiveCount})
        </Button>
      </div>

      <Tabs value={activeCategory} onValueChange={setActiveCategory}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {categories.map(cat => (
            <TabsTrigger key={cat} value={cat} className="gap-2 text-xs sm:text-sm">
              {categoryIcons[cat]}
              {cat}
            </TabsTrigger>
          ))}
        </TabsList>

        {categories.map(cat => (
          <TabsContent key={cat} value={cat} className="mt-4">
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="w-full">
                  <div className="min-w-[1200px]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[250px] sticky left-0 bg-background z-10">
                            Topic
                          </TableHead>
                          {jurisdictionOrder.map(jur => (
                            <TableHead key={jur} className="text-center min-w-[120px]">
                              <div className="font-medium">{jur}</div>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTopics
                          .filter(topic => {
                            if (!showMoreRestrictive) return true;
                            return Object.values(topic.jurisdictions).some(j => j.isMoreRestrictive);
                          })
                          .map(topic => (
                            <TableRow key={topic.id}>
                              <TableCell className="sticky left-0 bg-background z-10">
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="cursor-help">
                                        <div className="font-medium text-sm">{topic.topic}</div>
                                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                                          <Info className="h-3 w-3" />
                                          {topic.ibcReference}
                                        </div>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="max-w-[300px]">
                                      <p className="font-medium">{topic.topic}</p>
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {topic.description}
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </TableCell>
                              {jurisdictionOrder.map(jur => {
                                const data = topic.jurisdictions[jur];
                                return (
                                  <TableCell 
                                    key={jur}
                                    className={`text-center text-xs ${
                                      data?.isMoreRestrictive 
                                        ? 'bg-destructive/10 text-destructive font-medium' 
                                        : data?.isLessRestrictive 
                                          ? 'bg-green-500/10 text-green-600 dark:text-green-400 font-medium'
                                          : ''
                                    }`}
                                  >
                                    {data ? (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <div className="cursor-help">
                                              <div className="flex items-center justify-center gap-1">
                                                {data.isMoreRestrictive && (
                                                  <AlertTriangle className="h-3 w-3" />
                                                )}
                                                {data.isLessRestrictive && (
                                                  <CheckCircle2 className="h-3 w-3" />
                                                )}
                                              </div>
                                              <div>{data.value}</div>
                                            </div>
                                          </TooltipTrigger>
                                          <TooltipContent>
                                            <p>{data.notes}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    ) : (
                                      <span className="text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-destructive/10 border border-destructive/30" />
                <span className="text-muted-foreground">More restrictive than IBC</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded bg-green-500/10 border border-green-500/30" />
                <span className="text-muted-foreground">Less restrictive than IBC</span>
              </div>
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Hover for notes</span>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{comparisonTopics.length}</div>
            <div className="text-sm text-muted-foreground">Topics Compared</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{jurisdictionOrder.length}</div>
            <div className="text-sm text-muted-foreground">Jurisdictions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-destructive">{moreRestrictiveCount}</div>
            <div className="text-sm text-muted-foreground">More Restrictive Items</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{categories.length}</div>
            <div className="text-sm text-muted-foreground">Categories</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
