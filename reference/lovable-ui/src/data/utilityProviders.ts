// Canonical directory of utility coordination targets, sourced from
// "CommunET East Coast Utility Coverage Analysis" (July 10, 2026 expanded scope).
// Regional classifications and coordination notes are Commun-ET's own — verify
// current service territories against EIA Form 861 before external use.

export type UtilityKind = "Electric" | "Gas" | "Water" | "Telecom" | "Sanitary";
export type UtilityRegion =
  | "DMV"
  | "Northeast"
  | "Southeast"
  | "Florida"
  | "Ohio"
  | "West Virginia"
  | "Alabama"
  | "Mississippi";

export type UtilityHealth = "Good" | "Strained" | "Critical";

export type UtilityProvider = {
  name: string;
  parent?: string;
  utility: UtilityKind;
  region: UtilityRegion;
  territory: string;
  corporateContact: string;
  newServiceChannel: string;
  sla: string;
  health: UtilityHealth;
};

export const utilityProviders: UtilityProvider[] = [
  { name: "PEPCO", parent: "Exelon", utility: "Electric", region: "DMV", territory: "Washington, DC · Prince George's & Montgomery Counties, MD", corporateContact: "701 Ninth Street NW, Washington, DC 20068 · (877) 737-2662 · pepco.com", newServiceChannel: "New service assistance: (202) 833-7500 · pepco.com Doing Business With Us", sla: "Service planning 8 wk", health: "Strained" },
  { name: "BGE", parent: "Exelon", utility: "Electric", region: "DMV", territory: "Central Maryland · Baltimore metro", corporateContact: "110 West Fayette Street, Baltimore, MD 21201 · (800) 685-0123 · bge.com", newServiceChannel: "New Business regional contacts + Large Customer Services via bge.com Doing Business With Us", sla: "Service planning 7 wk", health: "Good" },
  { name: "Dominion Energy Virginia", parent: "Dominion Energy", utility: "Electric", region: "DMV", territory: "Northern VA · Fairfax · Loudoun · Richmond", corporateContact: "(866) 366-4357 · dominionenergy.com", newServiceChannel: "New service application portal on dominionenergy.com (Builders & Developers)", sla: "Service planning 6 wk", health: "Good" },
  { name: "Washington Gas (WGL)", utility: "Gas", region: "DMV", territory: "DC · MD · Northern VA", corporateContact: "(703) 750-1000 · washingtongas.com", newServiceChannel: "Builder Services: washingtongas.com/builders", sla: "Tap design 4 wk", health: "Good" },
  { name: "DC Water", utility: "Water", region: "DMV", territory: "Washington, DC", corporateContact: "(202) 612-3400 · dcwater.com", newServiceChannel: "Permit Operations · dcwater.com/permit-operations", sla: "Tap 12 wk", health: "Strained" },
  { name: "Fairfax Water", utility: "Water", region: "DMV", territory: "Fairfax County, VA", corporateContact: "(703) 698-5800 · fairfaxwater.org", newServiceChannel: "Development Services · fairfaxwater.org/development", sla: "Tap 6 wk", health: "Good" },
  { name: "Verizon FiOS", utility: "Telecom", region: "DMV", territory: "DC · MD · VA", corporateContact: "(800) 837-4966 · verizon.com", newServiceChannel: "Verizon Enhanced Communities builder program", sla: "Make-ready 5 wk", health: "Good" },
  { name: "Lumen", utility: "Telecom", region: "DMV", territory: "Regional backbone", corporateContact: "(866) 352-0291 · lumen.com", newServiceChannel: "Wholesale construction · lumen.com/wholesale", sla: "Splice window 7 wk", health: "Strained" },
  { name: "DC Water (Sewer)", utility: "Sanitary", region: "DMV", territory: "Washington, DC", corporateContact: "(202) 612-3400 · dcwater.com", newServiceChannel: "Permit Operations · dcwater.com/permit-operations", sla: "Lateral approval 8 wk", health: "Critical" },
  { name: "Con Edison", parent: "Consolidated Edison", utility: "Electric", region: "Northeast", territory: "New York City · Westchester County, NY", corporateContact: "4 Irving Place, New York, NY 10003 · (800) 752-6633 (24/7) · coned.com", newServiceChannel: "Project applications via coned.com service request channels", sla: "Design review 10 wk", health: "Strained" },
  { name: "PSE&G", parent: "Public Service Enterprise Group", utility: "Electric", region: "Northeast", territory: "New Jersey", corporateContact: "80 Park Plaza, Newark, NJ 07101 · (800) 436-7734 · nj.pseg.com", newServiceChannel: "Construction Inquiry: (800) 722-0256 · Business Solutions: (855) 249-7734", sla: "Service upgrade 8 wk", health: "Good" },
  { name: "National Grid", parent: "National Grid", utility: "Electric", region: "Northeast", territory: "Upstate NY · Massachusetts · Rhode Island", corporateContact: "Regional US offices · nationalgridus.com", newServiceChannel: "Start Service for New Construction portals (regional) · MA/RI inspection: (800) 375-7405", sla: "Service planning 9 wk", health: "Good" },
  { name: "Duke Energy Carolinas", parent: "Duke Energy", utility: "Electric", region: "Southeast", territory: "North Carolina · South Carolina", corporateContact: "Headquarters: Charlotte, NC · duke-energy.com", newServiceChannel: "Builder Portal: builderportal.duke-energy.app (electric + Piedmont gas in one request)", sla: "Service planning 6 wk", health: "Good" },
  { name: "Georgia Power", parent: "Southern Company", utility: "Electric", region: "Southeast", territory: "Georgia (statewide)", corporateContact: "241 Ralph McGill Blvd NE, Atlanta, GA 30308 · (888) 655-5888 · georgiapower.com", newServiceChannel: "New Service / Builders & Developers channels via georgiapower.com", sla: "Service planning 6 wk", health: "Good" },
  { name: "Duke Energy Florida", parent: "Duke Energy", utility: "Electric", region: "Florida", territory: "West-central & north Florida", corporateContact: "Headquarters: Charlotte, NC · duke-energy.com", newServiceChannel: "Builder Portal: builderportal.duke-energy.app", sla: "Service planning 6 wk", health: "Good" },
  { name: "Florida Power & Light", parent: "NextEra Energy", utility: "Electric", region: "Florida", territory: "East & south Florida coasts", corporateContact: "Headquarters: Juno Beach, FL · fpl.com", newServiceChannel: "FPL Project Portal · partner.fpl.com", sla: "Service planning 7 wk", health: "Good" },
  { name: "AEP Ohio", parent: "American Electric Power", utility: "Electric", region: "Ohio", territory: "Columbus + central & southern Ohio", corporateContact: "1 Riverside Plaza, Columbus, OH 43215 · (614) 716-1000 · aep.com", newServiceChannel: "AEP Ohio customer service: (800) 672-2231 · New Home / New Business forms on aepohio.com (Builders)", sla: "Service planning 7 wk", health: "Good" },
  { name: "Duke Energy Ohio", parent: "Duke Energy", utility: "Electric", region: "Ohio", territory: "Cincinnati region (electric + gas)", corporateContact: "Headquarters: Charlotte, NC · duke-energy.com", newServiceChannel: "Builder Portal: builderportal.duke-energy.app", sla: "Service planning 6 wk", health: "Good" },
  { name: "Appalachian Power", parent: "American Electric Power", utility: "Electric", region: "West Virginia", territory: "Southern & central West Virginia · SW Virginia · TN", corporateContact: "1 Riverside Plaza, Columbus, OH 43215 · (614) 716-1000 · aep.com", newServiceChannel: "New Business forms via appalachianpower.com (Builders section)", sla: "Service planning 8 wk", health: "Good" },
  { name: "Wheeling Power", parent: "American Electric Power", utility: "Electric", region: "West Virginia", territory: "Northern West Virginia (Wheeling area)", corporateContact: "aep.com · (800) 672-2231", newServiceChannel: "New Business channels via wheelingpower.com", sla: "Service planning 8 wk", health: "Good" },
  { name: "Alabama Power", parent: "Southern Company", utility: "Electric", region: "Alabama", territory: "Alabama (statewide) · ~1.5M customers", corporateContact: "alabamapower.com · (800) 245-2244", newServiceChannel: "Builders & Developers portal on alabamapower.com · applications up to 45 days in advance", sla: "Service planning 6 wk", health: "Good" },
  { name: "Mississippi Power", parent: "Southern Company", utility: "Electric", region: "Mississippi", territory: "Southeast Mississippi (23 counties)", corporateContact: "mississippipower.com · (800) 532-1502", newServiceChannel: "Business services channels via mississippipower.com", sla: "Service planning 6 wk", health: "Good" },
  { name: "Entergy Mississippi", parent: "Entergy", utility: "Electric", region: "Mississippi", territory: "45 of 82 Mississippi counties · ~459,000 customers", corporateContact: "entergymississippi.com · (800) ENTERGY / (800) 368-3749", newServiceChannel: "Builder services + online turn-on form for new residential construction", sla: "Service planning 7 wk", health: "Good" },
];

export type CoverageRow = { company: string; presence: string; materials: string };

export const eastCoastCoverage: CoverageRow[] = [
  { company: "Duke Energy", presence: "Carolinas and Florida", materials: "Duke Energy Carolinas · Duke Energy Florida" },
  { company: "Dominion Energy", presence: "Virginia and South Carolina", materials: "Dominion (DMV utility set)" },
  { company: "National Grid", presence: "New York and Massachusetts", materials: "National Grid (Northeast)" },
  { company: "Public Service Enterprise Group", presence: "New Jersey", materials: "PSE&G (Northeast pilot sites)" },
  { company: "Consolidated Edison", presence: "New York City and Westchester", materials: "Con Edison (Northeast pilot sites)" },
  { company: "Exelon", presence: "DC, Maryland, Delaware, Pennsylvania, New Jersey", materials: "PEPCO · BGE · PECO · Delmarva · Atlantic City Electric" },
  { company: "NextEra", presence: "Florida", materials: "Florida Power & Light (FPL)" },
  { company: "Southern Company", presence: "Georgia", materials: "Georgia Power (Southeast pilot sites)" },
];

export const excludedCompanies: { company: string; reason: string }[] = [
  { company: "Constellation Energy", reason: "Competitive generator and retail supplier, not a distribution utility. Does not grant service connections or set meters. Spun out of Exelon." },
  { company: "Vistra", reason: "Competitive generator and retail supplier. Same exclusion basis as Constellation." },
  { company: "American Water Works", reason: "East Coast presence in NJ, PA, and VA, but water service — not the electric and gas coordination that drives energization timelines." },
  { company: "American Electric Power", reason: "Limited East Coast presence in VA/WV. Predominantly Midwest and Texas. Included under Expanded Scope for Ohio and West Virginia." },
  { company: "Entergy", reason: "Gulf South territory (LA, MS, AR, TX). Included under Expanded Scope for Mississippi." },
  { company: "WEC Energy Group", reason: "Upper Midwest. Parent of We Energies, a Commun-ET relationship in Milwaukee, but not East Coast." },
  { company: "Exelon (Canada)", reason: "Exelon is listed with US and Canada operations; only its US East Coast subsidiaries are counted above." },
  { company: "PG&E", reason: "California." },
  { company: "Sempra Energy", reason: "California and Texas." },
  { company: "Edison International", reason: "Southern California." },
  { company: "Xcel Energy", reason: "Upper Midwest and Mountain West." },
  { company: "DTE Energy", reason: "Michigan." },
  { company: "BCE", reason: "Canadian telecommunications company, not a utility in the relevant sense. See the eastern Canada note in the Expanded Scope section." },
];

export const expandedScope: { region: string; companies: string; notes: string }[] = [
  { region: "Ohio", companies: "American Electric Power · Duke Energy", notes: "AEP Ohio (Columbus and central/southern Ohio); Duke Energy Ohio (Cincinnati region, electric + gas). Dominion no longer qualifies — it exited Ohio gas distribution and now directs Ohio gas customers to Enbridge Gas." },
  { region: "West Virginia", companies: "American Electric Power", notes: "Appalachian Power and Wheeling Power (AEP subsidiaries). Dominion divested its West Virginia gas utility (Hope Gas), so it no longer qualifies here." },
  { region: "Alabama", companies: "Southern Company", notes: "Alabama Power, serving about 1.5 million customers statewide." },
  { region: "Mississippi", companies: "Entergy · Southern Company", notes: "Entergy Mississippi (~459,000 customers across 45 of 82 counties); Mississippi Power (southeast Mississippi, a Southern Company subsidiary)." },
  { region: "Eastern Canada", companies: "None (energy) · BCE (telecom only)", notes: "No Orennia-list company operates electric or gas distribution in Atlantic Canada or Quebec. Region served by utilities absent from this list (Emera / Nova Scotia Power, Fortis, NB Power, Hydro-Québec). BCE is Montreal-headquartered telecom, not an energy utility." },
];