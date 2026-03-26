import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import { 
  MapPin, 
  Clock, 
  DollarSign, 
  Building2, 
  FileText, 
  CheckCircle2,
  ArrowRight,
  ExternalLink,
  TrendingUp,
  Users,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CoverageRequestForm } from "@/components/jurisdictions/CoverageRequestForm";

interface Jurisdiction {
  id: string;
  name: string;
  city: string | null;
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

interface StateStats {
  totalJurisdictions: number;
  avgPermitFee: number;
  avgReviewDays: number;
  totalResidentialUnits: number;
  highVolumeCount: number;
  expeditedCount: number;
}

const STATE_INFO: Record<string, { name: string; region: string; description: string }> = {
  AL: { name: "Alabama", region: "South", description: "Alabama's permit landscape features a mix of urban and rural jurisdictions with varying requirements across its major metropolitan areas." },
  AK: { name: "Alaska", region: "West", description: "Alaska presents unique permitting challenges due to its vast geography and climate considerations." },
  AZ: { name: "Arizona", region: "West", description: "Arizona's booming construction market, particularly in Phoenix and Tucson metro areas, requires efficient permit navigation." },
  AR: { name: "Arkansas", region: "South", description: "Arkansas offers relatively streamlined permitting processes across its growing urban centers." },
  CA: { name: "California", region: "West", description: "California has the most complex permitting requirements in the nation, with strict environmental and seismic regulations." },
  CO: { name: "Colorado", region: "West", description: "Colorado's Front Range corridor sees high construction activity with varying municipal requirements." },
  CT: { name: "Connecticut", region: "Northeast", description: "Connecticut's established municipal system features detailed review processes across its communities." },
  DE: { name: "Delaware", region: "Northeast", description: "Delaware offers a relatively straightforward permitting environment with coordinated state oversight." },
  FL: { name: "Florida", region: "South", description: "Florida's robust construction market requires navigation of hurricane-resistant building codes and local requirements." },
  GA: { name: "Georgia", region: "South", description: "Georgia's Atlanta metro area represents one of the fastest-growing permit markets in the Southeast." },
  HI: { name: "Hawaii", region: "West", description: "Hawaii's unique geographic and cultural considerations influence its specialized permitting requirements." },
  ID: { name: "Idaho", region: "West", description: "Idaho's growing population centers are experiencing increased construction activity and evolving permit processes." },
  IL: { name: "Illinois", region: "Midwest", description: "Illinois features diverse permitting landscapes from Chicago's complex requirements to streamlined rural processes." },
  IN: { name: "Indiana", region: "Midwest", description: "Indiana offers generally business-friendly permitting environments across its metropolitan areas." },
  IA: { name: "Iowa", region: "Midwest", description: "Iowa's steady growth markets feature accessible and responsive permitting departments." },
  KS: { name: "Kansas", region: "Midwest", description: "Kansas provides straightforward permitting processes across its major urban centers." },
  KY: { name: "Kentucky", region: "South", description: "Kentucky's permitting landscape reflects its mix of growing urban centers and rural communities." },
  LA: { name: "Louisiana", region: "South", description: "Louisiana's unique coastal and flood zone requirements add complexity to standard permitting processes." },
  ME: { name: "Maine", region: "Northeast", description: "Maine's permitting processes reflect its focus on environmental protection and community character." },
  MD: { name: "Maryland", region: "Northeast", description: "Maryland's proximity to DC creates a dynamic permit market with sophisticated municipal systems." },
  MA: { name: "Massachusetts", region: "Northeast", description: "Massachusetts features rigorous permitting requirements, particularly in historic and coastal areas." },
  MI: { name: "Michigan", region: "Midwest", description: "Michigan's recovering construction market offers opportunities across its diverse municipalities." },
  MN: { name: "Minnesota", region: "Midwest", description: "Minnesota's Twin Cities metro area represents the primary permit activity center with efficient processes." },
  MS: { name: "Mississippi", region: "South", description: "Mississippi's growing coastal and urban areas are seeing increased construction permit activity." },
  MO: { name: "Missouri", region: "Midwest", description: "Missouri's major metros of Kansas City and St. Louis anchor a diverse permitting landscape." },
  MT: { name: "Montana", region: "West", description: "Montana's booming resort and residential markets create dynamic permitting environments." },
  NE: { name: "Nebraska", region: "Midwest", description: "Nebraska offers efficient permitting processes centered around its major urban areas." },
  NV: { name: "Nevada", region: "West", description: "Nevada's Las Vegas metro area represents one of the nation's most active permit markets." },
  NH: { name: "New Hampshire", region: "Northeast", description: "New Hampshire's local-control approach creates varied permitting requirements across municipalities." },
  NJ: { name: "New Jersey", region: "Northeast", description: "New Jersey's dense development patterns require navigation of complex municipal requirements." },
  NM: { name: "New Mexico", region: "West", description: "New Mexico's growing urban centers offer evolving permit processes with cultural considerations." },
  NY: { name: "New York", region: "Northeast", description: "New York features the nation's most complex urban permitting in NYC plus diverse upstate requirements." },
  NC: { name: "North Carolina", region: "South", description: "North Carolina's Research Triangle and Charlotte metros are among the Southeast's hottest permit markets." },
  ND: { name: "North Dakota", region: "Midwest", description: "North Dakota's energy-driven growth has created dynamic permitting environments in key areas." },
  OH: { name: "Ohio", region: "Midwest", description: "Ohio's major metros offer substantial permit markets with established review processes." },
  OK: { name: "Oklahoma", region: "South", description: "Oklahoma provides generally accessible permitting processes across its growing urban centers." },
  OR: { name: "Oregon", region: "West", description: "Oregon's Portland metro area features progressive building codes and detailed review requirements." },
  PA: { name: "Pennsylvania", region: "Northeast", description: "Pennsylvania's Philadelphia and Pittsburgh metros anchor diverse permitting landscapes." },
  RI: { name: "Rhode Island", region: "Northeast", description: "Rhode Island's compact geography means navigating closely coordinated municipal systems." },
  SC: { name: "South Carolina", region: "South", description: "South Carolina's coastal and urban growth creates active permit markets with varying requirements." },
  SD: { name: "South Dakota", region: "Midwest", description: "South Dakota offers straightforward permitting processes supporting its steady growth." },
  TN: { name: "Tennessee", region: "South", description: "Tennessee's Nashville metro is one of the nation's fastest-growing permit markets." },
  TX: { name: "Texas", region: "South", description: "Texas features massive permit volume across multiple major metros with generally business-friendly approaches." },
  UT: { name: "Utah", region: "West", description: "Utah's booming Wasatch Front creates one of the West's most active permit markets." },
  VT: { name: "Vermont", region: "Northeast", description: "Vermont's environmental focus shapes its careful permitting review processes." },
  VA: { name: "Virginia", region: "South", description: "Virginia's Northern Virginia corridor represents a major permit market with sophisticated requirements." },
  WA: { name: "Washington", region: "West", description: "Washington's Seattle metro features complex permitting with progressive building standards." },
  WV: { name: "West Virginia", region: "South", description: "West Virginia offers accessible permitting processes across its communities." },
  WI: { name: "Wisconsin", region: "Midwest", description: "Wisconsin's major metros offer established permitting systems with reasonable timelines." },
  WY: { name: "Wyoming", region: "West", description: "Wyoming's resort and energy communities create specialized permitting requirements." },
  DC: { name: "District of Columbia", region: "Northeast", description: "DC's complex federal and local requirements create unique permitting challenges." }
};

const REGIONS: Record<string, string[]> = {
  Northeast: ["CT", "DE", "ME", "MD", "MA", "NH", "NJ", "NY", "PA", "RI", "VT", "DC"],
  Midwest: ["IL", "IN", "IA", "KS", "MI", "MN", "MO", "NE", "ND", "OH", "SD", "WI"],
  South: ["AL", "AR", "FL", "GA", "KY", "LA", "MS", "NC", "OK", "SC", "TN", "TX", "VA", "WV"],
  West: ["AK", "AZ", "CA", "CO", "HI", "ID", "MT", "NV", "NM", "OR", "UT", "WA", "WY"]
};

export default function StateLandingPage() {
  const { stateCode } = useParams<{ stateCode: string }>();
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [stats, setStats] = useState<StateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [neighboringStates, setNeighboringStates] = useState<string[]>([]);

  const stateCodeUpper = stateCode?.toUpperCase() || "";
  const stateInfo = STATE_INFO[stateCodeUpper];

  useEffect(() => {
    async function fetchData() {
      if (!stateCodeUpper || !stateInfo) return;

      setLoading(true);
      
      const { data, error } = await supabase
        .from("jurisdictions")
        .select(`
          id, name, city, county,
          base_permit_fee, plan_review_fee,
          plan_review_sla_days, permit_issuance_sla_days,
          submission_methods, website_url, is_high_volume,
          residential_units_2024, expedited_available
        `)
        .eq("state", stateCodeUpper)
        .eq("is_active", true)
        .order("residential_units_2024", { ascending: false, nullsFirst: false });

      if (!error && data) {
        setJurisdictions(data);
        
        // Calculate stats
        const totalJurisdictions = data.length;
        const feesWithValues = data.filter(j => j.base_permit_fee && j.base_permit_fee > 0);
        const avgPermitFee = feesWithValues.length > 0
          ? feesWithValues.reduce((sum, j) => sum + (j.base_permit_fee || 0), 0) / feesWithValues.length
          : 0;
        
        const reviewWithValues = data.filter(j => j.plan_review_sla_days && j.plan_review_sla_days > 0);
        const avgReviewDays = reviewWithValues.length > 0
          ? reviewWithValues.reduce((sum, j) => sum + (j.plan_review_sla_days || 0), 0) / reviewWithValues.length
          : 0;
        
        const totalResidentialUnits = data.reduce((sum, j) => sum + (j.residential_units_2024 || 0), 0);
        const highVolumeCount = data.filter(j => j.is_high_volume).length;
        const expeditedCount = data.filter(j => j.expedited_available).length;
        
        setStats({
          totalJurisdictions,
          avgPermitFee: Math.round(avgPermitFee),
          avgReviewDays: Math.round(avgReviewDays),
          totalResidentialUnits,
          highVolumeCount,
          expeditedCount
        });
      }
      
      // Find neighboring states in same region
      const region = stateInfo.region;
      const regionStates = REGIONS[region] || [];
      setNeighboringStates(regionStates.filter(s => s !== stateCodeUpper).slice(0, 5));
      
      setLoading(false);
    }
    
    fetchData();
  }, [stateCodeUpper, stateInfo]);

  const pageTitle = stateInfo 
    ? `${stateInfo.name} Permit Intelligence | PermitPulse`
    : "State Not Found | PermitPulse";
  
  const pageDescription = stateInfo
    ? `Get verified permit data for ${stateInfo.name}. Access ${stats?.totalJurisdictions || "multiple"} jurisdictions with fee schedules, SLA timelines, and submission requirements. Updated weekly.`
    : "State not found in our database.";

  const canonicalUrl = `https://review-resolve-ai.lovable.app/jurisdictions/${stateCodeUpper.toLowerCase()}`;

  if (!stateInfo) {
    return (
      <>
        <Helmet>
          <title>State Not Found | PermitPulse</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <div className="container mx-auto px-4 py-20 text-center">
          <h1 className="text-3xl font-bold mb-4">State Not Found</h1>
          <p className="text-muted-foreground mb-8">
            We couldn't find information for that state code.
          </p>
          <Button asChild>
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* SEO Meta Tags */}
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <link rel="canonical" href={canonicalUrl} />
        
        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="PermitPulse" />
        <meta property="og:image" content="https://review-resolve-ai.lovable.app/og-image.png" />
        
        {/* Twitter */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        <meta name="twitter:image" content="https://review-resolve-ai.lovable.app/og-image.png" />
        
        {/* Additional SEO */}
        <meta name="keywords" content={`${stateInfo.name} permits, ${stateInfo.name} building permits, permit fees ${stateInfo.name}, plan review ${stateInfo.name}, construction permits ${stateCodeUpper}`} />
        <meta name="geo.region" content={`US-${stateCodeUpper}`} />
        
        {/* JSON-LD Structured Data */}
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": pageTitle,
            "description": pageDescription,
            "url": canonicalUrl,
            "publisher": {
              "@type": "Organization",
              "name": "PermitPulse",
              "url": "https://review-resolve-ai.lovable.app",
              "logo": {
                "@type": "ImageObject",
                "url": "https://review-resolve-ai.lovable.app/og-image.png"
              },
              "sameAs": []
            },
            "mainEntity": {
              "@type": "Service",
              "name": `${stateInfo.name} Permit Intelligence`,
              "description": `Permit data and fee information for ${stats?.totalJurisdictions || 0} jurisdictions in ${stateInfo.name}`,
              "areaServed": {
                "@type": "State",
                "name": stateInfo.name,
                "addressCountry": "US"
              },
              "provider": {
                "@type": "Organization",
                "name": "PermitPulse"
              }
            },
            "breadcrumb": {
              "@type": "BreadcrumbList",
              "itemListElement": [
                {
                  "@type": "ListItem",
                  "position": 1,
                  "name": "Home",
                  "item": "https://review-resolve-ai.lovable.app"
                },
                {
                  "@type": "ListItem",
                  "position": 2,
                  "name": "Jurisdictions",
                  "item": "https://review-resolve-ai.lovable.app/jurisdictions/map"
                },
                {
                  "@type": "ListItem",
                  "position": 3,
                  "name": stateInfo.name,
                  "item": canonicalUrl
                }
              ]
            }
          })}
        </script>
      </Helmet>

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-primary/10 to-background py-16 md:py-24">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-4xl mx-auto text-center"
          >
            <Badge variant="outline" className="mb-4">
              <MapPin className="w-3 h-3 mr-1" />
              {stateInfo.region} Region
            </Badge>
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              {stateInfo.name} Permit Intelligence
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
              {stateInfo.description}
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Button size="lg" asChild>
                <Link to="/auth">
                  Start Free Trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/jurisdictions/compare">Compare Jurisdictions</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-12 border-b">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {loading ? (
              Array(6).fill(0).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4 text-center">
                    <Skeleton className="h-8 w-16 mx-auto mb-2" />
                    <Skeleton className="h-4 w-24 mx-auto" />
                  </CardContent>
                </Card>
              ))
            ) : stats ? (
              <>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-3xl font-bold text-primary">{stats.totalJurisdictions}</div>
                    <div className="text-sm text-muted-foreground">Jurisdictions</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-3xl font-bold text-primary">
                      ${stats.avgPermitFee.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">Avg. Permit Fee</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-3xl font-bold text-primary">
                      {stats.avgReviewDays || "—"}
                    </div>
                    <div className="text-sm text-muted-foreground">Avg. Review Days</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-3xl font-bold text-primary">
                      {stats.totalResidentialUnits.toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground">2024 Res. Units</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-3xl font-bold text-primary">{stats.highVolumeCount}</div>
                    <div className="text-sm text-muted-foreground">High Volume</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-3xl font-bold text-primary">{stats.expeditedCount}</div>
                    <div className="text-sm text-muted-foreground">Offer Expedited</div>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {/* Jurisdictions Table */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-8"
          >
            <h2 className="text-3xl font-bold mb-2">
              Top {stateInfo.name} Jurisdictions
            </h2>
            <p className="text-muted-foreground">
              Ranked by 2024 residential permit volume. Click any jurisdiction for full details.
            </p>
          </motion.div>

          {loading ? (
            <div className="space-y-4">
              {Array(5).fill(0).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : jurisdictions.length > 0 ? (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Jurisdiction</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Permit Fee</TableHead>
                      <TableHead className="text-right">Review SLA</TableHead>
                      <TableHead className="text-right">2024 Units</TableHead>
                      <TableHead>Features</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jurisdictions.slice(0, 15).map((j) => (
                      <TableRow key={j.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            {j.name}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {j.city || j.county || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {j.base_permit_fee 
                            ? `$${j.base_permit_fee.toLocaleString()}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {j.plan_review_sla_days 
                            ? `${j.plan_review_sla_days} days`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {j.residential_units_2024?.toLocaleString() || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {j.is_high_volume && (
                              <Badge variant="secondary" className="text-xs">
                                <TrendingUp className="h-3 w-3 mr-1" />
                                High Vol
                              </Badge>
                            )}
                            {j.expedited_available && (
                              <Badge variant="outline" className="text-xs">
                                <Zap className="h-3 w-3 mr-1" />
                                Expedited
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {j.website_url && (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={j.website_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Coverage Coming Soon</h3>
                <p className="text-muted-foreground mb-4">
                  We're actively expanding our {stateInfo.name} coverage.
                </p>
                <CoverageRequestForm
                  defaultState={stateCodeUpper}
                  triggerButton={
                    <Button>
                      <MapPin className="h-4 w-4 mr-2" />
                      Request Priority Coverage
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          )}

          {jurisdictions.length > 15 && (
            <div className="mt-6 text-center">
              <p className="text-muted-foreground mb-4">
                Showing 15 of {jurisdictions.length} jurisdictions
              </p>
              <Button variant="outline" asChild>
                <Link to="/auth">
                  Sign Up to View All
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 bg-muted/30">
        <div className="container mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-3xl font-bold mb-4">
              What You Get with {stateInfo.name} Coverage
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Every jurisdiction includes verified data updated weekly
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <Card>
              <CardHeader>
                <DollarSign className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Fee Schedules</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Complete fee breakdowns including base permits, plan review, inspection fees, and expedited options.
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <Clock className="h-8 w-8 text-primary mb-2" />
                <CardTitle>SLA Timelines</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Verified processing times for plan review, permit issuance, and inspection scheduling.
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <FileText className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Submission Requirements</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Accepted file formats, submission methods, and special requirements for each jurisdiction.
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <Users className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Reviewer Contacts</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  Direct contact information for plan reviewers and permitting staff.
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <TrendingUp className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Market Intelligence</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  2024 permit volume data and trends to identify high-opportunity markets.
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CheckCircle2 className="h-8 w-8 text-primary mb-2" />
                <CardTitle>Pre-Submittal Checks</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  AI-powered detection of common rejection reasons before you submit.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Neighboring States */}
      {neighboringStates.length > 0 && (
        <section className="py-16">
          <div className="container mx-auto px-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-8"
            >
              <h2 className="text-2xl font-bold mb-2">
                Explore {stateInfo.region} Coverage
              </h2>
              <p className="text-muted-foreground">
                View permit data for other states in the region
              </p>
            </motion.div>

            <div className="flex flex-wrap justify-center gap-3">
              {neighboringStates.map((code) => (
                <Button key={code} variant="outline" asChild>
                  <Link to={`/jurisdictions/${code.toLowerCase()}`}>
                    <MapPin className="h-4 w-4 mr-2" />
                    {STATE_INFO[code]?.name || code}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA Section */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Ready to Streamline {stateInfo.name} Permits?
            </h2>
            <p className="text-xl opacity-90 mb-8 max-w-2xl mx-auto">
              Get instant access to verified jurisdiction data, AI-powered tools, and expedited workflows.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Button size="lg" variant="secondary" asChild>
                <Link to="/auth">
                  Start Free Trial
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" className="bg-transparent border-primary-foreground hover:bg-primary-foreground/10" asChild>
                <Link to="/contact">Talk to Sales</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>
    </>
  );
}
