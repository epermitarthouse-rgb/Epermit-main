import { useMemo, useState } from "react";
import { BookOpen, Building2, ChevronRight, ExternalLink, FileText, Landmark, MapPin, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type RefItem = { code: string; title: string; url?: string };
type Collection = {
  key: string;
  name: string;
  scope: "icc" | "state" | "city" | "utility" | "internal";
  jurisdiction?: string;
  items: RefItem[];
};

// ICC family — full published I-Codes plus companion standards
const ICC_FAMILY: RefItem[] = [
  { code: "IBC 2024", title: "International Building Code", url: "https://codes.iccsafe.org/content/IBC2024P1" },
  { code: "IBC 2021", title: "International Building Code", url: "https://codes.iccsafe.org/content/IBC2021P2" },
  { code: "IBC 2018", title: "International Building Code", url: "https://codes.iccsafe.org/content/IBC2018" },
  { code: "IBC 2015", title: "International Building Code" },
  { code: "IRC 2024", title: "International Residential Code", url: "https://codes.iccsafe.org/content/IRC2024P1" },
  { code: "IRC 2021", title: "International Residential Code", url: "https://codes.iccsafe.org/content/IRC2021P2" },
  { code: "IRC 2018", title: "International Residential Code" },
  { code: "IEBC 2024", title: "International Existing Building Code" },
  { code: "IEBC 2021", title: "International Existing Building Code" },
  { code: "IFC 2024", title: "International Fire Code" },
  { code: "IFC 2021", title: "International Fire Code" },
  { code: "IMC 2024", title: "International Mechanical Code" },
  { code: "IMC 2021", title: "International Mechanical Code" },
  { code: "IPC 2024", title: "International Plumbing Code" },
  { code: "IPC 2021", title: "International Plumbing Code" },
  { code: "IECC 2024", title: "International Energy Conservation Code" },
  { code: "IECC 2021", title: "International Energy Conservation Code" },
  { code: "IECC 2018", title: "International Energy Conservation Code" },
  { code: "IFGC 2024", title: "International Fuel Gas Code" },
  { code: "IFGC 2021", title: "International Fuel Gas Code" },
  { code: "ISPSC 2024", title: "International Swimming Pool and Spa Code" },
  { code: "IPMC 2024", title: "International Property Maintenance Code" },
  { code: "IPMC 2021", title: "International Property Maintenance Code" },
  { code: "IPSDC 2024", title: "International Private Sewage Disposal Code" },
  { code: "IWUIC 2024", title: "International Wildland-Urban Interface Code" },
  { code: "IgCC 2024", title: "International Green Construction Code" },
  { code: "IZC 2024", title: "International Zoning Code" },
  { code: "ICC A117.1-2017", title: "Accessible and Usable Buildings and Facilities" },
  { code: "ICC 500-2020", title: "Standard for Storm Shelters (with NSSA)" },
  { code: "ICC 600-2020", title: "Residential Construction in High-Wind Regions" },
  { code: "ICC 700-2020", title: "National Green Building Standard (with NAHB)" },
  { code: "ICC PMG Listing", title: "Plumbing, Mechanical, Fuel Gas Product Directory" },
  { code: "ASHRAE 90.1-2022", title: "Energy Standard for Buildings (referenced by IECC)" },
  { code: "ASHRAE 90.1-2019", title: "Energy Standard for Buildings" },
  { code: "ASHRAE 62.1-2022", title: "Ventilation for Acceptable Indoor Air Quality" },
  { code: "NFPA 70 (NEC 2023)", title: "National Electrical Code" },
  { code: "NFPA 70 (NEC 2020)", title: "National Electrical Code" },
  { code: "NFPA 13-2022", title: "Standard for the Installation of Sprinkler Systems" },
  { code: "NFPA 72-2022", title: "National Fire Alarm and Signaling Code" },
  { code: "NFPA 101-2024", title: "Life Safety Code" },
];

// State-adopted construction codes (representative national coverage)
const STATE_CODES: Collection[] = [
  { key: "st-al", name: "Alabama", scope: "state", jurisdiction: "AL", items: [
    { code: "2021 IBC", title: "Alabama Building Code (state buildings)" },
    { code: "2015 IECC", title: "Alabama Energy & Residential Codes Board" },
  ]},
  { key: "st-ak", name: "Alaska", scope: "state", jurisdiction: "AK", items: [
    { code: "2012 IBC / IRC", title: "State Fire Marshal adopted codes" },
  ]},
  { key: "st-az", name: "Arizona", scope: "state", jurisdiction: "AZ", items: [
    { code: "Local adoption", title: "No statewide building code; municipal adoption" },
  ]},
  { key: "st-ar", name: "Arkansas", scope: "state", jurisdiction: "AR", items: [
    { code: "2021 IBC / IRC / IECC", title: "Arkansas Fire Prevention Code Vol. III" },
  ]},
  { key: "st-ca", name: "California", scope: "state", jurisdiction: "CA", items: [
    { code: "2022 CBC (Title 24 Part 2)", title: "California Building Code" },
    { code: "2022 CRC (Title 24 Part 2.5)", title: "California Residential Code" },
    { code: "2022 CEC (Title 24 Part 6)", title: "California Energy Code" },
    { code: "2022 CALGreen (Title 24 Part 11)", title: "Green Building Standards" },
    { code: "2022 CFC (Title 24 Part 9)", title: "California Fire Code" },
  ]},
  { key: "st-co", name: "Colorado", scope: "state", jurisdiction: "CO", items: [
    { code: "2021 IECC", title: "Statewide energy code (HB21-1286 / SB22-051)" },
    { code: "Local adoption", title: "Building code adopted by municipality" },
  ]},
  { key: "st-ct", name: "Connecticut", scope: "state", jurisdiction: "CT", items: [
    { code: "2022 CT State Building Code", title: "Based on 2021 IBC/IRC with amendments" },
  ]},
  { key: "st-de", name: "Delaware", scope: "state", jurisdiction: "DE", items: [
    { code: "2018 IBC / IRC / IECC", title: "State-adopted with local amendments" },
  ]},
  { key: "st-fl", name: "Florida", scope: "state", jurisdiction: "FL", items: [
    { code: "FBC 8th Ed. (2023) Building", title: "Florida Building Code — Building" },
    { code: "FBC 8th Ed. (2023) Residential", title: "Florida Building Code — Residential" },
    { code: "FBC 8th Ed. (2023) Energy", title: "Florida Building Code — Energy Conservation" },
    { code: "FBC 8th Ed. (2023) Existing", title: "Florida Building Code — Existing Building" },
    { code: "HVHZ Provisions", title: "High-Velocity Hurricane Zone (Miami-Dade / Broward)" },
  ]},
  { key: "st-ga", name: "Georgia", scope: "state", jurisdiction: "GA", items: [
    { code: "2018 IBC + GA amendments", title: "Georgia State Minimum Standard Codes" },
    { code: "2020 GA Energy Code", title: "Based on 2015 IECC with amendments" },
  ]},
  { key: "st-hi", name: "Hawaii", scope: "state", jurisdiction: "HI", items: [
    { code: "2018 IBC / IRC", title: "State Building Code with county amendments" },
  ]},
  { key: "st-id", name: "Idaho", scope: "state", jurisdiction: "ID", items: [
    { code: "2018 IBC / IRC / IECC", title: "Idaho Building Code Act" },
  ]},
  { key: "st-il", name: "Illinois", scope: "state", jurisdiction: "IL", items: [
    { code: "2021 IECC", title: "IL Energy Conservation Code (statewide)" },
    { code: "Local adoption", title: "Building code adopted by municipality" },
  ]},
  { key: "st-in", name: "Indiana", scope: "state", jurisdiction: "IN", items: [
    { code: "2014 Indiana Building Code", title: "Based on 2012 IBC" },
    { code: "2020 IN Residential Code", title: "Based on 2018 IRC" },
  ]},
  { key: "st-ia", name: "Iowa", scope: "state", jurisdiction: "IA", items: [
    { code: "2015 IBC / IECC", title: "State Building Code (state buildings)" },
  ]},
  { key: "st-ks", name: "Kansas", scope: "state", jurisdiction: "KS", items: [
    { code: "Local adoption", title: "No statewide building code" },
  ]},
  { key: "st-ky", name: "Kentucky", scope: "state", jurisdiction: "KY", items: [
    { code: "2018 KBC / KRC", title: "Kentucky Building & Residential Code" },
  ]},
  { key: "st-la", name: "Louisiana", scope: "state", jurisdiction: "LA", items: [
    { code: "2021 IBC / IRC (LSUCC)", title: "Louisiana State Uniform Construction Code" },
  ]},
  { key: "st-me", name: "Maine", scope: "state", jurisdiction: "ME", items: [
    { code: "2015 IBC / IRC / IECC (MUBEC)", title: "Maine Uniform Building & Energy Code" },
  ]},
  { key: "st-md", name: "Maryland", scope: "state", jurisdiction: "MD", items: [
    { code: "2021 IBC (MBPS)", title: "Maryland Building Performance Standards" },
    { code: "2021 IECC (MBPS)", title: "Statewide energy code" },
    { code: "2018 IEBC (MBRS)", title: "Maryland Building Rehabilitation Code" },
  ]},
  { key: "st-ma", name: "Massachusetts", scope: "state", jurisdiction: "MA", items: [
    { code: "780 CMR 10th Ed.", title: "Massachusetts State Building Code (2021 IBC base)" },
    { code: "225 CMR 22/23", title: "MA Stretch Energy Code / Specialized Opt-in" },
  ]},
  { key: "st-mi", name: "Michigan", scope: "state", jurisdiction: "MI", items: [
    { code: "2015 MBC / MRC", title: "Michigan Building & Residential Code" },
    { code: "2015 MUEC", title: "Michigan Uniform Energy Code" },
  ]},
  { key: "st-mn", name: "Minnesota", scope: "state", jurisdiction: "MN", items: [
    { code: "2020 MSBC", title: "Minnesota State Building Code (2018 IBC base)" },
    { code: "2020 MN Energy Code", title: "Ch. 1323 commercial / Ch. 1322 residential" },
  ]},
  { key: "st-ms", name: "Mississippi", scope: "state", jurisdiction: "MS", items: [
    { code: "2018 IBC / IRC / IECC", title: "State Building Code (SB 2378)" },
  ]},
  { key: "st-mo", name: "Missouri", scope: "state", jurisdiction: "MO", items: [
    { code: "Local adoption", title: "No statewide building code" },
  ]},
  { key: "st-mt", name: "Montana", scope: "state", jurisdiction: "MT", items: [
    { code: "2021 IBC / IRC / IECC", title: "Montana Building Codes Bureau" },
  ]},
  { key: "st-ne", name: "Nebraska", scope: "state", jurisdiction: "NE", items: [
    { code: "2018 IECC", title: "NE Energy Code (statewide)" },
  ]},
  { key: "st-nv", name: "Nevada", scope: "state", jurisdiction: "NV", items: [
    { code: "Local adoption", title: "County/municipal adoption of IBC/IRC" },
  ]},
  { key: "st-nh", name: "New Hampshire", scope: "state", jurisdiction: "NH", items: [
    { code: "2018 IBC / IRC / IECC", title: "NH State Building Code (RSA 155-A)" },
  ]},
  { key: "st-nj", name: "New Jersey", scope: "state", jurisdiction: "NJ", items: [
    { code: "2021 IBC / IRC (NJ UCC)", title: "NJ Uniform Construction Code" },
    { code: "2021 IEBC (Rehab Subcode)", title: "NJ Rehabilitation Subcode" },
  ]},
  { key: "st-nm", name: "New Mexico", scope: "state", jurisdiction: "NM", items: [
    { code: "2015 NMCBC / NMRBC", title: "NM Commercial & Residential Building Codes" },
    { code: "2018 NMECC", title: "NM Energy Conservation Code" },
  ]},
  { key: "st-ny", name: "New York", scope: "state", jurisdiction: "NY", items: [
    { code: "2020 NYS Uniform Code", title: "Building Code of NYS (2018 IBC base)" },
    { code: "2020 NYS ECCC", title: "Energy Conservation Construction Code" },
  ]},
  { key: "st-nc", name: "North Carolina", scope: "state", jurisdiction: "NC", items: [
    { code: "2018 NCBC", title: "NC State Building Code (2015 IBC base)" },
    { code: "2018 NC Energy Code", title: "NC ECC" },
  ]},
  { key: "st-nd", name: "North Dakota", scope: "state", jurisdiction: "ND", items: [
    { code: "2021 IBC / IRC / IECC", title: "State-adopted (state buildings)" },
  ]},
  { key: "st-oh", name: "Ohio", scope: "state", jurisdiction: "OH", items: [
    { code: "2017 OBC (2015 IBC)", title: "Ohio Building Code" },
    { code: "2019 RCO", title: "Residential Code of Ohio" },
  ]},
  { key: "st-ok", name: "Oklahoma", scope: "state", jurisdiction: "OK", items: [
    { code: "2018 IBC / IRC / IECC", title: "OUBCC adoption" },
  ]},
  { key: "st-or", name: "Oregon", scope: "state", jurisdiction: "OR", items: [
    { code: "2022 OSSC", title: "Oregon Structural Specialty Code (2021 IBC base)" },
    { code: "2023 ORSC", title: "Oregon Residential Specialty Code" },
    { code: "2023 OEESC", title: "Oregon Energy Efficiency Specialty Code" },
  ]},
  { key: "st-pa", name: "Pennsylvania", scope: "state", jurisdiction: "PA", items: [
    { code: "2018 IBC / IRC (UCC)", title: "PA Uniform Construction Code" },
    { code: "2018 IECC (UCC)", title: "Statewide energy code" },
  ]},
  { key: "st-ri", name: "Rhode Island", scope: "state", jurisdiction: "RI", items: [
    { code: "2018 IBC / IRC / IECC", title: "RI State Building Code (SBC-1 through SBC-8)" },
  ]},
  { key: "st-sc", name: "South Carolina", scope: "state", jurisdiction: "SC", items: [
    { code: "2021 IBC / IRC / IECC", title: "SC Building Codes Council" },
  ]},
  { key: "st-sd", name: "South Dakota", scope: "state", jurisdiction: "SD", items: [
    { code: "Local adoption", title: "No statewide building code (except state buildings)" },
  ]},
  { key: "st-tn", name: "Tennessee", scope: "state", jurisdiction: "TN", items: [
    { code: "2018 IBC / IECC", title: "TN State Building Codes" },
  ]},
  { key: "st-tx", name: "Texas", scope: "state", jurisdiction: "TX", items: [
    { code: "2015 IRC (statewide)", title: "TX Residential Code" },
    { code: "2015 IECC (statewide)", title: "TX Energy Code" },
    { code: "Local adoption", title: "Commercial building code by municipality" },
  ]},
  { key: "st-ut", name: "Utah", scope: "state", jurisdiction: "UT", items: [
    { code: "2021 IBC / IRC / IECC", title: "Utah State Construction Code" },
  ]},
  { key: "st-vt", name: "Vermont", scope: "state", jurisdiction: "VT", items: [
    { code: "2015 IBC (VT Fire & Building)", title: "VT Fire & Building Safety Code" },
    { code: "2020 VT RBES / CBES", title: "VT Residential & Commercial Energy Standards" },
  ]},
  { key: "st-va", name: "Virginia", scope: "state", jurisdiction: "VA", items: [
    { code: "2021 VCC", title: "Virginia Construction Code (2021 IBC base)" },
    { code: "2021 VRC", title: "Virginia Residential Code" },
    { code: "2021 VEBC", title: "Virginia Existing Building Code" },
    { code: "2021 VEC", title: "Virginia Energy Conservation Code" },
  ]},
  { key: "st-wa", name: "Washington", scope: "state", jurisdiction: "WA", items: [
    { code: "2021 WA State Building Code", title: "2021 IBC + WA amendments" },
    { code: "2021 WSEC-C / WSEC-R", title: "Washington State Energy Code" },
  ]},
  { key: "st-wv", name: "West Virginia", scope: "state", jurisdiction: "WV", items: [
    { code: "2015 IBC / IRC / IECC", title: "WV State Building Code" },
  ]},
  { key: "st-wi", name: "Wisconsin", scope: "state", jurisdiction: "WI", items: [
    { code: "SPS 361–366 (2015 IBC)", title: "WI Commercial Building Code" },
    { code: "SPS 320–325 (UDC)", title: "WI Uniform Dwelling Code" },
  ]},
  { key: "st-wy", name: "Wyoming", scope: "state", jurisdiction: "WY", items: [
    { code: "2018 IBC / IRC / IECC", title: "State-adopted (state buildings)" },
  ]},
  { key: "st-dc", name: "District of Columbia", scope: "state", jurisdiction: "DC", items: [
    { code: "2017 DC Construction Codes", title: "12 DCMR A–M (2015 IBC base)" },
    { code: "2017 DC Energy Conservation Code", title: "12-I DCMR" },
    { code: "2017 DC Green Construction Code", title: "12-K DCMR" },
  ]},
];

// City / county amendments (major markets + core Commun-ET service area)
const CITY_CODES: Collection[] = [
  { key: "ci-dc", name: "Washington, DC — DCRA/DOB", scope: "city", jurisdiction: "DC", items: [
    { code: "12 DCMR", title: "DC Construction Codes Supplement" },
    { code: "Green Area Ratio", title: "DOEE zoning-linked landscape requirement" },
    { code: "CBE / DBE requirements", title: "Contracting compliance on public work" },
  ]},
  { key: "ci-mont", name: "Montgomery County, MD", scope: "city", jurisdiction: "MD", items: [
    { code: "COMCOR 8.00.01", title: "Building Construction — county amendments" },
    { code: "Ch. 22 Fire Safety Code", title: "MoCo Fire Code amendments" },
    { code: "Ch. 18A IECC amendments", title: "County energy code overlay" },
  ]},
  { key: "ci-pg", name: "Prince George's County, MD", scope: "city", jurisdiction: "MD", items: [
    { code: "Subtitle 4 Building", title: "PG County building code amendments" },
  ]},
  { key: "ci-arl", name: "Arlington County, VA", scope: "city", jurisdiction: "VA", items: [
    { code: "VCC + Arlington amendments", title: "Adopted VCC with local supplements" },
    { code: "Green Building Incentive", title: "LEED / density bonus program" },
  ]},
  { key: "ci-alx", name: "Alexandria, VA", scope: "city", jurisdiction: "VA", items: [
    { code: "VCC + Alexandria amendments", title: "City of Alexandria code office" },
    { code: "Old & Historic District BAR", title: "Board of Architectural Review" },
  ]},
  { key: "ci-ffx", name: "Fairfax County, VA", scope: "city", jurisdiction: "VA", items: [
    { code: "VCC + Fairfax amendments", title: "Land Development Services" },
    { code: "PFM", title: "Public Facilities Manual" },
  ]},
  { key: "ci-lou", name: "Loudoun County, VA", scope: "city", jurisdiction: "VA", items: [
    { code: "VCC + Loudoun amendments", title: "Building & Development" },
    { code: "Facilities Standards Manual", title: "FSM design standards" },
  ]},
  { key: "ci-balt", name: "Baltimore City, MD", scope: "city", jurisdiction: "MD", items: [
    { code: "Baltimore City Building Code", title: "2018 IBC + city amendments" },
    { code: "IHOD", title: "Inclusionary housing overlay" },
  ]},
  { key: "ci-nyc", name: "New York City, NY — DOB", scope: "city", jurisdiction: "NY", items: [
    { code: "2022 NYCBC", title: "NYC Building Code" },
    { code: "2022 NYCECC", title: "NYC Energy Conservation Code" },
    { code: "NYCFC", title: "NYC Fire Code (FDNY)" },
    { code: "Local Law 97", title: "Building emissions limits" },
    { code: "Local Law 11 / FISP", title: "Facade Inspection Safety Program" },
  ]},
  { key: "ci-chi", name: "Chicago, IL — DOB", scope: "city", jurisdiction: "IL", items: [
    { code: "2019 Chicago Construction Codes", title: "Based on 2018 IBC" },
    { code: "Chicago Energy Conservation Code", title: "2018 IECC + amendments" },
  ]},
  { key: "ci-la", name: "Los Angeles, CA — LADBS", scope: "city", jurisdiction: "CA", items: [
    { code: "2023 LABC", title: "LA Building Code (CBC + LA amendments)" },
    { code: "2023 LAGBC", title: "LA Green Building Code" },
    { code: "LAMC Zoning", title: "LA Municipal Code — Zoning" },
  ]},
  { key: "ci-sf", name: "San Francisco, CA — DBI", scope: "city", jurisdiction: "CA", items: [
    { code: "2022 SFBC", title: "SF Building Code" },
    { code: "SF Green Building Code", title: "Ch. 13C SF Env. Code" },
    { code: "SF Existing Buildings Ordinance", title: "Energy performance + retro-commissioning" },
  ]},
  { key: "ci-mia", name: "Miami-Dade County, FL", scope: "city", jurisdiction: "FL", items: [
    { code: "FBC + HVHZ", title: "High-Velocity Hurricane Zone amendments" },
    { code: "NOA product approvals", title: "Miami-Dade Notice of Acceptance" },
  ]},
  { key: "ci-bos", name: "Boston, MA — ISD", scope: "city", jurisdiction: "MA", items: [
    { code: "780 CMR + Boston amendments", title: "MA State Building Code + city rules" },
    { code: "Article 37 Green Buildings", title: "Boston Zoning Code" },
    { code: "BERDO 2.0", title: "Building Emissions Reduction & Disclosure" },
  ]},
  { key: "ci-sea", name: "Seattle, WA — SDCI", scope: "city", jurisdiction: "WA", items: [
    { code: "2021 SBC", title: "Seattle Building Code (IBC + amendments)" },
    { code: "2021 SECC", title: "Seattle Energy Code" },
  ]},
  { key: "ci-den", name: "Denver, CO — CPD", scope: "city", jurisdiction: "CO", items: [
    { code: "2022 Denver Building & Fire Code", title: "2021 IBC + Denver amendments" },
    { code: "Denver Green Code", title: "Green building overlay" },
    { code: "Energize Denver", title: "Existing buildings performance requirements" },
  ]},
  { key: "ci-atl", name: "Atlanta, GA — Office of Buildings", scope: "city", jurisdiction: "GA", items: [
    { code: "GA State Codes + Atlanta amendments", title: "Municipal code overlay" },
  ]},
  { key: "ci-dal", name: "Dallas, TX — Building Inspection", scope: "city", jurisdiction: "TX", items: [
    { code: "2021 IBC + Dallas amendments", title: "Ch. 52 Dallas City Code" },
    { code: "Dallas Green Construction Code", title: "Sustainable development ordinance" },
  ]},
  { key: "ci-hou", name: "Houston, TX — Permitting Center", scope: "city", jurisdiction: "TX", items: [
    { code: "2012 IBC + Houston amendments", title: "Houston Construction Code" },
  ]},
  { key: "ci-aus", name: "Austin, TX — DSD", scope: "city", jurisdiction: "TX", items: [
    { code: "2021 IBC + Austin amendments", title: "Austin Building Criteria Manual" },
    { code: "Austin Energy Green Building", title: "AEGB rating requirements" },
  ]},
  { key: "ci-phx", name: "Phoenix, AZ — PDD", scope: "city", jurisdiction: "AZ", items: [
    { code: "2018 IBC + Phoenix amendments", title: "Phoenix Building Construction Code" },
  ]},
  { key: "ci-phi", name: "Philadelphia, PA — L&I", scope: "city", jurisdiction: "PA", items: [
    { code: "PA UCC + Philadelphia amendments", title: "Philadelphia Building Code" },
    { code: "Bill 200013", title: "Building energy performance policy" },
  ]},
];

const UTILITY_REFS: RefItem[] = [
  { code: "PEPCO Greenbook", title: "Electric service requirements (DC/MD)" },
  { code: "BGE Blue Book", title: "Baltimore Gas & Electric service standards" },
  { code: "Dominion Energy Blue Book", title: "VA electric service requirements" },
  { code: "NOVEC OH/UG Standards", title: "Northern VA Electric Cooperative" },
  { code: "Washington Gas WAMS", title: "Gas service application & metering" },
  { code: "DC Water DCSE", title: "Design & Construction Standards & Specifications" },
  { code: "WSSC Plumbing / Site Utility", title: "Washington Suburban Sanitary Commission" },
  { code: "Con Edison Bluebook", title: "NYC electric service specifications" },
  { code: "SCE / SDG&E / PG&E Green Books", title: "California IOU service standards" },
  { code: "ComEd OH/UG Standards", title: "Chicago electric service" },
];

const INTERNAL_PLAYBOOKS: RefItem[] = [
  { code: "Phase 0 SOP", title: "Feasibility → intake handoff" },
  { code: "Critical-path triage", title: "Blocker escalation ladder" },
  { code: "Comment reconciliation", title: "AE response verification playbook" },
  { code: "Utility long-lead runbook", title: "Transformer / meter set choreography" },
  { code: "Portal outage fallback", title: "Manual upload + evidence capture" },
];

const ALL_COLLECTIONS: Collection[] = [
  { key: "icc", name: "ICC I-Codes & Referenced Standards", scope: "icc", items: ICC_FAMILY },
  ...STATE_CODES,
  ...CITY_CODES,
  { key: "util", name: "Utility Standards", scope: "utility", items: UTILITY_REFS },
  { key: "internal", name: "Internal Playbooks", scope: "internal", items: INTERNAL_PLAYBOOKS },
];

const SCOPE_META: Record<Collection["scope"], { label: string; icon: typeof BookOpen }> = {
  icc: { label: "ICC", icon: BookOpen },
  state: { label: "State", icon: Landmark },
  city: { label: "City / County", icon: Building2 },
  utility: { label: "Utility", icon: MapPin },
  internal: { label: "Internal", icon: FileText },
};

const FILTERS: { key: "all" | Collection["scope"]; label: string }[] = [
  { key: "all", label: "All" },
  { key: "icc", label: "ICC / National" },
  { key: "state", label: "State" },
  { key: "city", label: "City / County" },
  { key: "utility", label: "Utility" },
  { key: "internal", label: "Internal" },
];

const ReferenceLibrary = () => {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<(typeof FILTERS)[number]["key"]>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ALL_COLLECTIONS
      .filter((c) => scope === "all" || c.scope === scope)
      .map((c) => ({
        ...c,
        items: needle
          ? c.items.filter(
              (i) =>
                i.code.toLowerCase().includes(needle) ||
                i.title.toLowerCase().includes(needle) ||
                c.name.toLowerCase().includes(needle) ||
                (c.jurisdiction ?? "").toLowerCase().includes(needle),
            )
          : c.items,
      }))
      .filter((c) => c.items.length > 0);
  }, [q, scope]);

  const totalRefs = filtered.reduce((sum, c) => sum + c.items.length, 0);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="pilot-kicker text-primary">Technical Reference Library</div>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
            Codes, Standards &amp; Playbooks
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full ICC I-Code family, state-adopted construction codes across all 50 states + DC, city/county
            amendments for major markets, utility standards, and internal playbooks.
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 md:min-w-72">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search codes, jurisdictions, sections"
          />
        </label>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setScope(f.key)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-tight uppercase tracking-wide transition",
                scope === f.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="pilot-kicker text-muted-foreground">
          {filtered.length} collections · {totalRefs} references
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c) => {
          const Icon = SCOPE_META[c.scope].icon;
          return (
            <section key={c.key} className="pilot-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="pilot-kicker text-muted-foreground">
                    {SCOPE_META[c.scope].label}
                    {c.jurisdiction ? ` · ${c.jurisdiction}` : ""}
                  </div>
                  <h2 className="mt-1 flex items-center gap-2 font-tight text-base font-bold">
                    <Icon className="h-4 w-4 text-primary" /> {c.name}
                  </h2>
                </div>
                <span className="pilot-kicker text-muted-foreground">{c.items.length} refs</span>
              </div>
              <ul className="mt-3 space-y-1">
                {c.items.map((i) => {
                  const content = (
                    <>
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          <span className="font-data text-[11px] uppercase tracking-wide text-primary">
                            {i.code}
                          </span>
                          <span className="ml-2 text-foreground/80">{i.title}</span>
                        </span>
                      </span>
                      {i.url ? (
                        <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      )}
                    </>
                  );
                  return (
                    <li key={`${c.key}-${i.code}`}>
                      {i.url ? (
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40"
                        >
                          {content}
                        </a>
                      ) : (
                        <div className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40">
                          {content}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {filtered.length === 0 && (
          <div className="pilot-card col-span-full p-8 text-center text-sm text-muted-foreground">
            No references match "{q}".
          </div>
        )}
      </div>
    </div>
  );
};

export default ReferenceLibrary;