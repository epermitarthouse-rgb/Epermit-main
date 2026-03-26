import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { 
  Calculator,
  DollarSign,
  Building2,
  ExternalLink,
  Info,
  FileText,
  Ruler,
  Home,
  Factory,
  Wrench,
  AlertCircle
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface FeeCategory {
  id: string;
  name: string;
  description: string;
  formula: string;
  example?: string;
}

interface JurisdictionFees {
  id: string;
  name: string;
  abbreviation: string;
  officialUrl: string;
  calculatorUrl?: string;
  lastUpdated: string;
  notes: string[];
  feeFormula: string;
  newConstruction: FeeCategory[];
  alterations: FeeCategory[];
  planReview: FeeCategory[];
  inspections: FeeCategory[];
  other: FeeCategory[];
}

const jurisdictionFees: JurisdictionFees[] = [
  {
    id: 'dc',
    name: 'District of Columbia',
    abbreviation: 'DC DOB',
    officialUrl: 'https://dob.dc.gov/node/1620346',
    lastUpdated: '2024',
    feeFormula: 'Valuation-based with 10% enhanced fee surcharge on all fees',
    notes: [
      'All fees include 10% enhanced fee surcharge',
      'Filing deposit: 50% of permit fee (max $20,000)',
      'Green Building Fee applies to all projects'
    ],
    newConstruction: [
      { id: 'dc-new-1', name: 'Building Permit Fee', description: 'New construction and additions', formula: '$0.03 per cubic foot × 1.10 (enhanced fee)', example: '100,000 cu ft × $0.03 × 1.10 = $3,300' },
      { id: 'dc-new-2', name: 'Green Building Fee', description: 'New construction sustainability fee', formula: '$0.002 per square foot × 1.10', example: '50,000 sq ft × $0.002 × 1.10 = $110' },
      { id: 'dc-new-3', name: 'Filing Deposit', description: 'Required at application (credited to permit)', formula: '50% of assessed permit fee (max $20,000)', example: '$10,000 permit = $5,000 deposit' },
    ],
    alterations: [
      { id: 'dc-alt-1', name: 'Under $500 value', description: 'Minor alterations', formula: '$33 × 1.10 = $36.30 flat', example: 'Fixed fee' },
      { id: 'dc-alt-2', name: '$501 - $1,000 value', description: 'Small alterations', formula: '$65 × 1.10 = $71.50 flat', example: 'Fixed fee' },
      { id: 'dc-alt-3', name: '$1,001 - $1,000,000', description: 'Standard alterations', formula: '($30 + 2% of value) × 1.10', example: '$500K = ($30 + $10,000) × 1.10 = $11,033' },
      { id: 'dc-alt-4', name: 'Over $1,000,000', description: 'Major alterations', formula: '($10,030 + 1% of total) × 1.10', example: '$5M = ($10,030 + $50,000) × 1.10 = $66,033' },
      { id: 'dc-alt-5', name: 'Green Building Fee', description: 'Alterations $1K-$1M', formula: '0.13% of value × 1.10', example: '$500K × 0.0013 × 1.10 = $715' },
      { id: 'dc-alt-6', name: 'Green Building Fee (>$1M)', description: 'Major alterations', formula: '($1,300 + 0.0065% over $1M) × 1.10', example: '$5M = ($1,300 + $260) × 1.10 = $1,716' },
    ],
    planReview: [
      { id: 'dc-plan-1', name: 'Design Review (<10K sf)', description: 'Commercial, 1 hour max', formula: '$130 × 1.10 = $143', example: 'Small commercial' },
      { id: 'dc-plan-2', name: 'Design Review (10K-100K sf)', description: 'Commercial, 2 hours max', formula: '$390 × 1.10 = $429', example: 'Medium commercial' },
      { id: 'dc-plan-3', name: 'Design Review (>100K sf)', description: 'Commercial, 3 hours max', formula: '$650 × 1.10 = $715', example: 'Large commercial' },
      { id: 'dc-plan-4', name: 'Additional Review Time', description: 'Per hour or fraction', formula: '$150/hr × 1.10 = $165/hr', example: 'Complex projects' },
      { id: 'dc-plan-5', name: 'Repeat Technical Review', description: 'Rejected/revised plans per discipline', formula: '$65-$650 per discipline × 1.10', example: 'Varies by size' },
      { id: 'dc-plan-6', name: 'Preliminary Review (Residential)', description: 'Single family preliminary', formula: '$65 × 1.10 = $71.50', example: 'Single family' },
    ],
    inspections: [
      { id: 'dc-insp-1', name: 'C/O (≤5,000 sf)', description: 'Certificate of Occupancy', formula: '($42 + $33 filing) × 1.10 = $82.50', example: 'Small spaces' },
      { id: 'dc-insp-2', name: 'C/O (5K-50K sf)', description: 'Medium Certificate of Occupancy', formula: '($42 + $0.004/sf + $33) × 1.10', example: '30K sf = $209' },
      { id: 'dc-insp-3', name: 'C/O (50K-100K sf)', description: 'Large Certificate of Occupancy', formula: '($276 + $0.003/sf + $33) × 1.10', example: '75K sf = $587' },
      { id: 'dc-insp-4', name: 'C/O (>100K sf)', description: 'Very large C/O', formula: '($471 + $0.0013/sf + $33) × 1.10', example: '200K sf = $841' },
      { id: 'dc-insp-5', name: 'Certificate of Use', description: 'Annual certificate', formula: '$260 × 1.10 = $286/year', example: 'Annual renewal' },
    ],
    other: [
      { id: 'dc-other-1', name: 'Demolition/Raze', description: 'Complete demolition', formula: '($30 + 2% of cost) × 1.10', example: 'Same as alteration' },
      { id: 'dc-other-2', name: 'Raze by volume', description: 'Alternative calculation', formula: '$0.02/cubic foot × 1.10', example: '50K cf = $1,100' },
      { id: 'dc-other-3', name: 'Excavation (<50K cf)', description: 'Small excavation', formula: '$130 × 1.10 = $143', example: 'Foundation' },
      { id: 'dc-other-4', name: 'Excavation (≥50K cf)', description: 'Large excavation', formula: '$650 × 1.10 = $715', example: 'Major site work' },
      { id: 'dc-other-5', name: 'Sign (≤25 sf)', description: 'Small signage', formula: '$65 × 1.10 = $71.50', example: 'Storefront' },
      { id: 'dc-other-6', name: 'Sign (25-100 sf)', description: 'Medium signage', formula: '$130 × 1.10 = $143', example: 'Building ID' },
      { id: 'dc-other-7', name: 'Sign (>100 sf)', description: 'Large signage', formula: '($130 + $2/sf over 100) × 1.10', example: '200 sf = $363' },
      { id: 'dc-other-8', name: 'Swimming Pool (≤15K gal)', description: 'Small pool', formula: '$260 × 1.10 = $286', example: 'Residential pool' },
      { id: 'dc-other-9', name: 'Swimming Pool (>15K gal)', description: 'Large pool', formula: '($260 + $33/1000 gal) × 1.10', example: '25K gal = $396' },
    ]
  },
  {
    id: 'chicago',
    name: 'City of Chicago',
    abbreviation: 'Chicago DOB',
    officialUrl: 'https://www.chicago.gov/content/dam/city/depts/bldgs/general/Permitfees/2024%20Bldg%20Permit%20Fee%20Tables.pdf',
    calculatorUrl: 'https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits/svcs/permit_fee_calculator.html',
    lastUpdated: 'January 1, 2024',
    feeFormula: 'Area × Construction Factor × Scope Factor (minimum $302)',
    notes: [
      'Fee = Area × Construction Factor × Scope Factor',
      'Minimum permit fee: $302',
      'Construction factor varies by occupancy group and type (I-V)',
      'Scope factor ranges 0.25-1.25 based on work complexity'
    ],
    newConstruction: [
      { id: 'chi-new-1', name: 'Group A-1 (with stage)', description: 'Theaters, concert halls', formula: 'Area × (Type I: $1.00, II: $0.93, III: $0.90, IV: $0.86, V: $0.79) × Scope Factor', example: '50K sf Type I × $1.00 × 1.0 = $50,000' },
      { id: 'chi-new-2', name: 'Group A-1 (without stage)', description: 'Assembly without stage', formula: 'Area × (Type I: $0.92, II: $0.85, III: $0.81, IV: $0.78, V: $0.62)', example: '20K sf Type II = $17,000' },
      { id: 'chi-new-3', name: 'Group A-2/A-3/A-4', description: 'Restaurants, churches, arenas', formula: 'Area × (Type I: $0.81, II: $0.76, III: $0.71, IV: $0.69, V: $0.62)', example: '15K sf Type I = $12,150' },
      { id: 'chi-new-4', name: 'Group A-5', description: 'Stadiums, bleachers', formula: 'Area × (Type I: $0.90, II: $0.84, III: $0.81, IV: $0.77, V: $0.70)', example: '100K sf Type I = $90,000' },
      { id: 'chi-new-5', name: 'Group B (Business)', description: 'Offices, banks, clinics', formula: 'Area × (Type I: $0.79, II: $0.73, III: $0.70, IV: $0.65, V: $0.57)', example: '100K sf Type I = $79,000' },
      { id: 'chi-new-6', name: 'Group E (Educational)', description: 'Schools, day care', formula: 'Area × (Type I: $0.82, II: $0.76, III: $0.74, IV: $0.69, V: $0.61)', example: '75K sf Type II = $57,000' },
      { id: 'chi-new-7', name: 'Group F (Factory)', description: 'Industrial, manufacturing', formula: 'Area × (Type I: $0.54, II: $0.42, III: $0.40, IV: $0.37, V: $0.30)', example: '200K sf Type II = $84,000' },
      { id: 'chi-new-8', name: 'Group H (Hazardous)', description: 'Hazardous occupancy', formula: 'Area × (Type I: $0.79, II: $0.73, III: $0.70, IV: $0.65, V: $0.57)', example: '10K sf Type I = $7,900' },
      { id: 'chi-new-9', name: 'Group I (Institutional)', description: 'Hospitals, jails', formula: 'Area × (Type I: $1.00, II: $0.93, III: $0.92, IV: $0.81, V: $0.73)', example: '50K sf Type I = $50,000' },
      { id: 'chi-new-10', name: 'Group M (Mercantile)', description: 'Retail, department stores', formula: 'Area × (Type I: $0.79, II: $0.53, III: $0.49, IV: $0.47, V: $0.40)', example: '30K sf Type I = $23,700' },
      { id: 'chi-new-11', name: 'Group R-1 (Hotels)', description: 'Hotels, motels', formula: 'Area × (Type I: $0.79, II: $0.73, III: $0.73, IV: $0.66, V: $0.59)', example: '80K sf Type I = $63,200' },
      { id: 'chi-new-12', name: 'Group R-2 (Apartments)', description: 'Multi-family residential', formula: 'Area × (Type I: $0.79, II: $0.73, III: $0.73, IV: $0.66, V: $0.59)', example: '150K sf Type III = $109,500' },
      { id: 'chi-new-13', name: 'Group R-3/R-4 (Residential)', description: '1-3 dwelling units, care facilities', formula: 'Area × (Type I: $0.49, II: $0.47, III: $0.46, IV: $0.45, V: $0.41)', example: '3K sf Type V = $1,230' },
      { id: 'chi-new-14', name: 'Group R-5', description: 'Other residential', formula: 'Area × (Type I: $0.50, II: $0.39, III: $0.37, IV: $0.33, V: $0.26)', example: '2.5K sf Type V = $650' },
      { id: 'chi-new-15', name: 'Group S (Storage)', description: 'Warehouses, parking', formula: 'Area × (Type I: $0.40, II: $0.35, III: $0.32, IV: $0.30, V: $0.24)', example: '500K sf Type II = $175,000' },
      { id: 'chi-new-16', name: 'Group U (Utility)', description: 'Agricultural, misc', formula: 'Area × (Type I: $0.33, II: $0.29, III: $0.27, IV: $0.25, V: $0.22)', example: '5K sf Type V = $1,100' },
    ],
    alterations: [
      { id: 'chi-alt-1', name: 'Level 1 Alteration', description: 'Minor non-structural, no space reconfig', formula: 'Area × Construction Factor × 0.25', example: '5K sf Group B Type I × 0.25 = $988' },
      { id: 'chi-alt-2', name: 'Level 2/3 Alteration', description: 'Major renovation', formula: 'Area × Construction Factor × 0.75-1.0', example: '10K sf Group B × 0.75 = $5,925' },
      { id: 'chi-alt-3', name: 'Change of Occupancy', description: 'Without hazard increase', formula: 'Area × Construction Factor × 0.75 (min $1,700)', example: 'Occupancy change' },
      { id: 'chi-alt-4', name: 'Change of Occupancy (hazard increase)', description: 'Increased hazard category', formula: 'Area × Construction Factor × 1.0 (min $3,450)', example: 'Hazard increase' },
      { id: 'chi-alt-5', name: 'Structural Repair Only', description: 'Entire scope is structural', formula: 'Area × Construction Factor × 0.25 (min $850)', example: 'Structural work' },
      { id: 'chi-alt-6', name: 'Roof Repair/Replace', description: 'With structural repair', formula: 'Area × Construction Factor × 0.25 (min $850)', example: 'Roof work' },
    ],
    planReview: [
      { id: 'chi-plan-1', name: 'Easy Permit (online)', description: 'Simple residential work', formula: '$50 flat fee', example: 'Water heater, furnace' },
      { id: 'chi-plan-2', name: 'Standard Review', description: 'Included in permit fee', formula: 'Included in calculated permit fee', example: 'All standard permits' },
      { id: 'chi-plan-3', name: 'Developer Services', description: 'Expedited large projects', formula: 'Contact DOB for quote', example: 'Major developments' },
    ],
    inspections: [
      { id: 'chi-insp-1', name: 'Standard Inspections', description: 'Required construction inspections', formula: 'Included in permit fee', example: 'Foundation, framing, final' },
      { id: 'chi-insp-2', name: 'Special Inspections', description: 'Third-party required', formula: 'By approved special inspection agency', example: 'Structural, fireproofing' },
    ],
    other: [
      { id: 'chi-other-1', name: 'Ordinary Demolition', description: 'Standard demolition', formula: 'Flat fee: $550', example: 'Standard demo' },
      { id: 'chi-other-2', name: 'Complex Demolition', description: 'Complex demolition work', formula: 'Flat fee: $2,300', example: 'Complex demo' },
      { id: 'chi-other-3', name: 'Detached Garage/Carport', description: 'Accessory structure', formula: 'Area × Factor × 0.5 (min $550)', example: 'Residential garage' },
      { id: 'chi-other-4', name: 'Temporary Structure', description: 'Not in Table 14A-12-1204.2', formula: 'Flat fee: $300', example: 'Temp structures' },
      { id: 'chi-other-5', name: 'Exterior Wall Rehab (tuckpointing)', description: 'Masonry repair', formula: 'Area × 0.05 (min $350)', example: 'Facade repair' },
      { id: 'chi-other-6', name: 'Exterior Wall Rehab (concrete)', description: 'Concrete repair', formula: 'Area × 0.5 (min $550)', example: 'Concrete facade' },
    ]
  },
  {
    id: 'nyc',
    name: 'New York City',
    abbreviation: 'NYC DOB',
    officialUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-156650',
    calculatorUrl: 'https://www.nyc.gov/site/buildings/industry/fee-schedule.page',
    lastUpdated: '2024',
    feeFormula: 'Filing Fee + Plan Exam Fee + Work Permit Fee (based on cost/sq ft)',
    notes: [
      'Separate filing, plan exam, and work permit fees',
      'Professional certification can reduce plan exam time',
      'After-hours inspections: $200/hr (2-hour min)',
      'Work started without permit: 5× standard fee'
    ],
    newConstruction: [
      { id: 'nyc-new-1', name: 'NB Filing Fee', description: 'New building application', formula: '$280 base + $0.26 per $1,000 construction cost', example: '$10M project = $280 + $2,600 = $2,880' },
      { id: 'nyc-new-2', name: 'Plan Exam Fee', description: 'DOB plan review', formula: '$420 base + $35 per 1,000 sq ft', example: '50K sf = $420 + $1,750 = $2,170' },
      { id: 'nyc-new-3', name: 'Work Permit Fee', description: 'Construction permit', formula: '$100 per $15,000 of work (min $100)', example: '$3M = 200 × $100 = $20,000' },
      { id: 'nyc-new-4', name: 'Equipment Work Filing', description: 'Boiler, elevator, etc.', formula: '$110 - $210 based on equipment type', example: 'Varies by equipment' },
    ],
    alterations: [
      { id: 'nyc-alt-1', name: 'Alt-1 (Major Alteration)', description: 'Change use/egress/occupancy', formula: '$280 filing + $0.26 per $1,000 cost', example: 'Major renovation' },
      { id: 'nyc-alt-2', name: 'Alt-2 (Multiple Work Types)', description: 'Multiple systems/work types', formula: '$165 filing + $0.26 per $1,000 cost', example: 'HVAC + electrical' },
      { id: 'nyc-alt-3', name: 'Alt-3 (Minor Alteration)', description: 'Single work type only', formula: '$110 flat filing fee', example: 'Single-trade work' },
      { id: 'nyc-alt-4', name: 'Administrative Changes', description: 'DOB Now amendments', formula: '$50 - $100 based on change type', example: 'Minor amendments' },
    ],
    planReview: [
      { id: 'nyc-plan-1', name: 'Professional Certification', description: 'Licensed professional certified', formula: 'Reduced review timeline (1-2 days)', example: 'PE/RA certified plans' },
      { id: 'nyc-plan-2', name: 'DOB Plan Examination', description: 'Full department review', formula: 'Standard review: 4-12 weeks', example: 'Complex projects' },
      { id: 'nyc-plan-3', name: 'Accelerated Plan Review', description: 'Priority processing', formula: '2.5× standard plan exam fee', example: 'Expedited review' },
      { id: 'nyc-plan-4', name: 'Hub Priority Processing', description: 'DOB Hub projects', formula: 'Contact Hub for pricing', example: 'Large developments' },
    ],
    inspections: [
      { id: 'nyc-insp-1', name: 'Standard Inspection', description: 'Required inspections', formula: 'Included in permit fee', example: 'All required inspections' },
      { id: 'nyc-insp-2', name: 'After-Hours Inspection', description: 'Outside business hours', formula: '$200/hour (2-hour minimum)', example: 'Weekend = $400 min' },
      { id: 'nyc-insp-3', name: 'Re-inspection Fee', description: 'Failed inspection follow-up', formula: '$100 per re-inspection', example: 'Correction verification' },
      { id: 'nyc-insp-4', name: 'Temporary C of O', description: '90-day TCO', formula: '$100 per TCO', example: 'Partial occupancy' },
    ],
    other: [
      { id: 'nyc-other-1', name: 'Demolition Permit', description: 'Full/partial demolition', formula: '$420 + $0.10 per sq ft of demo', example: '10K sf = $1,420' },
      { id: 'nyc-other-2', name: 'Sign Application', description: 'Signage permit', formula: '$165 per sign + size surcharges', example: 'Varies by sign type' },
      { id: 'nyc-other-3', name: 'Scaffold/Shed Permit', description: 'Sidewalk shed', formula: '$110 filing + area fees', example: 'Construction protection' },
      { id: 'nyc-other-4', name: 'Work Without Permit Penalty', description: 'Started without permit', formula: '5× standard permit fee', example: 'Violation penalty' },
    ]
  },
  {
    id: 'miami',
    name: 'City of Miami',
    abbreviation: 'Miami',
    officialUrl: 'https://www.miami.gov/Permits-Construction/Permitting-Resources/City-of-Miami-Building-Permit-Fee-Schedule',
    lastUpdated: '2024',
    feeFormula: 'Residential: 0.5% of cost | Commercial: 1% up to $30M, then 0.5%',
    notes: [
      'Residential (≤3 units): 0.50% of construction cost',
      'Commercial/Multifamily: 1% up to $30M + 0.5% over $30M',
      'Minimum permit fee: $110',
      'Work without permit: 2× fee (Homestead) or 4× (Commercial) + $110'
    ],
    newConstruction: [
      { id: 'mia-new-1', name: 'Residential (≤3 units)', description: 'Single-family, duplex, triplex', formula: '0.50% of estimated construction cost', example: '$500K × 0.005 = $2,500' },
      { id: 'mia-new-2', name: 'Commercial/Multifamily', description: 'All commercial and 4+ units', formula: '1% up to $30M + 0.5% over $30M', example: '$50M = $300K + $100K = $400K' },
      { id: 'mia-new-3', name: 'Minimum Permit Fee', description: 'All permit types', formula: '$110 minimum', example: 'Small projects' },
      { id: 'mia-new-4', name: 'Phased Permit', description: 'FBC 105.13 phased permits', formula: '$1,500 + surcharges', example: '6-month validity' },
    ],
    alterations: [
      { id: 'mia-alt-1', name: 'Residential Remodel', description: 'Renovation ≤3 units', formula: '0.50% of construction cost (min $45 if <$2,500)', example: '$100K remodel = $500' },
      { id: 'mia-alt-2', name: 'Commercial Remodel', description: 'Commercial alterations', formula: '1% of construction cost', example: '$500K TI = $5,000' },
      { id: 'mia-alt-3', name: 'Revision Fee', description: 'Plan revisions after 2nd review', formula: '$56 per discipline', example: 'Per revision' },
    ],
    planReview: [
      { id: 'mia-plan-1', name: 'Dry Run/Up-Front Fee', description: 'Submittal deposit', formula: '$2.80 per $1,000 construction value', example: '$1M = $2,800 deposit' },
      { id: 'mia-plan-2', name: 'Private Provider Credit', description: 'Third-party review', formula: '1/3 credit on permit fee', example: 'FL 553.791 provider' },
      { id: 'mia-plan-3', name: 'Joint Plan Review', description: 'Multi-discipline meeting', formula: '$276 per discipline (2 hrs max)', example: 'Projects >20K sf' },
    ],
    inspections: [
      { id: 'mia-insp-1', name: 'C/O Residential', description: 'Per dwelling unit', formula: '$105 per unit', example: '10 units = $1,050' },
      { id: 'mia-insp-2', name: 'C/O Commercial', description: 'Commercial/multifamily rental', formula: '$0.10 per sq ft (min $250)', example: '50K sf = $5,000' },
      { id: 'mia-insp-3', name: 'T.C.O. Extension', description: 'Temporary C/O extension', formula: '$0.10/sf per 90 days (commercial)', example: '90-day extensions' },
    ],
    other: [
      { id: 'mia-other-1', name: 'Solid Waste Surcharge (Res)', description: 'Residential debris', formula: '$0.22 per $100 cost (min $26, max $600)', example: '$100K = $220' },
      { id: 'mia-other-2', name: 'Solid Waste Surcharge (Comm)', description: 'Commercial debris', formula: '2.5% of cost (min $57, max $10,500)', example: '$1M = $10,500 (capped)' },
      { id: 'mia-other-3', name: 'Energy Conservation Fee', description: 'New construction/additions', formula: '$0.11 per sq ft', example: '10K sf = $1,100' },
      { id: 'mia-other-4', name: 'Permit by Affidavit', description: 'Legalization pre-2002', formula: '$250 + enforcement fees', example: 'Unpermitted work' },
      { id: 'mia-other-5', name: 'Annual Facility Permit', description: 'Annual maintenance permit', formula: '2% of annual work schedule cost', example: 'Recurring maintenance' },
    ]
  },
  {
    id: 'seattle',
    name: 'City of Seattle',
    abbreviation: 'Seattle SDCI',
    officialUrl: 'https://www.seattle.gov/sdci/codes/codes-we-enforce-(a-z)/fees',
    calculatorUrl: 'https://www.seattle.gov/sdci/permits/permit-fee-calculator',
    lastUpdated: 'January 1, 2024',
    feeFormula: 'Based on ICC Building Valuation Data (BVD) × Local Multiplier',
    notes: [
      'Base hourly rate: $257/hr (2024)',
      'Land use hourly rate: $439/hr',
      'Fees based on ICC Building Valuation Data tables',
      '2% inflationary increase applied in 2024'
    ],
    newConstruction: [
      { id: 'sea-new-1', name: 'Single Family (R-3)', description: '1,500 sf dwelling + garage', formula: 'BVD value × D-1 table rate', example: '1,900 sf = ~$4,888 (2024)' },
      { id: 'sea-new-2', name: '3-Unit Townhouse (R-3)', description: '6,100 sf townhouse', formula: 'BVD value × D-1 table rate', example: '~$12,703 (2024)' },
      { id: 'sea-new-3', name: 'Office (B)', description: '7,000 sf office', formula: 'BVD value × D-1 table rate', example: 'BVD $1.3M → $15,031' },
      { id: 'sea-new-4', name: 'Apartment (R-2)', description: '21,000 sf dwelling', formula: 'BVD value × D-1 table rate', example: 'BVD $3.4M → $33,346' },
      { id: 'sea-new-5', name: 'Bank (B)', description: '5,000 sf bank', formula: 'BVD value × D-1 table rate', example: 'BVD $933K → $11,454' },
    ],
    alterations: [
      { id: 'sea-alt-1', name: 'Tenant Improvement', description: 'Commercial TI by value', formula: 'Based on alteration BVD', example: 'Per valuation table' },
      { id: 'sea-alt-2', name: 'Residential Remodel', description: 'Based on project value', formula: 'BVD × applicable multiplier', example: 'Per fee schedule' },
    ],
    planReview: [
      { id: 'sea-plan-1', name: 'Standard Review', description: 'SDCI plan review', formula: 'Included in D-1 table fee', example: 'Standard timeline' },
      { id: 'sea-plan-2', name: 'Expedited Review', description: 'Priority processing', formula: 'Contact SDCI for availability', example: 'Limited availability' },
      { id: 'sea-plan-3', name: 'Pre-Application Conference', description: 'Optional pre-app meeting', formula: '$257/hr base rate', example: 'Complex projects' },
    ],
    inspections: [
      { id: 'sea-insp-1', name: 'Standard Inspections', description: 'Required inspections', formula: 'Included in permit fee', example: 'Per inspection schedule' },
    ],
    other: [
      { id: 'sea-other-1', name: 'Minimum D-1 Table Fee', description: 'Minimum permit fee', formula: '$257 minimum (2024)', example: 'Small projects' },
      { id: 'sea-other-2', name: 'Washington State BCPF', description: 'State building code fee', formula: 'Per Washington State schedule', example: 'State surcharge' },
    ]
  },
  {
    id: 'boston',
    name: 'City of Boston',
    abbreviation: 'Boston ISD',
    officialUrl: 'https://content.boston.gov/sites/default/files/file/2023/05/Building%20Fees%205%2015%2023.pdf',
    lastUpdated: '2023',
    feeFormula: '$50 base + $10 per $1,000 of construction cost',
    notes: [
      'Long Form Building: $50 + $10 per $1,000 cost',
      'Short Form Building: $20 primary fee',
      'Double fee if work started without permit',
      'Electrical: $20 + $0.25/amp (≤240V) or $0.75/amp (>480V)'
    ],
    newConstruction: [
      { id: 'bos-new-1', name: 'Long Form Building', description: 'New construction permits', formula: '$50 + $10 per $1,000 of estimated cost', example: '$500K = $50 + $5,000 = $5,050' },
      { id: 'bos-new-2', name: 'Short Form Building', description: 'Minor construction', formula: '$20 primary fee', example: 'Small projects' },
    ],
    alterations: [
      { id: 'bos-alt-1', name: 'Amendment', description: 'Plan amendments', formula: '$20 + $10 per $1,000 of work', example: '$100K amendment = $1,020' },
      { id: 'bos-alt-2', name: 'Change of Occupancy (≤3 family)', description: 'Residential occupancy change', formula: '$20 flat fee', example: 'Residential' },
      { id: 'bos-alt-3', name: 'Change of Occupancy (4+ family/Comm)', description: 'Commercial occupancy change', formula: '$50 flat fee', example: 'Commercial' },
    ],
    planReview: [
      { id: 'bos-plan-1', name: 'Board of Appeal (1-3 family)', description: 'Variance appeal', formula: '$150 primary fee', example: 'Residential variance' },
      { id: 'bos-plan-2', name: 'Board of Appeal (4+ family/Comm)', description: 'Commercial variance', formula: '$150 per violation cited', example: 'Commercial variance' },
    ],
    inspections: [
      { id: 'bos-insp-1', name: 'Off-Hour Permits', description: 'After-hours work', formula: '$100 per day', example: 'Weekend work' },
    ],
    other: [
      { id: 'bos-other-1', name: 'Electrical (service upgrade)', description: 'New/upgraded service', formula: '$20 + $0.25/amp (≤240V) or $0.75/amp (>480V)', example: '200A service = $70' },
      { id: 'bos-other-2', name: 'Electrical (fixtures)', description: 'No service change', formula: '$20 + $1 per fixture/outlet', example: '50 fixtures = $70' },
      { id: 'bos-other-3', name: 'Plumbing', description: 'Plumbing permit', formula: '$20 + $5 per fixture', example: '10 fixtures = $70' },
      { id: 'bos-other-4', name: 'Gas', description: 'Gas piping permit', formula: '$20 + $5 per appliance + $0.09/1,000 BTU', example: 'Per appliance' },
      { id: 'bos-other-5', name: 'Nominal Fee', description: 'Special cases', formula: '$300 + $50 application', example: 'Special projects' },
      { id: 'bos-other-6', name: 'Double Fee Penalty', description: 'Work without permit', formula: '2× standard fee', example: 'Violation' },
    ]
  },
  {
    id: 'la',
    name: 'Los Angeles',
    abbreviation: 'LA LADBS',
    officialUrl: 'https://dbs.lacity.gov/services/plan-review-permitting',
    calculatorUrl: 'https://www.ladbs.org/permits/calculate-permit-fees',
    lastUpdated: '2024',
    feeFormula: 'Based on ICC Building Valuation Data × LADBS Multipliers',
    notes: [
      'Plan check fee: 80% of building permit fee',
      'Strong motion instrumentation fee applies',
      'Expedited plan check: 200% of standard',
      'Private provider option available'
    ],
    newConstruction: [
      { id: 'la-new-1', name: 'Building Permit Fee', description: 'Based on ICC valuation', formula: 'Per LADBS valuation table', example: 'See online calculator' },
      { id: 'la-new-2', name: 'Plan Check Fee', description: 'Plan review fee', formula: '80% of building permit fee', example: '$10K permit = $8K plan check' },
      { id: 'la-new-3', name: 'Systems Development Fee', description: 'Infrastructure impact', formula: 'Based on use and size', example: 'Varies by project' },
    ],
    alterations: [
      { id: 'la-alt-1', name: 'Alteration Permit', description: 'Based on valuation', formula: 'Per ICC valuation tables', example: 'Similar to new construction' },
      { id: 'la-alt-2', name: 'Tenant Improvement', description: 'Commercial TI', formula: 'Based on scope and valuation', example: 'Per fee schedule' },
    ],
    planReview: [
      { id: 'la-plan-1', name: 'Standard Plan Check', description: 'Regular review queue', formula: '80% of permit fee', example: '4-6 weeks typical' },
      { id: 'la-plan-2', name: 'Expedited Plan Check', description: 'Priority processing', formula: '200% of standard plan check', example: '1-2 weeks' },
      { id: 'la-plan-3', name: 'Parallel Plan Check', description: 'Concurrent discipline review', formula: 'Additional coordination fee', example: 'Large projects' },
    ],
    inspections: [
      { id: 'la-insp-1', name: 'Inspection Fee', description: 'Standard inspections', formula: 'Included in permit', example: 'Required inspections' },
      { id: 'la-insp-2', name: 'Special Inspection', description: 'Deputy inspector', formula: 'Hourly rates apply', example: 'Structural, welding' },
    ],
    other: [
      { id: 'la-other-1', name: 'Strong Motion Instrumentation', description: 'Seismic monitoring fee', formula: '$0.00028 per $1 of valuation', example: '$1M = $280' },
      { id: 'la-other-2', name: 'Green Building Fee', description: 'Title 24 compliance', formula: 'Based on project scope', example: 'Sustainability' },
      { id: 'la-other-3', name: 'School Fee', description: 'If applicable', formula: 'Per sq ft rate', example: 'Residential development' },
    ]
  },
];

export function PermitFeeCalculator() {
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>(jurisdictionFees[0].id);
  const [constructionValue, setConstructionValue] = useState<string>('');
  const [squareFootage, setSquareFootage] = useState<string>('');
  const [projectType, setProjectType] = useState<string>('commercial');
  const [constructionType, setConstructionType] = useState<string>('I');

  const currentJurisdiction = jurisdictionFees.find(j => j.id === selectedJurisdiction);

  // Calculate DC Fee
  const calculateDCFee = () => {
    const value = parseFloat(constructionValue) || 0;
    const sf = parseFloat(squareFootage) || 0;
    
    let permitFee = 0;
    let greenFee = 0;
    
    if (value <= 500) {
      permitFee = 36.30;
    } else if (value <= 1000) {
      permitFee = 71.50;
    } else if (value <= 1000000) {
      permitFee = (30 + (value * 0.02)) * 1.10;
      greenFee = value * 0.0013 * 1.10;
    } else {
      permitFee = (10030 + (value * 0.01)) * 1.10;
      greenFee = (1300 + ((value - 1000000) * 0.000065)) * 1.10;
    }
    
    return {
      permitFee: permitFee.toFixed(2),
      greenFee: greenFee.toFixed(2),
      deposit: Math.min(permitFee * 0.5, 20000).toFixed(2),
      total: (permitFee + greenFee).toFixed(2)
    };
  };

  // Calculate Chicago Fee
  const calculateChicagoFee = () => {
    const sf = parseFloat(squareFootage) || 0;
    const typeRates: Record<string, Record<string, number>> = {
      'B': { 'I': 0.79, 'II': 0.73, 'III': 0.70, 'IV': 0.65, 'V': 0.57 },
      'R-2': { 'I': 0.79, 'II': 0.73, 'III': 0.73, 'IV': 0.66, 'V': 0.59 },
      'M': { 'I': 0.79, 'II': 0.53, 'III': 0.49, 'IV': 0.47, 'V': 0.40 },
      'F': { 'I': 0.54, 'II': 0.42, 'III': 0.40, 'IV': 0.37, 'V': 0.30 },
      'S': { 'I': 0.40, 'II': 0.35, 'III': 0.32, 'IV': 0.30, 'V': 0.24 },
    };
    const rate = typeRates['B'][constructionType] || 0.79;
    const fee = Math.max(sf * rate, 302);
    return {
      fee: fee.toFixed(2),
      rate: rate.toFixed(2)
    };
  };

  // Calculate Miami Fee
  const calculateMiamiFeee = () => {
    const value = parseFloat(constructionValue) || 0;
    const sf = parseFloat(squareFootage) || 0;
    
    let permitFee = 0;
    let solidWaste = 0;
    let energyFee = sf * 0.11;
    
    if (projectType === 'residential') {
      permitFee = Math.max(value * 0.005, 110);
      solidWaste = Math.min(Math.max(value * 0.0022, 26), 600);
    } else {
      if (value <= 30000000) {
        permitFee = value * 0.01;
      } else {
        permitFee = 300000 + (value - 30000000) * 0.005;
      }
      permitFee = Math.max(permitFee, 110);
      solidWaste = Math.min(Math.max(value * 0.025, 57), 10500);
    }
    
    return {
      permitFee: permitFee.toFixed(2),
      solidWaste: solidWaste.toFixed(2),
      energyFee: energyFee.toFixed(2),
      total: (permitFee + solidWaste + energyFee).toFixed(2)
    };
  };

  // Calculate Boston Fee
  const calculateBostonFee = () => {
    const value = parseFloat(constructionValue) || 0;
    const fee = 50 + (value / 1000) * 10;
    return fee.toFixed(2);
  };

  // Calculate NYC Fee
  const calculateNYCFee = () => {
    const value = parseFloat(constructionValue) || 0;
    const sf = parseFloat(squareFootage) || 0;
    
    const filingFee = 280 + (value / 1000) * 0.26;
    const planExamFee = 420 + (sf / 1000) * 35;
    const workPermitFee = Math.max(Math.ceil(value / 15000) * 100, 100);
    
    return {
      filingFee: filingFee.toFixed(2),
      planExamFee: planExamFee.toFixed(2),
      workPermitFee: workPermitFee.toFixed(2),
      total: (filingFee + planExamFee + workPermitFee).toFixed(2)
    };
  };

  return (
    <div className="space-y-6">
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Permit Fee Formula Reference
          </CardTitle>
          <CardDescription>
            Official permit fee schedules and calculation formulas from major jurisdictions.
            Select a jurisdiction to view detailed fee breakdowns and use the interactive calculator.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Interactive Calculator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Interactive Fee Calculator
          </CardTitle>
          <CardDescription>
            Enter project details for permit fee estimates based on official formulas
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Jurisdiction</Label>
              <Select value={selectedJurisdiction} onValueChange={setSelectedJurisdiction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {jurisdictionFees.map(j => (
                    <SelectItem key={j.id} value={j.id}>{j.abbreviation}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Construction Value ($)</Label>
              <Input 
                type="number" 
                placeholder="e.g., 500000"
                value={constructionValue}
                onChange={(e) => setConstructionValue(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Square Footage</Label>
              <Input 
                type="number" 
                placeholder="e.g., 10000"
                value={squareFootage}
                onChange={(e) => setSquareFootage(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Project Type</Label>
              <Select value={projectType} onValueChange={setProjectType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential (≤3 units)</SelectItem>
                  <SelectItem value="commercial">Commercial/Multi-family</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {selectedJurisdiction === 'chicago' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Construction Type</Label>
                <Select value={constructionType} onValueChange={setConstructionType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="I">Type I (Fire-Resistive)</SelectItem>
                    <SelectItem value="II">Type II (Non-combustible)</SelectItem>
                    <SelectItem value="III">Type III (Ordinary)</SelectItem>
                    <SelectItem value="IV">Type IV (Heavy Timber)</SelectItem>
                    <SelectItem value="V">Type V (Wood Frame)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          
          {/* DC Calculator Results */}
          {selectedJurisdiction === 'dc' && constructionValue && (
            <Card className="bg-muted/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  DC DOB Fee Estimate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-primary">${calculateDCFee().permitFee}</div>
                    <div className="text-sm text-muted-foreground">Permit Fee</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">${calculateDCFee().greenFee}</div>
                    <div className="text-sm text-muted-foreground">Green Building Fee</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">${calculateDCFee().deposit}</div>
                    <div className="text-sm text-muted-foreground">Filing Deposit</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">${calculateDCFee().total}</div>
                    <div className="text-sm text-muted-foreground">Total Estimated</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Chicago Calculator Results */}
          {selectedJurisdiction === 'chicago' && squareFootage && (
            <Card className="bg-muted/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Chicago DOB Fee Estimate (Group B, Type {constructionType})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-primary">${calculateChicagoFee().fee}</div>
                    <div className="text-sm text-muted-foreground">Permit Fee</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">${calculateChicagoFee().rate}/sf</div>
                    <div className="text-sm text-muted-foreground">Construction Factor</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Formula: {squareFootage} sf × ${calculateChicagoFee().rate}/sf = ${calculateChicagoFee().fee} (min $302)
                </p>
              </CardContent>
            </Card>
          )}

          {/* NYC Calculator Results */}
          {selectedJurisdiction === 'nyc' && (constructionValue || squareFootage) && (
            <Card className="bg-muted/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  NYC DOB Fee Estimate (New Building)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">${calculateNYCFee().filingFee}</div>
                    <div className="text-sm text-muted-foreground">Filing Fee</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">${calculateNYCFee().planExamFee}</div>
                    <div className="text-sm text-muted-foreground">Plan Exam Fee</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">${calculateNYCFee().workPermitFee}</div>
                    <div className="text-sm text-muted-foreground">Work Permit Fee</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">${calculateNYCFee().total}</div>
                    <div className="text-sm text-muted-foreground">Total Estimated</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Miami Calculator Results */}
          {selectedJurisdiction === 'miami' && constructionValue && (
            <Card className="bg-muted/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Miami Fee Estimate ({projectType === 'residential' ? 'Residential' : 'Commercial'})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold">${calculateMiamiFeee().permitFee}</div>
                    <div className="text-sm text-muted-foreground">Permit Fee</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">${calculateMiamiFeee().solidWaste}</div>
                    <div className="text-sm text-muted-foreground">Solid Waste Surcharge</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold">${calculateMiamiFeee().energyFee}</div>
                    <div className="text-sm text-muted-foreground">Energy Fee</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-primary">${calculateMiamiFeee().total}</div>
                    <div className="text-sm text-muted-foreground">Total Estimated</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Boston Calculator Results */}
          {selectedJurisdiction === 'boston' && constructionValue && (
            <Card className="bg-muted/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Boston ISD Fee Estimate (Long Form Building)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center">
                  <div className="text-3xl font-bold text-primary">${calculateBostonFee()}</div>
                  <div className="text-sm text-muted-foreground">Permit Fee</div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Formula: $50 + (${constructionValue} ÷ 1,000) × $10 = ${calculateBostonFee()}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Generic message for other jurisdictions */}
          {!['dc', 'chicago', 'nyc', 'miami', 'boston'].includes(selectedJurisdiction) && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <AlertCircle className="h-5 w-5" />
                  <div>
                    <p className="font-medium">View detailed formulas below</p>
                    <p className="text-sm">Use the official calculator link for {currentJurisdiction?.name}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Jurisdiction Fee Schedules */}
      <Tabs defaultValue={jurisdictionFees[0].id}>
        <ScrollArea className="w-full">
          <TabsList className="inline-flex h-auto gap-1 w-max">
            {jurisdictionFees.map(j => (
              <TabsTrigger key={j.id} value={j.id} className="text-xs sm:text-sm whitespace-nowrap">
                {j.abbreviation}
              </TabsTrigger>
            ))}
          </TabsList>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>

        {jurisdictionFees.map(jurisdiction => (
          <TabsContent key={jurisdiction.id} value={jurisdiction.id} className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between flex-wrap gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      {jurisdiction.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Last updated: {jurisdiction.lastUpdated}
                    </CardDescription>
                    <div className="mt-2 p-2 bg-muted rounded text-sm">
                      <strong>Formula:</strong> {jurisdiction.feeFormula}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a href={jurisdiction.officialUrl} target="_blank" rel="noopener noreferrer">
                        Official Schedule <ExternalLink className="h-3 w-3 ml-1" />
                      </a>
                    </Button>
                    {jurisdiction.calculatorUrl && (
                      <Button variant="default" size="sm" asChild>
                        <a href={jurisdiction.calculatorUrl} target="_blank" rel="noopener noreferrer">
                          <Calculator className="h-3 w-3 mr-1" />
                          Official Calculator
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {jurisdiction.notes.map((note, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      <Info className="h-3 w-3 mr-1" />
                      {note}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
            </Card>

            <Accordion type="multiple" defaultValue={['new-construction']} className="w-full">
              <AccordionItem value="new-construction">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    New Construction Fees
                    <Badge variant="outline" className="ml-2">{jurisdiction.newConstruction.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[150px]">Fee Type</TableHead>
                          <TableHead className="min-w-[150px]">Description</TableHead>
                          <TableHead className="min-w-[250px]">Formula</TableHead>
                          <TableHead className="min-w-[200px]">Example</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jurisdiction.newConstruction.map(fee => (
                          <TableRow key={fee.id}>
                            <TableCell className="font-medium">{fee.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{fee.description}</TableCell>
                            <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded break-words">{fee.formula}</code></TableCell>
                            <TableCell className="text-sm text-muted-foreground">{fee.example}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="alterations">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    Alteration & Renovation Fees
                    <Badge variant="outline" className="ml-2">{jurisdiction.alterations.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[150px]">Fee Type</TableHead>
                          <TableHead className="min-w-[150px]">Description</TableHead>
                          <TableHead className="min-w-[250px]">Formula</TableHead>
                          <TableHead className="min-w-[200px]">Example</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jurisdiction.alterations.map(fee => (
                          <TableRow key={fee.id}>
                            <TableCell className="font-medium">{fee.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{fee.description}</TableCell>
                            <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded break-words">{fee.formula}</code></TableCell>
                            <TableCell className="text-sm text-muted-foreground">{fee.example}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="plan-review">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Plan Review Fees
                    <Badge variant="outline" className="ml-2">{jurisdiction.planReview.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[150px]">Fee Type</TableHead>
                          <TableHead className="min-w-[150px]">Description</TableHead>
                          <TableHead className="min-w-[250px]">Formula</TableHead>
                          <TableHead className="min-w-[200px]">Example</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jurisdiction.planReview.map(fee => (
                          <TableRow key={fee.id}>
                            <TableCell className="font-medium">{fee.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{fee.description}</TableCell>
                            <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded break-words">{fee.formula}</code></TableCell>
                            <TableCell className="text-sm text-muted-foreground">{fee.example}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="inspections">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Ruler className="h-4 w-4" />
                    Inspection & Certificate Fees
                    <Badge variant="outline" className="ml-2">{jurisdiction.inspections.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[150px]">Fee Type</TableHead>
                          <TableHead className="min-w-[150px]">Description</TableHead>
                          <TableHead className="min-w-[250px]">Formula</TableHead>
                          <TableHead className="min-w-[200px]">Example</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jurisdiction.inspections.map(fee => (
                          <TableRow key={fee.id}>
                            <TableCell className="font-medium">{fee.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{fee.description}</TableCell>
                            <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded break-words">{fee.formula}</code></TableCell>
                            <TableCell className="text-sm text-muted-foreground">{fee.example}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem value="other">
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Factory className="h-4 w-4" />
                    Other Fees (Demo, Signs, Special)
                    <Badge variant="outline" className="ml-2">{jurisdiction.other.length}</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="w-full">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="min-w-[150px]">Fee Type</TableHead>
                          <TableHead className="min-w-[150px]">Description</TableHead>
                          <TableHead className="min-w-[250px]">Formula</TableHead>
                          <TableHead className="min-w-[200px]">Example</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jurisdiction.other.map(fee => (
                          <TableRow key={fee.id}>
                            <TableCell className="font-medium">{fee.name}</TableCell>
                            <TableCell className="text-muted-foreground text-sm">{fee.description}</TableCell>
                            <TableCell><code className="text-xs bg-muted px-1.5 py-0.5 rounded break-words">{fee.formula}</code></TableCell>
                            <TableCell className="text-sm text-muted-foreground">{fee.example}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </TabsContent>
        ))}
      </Tabs>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{jurisdictionFees.length}</div>
            <div className="text-sm text-muted-foreground">Jurisdictions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">
              {jurisdictionFees.reduce((sum, j) => sum + j.newConstruction.length + j.alterations.length + j.planReview.length + j.inspections.length + j.other.length, 0)}
            </div>
            <div className="text-sm text-muted-foreground">Fee Formulas</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{jurisdictionFees.filter(j => j.calculatorUrl).length}</div>
            <div className="text-sm text-muted-foreground">Official Calculators</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-primary">2024</div>
            <div className="text-sm text-muted-foreground">Data Year</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
