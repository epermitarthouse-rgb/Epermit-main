export type Group = { region: string; items: string[] };

export const jurisdictionGroups: Group[] = [
  {
    region: "National / Model Codes",
    items: [
      "General IBC (International Building Code)",
      "IRC (Residential)",
      "IECC (Energy)",
      "IFC (Fire)",
      "IPC (Plumbing)",
      "IMC (Mechanical)",
      "IFGC (Fuel Gas)",
      "IEBC (Existing Buildings)",
      "IgCC (Green Construction)",
      "ICC A117.1 (Accessibility)",
      "ASHRAE 90.1 / 62.1",
      "NFPA 1 / 13 / 72 / 101",
      "ADA 2010 Standards",
    ],
  },
  {
    region: "Mid-Atlantic",
    items: [
      "Washington D.C. (12A DCMR)",
      "Maryland (MSBC)",
      "Montgomery County, MD",
      "Prince George's County, MD",
      "Baltimore City, MD",
      "Arlington County, VA",
      "Fairfax County, VA",
      "Loudoun County, VA",
      "Alexandria, VA",
      "Richmond, VA",
    ],
  },
  {
    region: "Southeast",
    items: [
      "Florida Building Code (FBC)",
      "Miami-Dade County, FL (HVHZ)",
      "Broward County, FL",
      "Orlando, FL",
      "Tampa, FL",
      "Jacksonville, FL",
      "North Carolina",
      "Charlotte, NC",
      "Raleigh, NC",
      "South Carolina",
      "Charleston, SC",
      "Tennessee",
      "Nashville, TN",
      "Alabama",
      "Birmingham, AL",
      "Atlanta, GA",
      "Savannah, GA",
    ],
  },
  {
    region: "Northeast",
    items: [
      "New York City (NYCBC)",
      "Boston, MA",
      "Philadelphia, PA",
      "Newark, NJ",
      "Hartford, CT",
      "Providence, RI",
    ],
  },
  {
    region: "Midwest / Central",
    items: [
      "Chicago, IL",
      "Detroit, MI",
      "Minneapolis, MN",
      "Kansas City, MO",
      "Indianapolis, IN",
      "Columbus, OH",
      "Milwaukee, WI",
    ],
  },
  {
    region: "South Central",
    items: [
      "Dallas, TX",
      "Houston, TX",
      "Austin, TX",
      "San Antonio, TX",
      "Oklahoma City, OK",
      "New Orleans, LA",
    ],
  },
  {
    region: "Mountain / West",
    items: [
      "Denver, CO",
      "Phoenix, AZ",
      "Las Vegas, NV",
      "Salt Lake City, UT",
      "Albuquerque, NM",
      "Boise, ID",
    ],
  },
  {
    region: "Pacific",
    items: [
      "Los Angeles, CA",
      "San Francisco, CA",
      "San Diego, CA",
      "Seattle, WA",
      "Portland, OR",
      "Honolulu, HI",
      "Anchorage, AK",
    ],
  },
];

export const projectTypeGroups: Group[] = [
  {
    region: "Residential",
    items: [
      "Single-Family Residential",
      "Two-Family / Duplex",
      "Townhouse / Rowhouse",
      "Multi-Family Residential (3+ units)",
      "Apartment Building",
      "Condominium",
      "Accessory Dwelling Unit (ADU)",
      "Residential Addition",
      "Residential Renovation / Alteration",
    ],
  },
  {
    region: "Commercial",
    items: [
      "Commercial (General)",
      "Office Building",
      "Retail / Mercantile",
      "Restaurant / Food Service",
      "Hotel / Motel",
      "Mixed-Use Development",
      "Tenant Improvement (TI)",
      "Shell & Core",
    ],
  },
  {
    region: "Industrial",
    items: [
      "Industrial (General)",
      "Warehouse / Distribution",
      "Manufacturing Facility",
      "Data Center",
      "Laboratory / R&D",
      "Cold Storage / Refrigerated",
    ],
  },
  {
    region: "Healthcare",
    items: [
      "Healthcare (General)",
      "Hospital",
      "Medical Office Building",
      "Urgent Care / Clinic",
      "Assisted Living / Senior Care",
      "Nursing Home / Skilled Nursing",
    ],
  },
  {
    region: "Educational",
    items: [
      "Educational (General)",
      "K-12 School",
      "University / College",
      "Daycare / Childcare Center",
    ],
  },
  {
    region: "Institutional",
    items: [
      "Religious / Place of Worship",
      "Government Building",
      "Courthouse",
      "Library",
      "Museum / Gallery",
      "Community Center",
    ],
  },
  {
    region: "Assembly",
    items: [
      "Assembly (General)",
      "Theater / Performing Arts",
      "Arena / Stadium",
      "Convention Center",
      "Nightclub / Bar",
      "Recreation / Fitness Center",
    ],
  },
  {
    region: "Specialty",
    items: [
      "Parking Garage / Structure",
      "Gas Station / Auto Service",
      "Car Wash",
      "Self-Storage Facility",
      "Agricultural Building",
      "Utility / Infrastructure",
    ],
  },
  {
    region: "Site Work",
    items: [
      "Site / Civil Only",
      "Raze / Demolition",
      "Utility Service Work",
      "Landscape / Hardscape",
    ],
  },
];

export const codeYears = ["2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2015", "2012"];

export const defaultCodeYearFor = (jurisdiction: string): string => {
  const j = jurisdiction.toLowerCase();
  if (j.includes("d.c.") || j.includes("dcmr")) return "2017";
  if (j.includes("florida building code") || j.includes("miami-dade") || j.includes("broward") || j.includes("orlando") || j.includes(", fl")) return "2023";
  if (j.includes("maryland") || j.includes(", md")) return "2021";
  if (j.includes("new york city")) return "2022";
  if (j.includes("chicago")) return "2019";
  if (j.includes("los angeles") || j.includes("san francisco") || j.includes("san diego")) return "2023";
  if (j.includes("seattle") || j.includes("portland")) return "2021";
  return "2021";
};

export const isHvhz = (jurisdiction: string): boolean =>
  /miami-dade|broward|hvhz/i.test(jurisdiction);