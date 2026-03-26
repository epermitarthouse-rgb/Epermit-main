import { useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Search, 
  Book, 
  Building2, 
  MapPin, 
  Shield, 
  DoorOpen,
  Flame,
  Accessibility,
  HardHat,
  Zap,
  Scale,
  ExternalLink,
  BookOpen,
  FileText,
  Droplets,
  Wind,
  Leaf,
  Home,
  AlertTriangle,
  Snowflake,
  Sun,
  Mountain,
  Waves,
  ArrowUpDown
} from 'lucide-react';
import { CodeComparisonMatrix } from '@/components/code-reference/CodeComparisonMatrix';
import { PermitFeeCalculator } from '@/components/code-reference/PermitFeeCalculator';
import { motion } from 'framer-motion';

interface CodeSection {
  id: string;
  section: string;
  title: string;
  summary: string;
  details: string;
  category: string;
  keywords: string[];
}

interface JurisdictionCode {
  id: string;
  name: string;
  abbreviation: string;
  baseCode: string;
  adoptedYear: string;
  description: string;
  sections: CodeSection[];
  keyDifferences: string[];
  officialUrl?: string;
  state?: string;
  codeType: 'model' | 'state' | 'city';
}

const categoryIcons: Record<string, React.ReactNode> = {
  'Egress': <DoorOpen className="h-4 w-4" />,
  'Fire Safety': <Flame className="h-4 w-4" />,
  'Accessibility': <Accessibility className="h-4 w-4" />,
  'Structural': <HardHat className="h-4 w-4" />,
  'MEP': <Zap className="h-4 w-4" />,
  'Life Safety': <Shield className="h-4 w-4" />,
  'General': <Book className="h-4 w-4" />,
  'Energy': <Leaf className="h-4 w-4" />,
  'Plumbing': <Droplets className="h-4 w-4" />,
  'Mechanical': <Wind className="h-4 w-4" />,
  'Residential': <Home className="h-4 w-4" />,
  'Seismic': <AlertTriangle className="h-4 w-4" />,
  'Climate': <Snowflake className="h-4 w-4" />,
  'Coastal': <Waves className="h-4 w-4" />,
};

const jurisdictionCodes: JurisdictionCode[] = [
  // ============ MODEL CODES ============
  {
    id: 'ibc-2024',
    name: 'International Building Code',
    abbreviation: 'IBC 2024',
    baseCode: 'IBC 2024',
    adoptedYear: '2024',
    codeType: 'model',
    description: 'The model building code developed by ICC, serving as the basis for building regulations across all 50 U.S. states.',
    officialUrl: 'https://codes.iccsafe.org/content/IBC2024P1',
    keyDifferences: [],
    sections: [
      { id: 'ibc-101', section: 'IBC 101', title: 'Scope and Administration', summary: 'General administrative provisions including scope, purpose, and applicability.', details: 'Establishes the scope of the code, its purpose to safeguard public health and safety, and administrative procedures for enforcement.', category: 'General', keywords: ['scope', 'administration', 'purpose', 'applicability'] },
      { id: 'ibc-302', section: 'IBC 302', title: 'Fire-Resistance Ratings', summary: 'Fire-resistance ratings for building elements based on construction type.', details: 'Specifies fire-resistance requirements for structural elements, exterior walls, and fire barriers based on construction type and occupancy.', category: 'Fire Safety', keywords: ['fire-resistance', 'ratings', 'hours', 'fire barriers'] },
      { id: 'ibc-303', section: 'IBC 303', title: 'Occupancy Classification', summary: 'Classification of buildings by occupancy use groups A through U.', details: 'Defines occupancy groups including assembly, business, educational, factory, hazardous, institutional, mercantile, residential, storage, and utility.', category: 'General', keywords: ['occupancy', 'classification', 'use groups', 'assembly', 'residential'] },
      { id: 'ibc-504', section: 'IBC 504', title: 'Building Height', summary: 'Allowable building heights by construction type.', details: 'Establishes maximum allowable building heights in feet and stories based on occupancy classification and construction type.', category: 'General', keywords: ['height', 'stories', 'feet', 'maximum'] },
      { id: 'ibc-506', section: 'IBC 506', title: 'Building Area Modifications', summary: 'Allowable area increases for frontage and sprinklers.', details: 'Provides methods for increasing allowable building area through frontage increases, automatic sprinkler system installation, and unlimited area provisions.', category: 'General', keywords: ['area', 'frontage', 'sprinklers', 'unlimited'] },
      { id: 'ibc-602', section: 'IBC 602', title: 'Construction Classification', summary: 'Types of construction I through V.', details: 'Defines construction types based on fire-resistance ratings: Type I (most fire-resistant), Type II, Type III, Type IV (mass timber), and Type V.', category: 'Fire Safety', keywords: ['construction type', 'fire-resistant', 'mass timber', 'noncombustible'] },
      { id: 'ibc-903', section: 'IBC 903', title: 'Automatic Sprinkler Systems', summary: 'Requirements for automatic fire sprinkler systems.', details: 'Required in Group A with occupant load >100, Group E, Group F-1 >12,000 sq ft, Group H, Group I, Group M >12,000 sq ft, Group R, Group S-1 >12,000 sq ft, and high-rise buildings.', category: 'Fire Safety', keywords: ['sprinkler', 'fire suppression', 'NFPA 13', 'automatic'] },
      { id: 'ibc-907', section: 'IBC 907', title: 'Fire Alarm Systems', summary: 'Fire alarm and detection system requirements.', details: 'Manual fire alarm required in Group A >300 occupants, Group B >500 occupants or 3+ stories, Group E, Group F >500 occupants, Group H, Group I, Group M >500 occupants, Group R-1.', category: 'Fire Safety', keywords: ['fire alarm', 'detection', 'notification', 'smoke detector'] },
      { id: 'ibc-1001', section: 'IBC 1001', title: 'Means of Egress', summary: 'General requirements for means of egress.', details: 'Establishes requirements for safe egress from buildings including exit access, exits, exit discharge, and accessible means of egress.', category: 'Egress', keywords: ['egress', 'exit', 'escape', 'evacuation', 'accessible'] },
      { id: 'ibc-1004', section: 'IBC 1004', title: 'Occupant Load', summary: 'Calculation of occupant load for egress.', details: 'The occupant load is calculated by dividing floor area by occupant load factor. Assembly areas use 5-15 sq ft per occupant depending on use.', category: 'Egress', keywords: ['occupant load', 'egress capacity', 'assembly', 'floor area'] },
      { id: 'ibc-1005', section: 'IBC 1005', title: 'Means of Egress Sizing', summary: 'Egress width requirements based on occupant load.', details: 'Stairways: 0.3 inch per occupant (sprinklered) or 0.2 inch (unsprinklered). Other components: 0.2 inch per occupant (sprinklered) or 0.15 inch (unsprinklered).', category: 'Egress', keywords: ['egress width', 'stair width', 'door width', 'corridor'] },
      { id: 'ibc-1006', section: 'IBC 1006', title: 'Number of Exits', summary: 'Minimum number of exits based on occupant load.', details: 'Spaces with 1-500 occupants require 2 exits. 501-1000 require 3 exits. Over 1000 require 4 exits. Single exits permitted for certain limited occupancies.', category: 'Egress', keywords: ['number of exits', 'exit access', 'travel distance'] },
      { id: 'ibc-1017', section: 'IBC 1017', title: 'Exit Access Travel Distance', summary: 'Maximum travel distance to reach an exit.', details: 'Without sprinklers: 200 ft (most), 250 ft (B, F, S). With sprinklers: 250 ft (most), 300 ft (B), 400 ft (F-1, S-1). Measured along natural path.', category: 'Egress', keywords: ['travel distance', 'exit access', 'path of travel'] },
      { id: 'ibc-1104', section: 'IBC 1104', title: 'Accessible Routes', summary: 'Requirements for accessible paths of travel.', details: 'At least one accessible route shall connect accessible building entrances with all accessible spaces and elements.', category: 'Accessibility', keywords: ['accessible route', 'path of travel', 'ADA', 'wheelchair'] },
      { id: 'ibc-1107', section: 'IBC 1107', title: 'Dwelling Units and Sleeping Units', summary: 'Accessibility requirements for dwelling units.', details: 'Requirements for Type A units (2%), Type B units (per Fair Housing), and communication features in dwelling and sleeping units.', category: 'Accessibility', keywords: ['dwelling', 'accessible', 'Type A', 'Type B', 'fair housing'] },
      { id: 'ibc-1604', section: 'IBC 1604', title: 'General Structural Design', summary: 'General requirements for structural design.', details: 'Buildings shall be designed to support all loads per ASCE 7. Dead loads, live loads, roof loads, wind loads, seismic loads.', category: 'Structural', keywords: ['structural', 'load', 'ASCE 7', 'design'] },
      { id: 'ibc-1609', section: 'IBC 1609', title: 'Wind Loads', summary: 'Design requirements for wind loads.', details: 'Wind loads per ASCE 7. Basic wind speeds based on location and risk category. Wind-borne debris protection in hurricane regions.', category: 'Structural', keywords: ['wind load', 'hurricane', 'ASCE 7', 'debris'] },
      { id: 'ibc-1613', section: 'IBC 1613', title: 'Earthquake Loads', summary: 'Seismic design requirements.', details: 'Seismic design categories A through F based on soil type, seismic zone, and risk category. Requirements increase with SDC.', category: 'Seismic', keywords: ['seismic', 'earthquake', 'SDC', 'lateral'] },
    ]
  },
  {
    id: 'irc-2024',
    name: 'International Residential Code',
    abbreviation: 'IRC 2024',
    baseCode: 'IRC 2024',
    adoptedYear: '2024',
    codeType: 'model',
    description: 'Comprehensive code for one- and two-family dwellings and townhouses up to three stories.',
    officialUrl: 'https://codes.iccsafe.org/content/IRC2024P1',
    keyDifferences: [],
    sections: [
      { id: 'irc-r301', section: 'IRC R301', title: 'Design Criteria', summary: 'Structural design criteria for residential buildings.', details: 'Climate zones, seismic design categories, wind design, and snow loads for residential construction.', category: 'Structural', keywords: ['design', 'climate', 'seismic', 'wind', 'snow'] },
      { id: 'irc-r302', section: 'IRC R302', title: 'Fire-Resistant Construction', summary: 'Fire separation and protection requirements.', details: 'Dwelling unit separation, garage separation, membrane penetrations, and fire-resistant construction assemblies.', category: 'Fire Safety', keywords: ['fire separation', 'garage', 'dwelling separation'] },
      { id: 'irc-r311', section: 'IRC R311', title: 'Means of Egress', summary: 'Emergency escape and rescue openings.', details: 'Requirements for emergency escape openings, doors, hallways, stairways, and landings in dwellings.', category: 'Egress', keywords: ['egress', 'escape', 'rescue', 'emergency'] },
      { id: 'irc-r403', section: 'IRC R403', title: 'Footings', summary: 'Foundation footing requirements.', details: 'Minimum footing depth, width, and reinforcement based on soil conditions and wall loading.', category: 'Structural', keywords: ['footing', 'foundation', 'depth', 'width'] },
      { id: 'irc-r502', section: 'IRC R502', title: 'Wood Floor Framing', summary: 'Floor framing lumber and spans.', details: 'Requirements for floor joists, girders, blocking, and floor sheathing in wood-framed construction.', category: 'Structural', keywords: ['floor', 'joist', 'framing', 'span', 'lumber'] },
      { id: 'irc-r802', section: 'IRC R802', title: 'Wood Roof Framing', summary: 'Roof framing and rafter requirements.', details: 'Ceiling joists, rafters, ridge boards, collar ties, and roof sheathing requirements.', category: 'Structural', keywords: ['roof', 'rafter', 'ceiling joist', 'ridge'] },
    ]
  },
  {
    id: 'iecc-2024',
    name: 'International Energy Conservation Code',
    abbreviation: 'IECC 2024',
    baseCode: 'IECC 2024',
    adoptedYear: '2024',
    codeType: 'model',
    description: 'Energy efficiency code establishing minimum requirements for energy-efficient buildings.',
    officialUrl: 'https://codes.iccsafe.org/content/IECC2024P1',
    keyDifferences: [],
    sections: [
      { id: 'iecc-c402', section: 'IECC C402', title: 'Building Envelope Requirements', summary: 'Thermal envelope requirements for commercial buildings.', details: 'Insulation R-values, fenestration U-factors, and air barrier requirements for commercial building envelopes.', category: 'Energy', keywords: ['insulation', 'R-value', 'U-factor', 'envelope', 'thermal'] },
      { id: 'iecc-c403', section: 'IECC C403', title: 'HVAC Systems', summary: 'Mechanical system efficiency requirements.', details: 'Equipment efficiency, controls, economizers, and duct sealing requirements for commercial HVAC.', category: 'Mechanical', keywords: ['HVAC', 'efficiency', 'economizer', 'duct sealing'] },
      { id: 'iecc-c405', section: 'IECC C405', title: 'Electrical Power and Lighting', summary: 'Lighting power density and controls.', details: 'Interior and exterior lighting power allowances, daylight responsive controls, and occupancy sensors.', category: 'Energy', keywords: ['lighting', 'LPD', 'controls', 'occupancy sensor'] },
      { id: 'iecc-r402', section: 'IECC R402', title: 'Residential Building Envelope', summary: 'Insulation and fenestration requirements.', details: 'Prescriptive insulation R-values and fenestration U-factors by climate zone for residential buildings.', category: 'Energy', keywords: ['residential', 'insulation', 'R-value', 'fenestration'] },
    ]
  },
  {
    id: 'ifc-2024',
    name: 'International Fire Code',
    abbreviation: 'IFC 2024',
    baseCode: 'IFC 2024',
    adoptedYear: '2024',
    codeType: 'model',
    description: 'Comprehensive fire code covering fire prevention, fire protection systems, and hazardous materials.',
    officialUrl: 'https://codes.iccsafe.org/content/IFC2024P1',
    keyDifferences: [],
    sections: [
      { id: 'ifc-901', section: 'IFC 901', title: 'Fire Protection Systems', summary: 'General fire protection system requirements.', details: 'Installation, inspection, testing, and maintenance requirements for fire protection systems.', category: 'Fire Safety', keywords: ['fire protection', 'sprinkler', 'alarm', 'standpipe'] },
      { id: 'ifc-903', section: 'IFC 903', title: 'Automatic Sprinkler Systems', summary: 'Where sprinklers are required.', details: 'Thresholds for automatic sprinkler installation based on occupancy and building characteristics.', category: 'Fire Safety', keywords: ['sprinkler', 'NFPA 13', 'threshold', 'required'] },
      { id: 'ifc-907', section: 'IFC 907', title: 'Fire Alarm Systems', summary: 'Fire alarm and detection requirements.', details: 'Requirements for fire alarm systems, smoke detection, notification appliances, and monitoring.', category: 'Fire Safety', keywords: ['fire alarm', 'smoke detector', 'notification', 'monitoring'] },
      { id: 'ifc-2701', section: 'IFC 2701', title: 'Hazardous Materials', summary: 'General hazardous materials provisions.', details: 'Classification, storage, handling, and dispensing requirements for hazardous materials.', category: 'Fire Safety', keywords: ['hazardous materials', 'storage', 'handling', 'classification'] },
    ]
  },
  {
    id: 'ipc-2024',
    name: 'International Plumbing Code',
    abbreviation: 'IPC 2024',
    baseCode: 'IPC 2024',
    adoptedYear: '2024',
    codeType: 'model',
    description: 'Comprehensive plumbing code covering water supply, drainage, and fixtures.',
    officialUrl: 'https://codes.iccsafe.org/content/IPC2024P1',
    keyDifferences: [],
    sections: [
      { id: 'ipc-403', section: 'IPC 403', title: 'Minimum Plumbing Facilities', summary: 'Required number of plumbing fixtures.', details: 'Minimum fixture counts based on occupancy type and occupant load.', category: 'Plumbing', keywords: ['fixtures', 'minimum', 'occupancy', 'restroom'] },
      { id: 'ipc-604', section: 'IPC 604', title: 'Water Distribution Design', summary: 'Water supply system sizing.', details: 'Sizing methods for water supply piping based on fixture units and pressure requirements.', category: 'Plumbing', keywords: ['water supply', 'sizing', 'pressure', 'fixture units'] },
      { id: 'ipc-710', section: 'IPC 710', title: 'Drainage System Sizing', summary: 'DWV pipe sizing requirements.', details: 'Drain, waste, and vent pipe sizing based on drainage fixture units.', category: 'Plumbing', keywords: ['drainage', 'DWV', 'sizing', 'DFU'] },
    ]
  },
  {
    id: 'imc-2024',
    name: 'International Mechanical Code',
    abbreviation: 'IMC 2024',
    baseCode: 'IMC 2024',
    adoptedYear: '2024',
    codeType: 'model',
    description: 'Mechanical code covering HVAC systems, exhaust, ducts, and equipment.',
    officialUrl: 'https://codes.iccsafe.org/content/IMC2024P1',
    keyDifferences: [],
    sections: [
      { id: 'imc-401', section: 'IMC 401', title: 'General Ventilation', summary: 'Ventilation system requirements.', details: 'Outdoor air ventilation requirements, natural and mechanical ventilation options.', category: 'Mechanical', keywords: ['ventilation', 'outdoor air', 'mechanical', 'natural'] },
      { id: 'imc-501', section: 'IMC 501', title: 'Exhaust Systems', summary: 'Exhaust system requirements.', details: 'Requirements for exhaust including kitchen, bathroom, and hazardous exhaust.', category: 'Mechanical', keywords: ['exhaust', 'kitchen', 'bathroom', 'hazardous'] },
      { id: 'imc-603', section: 'IMC 603', title: 'Duct Construction', summary: 'Duct material and installation.', details: 'Duct construction materials, joints, sealing, and support requirements.', category: 'Mechanical', keywords: ['duct', 'construction', 'sealing', 'materials'] },
    ]
  },

  // ============ MAJOR CITY CODES ============
  {
    id: 'nyc',
    name: 'New York City Building Code',
    abbreviation: 'NYC BC',
    baseCode: 'NYC Building Code 2022',
    adoptedYear: '2022',
    state: 'New York',
    codeType: 'city',
    description: 'New York City has its own comprehensive building code with extensive local requirements for high-rise and dense urban construction.',
    officialUrl: 'https://www1.nyc.gov/site/buildings/codes/codes.page',
    keyDifferences: [
      'Sprinklers required in ALL new buildings regardless of size',
      'Egress capacity: 0.2" per occupant for stairs (vs IBC 0.3")',
      '5% Type A accessible units (vs IBC 2%)',
      'High-rise requirements start at 75 ft',
      'Local Law 97 carbon emissions compliance',
      'FISP facade inspection requirements'
    ],
    sections: [
      { id: 'nyc-903', section: 'NYC BC 903.2', title: 'Automatic Sprinklers', summary: 'Sprinklers required in ALL new buildings.', details: 'NYC requires automatic sprinkler systems in all new buildings regardless of size or occupancy. Most restrictive in the U.S.', category: 'Fire Safety', keywords: ['sprinkler', 'fire protection', 'all buildings'] },
      { id: 'nyc-1005', section: 'NYC BC 1005.1', title: 'Egress Capacity', summary: 'Different egress capacity factors than IBC.', details: 'NYC uses 0.2 inch per occupant for stairways. This results in wider required stair widths for same occupant loads.', category: 'Egress', keywords: ['egress capacity', 'stair width', 'occupant load'] },
      { id: 'nyc-403', section: 'NYC BC 403', title: 'High-Rise Buildings', summary: 'Requirements for buildings over 75 feet.', details: 'Includes fire command center, stair pressurization, emergency voice/alarm, and additional structural fire resistance.', category: 'Fire Safety', keywords: ['high-rise', 'fire command', 'pressurization'] },
      { id: 'nyc-1107', section: 'NYC BC 1107', title: 'Accessible Dwelling Units', summary: '5% of units must be Type A accessible.', details: 'NYC requires 5% of dwelling units to be Type A accessible, more stringent than IBC 2%.', category: 'Accessibility', keywords: ['accessible units', 'Type A', 'multifamily'] },
      { id: 'nyc-ll97', section: 'Local Law 97', title: 'Carbon Emissions', summary: 'Building carbon emission limits.', details: 'Buildings over 25,000 sq ft must meet carbon emission limits starting 2024. Fines for non-compliance.', category: 'Energy', keywords: ['carbon', 'emissions', 'climate', 'sustainability'] },
      { id: 'nyc-fisp', section: 'FISP (LL11)', title: 'Facade Inspection', summary: 'Periodic facade inspections required.', details: 'Buildings over 6 stories require facade inspections every 5 years by qualified exterior wall inspector.', category: 'Structural', keywords: ['facade', 'FISP', 'inspection', 'exterior wall'] },
    ]
  },
  {
    id: 'chicago',
    name: 'Chicago Building Code',
    abbreviation: 'Chicago BC',
    baseCode: 'Chicago Municipal Code',
    adoptedYear: '2023',
    state: 'Illinois',
    codeType: 'city',
    description: "Chicago has its own comprehensive building code, separate from IBC, with specific requirements for the city's unique conditions.",
    officialUrl: 'https://www.chicago.gov/city/en/depts/bldgs.html',
    keyDifferences: [
      'Separate code from IBC (not IBC-based)',
      'High-rise requirements at 80 ft (vs 75 ft IBC)',
      'Chicago-specific wind load requirements',
      'Foundation requirements for Chicago soil',
      'Freight elevator requirements in commercial'
    ],
    sections: [
      { id: 'chi-13-160', section: 'Chicago BC 13-160', title: 'Corridor Requirements', summary: 'Corridor widths and egress requirements.', details: 'Minimum 44-inch corridor width, increasing to 66 inches for schools. Exit stair requirements differ from IBC.', category: 'Egress', keywords: ['corridor', 'width', 'school', 'egress'] },
      { id: 'chi-15-16', section: 'Chicago BC 15-16', title: 'High-Rise Sprinklers', summary: 'Sprinkler requirements for buildings over 80 ft.', details: 'Chicago defines high-rise at 80 feet. All high-rise buildings require sprinklers with standpipe connections.', category: 'Fire Safety', keywords: ['high-rise', 'sprinkler', 'standpipe', '80 feet'] },
      { id: 'chi-13-132', section: 'Chicago BC 13-132', title: 'Wind Load Design', summary: 'Chicago-specific wind requirements.', details: 'Specific wind load requirements for lakefront location and urban wind patterns.', category: 'Structural', keywords: ['wind', 'lakefront', 'structural', 'Chicago'] },
    ]
  },
  {
    id: 'la-city',
    name: 'Los Angeles Building Code',
    abbreviation: 'LABC',
    baseCode: 'CBC 2022 with LA amendments',
    adoptedYear: '2023',
    state: 'California',
    codeType: 'city',
    description: 'Los Angeles adopts CBC with additional local amendments for seismic safety and fire hazards.',
    officialUrl: 'https://www.ladbs.org/',
    keyDifferences: [
      'Mandatory retrofit for soft-story buildings',
      'Non-ductile concrete building retrofit program',
      'Hillside construction requirements',
      'Very High Fire Hazard Severity Zone requirements',
      'LA-specific accessibility requirements'
    ],
    sections: [
      { id: 'la-soft', section: 'LABC 91.9', title: 'Soft-Story Retrofit', summary: 'Mandatory retrofit for vulnerable buildings.', details: 'Wood-frame soft-story buildings must be retrofitted. Applies to pre-1978 buildings with tuck-under parking.', category: 'Seismic', keywords: ['soft-story', 'retrofit', 'seismic', 'mandatory'] },
      { id: 'la-ndc', section: 'LABC Ordinance 186652', title: 'Non-Ductile Concrete', summary: 'Concrete building retrofit requirements.', details: 'Pre-1976 non-ductile concrete buildings require seismic evaluation and potential retrofit.', category: 'Seismic', keywords: ['concrete', 'retrofit', 'non-ductile', 'seismic'] },
      { id: 'la-hillside', section: 'LABC 91.106.4', title: 'Hillside Construction', summary: 'Requirements for hillside development.', details: 'Special foundation, drainage, and grading requirements for construction on slopes.', category: 'Structural', keywords: ['hillside', 'slope', 'grading', 'foundation'] },
    ]
  },

  // ============ STATE CODES ============
  {
    id: 'california',
    name: 'California Building Code',
    abbreviation: 'CBC',
    baseCode: 'IBC 2021 with CA amendments (Title 24, Part 2)',
    adoptedYear: '2022',
    state: 'California',
    codeType: 'state',
    description: 'California adopts IBC with extensive amendments for accessibility, seismic design, and energy efficiency.',
    officialUrl: 'https://www.dgs.ca.gov/BSC/Codes',
    keyDifferences: [
      'Most restrictive accessibility requirements in U.S. (CBC 11B)',
      'California-specific seismic design requirements',
      'Title 24 Energy Code (most stringent in U.S.)',
      'CALGreen mandatory green building standards',
      'Wildland-Urban Interface fire requirements',
      'OSHPD hospital seismic requirements'
    ],
    sections: [
      { id: 'cbc-11b', section: 'CBC 11B-206.2.1', title: 'Accessible Routes from Parking', summary: 'Accessible routes required from ALL parking spaces.', details: 'California requires accessible routes from all parking spaces, not just designated accessible spaces. Unique to California.', category: 'Accessibility', keywords: ['accessible route', 'parking', 'path of travel'] },
      { id: 'cbc-11b-403', section: 'CBC 11B-403.5.1', title: 'Corridor Width', summary: 'Minimum corridor width 48 inches clear.', details: 'CBC requires 48-inch clear corridor width, stricter than IBC 44-inch requirement.', category: 'Accessibility', keywords: ['corridor', 'width', 'accessible route'] },
      { id: 'cbc-1613', section: 'CBC 1613', title: 'Seismic Design', summary: 'California-specific seismic requirements.', details: 'Enhanced seismic design beyond base IBC. Site-specific ground motion for many buildings.', category: 'Seismic', keywords: ['seismic', 'earthquake', 'structural', 'OSHPD'] },
      { id: 'cbc-7a', section: 'CBC Chapter 7A', title: 'Wildland-Urban Interface', summary: 'Fire-resistive construction in WUI zones.', details: 'Enhanced fire resistance including ignition-resistant materials, defensible space, and specific construction methods.', category: 'Fire Safety', keywords: ['wildfire', 'WUI', 'fire resistant', 'ignition'] },
      { id: 'cbc-calgreen', section: 'CALGreen (Title 24, Part 11)', title: 'Green Building Standards', summary: 'Mandatory green building requirements.', details: '20% water reduction, 65% construction waste diversion, low-emitting materials, EV charging infrastructure.', category: 'Energy', keywords: ['green building', 'sustainability', 'LEED', 'energy'] },
    ]
  },
  {
    id: 'dc',
    name: 'Washington D.C. Construction Codes',
    abbreviation: '12A DCMR',
    baseCode: 'IBC 2021 with D.C. amendments',
    adoptedYear: '2021',
    state: 'District of Columbia',
    codeType: 'state',
    description: 'D.C. adopts IBC with significant local amendments for accessibility and historic preservation.',
    officialUrl: 'https://dcra.dc.gov/construction-codes',
    keyDifferences: [
      'Corridor width minimum 48" (vs IBC 44")',
      '10% Type A accessible units (vs IBC 2%)',
      'Sprinklers required in buildings over 5,000 sq ft',
      'Fire alarm required at 3 stories (vs IBC 4)',
      'Historic preservation requirements in L\'Enfant Plan zones',
      'DOEE stormwater management requirements'
    ],
    sections: [
      { id: 'dc-1017', section: '12A DCMR 1017.2', title: 'Corridor Width', summary: 'Minimum corridor width increased to 48 inches.', details: 'D.C. requires 48-inch corridor width for all occupancies, stricter than IBC 44-inch.', category: 'Egress', keywords: ['corridor', 'width', 'egress', 'passageway'] },
      { id: 'dc-903', section: '12A DCMR 903.2.1', title: 'Automatic Sprinklers', summary: 'Sprinklers in all new buildings over 5,000 sq ft.', details: 'Automatic sprinklers required in all new buildings exceeding 5,000 sq ft regardless of occupancy.', category: 'Fire Safety', keywords: ['sprinkler', 'fire protection', 'automatic'] },
      { id: 'dc-1103', section: '12A DCMR 1103.2.2', title: 'Type A Accessible Units', summary: '10% of dwelling units must be Type A accessible.', details: '10% of dwelling units in multi-family must be Type A accessible. Most stringent in U.S.', category: 'Accessibility', keywords: ['accessible units', 'Type A', 'dwelling', 'multifamily'] },
      { id: 'dc-3412', section: '12A DCMR 3412', title: 'Historic Buildings', summary: 'HPRB approval required in historic districts.', details: 'Work in Historic Districts requires HPRB approval. Additional requirements in L\'Enfant Plan zones.', category: 'General', keywords: ['historic', 'preservation', 'HPRB', 'landmark'] },
      { id: 'dc-stormwater', section: '21 DCMR 5', title: 'Stormwater Management', summary: 'DOEE stormwater requirements.', details: 'Stormwater retention, green infrastructure, and erosion control requirements for construction sites.', category: 'General', keywords: ['stormwater', 'DOEE', 'retention', 'green infrastructure'] },
    ]
  },
  {
    id: 'florida',
    name: 'Florida Building Code',
    abbreviation: 'FBC',
    baseCode: 'IBC 2021 with FL amendments (8th Edition)',
    adoptedYear: '2023',
    state: 'Florida',
    codeType: 'state',
    description: 'Florida adopts IBC with significant amendments for hurricane and flood resistance.',
    officialUrl: 'https://floridabuilding.org/',
    keyDifferences: [
      'High-Velocity Hurricane Zone (HVHZ) requirements',
      'Wind speeds up to 180 mph in coastal areas',
      'Impact-resistant glazing requirements',
      'Enhanced flood construction requirements',
      'Pool safety requirements',
      'Termite protection requirements'
    ],
    sections: [
      { id: 'fbc-1609', section: 'FBC 1609', title: 'Wind Loads - HVHZ', summary: 'Enhanced wind design for hurricane zones.', details: 'HVHZ covers Miami-Dade and Broward with wind speeds up to 180 mph. Special product approvals required.', category: 'Structural', keywords: ['wind', 'hurricane', 'HVHZ', 'Miami-Dade'] },
      { id: 'fbc-1609-debris', section: 'FBC 1609.1.2', title: 'Wind-Borne Debris Protection', summary: 'Impact-resistant glazing or shutters required.', details: 'Products must pass large and small missile impact tests per Florida testing protocols.', category: 'Structural', keywords: ['debris', 'impact', 'shutters', 'glazing'] },
      { id: 'fbc-3109', section: 'FBC 3109', title: 'Coastal Construction', summary: 'Requirements for buildings in flood zones.', details: 'V-zone buildings must be elevated with breakaway walls below. A-zone has additional requirements.', category: 'Coastal', keywords: ['flood', 'coastal', 'V-zone', 'elevation'] },
      { id: 'fbc-454', section: 'FBC 454', title: 'Residential Pool Safety', summary: 'Pool barrier and safety requirements.', details: '4-foot minimum barrier height with self-latching gates. Door alarms or safety covers required.', category: 'Life Safety', keywords: ['pool', 'barrier', 'safety', 'residential'] },
    ]
  },
  {
    id: 'texas',
    name: 'Texas Building Codes',
    abbreviation: 'TX Local',
    baseCode: 'IBC 2021 (varies by jurisdiction)',
    adoptedYear: '2021',
    state: 'Texas',
    codeType: 'state',
    description: 'Texas has no mandatory statewide code; local jurisdictions adopt codes individually with local amendments.',
    officialUrl: 'https://www.tdlr.texas.gov/',
    keyDifferences: [
      'No mandatory statewide code',
      'Local adoption varies significantly',
      'Major cities use IBC with local amendments',
      'Texas Accessibility Standards (TAS)',
      'Houston, Dallas, Austin have unique amendments'
    ],
    sections: [
      { id: 'tx-tas', section: 'TAS', title: 'Texas Accessibility Standards', summary: 'State accessibility requirements.', details: 'Texas-specific accessibility that supplements or exceeds ADA requirements.', category: 'Accessibility', keywords: ['accessibility', 'TAS', 'Texas', 'ADA'] },
      { id: 'tx-houston', section: 'Houston Amendments', title: 'Houston Amendments', summary: 'City of Houston specific provisions.', details: 'Houston-specific amendments including enhanced flood provisions and hurricane resistance.', category: 'General', keywords: ['Houston', 'amendments', 'flood', 'hurricane'] },
    ]
  },
  {
    id: 'massachusetts',
    name: 'Massachusetts State Building Code',
    abbreviation: 'MA 780 CMR',
    baseCode: 'IBC 2021 with MA amendments',
    adoptedYear: '2024',
    state: 'Massachusetts',
    codeType: 'state',
    description: 'Massachusetts statewide code with amendments for accessibility, energy, and specialized stretch energy code.',
    officialUrl: 'https://www.mass.gov/780-cmr-massachusetts-state-building-code',
    keyDifferences: [
      '780 CMR structure',
      'Massachusetts AAB accessibility',
      'Stretch Energy Code option for municipalities',
      'Specialized net-zero code option',
      'Snow load requirements for New England'
    ],
    sections: [
      { id: 'ma-aab', section: '521 CMR', title: 'Architectural Access Board', summary: 'Massachusetts accessibility requirements.', details: 'State accessibility by Architectural Access Board, often more stringent than ADA.', category: 'Accessibility', keywords: ['accessibility', 'AAB', 'Massachusetts', '521 CMR'] },
      { id: 'ma-stretch', section: 'Stretch Code', title: 'Stretch Energy Code', summary: 'Optional enhanced energy code.', details: 'More stringent energy code municipalities can adopt to exceed base code requirements.', category: 'Energy', keywords: ['stretch code', 'energy', 'net-zero', 'municipal'] },
      { id: 'ma-snow', section: '780 CMR 1608', title: 'Snow Loads', summary: 'Massachusetts snow load requirements.', details: 'Ground snow loads specific to Massachusetts regions, ranging from 40 to 70 psf.', category: 'Climate', keywords: ['snow', 'ground snow', 'psf', 'New England'] },
    ]
  },
  {
    id: 'washington',
    name: 'Washington State Building Code',
    abbreviation: 'WA SBC',
    baseCode: 'IBC 2018 with WA amendments',
    adoptedYear: '2021',
    state: 'Washington',
    codeType: 'state',
    description: 'Washington State code with amendments for seismic design, energy, and mass timber construction.',
    officialUrl: 'https://sbcc.wa.gov/state-codes-regulations-guidelines',
    keyDifferences: [
      'Seattle often adopts ahead of state cycle',
      'Enhanced seismic for Pacific Northwest',
      'Washington State Energy Code (WSEC)',
      'Mass timber construction provisions',
      'Snow loads for Cascades'
    ],
    sections: [
      { id: 'wa-1613', section: 'WA 1613', title: 'Earthquake Loads', summary: 'Washington seismic requirements.', details: 'Enhanced seismic for Pacific Northwest including site-specific ground motion for Cascadia Subduction Zone.', category: 'Seismic', keywords: ['seismic', 'earthquake', 'Pacific Northwest', 'Cascadia'] },
      { id: 'wa-wsec', section: 'WSEC', title: 'Washington Energy Code', summary: 'State energy code requirements.', details: 'Washington-specific energy code that may exceed IECC in certain provisions.', category: 'Energy', keywords: ['energy', 'WSEC', 'Washington', 'efficiency'] },
      { id: 'wa-504', section: 'WA 504', title: 'Mass Timber Height', summary: 'Washington mass timber provisions.', details: 'Provisions for mass timber that may allow greater heights than base IBC.', category: 'General', keywords: ['mass timber', 'CLT', 'height', 'Type IV'] },
    ]
  },
  {
    id: 'oregon',
    name: 'Oregon Structural Specialty Code',
    abbreviation: 'OSSC',
    baseCode: 'IBC 2021 with OR amendments',
    adoptedYear: '2022',
    state: 'Oregon',
    codeType: 'state',
    description: 'Oregon code with amendments for seismic design, mass timber, and energy efficiency.',
    officialUrl: 'https://www.oregon.gov/bcd/codes-stand/Pages/adopted-codes.aspx',
    keyDifferences: [
      'Enhanced Cascadia Subduction Zone seismic',
      'Mass timber construction leadership',
      'Oregon Energy Efficiency Specialty Code',
      'Reach Code for higher efficiency',
      'Portland amendments significant'
    ],
    sections: [
      { id: 'or-seismic', section: 'OSSC 1613', title: 'Seismic Design', summary: 'Oregon seismic requirements.', details: 'Enhanced seismic for Cascadia Subduction Zone, including site-specific ground motion.', category: 'Seismic', keywords: ['seismic', 'earthquake', 'Cascadia', 'Oregon'] },
      { id: 'or-mass-timber', section: 'OSSC 504', title: 'Mass Timber', summary: 'Oregon mass timber provisions.', details: 'Oregon has been a leader in tall mass timber construction provisions.', category: 'General', keywords: ['mass timber', 'CLT', 'Oregon', 'tall wood'] },
      { id: 'or-reach', section: 'Reach Code', title: 'Reach Code', summary: 'Enhanced energy efficiency option.', details: 'Optional enhanced energy code jurisdictions can adopt.', category: 'Energy', keywords: ['reach code', 'energy', 'efficiency', 'Oregon'] },
    ]
  },
  {
    id: 'colorado',
    name: 'Colorado Building Codes',
    abbreviation: 'CO Local',
    baseCode: 'IBC 2021 (varies)',
    adoptedYear: '2022',
    state: 'Colorado',
    codeType: 'state',
    description: 'Colorado building codes vary by jurisdiction, with Denver having comprehensive amendments.',
    officialUrl: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Community-Planning-and-Development/Building-Codes',
    keyDifferences: [
      'High-altitude HVAC adjustments',
      'Significant snow load requirements',
      'Denver Green Code requirements',
      'Radon mitigation requirements',
      'Solar-ready provisions'
    ],
    sections: [
      { id: 'co-snow', section: 'CO 1608', title: 'Snow Loads', summary: 'Colorado ground snow loads.', details: 'Ground snow load of 30 psf for Denver metro with higher loads for mountain areas.', category: 'Climate', keywords: ['snow', 'ground snow', 'Colorado', 'psf'] },
      { id: 'co-green', section: 'Denver Green Code', title: 'Denver Green Code', summary: 'Sustainable building requirements.', details: 'EV readiness, solar provisions, and cool roof requirements.', category: 'Energy', keywords: ['green', 'EV ready', 'solar', 'cool roof'] },
      { id: 'co-radon', section: 'Radon Mitigation', title: 'Radon Mitigation', summary: 'Radon-resistant construction.', details: 'Requirements for radon-resistant new construction including sub-slab ventilation.', category: 'Residential', keywords: ['radon', 'mitigation', 'sub-slab', 'ventilation'] },
    ]
  },
  {
    id: 'new-jersey',
    name: 'New Jersey Uniform Construction Code',
    abbreviation: 'NJ UCC',
    baseCode: 'IBC 2021 with NJ modifications',
    adoptedYear: '2021',
    state: 'New Jersey',
    codeType: 'state',
    description: 'New Jersey statewide code with amendments for coastal construction and accessibility.',
    officialUrl: 'https://www.nj.gov/dca/divisions/codes/codreg/ucc.html',
    keyDifferences: [
      'Statewide uniform adoption',
      'Barrier-free subcode (accessibility)',
      'Coastal construction requirements',
      'Rehabilitation subcode for existing buildings',
      'Radon hazard subcode'
    ],
    sections: [
      { id: 'nj-barrier', section: 'N.J.A.C. 5:23-7', title: 'Barrier Free Subcode', summary: 'NJ accessibility requirements.', details: 'New Jersey accessibility that supplements federal ADA standards.', category: 'Accessibility', keywords: ['accessibility', 'barrier free', 'New Jersey', 'ADA'] },
      { id: 'nj-coastal', section: 'Coastal', title: 'Coastal Construction', summary: 'Shore area construction.', details: 'Special requirements for coastal flood hazard areas.', category: 'Coastal', keywords: ['coastal', 'flood', 'shore', 'CAFRA'] },
      { id: 'nj-rehab', section: 'N.J.A.C. 5:23-6', title: 'Rehabilitation Subcode', summary: 'Existing building alterations.', details: 'Flexible provisions for alterations and changes of use in existing buildings.', category: 'General', keywords: ['rehabilitation', 'existing', 'alteration', 'repair'] },
    ]
  },
  {
    id: 'pennsylvania',
    name: 'Pennsylvania Uniform Construction Code',
    abbreviation: 'PA UCC',
    baseCode: 'IBC 2018 with PA amendments',
    adoptedYear: '2022',
    state: 'Pennsylvania',
    codeType: 'state',
    description: 'Pennsylvania statewide code with accessibility and administrative provisions.',
    officialUrl: 'https://www.dli.pa.gov/ucc/Pages/default.aspx',
    keyDifferences: [
      'Statewide code with local enforcement options',
      'Pennsylvania accessibility provisions',
      'Agricultural building exemptions',
      'Historic building provisions'
    ],
    sections: [
      { id: 'pa-access', section: 'PA Accessibility', title: 'PA Accessibility', summary: 'State accessibility requirements.', details: 'Pennsylvania-specific accessibility coordinated with ADA.', category: 'Accessibility', keywords: ['accessibility', 'Pennsylvania', 'ADA'] },
      { id: 'pa-ag', section: 'Agricultural', title: 'Agricultural Exemption', summary: 'Farm building provisions.', details: 'Exemptions and reduced requirements for agricultural buildings.', category: 'General', keywords: ['agricultural', 'farm', 'exemption', 'barn'] },
    ]
  },
  {
    id: 'georgia',
    name: 'Georgia State Minimum Standard Codes',
    abbreviation: 'GA Codes',
    baseCode: 'IBC 2018 with GA amendments',
    adoptedYear: '2022',
    state: 'Georgia',
    codeType: 'state',
    description: 'Georgia mandatory statewide codes with amendments for accessibility.',
    officialUrl: 'https://www.dca.ga.gov/building-construction/building-codes-rules',
    keyDifferences: [
      'Mandatory statewide adoption',
      'Georgia accessibility code',
      'Local amendments permitted to be more stringent',
      'Atlanta amendments are significant'
    ],
    sections: [
      { id: 'ga-access', section: '120-3-20', title: 'Georgia Accessibility', summary: 'State accessibility code.', details: 'Georgia-specific accessibility that may exceed ADA.', category: 'Accessibility', keywords: ['accessibility', 'Georgia', 'ADA'] },
    ]
  },
  {
    id: 'north-carolina',
    name: 'North Carolina State Building Code',
    abbreviation: 'NC SBC',
    baseCode: 'IBC 2021 with NC amendments',
    adoptedYear: '2024',
    state: 'North Carolina',
    codeType: 'state',
    description: 'North Carolina statewide code with amendments for coastal and hurricane requirements.',
    officialUrl: 'https://www.ncdoi.gov/osfm/building-codes',
    keyDifferences: [
      'Statewide uniform adoption',
      'Coastal construction requirements (CAMA)',
      'Wind design for hurricane zones',
      'NC accessibility code'
    ],
    sections: [
      { id: 'nc-coastal', section: 'NC Appendix G', title: 'Coastal Areas', summary: 'CAMA coastal requirements.', details: 'Construction requirements in Coastal Area Management Act areas.', category: 'Coastal', keywords: ['coastal', 'CAMA', 'hurricane', 'flood'] },
      { id: 'nc-wind', section: 'NC 1609', title: 'Wind Design', summary: 'Hurricane wind requirements.', details: 'Wind design requirements for coastal and inland areas.', category: 'Structural', keywords: ['wind', 'hurricane', 'design', 'coastal'] },
    ]
  },
  {
    id: 'virginia',
    name: 'Virginia Uniform Statewide Building Code',
    abbreviation: 'VA USBC',
    baseCode: 'IBC 2018 with VA amendments',
    adoptedYear: '2021',
    state: 'Virginia',
    codeType: 'state',
    description: 'Virginia statewide code with amendments for accessibility and coastal construction.',
    officialUrl: 'https://www.dhcd.virginia.gov/building-and-fire-regulations',
    keyDifferences: [
      'Statewide uniform code',
      'Virginia accessibility requirements',
      'Tidewater area flood provisions',
      'Radon-resistant construction'
    ],
    sections: [
      { id: 'va-access', section: 'VA Chapter 11', title: 'Accessibility', summary: 'Virginia accessibility code.', details: 'Virginia-specific accessibility coordinated with ADA and Fair Housing.', category: 'Accessibility', keywords: ['accessibility', 'Virginia', 'ADA', 'Fair Housing'] },
      { id: 'va-flood', section: 'VA Appendix G', title: 'Flood Protection', summary: 'Coastal and riverine flood provisions.', details: 'Requirements for construction in Special Flood Hazard Areas.', category: 'Coastal', keywords: ['flood', 'coastal', 'tidewater', 'SFHA'] },
    ]
  },
  {
    id: 'minnesota',
    name: 'Minnesota State Building Code',
    abbreviation: 'MN SBC',
    baseCode: 'IBC 2018 with MN amendments',
    adoptedYear: '2020',
    state: 'Minnesota',
    codeType: 'state',
    description: 'Minnesota statewide code with amendments for cold climate and accessibility.',
    officialUrl: 'https://www.dli.mn.gov/business/codes-and-laws/building-code',
    keyDifferences: [
      'Extreme cold climate provisions',
      'Minnesota Accessibility Code',
      'Stretch Energy Code (SB 2030)',
      'Significant snow load requirements',
      'Frost depth requirements (42-60 inches)'
    ],
    sections: [
      { id: 'mn-frost', section: 'MN 1809', title: 'Frost Depth', summary: 'Foundation frost protection.', details: 'Minimum footing depth for frost protection varying by region (42-60 inches).', category: 'Climate', keywords: ['frost', 'footing', 'depth', 'foundation'] },
      { id: 'mn-snow', section: 'MN 1608', title: 'Snow Loads', summary: 'Ground snow loads.', details: 'Ground snow loads up to 60 psf in northern Minnesota.', category: 'Climate', keywords: ['snow', 'ground snow', 'psf', 'Minnesota'] },
      { id: 'mn-energy', section: 'MN 1322', title: 'Minnesota Energy Code', summary: 'State energy requirements.', details: 'Minnesota-specific energy code often exceeding IECC.', category: 'Energy', keywords: ['energy', 'Minnesota', 'efficiency', 'SB 2030'] },
    ]
  },
  {
    id: 'ohio',
    name: 'Ohio Building Code',
    abbreviation: 'OBC',
    baseCode: 'IBC 2021 with OH amendments',
    adoptedYear: '2024',
    state: 'Ohio',
    codeType: 'state',
    description: 'Ohio statewide code with amendments for accessibility and radon protection.',
    officialUrl: 'https://com.ohio.gov/divisions-and-programs/industrial-compliance/ohio-building-code',
    keyDifferences: [
      'Ohio Board of Building Standards oversight',
      'Ohio accessibility requirements',
      'Radon-resistant new construction',
      'Historic building exceptions'
    ],
    sections: [
      { id: 'obc-radon', section: 'OBC Radon', title: 'Radon Protection', summary: 'Radon-resistant construction.', details: 'Radon-resistant new construction requirements in certain Ohio counties.', category: 'Residential', keywords: ['radon', 'Ohio', 'residential', 'mitigation'] },
      { id: 'obc-access', section: 'OAC 4101:1', title: 'Ohio Accessibility', summary: 'State accessibility code.', details: 'Ohio accessibility administered by Board of Building Standards.', category: 'Accessibility', keywords: ['accessibility', 'Ohio', 'OAC'] },
    ]
  },
  {
    id: 'michigan',
    name: 'Michigan Building Code',
    abbreviation: 'MBC',
    baseCode: 'IBC 2018 with MI amendments',
    adoptedYear: '2021',
    state: 'Michigan',
    codeType: 'state',
    description: 'Michigan statewide code with amendments for accessibility and climate.',
    officialUrl: 'https://www.michigan.gov/lara/bureau-list/bcc/codes',
    keyDifferences: [
      'Michigan Construction Code Commission oversight',
      'State accessibility requirements',
      'Snow load provisions for northern Michigan'
    ],
    sections: [
      { id: 'mi-snow', section: 'MBC 1608', title: 'Snow Loads', summary: 'Michigan ground snow loads.', details: 'Ground snow loads varying from 30 to 70 psf across Michigan.', category: 'Climate', keywords: ['snow', 'ground snow', 'Michigan', 'psf'] },
    ]
  },
  {
    id: 'maryland',
    name: 'Maryland Building Performance Standards',
    abbreviation: 'MD BPS',
    baseCode: 'IBC 2018 with MD amendments',
    adoptedYear: '2021',
    state: 'Maryland',
    codeType: 'state',
    description: 'Maryland statewide code with amendments for accessibility and coastal construction.',
    officialUrl: 'https://www.dllr.state.md.us/labor/build/',
    keyDifferences: [
      'Statewide minimum standards',
      'Local amendments permitted',
      'Maryland Accessibility Code',
      'Chesapeake Bay critical area provisions',
      'Montgomery County/Baltimore amendments significant'
    ],
    sections: [
      { id: 'md-access', section: 'COMAR 09.12.53', title: 'Accessibility', summary: 'Maryland accessibility requirements.', details: 'Maryland accessibility administered by Dept of Labor.', category: 'Accessibility', keywords: ['accessibility', 'Maryland', 'COMAR'] },
      { id: 'md-chesapeake', section: 'Chesapeake', title: 'Critical Area', summary: 'Chesapeake Bay protection.', details: 'Special requirements for Chesapeake Bay Critical Area construction.', category: 'Coastal', keywords: ['Chesapeake', 'critical area', 'buffer', 'waterfront'] },
    ]
  },
  {
    id: 'arizona',
    name: 'Arizona Building Codes',
    abbreviation: 'AZ Codes',
    baseCode: 'IBC 2018 (varies)',
    adoptedYear: '2018',
    state: 'Arizona',
    codeType: 'state',
    description: 'Arizona codes vary by jurisdiction, with Phoenix and Tucson having significant amendments.',
    officialUrl: 'https://azdire.gov/',
    keyDifferences: [
      'No mandatory statewide code',
      'Phoenix and Tucson have significant amendments',
      'Desert climate considerations',
      'Swimming pool safety requirements'
    ],
    sections: [
      { id: 'az-pools', section: 'Pool Safety', title: 'Swimming Pool Enclosure', summary: 'Pool barrier requirements.', details: 'Arizona-specific pool barriers and safety devices.', category: 'Life Safety', keywords: ['pool', 'barrier', 'safety', 'enclosure'] },
    ]
  },
  {
    id: 'nevada',
    name: 'Nevada State Codes',
    abbreviation: 'NV Codes',
    baseCode: 'IBC 2018 (varies)',
    adoptedYear: '2021',
    state: 'Nevada',
    codeType: 'state',
    description: 'Nevada codes vary by jurisdiction, with Clark County (Las Vegas) having comprehensive adoptions.',
    officialUrl: 'https://bsp.nv.gov/',
    keyDifferences: [
      'No mandatory statewide code',
      'Clark County uses IBC with local amendments',
      'Seismic provisions for Western Nevada'
    ],
    sections: [
      { id: 'nv-seismic', section: 'NV 1613', title: 'Seismic Design', summary: 'Nevada seismic zones.', details: 'Seismic design particularly for western Nevada near fault zones.', category: 'Seismic', keywords: ['seismic', 'Nevada', 'Las Vegas', 'Reno'] },
    ]
  },
  {
    id: 'louisiana',
    name: 'Louisiana State Uniform Construction Code',
    abbreviation: 'LA SUCC',
    baseCode: 'IBC 2021 with LA amendments',
    adoptedYear: '2022',
    state: 'Louisiana',
    codeType: 'state',
    description: 'Louisiana statewide code with amendments for hurricane resistance and coastal construction.',
    officialUrl: 'https://lsuccc.dps.louisiana.gov/',
    keyDifferences: [
      'Statewide mandatory adoption',
      'Enhanced hurricane provisions',
      'Coastal construction requirements',
      'New Orleans has additional amendments',
      'Flood-resistant construction'
    ],
    sections: [
      { id: 'la-wind', section: 'LA 1609', title: 'Wind Design', summary: 'Louisiana wind requirements.', details: 'Enhanced wind design up to 150+ mph for coastal areas.', category: 'Structural', keywords: ['wind', 'hurricane', 'Louisiana', 'coastal'] },
      { id: 'la-flood', section: 'LA 1612', title: 'Flood Loads', summary: 'Louisiana flood provisions.', details: 'Requirements for flood hazard areas, particularly relevant post-Katrina.', category: 'Coastal', keywords: ['flood', 'Louisiana', 'coastal', 'elevation'] },
    ]
  },
  {
    id: 'connecticut',
    name: 'Connecticut State Building Code',
    abbreviation: 'CT SBC',
    baseCode: 'IBC 2021 with CT amendments',
    adoptedYear: '2022',
    state: 'Connecticut',
    codeType: 'state',
    description: 'Connecticut statewide code with amendments for accessibility and coastal construction.',
    officialUrl: 'https://portal.ct.gov/DAS/Office-of-State-Building-Inspector',
    keyDifferences: [
      'Statewide uniform code',
      'Connecticut accessibility requirements',
      'Coastal flood provisions'
    ],
    sections: [
      { id: 'ct-coastal', section: 'CT Appendix G', title: 'Coastal Construction', summary: 'Long Island Sound provisions.', details: 'Requirements for coastal flood hazard areas.', category: 'Coastal', keywords: ['coastal', 'flood', 'Connecticut', 'Long Island Sound'] },
    ]
  },
  {
    id: 'hawaii',
    name: 'Hawaii State Building Code',
    abbreviation: 'HI SBC',
    baseCode: 'IBC 2012 with HI amendments',
    adoptedYear: '2018',
    state: 'Hawaii',
    codeType: 'state',
    description: 'Hawaii statewide code with amendments for hurricane, volcanic hazards, and coastal construction.',
    officialUrl: 'https://cca.hawaii.gov/hbc/',
    keyDifferences: [
      'County enforcement with state oversight',
      'Hurricane wind design requirements',
      'Volcanic hazard zones',
      'Tsunami and coastal provisions',
      'Trade winds and salt spray considerations'
    ],
    sections: [
      { id: 'hi-wind', section: 'HI 1609', title: 'Wind Design', summary: 'Hawaii hurricane wind requirements.', details: 'Wind design for Pacific hurricane conditions.', category: 'Structural', keywords: ['wind', 'hurricane', 'Hawaii', 'Pacific'] },
      { id: 'hi-volcanic', section: 'Volcanic', title: 'Volcanic Hazards', summary: 'Lava flow and volcanic areas.', details: 'Special provisions for construction in volcanic hazard zones.', category: 'General', keywords: ['volcanic', 'lava', 'hazard', 'Hawaii'] },
      { id: 'hi-tsunami', section: 'HI Appendix G', title: 'Tsunami/Coastal', summary: 'Tsunami and coastal provisions.', details: 'Requirements for tsunami evacuation zones and coastal areas.', category: 'Coastal', keywords: ['tsunami', 'coastal', 'flood', 'Hawaii'] },
    ]
  },
  {
    id: 'alaska',
    name: 'Alaska Building Code',
    abbreviation: 'AK BC',
    baseCode: 'IBC 2018 with AK amendments',
    adoptedYear: '2020',
    state: 'Alaska',
    codeType: 'state',
    description: 'Alaska code with amendments for extreme cold, seismic design, and permafrost.',
    officialUrl: 'https://www.commerce.alaska.gov/web/dcra/BuildingCodeRequirements.aspx',
    keyDifferences: [
      'Extreme cold climate provisions',
      'Enhanced seismic requirements',
      'Permafrost and frozen ground',
      'Snow loads up to 150+ psf'
    ],
    sections: [
      { id: 'ak-seismic', section: 'AK 1613', title: 'Seismic Design', summary: 'Alaska seismic requirements.', details: 'Enhanced seismic design for Alaska active seismic zones.', category: 'Seismic', keywords: ['seismic', 'earthquake', 'Alaska', 'subduction'] },
      { id: 'ak-snow', section: 'AK 1608', title: 'Snow Loads', summary: 'Alaska ground snow loads.', details: 'Ground snow loads ranging from 40 to 150+ psf across Alaska.', category: 'Climate', keywords: ['snow', 'ground snow', 'Alaska', 'psf'] },
      { id: 'ak-permafrost', section: 'Permafrost', title: 'Frozen Ground', summary: 'Permafrost foundation provisions.', details: 'Special foundation requirements for construction on permafrost.', category: 'Structural', keywords: ['permafrost', 'frozen', 'foundation', 'Alaska'] },
    ]
  },
  {
    id: 'utah',
    name: 'Utah State Construction Codes',
    abbreviation: 'UT Codes',
    baseCode: 'IBC 2018 with UT amendments',
    adoptedYear: '2021',
    state: 'Utah',
    codeType: 'state',
    description: 'Utah statewide codes with amendments for seismic design and energy efficiency.',
    officialUrl: 'https://dopl.utah.gov/',
    keyDifferences: [
      'Statewide minimum standards',
      'Enhanced seismic for Wasatch Front',
      'Energy code requirements'
    ],
    sections: [
      { id: 'ut-seismic', section: 'UT 1613', title: 'Seismic Design', summary: 'Utah seismic requirements.', details: 'Enhanced seismic for Wasatch Front fault zone.', category: 'Seismic', keywords: ['seismic', 'earthquake', 'Wasatch', 'Utah'] },
    ]
  },
  {
    id: 'south-carolina',
    name: 'South Carolina Building Codes',
    abbreviation: 'SC Codes',
    baseCode: 'IBC 2018 with SC amendments',
    adoptedYear: '2022',
    state: 'South Carolina',
    codeType: 'state',
    description: 'South Carolina statewide code with amendments for coastal and hurricane requirements.',
    officialUrl: 'https://llr.sc.gov/bcc/',
    keyDifferences: [
      'Statewide mandatory adoption',
      'Coastal construction requirements',
      'Hurricane wind design'
    ],
    sections: [
      { id: 'sc-coastal', section: 'SC Appendix G', title: 'Coastal Construction', summary: 'SC coastal requirements.', details: 'Wind and flood resistance for coastal areas.', category: 'Coastal', keywords: ['coastal', 'hurricane', 'wind', 'flood'] },
    ]
  },
  {
    id: 'tennessee',
    name: 'Tennessee State Fire Marshal Codes',
    abbreviation: 'TN Codes',
    baseCode: 'IBC 2018 (varies)',
    adoptedYear: '2022',
    state: 'Tennessee',
    codeType: 'state',
    description: 'Tennessee fire codes enforced statewide; building codes vary by jurisdiction.',
    officialUrl: 'https://www.tn.gov/commerce/sfm.html',
    keyDifferences: [
      'State Fire Marshal enforces fire codes statewide',
      'Building codes vary by jurisdiction',
      'Nashville and Memphis have comprehensive codes'
    ],
    sections: [
      { id: 'tn-fire', section: 'TN IFC', title: 'Fire Prevention', summary: 'Tennessee fire code.', details: 'Statewide fire code enforced by State Fire Marshal.', category: 'Fire Safety', keywords: ['fire', 'Tennessee', 'State Fire Marshal'] },
    ]
  },
  {
    id: 'wisconsin',
    name: 'Wisconsin Uniform Dwelling Code',
    abbreviation: 'WI UDC',
    baseCode: 'IRC with WI amendments',
    adoptedYear: '2023',
    state: 'Wisconsin',
    codeType: 'state',
    description: 'Wisconsin residential code (UDC) for one- and two-family dwellings; commercial regulated separately.',
    officialUrl: 'https://dsps.wi.gov/pages/Programs/SB/Default.aspx',
    keyDifferences: [
      'UDC for residential, Commercial Building Code for commercial',
      'Significant snow load requirements',
      'Energy efficiency requirements'
    ],
    sections: [
      { id: 'wi-snow', section: 'SPS 321', title: 'Snow Loads', summary: 'Wisconsin ground snow loads.', details: 'Ground snow loads ranging from 30 to 50 psf across Wisconsin.', category: 'Climate', keywords: ['snow', 'ground snow', 'Wisconsin', 'psf'] },
    ]
  },
  {
    id: 'new-mexico',
    name: 'New Mexico Construction Industries Division',
    abbreviation: 'NM CID',
    baseCode: 'IBC 2018 with NM amendments',
    adoptedYear: '2021',
    state: 'New Mexico',
    codeType: 'state',
    description: 'New Mexico statewide codes with amendments for accessibility and traditional construction.',
    officialUrl: 'https://www.rld.nm.gov/construction-industries/',
    keyDifferences: [
      'Statewide licensing and code enforcement',
      'Adobe and earth construction provisions'
    ],
    sections: [
      { id: 'nm-adobe', section: 'NM Appendix R', title: 'Light Straw-Clay/Adobe', summary: 'Traditional construction methods.', details: 'Adobe and traditional Southwestern construction methods.', category: 'General', keywords: ['adobe', 'earth', 'traditional', 'New Mexico'] },
    ]
  },
  {
    id: 'kentucky',
    name: 'Kentucky Building Code',
    abbreviation: 'KBC',
    baseCode: 'IBC 2015 with KY amendments',
    adoptedYear: '2019',
    state: 'Kentucky',
    codeType: 'state',
    description: 'Kentucky statewide code with amendments for accessibility and energy.',
    officialUrl: 'https://dhbc.ky.gov/',
    keyDifferences: [
      'Statewide adoption with local enforcement',
      'Kentucky accessibility requirements',
      'Radon-resistant construction in certain areas'
    ],
    sections: [
      { id: 'ky-access', section: '815 KAR', title: 'Accessibility', summary: 'Kentucky accessibility code.', details: 'Kentucky accessibility coordinated with ADA.', category: 'Accessibility', keywords: ['accessibility', 'Kentucky', 'ADA'] },
    ]
  },
  {
    id: 'alabama',
    name: 'Alabama Building Code',
    abbreviation: 'AL Code',
    baseCode: 'IBC 2021',
    adoptedYear: '2021',
    state: 'Alabama',
    codeType: 'state',
    description: 'Alabama statewide code for state-owned buildings; local adoption varies.',
    officialUrl: 'https://bc.alabama.gov/',
    keyDifferences: [
      'State Building Commission oversight',
      'Coastal construction for Gulf Coast',
      'Local adoption varies significantly'
    ],
    sections: [
      { id: 'al-wind', section: 'AL 1609', title: 'Wind Design', summary: 'Gulf Coast wind requirements.', details: 'Enhanced wind design for coastal Alabama.', category: 'Structural', keywords: ['wind', 'hurricane', 'Gulf Coast', 'Alabama'] },
    ]
  },
];

export default function CodeReferenceLibrary() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedCodeType, setSelectedCodeType] = useState<string>('all');

  const categories = useMemo(() => {
    const cats = new Set<string>();
    jurisdictionCodes.forEach(jc => {
      jc.sections.forEach(s => cats.add(s.category));
    });
    return ['all', ...Array.from(cats).sort()];
  }, []);

  const filteredJurisdictions = useMemo(() => {
    return jurisdictionCodes.filter(jur => {
      if (selectedJurisdiction !== 'all' && jur.id !== selectedJurisdiction) return false;
      if (selectedCodeType !== 'all' && jur.codeType !== selectedCodeType) return false;
      return true;
    }).map(jur => ({
      ...jur,
      sections: jur.sections.filter(section => {
        const matchesCategory = selectedCategory === 'all' || section.category === selectedCategory;
        const matchesSearch = searchQuery === '' || 
          section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          section.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
          section.section.toLowerCase().includes(searchQuery.toLowerCase()) ||
          section.keywords.some(kw => kw.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchesCategory && matchesSearch;
      })
    })).filter(jur => jur.sections.length > 0 || searchQuery === '');
  }, [searchQuery, selectedJurisdiction, selectedCategory, selectedCodeType]);

  const totalSections = jurisdictionCodes.reduce((acc, jur) => acc + jur.sections.length, 0);
  const modelCodes = jurisdictionCodes.filter(j => j.codeType === 'model');
  const stateCodes = jurisdictionCodes.filter(j => j.codeType === 'state');
  const cityCodes = jurisdictionCodes.filter(j => j.codeType === 'city');

  return (
    <>
      <Helmet>
        <title>Building Code Reference Library | PermitPilot</title>
        <meta name="description" content="Comprehensive building code database covering 35+ jurisdictions. Quick reference for IBC, state codes, and city amendments." />
      </Helmet>

      <div className="w-full max-w-7xl ml-0 mr-auto pl-2 pr-4 sm:pl-3 sm:pr-6 md:pl-4 md:pr-6 py-4 sm:py-6 md:py-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-8"
        >
          {/* Header */}
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-3">
              <BookOpen className="h-10 w-10 text-primary" />
              <h1 className="text-4xl font-bold">Code Reference Library</h1>
            </div>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Comprehensive building code database covering {jurisdictionCodes.length} jurisdictions. 
              Quick reference for IBC, state codes, major city amendments, and more.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
              <Badge variant="secondary">
                <Book className="h-3 w-3 mr-1" />
                {jurisdictionCodes.length} Jurisdictions
              </Badge>
              <Badge variant="secondary">
                <FileText className="h-3 w-3 mr-1" />
                {totalSections}+ Code Sections
              </Badge>
              <Badge variant="outline">
                {modelCodes.length} Model Codes
              </Badge>
              <Badge variant="outline">
                {stateCodes.length} State Codes
              </Badge>
              <Badge variant="outline">
                {cityCodes.length} City Codes
              </Badge>
            </div>
          </div>

          {/* Search & Filters */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search code sections, topics, or keywords..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={selectedCodeType} onValueChange={setSelectedCodeType}>
                  <SelectTrigger className="w-full md:w-[160px]">
                    <SelectValue placeholder="Code Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="model">Model Codes</SelectItem>
                    <SelectItem value="state">State Codes</SelectItem>
                    <SelectItem value="city">City Codes</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={selectedJurisdiction} onValueChange={setSelectedJurisdiction}>
                  <SelectTrigger className="w-full md:w-[200px]">
                    <MapPin className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Jurisdiction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Jurisdictions</SelectItem>
                    {jurisdictionCodes.map(jur => (
                      <SelectItem key={jur.id} value={jur.id}>{jur.abbreviation}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-full md:w-[180px]">
                    <Scale className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(cat => (
                      <SelectItem key={cat} value={cat}>
                        {cat === 'all' ? 'All Categories' : cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Jurisdiction Tabs */}
          <Tabs defaultValue="browse" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="browse">Browse</TabsTrigger>
              <TabsTrigger value="model">Model Codes</TabsTrigger>
              <TabsTrigger value="matrix" className="gap-1">
                <ArrowUpDown className="h-3 w-3" />
                Compare
              </TabsTrigger>
              <TabsTrigger value="fees" className="gap-1">
                <Scale className="h-3 w-3" />
                Permit Fees
              </TabsTrigger>
              <TabsTrigger value="compare">Differences</TabsTrigger>
            </TabsList>

            <TabsContent value="browse" className="mt-6 space-y-6">
              {filteredJurisdictions.map(jur => (
                <motion.div
                  key={jur.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  layout
                >
                  <Card>
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <Building2 className="h-5 w-5" />
                            {jur.name}
                            <Badge variant="outline">{jur.abbreviation}</Badge>
                            {jur.state && <Badge variant="secondary">{jur.state}</Badge>}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            {jur.description}
                          </CardDescription>
                          <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                            <span>Base: {jur.baseCode}</span>
                            <span>•</span>
                            <span>Adopted: {jur.adoptedYear}</span>
                            {jur.officialUrl && (
                              <>
                                <span>•</span>
                                <a 
                                  href={jur.officialUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline flex items-center gap-1"
                                >
                                  Official Code <ExternalLink className="h-3 w-3" />
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                        <Badge>{jur.sections.length} sections</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="max-h-[600px]">
                        <Accordion type="multiple" className="w-full">
                          {jur.sections.map(section => (
                            <AccordionItem key={section.id} value={section.id}>
                              <AccordionTrigger className="hover:no-underline">
                                <div className="flex items-center gap-3 text-left">
                                  <div className="p-1.5 rounded bg-muted">
                                    {categoryIcons[section.category] || <Book className="h-4 w-4" />}
                                  </div>
                                  <div>
                                    <div className="font-medium flex items-center gap-2">
                                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{section.section}</code>
                                      {section.title}
                                    </div>
                                    <p className="text-sm text-muted-foreground font-normal">
                                      {section.summary}
                                    </p>
                                  </div>
                                </div>
                              </AccordionTrigger>
                              <AccordionContent>
                                <div className="pl-10 space-y-3">
                                  <p className="text-sm leading-relaxed">{section.details}</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    <Badge variant="secondary" className="text-xs">
                                      {section.category}
                                    </Badge>
                                    {section.keywords.map(kw => (
                                      <Badge key={kw} variant="outline" className="text-xs">
                                        {kw}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          ))}
                        </Accordion>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}

              {filteredJurisdictions.length === 0 && (
                <Card className="py-12 text-center">
                  <CardContent>
                    <Search className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-medium">No matching code sections</h3>
                    <p className="text-muted-foreground">Try adjusting your search or filters</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="model" className="mt-6 space-y-6">
              <Card className="bg-primary/5 border-primary/20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5" />
                    International Code Council (ICC) Model Codes
                  </CardTitle>
                  <CardDescription>
                    These model codes form the basis for building regulations across all 50 U.S. states. 
                    Most jurisdictions adopt these codes with local amendments.
                  </CardDescription>
                </CardHeader>
              </Card>
              
              {modelCodes.map(jur => (
                <Card key={jur.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2">
                          <Building2 className="h-5 w-5" />
                          {jur.name}
                          <Badge>{jur.abbreviation}</Badge>
                        </CardTitle>
                        <CardDescription className="mt-1">{jur.description}</CardDescription>
                        {jur.officialUrl && (
                          <a 
                            href={jur.officialUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-primary hover:underline flex items-center gap-1 mt-2 text-sm"
                          >
                            View Official Code <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                      <Badge variant="secondary">{jur.sections.length} sections</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Accordion type="multiple" className="w-full">
                      {jur.sections.map(section => (
                        <AccordionItem key={section.id} value={section.id}>
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center gap-3 text-left">
                              <div className="p-1.5 rounded bg-muted">
                                {categoryIcons[section.category] || <Book className="h-4 w-4" />}
                              </div>
                              <div>
                                <div className="font-medium flex items-center gap-2">
                                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{section.section}</code>
                                  {section.title}
                                </div>
                                <p className="text-sm text-muted-foreground font-normal">{section.summary}</p>
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="pl-10 space-y-3">
                              <p className="text-sm leading-relaxed">{section.details}</p>
                              <div className="flex flex-wrap gap-1.5">
                                <Badge variant="secondary" className="text-xs">{section.category}</Badge>
                                {section.keywords.map(kw => (
                                  <Badge key={kw} variant="outline" className="text-xs">{kw}</Badge>
                                ))}
                              </div>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="matrix" className="mt-6">
              <CodeComparisonMatrix />
            </TabsContent>

            <TabsContent value="fees" className="mt-6">
              <PermitFeeCalculator />
            </TabsContent>

            <TabsContent value="compare" className="mt-6">
              <Card className="bg-amber-500/10 border-amber-500/20 mb-6">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    Key Jurisdictional Differences
                  </CardTitle>
                  <CardDescription>
                    Important variations from the base IBC. These differences can significantly impact project requirements.
                  </CardDescription>
                </CardHeader>
              </Card>
              
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {jurisdictionCodes.filter(j => j.keyDifferences.length > 0).map(jur => (
                  <Card key={jur.id}>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        {jur.abbreviation}
                        {jur.state && <Badge variant="outline" className="text-xs">{jur.state}</Badge>}
                      </CardTitle>
                      <CardDescription>{jur.name}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {jur.keyDifferences.map((diff, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <Shield className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                            <span>{diff}</span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>
          </Tabs>

          {/* Quick Links */}
          <Card className="bg-muted/50">
            <CardContent className="pt-6">
              <div className="flex flex-wrap justify-center gap-3">
                <span className="text-sm text-muted-foreground w-full text-center mb-2">Quick links to official codes:</span>
                {jurisdictionCodes.filter(jur => jur.officialUrl).slice(0, 15).map(jur => (
                  <Button
                    key={jur.id}
                    variant="outline"
                    size="sm"
                    asChild
                  >
                    <a href={jur.officialUrl} target="_blank" rel="noopener noreferrer">
                      {jur.abbreviation}
                      <ExternalLink className="h-3 w-3 ml-1" />
                    </a>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </>
  );
}
