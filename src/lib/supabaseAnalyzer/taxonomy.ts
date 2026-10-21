export type TaxonomyGroup = { label: string; items: string[] };

// Active copy of the complete Lovable compliance taxonomy. It is intentionally
// separate from the Code Analyzer V2 jurisdiction registry and applicability logic.
export const analyzerJurisdictionGroups: TaxonomyGroup[] = [
  {
    label: "National / Model Codes",
    items: [
      "General IBC (International Building Code)", "IRC (Residential)", "IECC (Energy)",
      "IFC (Fire)", "IPC (Plumbing)", "IMC (Mechanical)", "IFGC (Fuel Gas)",
      "IEBC (Existing Buildings)", "IgCC (Green Construction)",
      "ICC A117.1 (Accessibility)", "ASHRAE 90.1 / 62.1",
      "NFPA 1 / 13 / 72 / 101", "ADA 2010 Standards",
    ],
  },
  {
    label: "Mid-Atlantic",
    items: [
      "Washington D.C. (12A DCMR)", "Maryland (MSBC)", "Montgomery County, MD",
      "Prince George's County, MD", "Baltimore City, MD", "Arlington County, VA",
      "Fairfax County, VA", "Loudoun County, VA", "Alexandria, VA", "Richmond, VA",
    ],
  },
  {
    label: "Southeast",
    items: [
      "Florida Building Code (FBC)", "Miami-Dade County, FL (HVHZ)",
      "Broward County, FL", "Orlando, FL", "Tampa, FL", "Jacksonville, FL",
      "North Carolina", "Charlotte, NC", "Raleigh, NC", "South Carolina",
      "Charleston, SC", "Tennessee", "Nashville, TN", "Alabama", "Birmingham, AL",
      "Atlanta, GA", "Savannah, GA",
    ],
  },
  {
    label: "Northeast",
    items: [
      "New York City (NYCBC)", "Boston, MA", "Philadelphia, PA", "Newark, NJ",
      "Hartford, CT", "Providence, RI",
    ],
  },
  {
    label: "Midwest / Central",
    items: [
      "Chicago, IL", "Detroit, MI", "Minneapolis, MN", "Kansas City, MO",
      "Indianapolis, IN", "Columbus, OH", "Milwaukee, WI",
    ],
  },
  {
    label: "South Central",
    items: [
      "Dallas, TX", "Houston, TX", "Austin, TX", "San Antonio, TX",
      "Oklahoma City, OK", "New Orleans, LA",
    ],
  },
  {
    label: "Mountain / West",
    items: [
      "Denver, CO", "Phoenix, AZ", "Las Vegas, NV", "Salt Lake City, UT",
      "Albuquerque, NM", "Boise, ID",
    ],
  },
  {
    label: "Pacific",
    items: [
      "Los Angeles, CA", "San Francisco, CA", "San Diego, CA", "Seattle, WA",
      "Portland, OR", "Honolulu, HI", "Anchorage, AK",
    ],
  },
];

export const analyzerProjectTypeGroups: TaxonomyGroup[] = [
  {
    label: "Residential",
    items: [
      "Single-Family Residential", "Two-Family / Duplex", "Townhouse / Rowhouse",
      "Multi-Family Residential (3+ units)", "Apartment Building", "Condominium",
      "Accessory Dwelling Unit (ADU)", "Residential Addition",
      "Residential Renovation / Alteration",
    ],
  },
  {
    label: "Commercial",
    items: [
      "Commercial (General)", "Office Building", "Retail / Mercantile",
      "Restaurant / Food Service", "Hotel / Motel", "Mixed-Use Development",
      "Tenant Improvement (TI)", "Shell & Core",
    ],
  },
  {
    label: "Industrial",
    items: [
      "Industrial (General)", "Warehouse / Distribution", "Manufacturing Facility",
      "Data Center", "Laboratory / R&D", "Cold Storage / Refrigerated",
    ],
  },
  {
    label: "Healthcare",
    items: [
      "Healthcare (General)", "Hospital", "Medical Office Building",
      "Urgent Care / Clinic", "Assisted Living / Senior Care",
      "Nursing Home / Skilled Nursing",
    ],
  },
  {
    label: "Educational",
    items: [
      "Educational (General)", "K-12 School", "University / College",
      "Daycare / Childcare Center",
    ],
  },
  {
    label: "Institutional",
    items: [
      "Religious / Place of Worship", "Government Building", "Courthouse",
      "Library", "Museum / Gallery", "Community Center",
    ],
  },
  {
    label: "Assembly",
    items: [
      "Assembly (General)", "Theater / Performing Arts", "Arena / Stadium",
      "Convention Center", "Nightclub / Bar", "Recreation / Fitness Center",
    ],
  },
  {
    label: "Specialty",
    items: [
      "Parking Garage / Structure", "Gas Station / Auto Service", "Car Wash",
      "Self-Storage Facility", "Agricultural Building", "Utility / Infrastructure",
    ],
  },
  {
    label: "Site Work",
    items: [
      "Site / Civil Only", "Raze / Demolition", "Utility Service Work",
      "Landscape / Hardscape",
    ],
  },
];

export const analyzerCodeYears = [
  "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2015", "2012",
];

export const DC_JURISDICTION = "Washington D.C. (12A DCMR)";
export const DC_CODE_EDITION = "2017";
export const DC_CODE_CONTEXT = "2017 District of Columbia Construction Codes (2015 IBC base)";

export function jurisdictionKeyFor(label: string): string {
  if (label === DC_JURISDICTION) return "dc";
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function defaultCodeYearForAnalyzer(jurisdiction: string): string {
  const value = jurisdiction.toLowerCase();
  if (value.includes("d.c.") || value.includes("dcmr")) return "2017";
  if (/florida|miami-dade|broward|orlando|, fl/.test(value)) return "2023";
  if (/maryland|, md/.test(value)) return "2021";
  if (value.includes("new york city")) return "2022";
  if (value.includes("chicago")) return "2019";
  if (/los angeles|san francisco|san diego/.test(value)) return "2023";
  return "2021";
}

export function codeContextForAnalyzer(jurisdiction: string, year: string): string {
  if (jurisdiction === DC_JURISDICTION && year === DC_CODE_EDITION) {
    return DC_CODE_CONTEXT;
  }
  return `${jurisdiction} — selected ${year} reference context; adopted-edition and technical-text coverage not independently verified`;
}
