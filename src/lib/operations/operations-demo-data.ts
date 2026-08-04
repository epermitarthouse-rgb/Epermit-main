/**
 * Lovable Operations Board fixtures — illustrative only.
 * Never persist, never merge into real totals/CSV/mutations.
 * Fixture project names (Langston / Rockville) must not inherit the selected real project.
 */

import type {
  MockReimbursable,
  MockScopeLine,
  MockSubitem,
  MockWorkflowGroup,
} from "./operations-types";

export const MOCK_FIXTURE_PROJECTS = ["Langston Blvd", "Rockville Pike"] as const;

export const MOCK_BOARD_TITLE =
  "RBD-L/C 450011 · NSN 445-4834 Langston Blvd";

export const langstonReimbursables: MockReimbursable[] = [
  { item: "RBD-L/C 450011 · SWM Agreement", logged: "Jan 18, 2024", project: "Langston Blvd", permitNo: "TBD", description: "SWM Agreement Recording", amount: 31, team: "IS", invoiced: "Invoiced", invoice: "2663", payment: "Done", progress: 100 },
  { item: "RBD-L/C 450011 · FedEx (Building)", logged: "Nov 28, 2023", project: "Langston Blvd", permitNo: "TBD", description: "FedEx – Building Permit set", amount: 23.01, team: "IS", invoiced: "Invoiced", invoice: "2663", payment: "Done", progress: 100 },
  { item: "Building Permit", logged: "Mar 6, 2024", project: "Langston Blvd", permitNo: "CNEW24-00737", description: "Building Permit Fee", amount: 1188.94, team: "IS", invoiced: "Invoiced", invoice: "2663", payment: "Done", progress: 100 },
  { item: "VDOT Land Disturbing / SWM", logged: "Mar 3, 2024", project: "Langston Blvd", permitNo: "LDAP23-00156", description: "LDA Stormwater Review", amount: 1160.51, team: "IS", invoiced: "Invoiced", invoice: "2663", payment: "Done", progress: 100 },
  { item: "FedEx Label", logged: "Sep 19, 2024", project: "Langston Blvd", permitNo: "—", description: "Printing / Certified Mailing", amount: 167, team: "IS", invoiced: "Invoiced", invoice: "2801", payment: "Done", progress: 100 },
  { item: "Printing Fee", logged: "Sep 19, 2024", project: "Langston Blvd", permitNo: "—", description: "Printing Fee", amount: 581, team: "IS", invoiced: "Invoiced", invoice: "2801", payment: "Done", progress: 100 },
  { item: "Printing – Certified Mailing", logged: "Apr 30, 2025", project: "Langston Blvd", permitNo: "DEMO Permit", description: "Certified Mailing", amount: 80.62, team: "IS", invoiced: "Invoiced", invoice: "2947", payment: "Done", progress: 100 },
  { item: "Permit for Patio – FEE", logged: "Sep 3, 2025", project: "Langston Blvd", permitNo: "CADD25-03835", description: "Debit Card", amount: 362.78, team: "IS", invoiced: "Invoiced", invoice: "2947", payment: "Done", progress: 100 },
  { item: "Revision Fee", logged: "Sep 11, 2025", project: "Langston Blvd", permitNo: "CNEW24-00737", description: "Debit Card", amount: 1204.84, team: "IS", invoiced: "Invoiced", invoice: "2947", payment: "Done", progress: 100 },
  { item: "C of O Fee", logged: "Dec 30, 2025", project: "Langston Blvd", permitNo: "COFO25-00233", description: "Certificate of Occupancy", amount: 0, team: "GC", invoiced: "Paid by GC", invoice: "—", payment: "Paid by GC", progress: 100 },
];

export const rockvilleReimbursables: MockReimbursable[] = [
  { item: "FedEx (Filing)", logged: "Oct 10, 2023", project: "Rockville Pike", permitNo: "TBD", description: "FedEx – Filing Set", amount: 23.4, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "Condition Use Fee", logged: "Oct 10, 2023", project: "Rockville Pike", permitNo: "TBD", description: "Zoning Condition Use", amount: 1512.5, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "Condition Use Transmittal", logged: "Jan 23, 2024", project: "Rockville Pike", permitNo: "TBD", description: "Transmittal Fee", amount: 220, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "Health Review Fee", logged: "Jan 24, 2024", project: "Rockville Pike", permitNo: "TBD", description: "Health Dept Review", amount: 330, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "WSSC Fees", logged: "Feb 5, 2024", project: "Rockville Pike", permitNo: "TBD", description: "WSSC Water/Sewer Fees", amount: 4865.89, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "Building Filing", logged: "Feb 8, 2024", project: "Rockville Pike", permitNo: "TBD", description: "Building Filing Fee", amount: 1751.59, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "Utility Location", logged: "Mar 4, 2024", project: "Rockville Pike", permitNo: "TBD", description: "Utility Locate", amount: 2321.25, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "Fire Flow Test", logged: "Apr 10, 2024", project: "Rockville Pike", permitNo: "TBD", description: "Fire Flow Test", amount: 690, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "Utility Fee – PEPCO", logged: "May 21, 2024", project: "Rockville Pike", permitNo: "TBD", description: "PEPCO Service", amount: 11953.1, team: "IS", invoiced: "Invoiced", invoice: "2612", payment: "Done", progress: 100 },
  { item: "Permit Fee – Interim", logged: "Aug 9, 2024", project: "Rockville Pike", permitNo: "TBD", description: "Interim Permit Fee", amount: 1946.7, team: "IS", invoiced: "Invoiced", invoice: "2694", payment: "Done", progress: 100 },
  { item: "U&O Permit", logged: "Aug 9, 2024", project: "Rockville Pike", permitNo: "TBD", description: "U&O Permit", amount: 383.93, team: "IS", invoiced: "Invoiced", invoice: "2694", payment: "Done", progress: 100 },
  { item: "Final Permit Fees", logged: "Sep 30, 2024", project: "Rockville Pike", permitNo: "1081112 / 1057…", description: "Final Building Permit", amount: 25480.11, team: "IS", invoiced: "Invoiced", invoice: "2694", payment: "Done", progress: 100 },
  { item: "Wash Gas Connect", logged: "Apr 3, 2025", project: "Rockville Pike", permitNo: "TBD", description: "Washington Gas Connect", amount: 6043, team: "IS", invoiced: "Invoiced", invoice: "2694", payment: "Done", progress: 100 },
];

export const allMockReimbursables: MockReimbursable[] = [
  ...langstonReimbursables,
  ...rockvilleReimbursables,
];

export const mockScopeLines: MockScopeLine[] = [
  { item: "Demo Permit", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 30, price: 3059.1 },
  { item: "Building Permitting w/ Health", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 50, price: 5098.5 },
  { item: "Land Disturbance & SWM Permitting", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 80, price: 8157.6 },
  { item: "Third Party / Special Inspections Coordination", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 10, price: 1019.7 },
  { item: "Washington Gas Utility Coordination", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 20, price: 2039.4 },
  { item: "Dominion Utility Coordination", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 20, price: 2039.4 },
  { item: "Telecom Utility Coordination", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 40, price: 4078.8 },
  { item: "VDOT Permitting", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 40, price: 4078.8 },
  { item: "Certificate of Occupancy (Final Inspections Coordination)", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 40, price: 4078.8 },
  { item: "Project Management & CM Support", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Mar 3, 2024", hours: 200, price: 20394 },
  { item: "Revision for GreaseTrap (SSPCO)", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Nov 17, 2025", hours: 0, price: 0 },
  { item: "Revision for Patio Furniture (SSPCO – Captured)", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Nov 17, 2025", hours: 0, price: 0 },
  { item: "Retaining Wall (SSPCO – Captured)", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Nov 17, 2025", hours: 0, price: 0 },
  { item: "Revisions for R-30 Spray (SSPCO)", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Dec 10, 2025", hours: 0, price: 0 },
  { item: "Occupant Signage Approval App (NEW)", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Apr 2, 2025", hours: 0, price: 0 },
  { item: "Occupancy Permit", client: "McDonald's USA", email: "Michele.Miller@us.mcd.com", dateNeeded: "Apr 2, 2025", hours: 0, price: 0 },
];

const reviewSubs = (label: "#1" | "#2", baseDate: string): MockSubitem[] => [
  { name: `Prescreen Review ${label}`, approved: label === "#1" ? "Done" : "Open", completion: baseDate, dependsOn: label === "#2" ? `Prescreen Review #1` : undefined },
  { name: `Mechanical Review ${label}`, approved: "Open", completion: baseDate, dependsOn: `Prescreen Review ${label}` },
  { name: `Water and Sewer Review ${label}`, approved: "Open", completion: baseDate, dependsOn: `Prescreen Review ${label}` },
  { name: `Plumbing Review ${label}`, approved: "Open", completion: baseDate, dependsOn: `Prescreen Review ${label}` },
  { name: `Electrical Review ${label}`, approved: "Open", completion: baseDate, dependsOn: `Prescreen Review ${label}` },
  { name: `Zoning Review ${label}`, approved: "Open", completion: baseDate, dependsOn: `Prescreen Review ${label}` },
  { name: `Health Review ${label}`, approved: "Open", completion: baseDate, dependsOn: `Prescreen Review ${label}` },
  { name: `Fire Review ${label}`, approved: "Open", completion: baseDate, dependsOn: `Prescreen Review ${label}` },
  { name: `Energy Review ${label}`, approved: "Open", completion: baseDate, dependsOn: `Prescreen Review ${label}` },
];

/** Illustrative PM workflow — not tied to any selected PermitPilot project. */
export const mockWorkflowGroups: MockWorkflowGroup[] = [
  {
    name: "Pre-Lease, Lease and Rent Due",
    accent: "hsl(45 92% 55%)",
    tasks: [
      { name: "Commun-ET LLC Proposal Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Done", completion: "Jan 21, 2022", progress: 100 },
      { name: "Commun-ET LLC Proposal Submitted", cp: "NCP", owner: "Commun-ET LLC", status: "Done", completion: "Jan 26, 2022", progress: 100 },
      { name: "Commun-ET LLC Proposal Approved", cp: "NCP", owner: "Commun-ET LLC", status: "Done", completion: "Feb 2, 2022", progress: 100 },
      { name: "Onboarding of Site Survey Design Team", cp: "NCP", owner: "Commun-ET LLC", status: "Done", completion: "Feb 9, 2022", progress: 100 },
      { name: "Initial Site Survey", cp: "NCP", owner: "Commun-ET LLC", status: "Done", completion: "Feb 22, 2022", progress: 100 },
      { name: "Initial Site Investigation Report Drafted", cp: "NCP", owner: "Commun-ET LLC", status: "Working", completion: "Mar 1, 2022", progress: 70 },
      { name: "1st Site Investigation Review Call Complete", cp: "NCP", owner: "Commun-ET LLC", status: "Working", completion: "Mar 2, 2022", progress: 40 },
      { name: "Finalization of Enhanced Site Investigation", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Mar 14, 2022", progress: 0 },
      { name: "Letter of Intent Transmittal", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Mar 1, 2022", progress: 0 },
      { name: "Lease Execution", cp: "CP", owner: "Client", status: "Not Started", completion: "May 13, 2022", progress: 0 },
      { name: "Design NTP", cp: "CP", owner: "Client", status: "Not Started", completion: "Mar 8, 2022", progress: 0 },
      { name: "Plans Submitted to LL", cp: "CP", owner: "Architect", status: "Not Started", completion: "Apr 6, 2022", progress: 0 },
      { name: "Permitting NTP", cp: "CP", owner: "Client", status: "Not Started", completion: "May 3, 2022", progress: 0 },
      { name: "LL Approval on Wingstop Plans", cp: "CP", owner: "Landlord", status: "Not Started", completion: "Jun 2, 2022", progress: 0 },
      { name: "Rent Due", cp: "CP", owner: "Client", status: "Not Started", completion: "Sep 16, 2022", progress: 0 },
    ],
  },
  {
    name: "Contractor Onboarding",
    accent: "hsl(200 90% 60%)",
    tasks: [
      { name: "Bid At Risk Evaluation Complete", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 7, 2022", progress: 0 },
      { name: "Bid NTP", cp: "CP", owner: "Client", status: "Not Started", completion: "Apr 8, 2022", progress: 0 },
      { name: "Request for Bidders", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 11, 2022", progress: 0 },
      { name: "Bids Received Back", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 22, 2022", progress: 0 },
      { name: "CMs Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 29, 2022", progress: 0 },
      { name: "GC & Subcontractor Team Chosen", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 2, 2022", progress: 0 },
      { name: "GC & Subcontractor Team Onboarding", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 6, 2022", progress: 0 },
      { name: "Construction Schedule Drafting Complete", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 13, 2022", progress: 0 },
      { name: "Construction, Permitting & Inspections Sync", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 18, 2022", progress: 0 },
      { name: "Finalization of Enhanced Construction Schedule", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 20, 2022", progress: 0 },
    ],
  },
  {
    name: "Change of Use",
    accent: "hsl(280 70% 65%)",
    tasks: [
      { name: "Application Submittal", cp: "CP", owner: "Commun-ET LLC", status: "Done", completion: "May 9, 2022", progress: 100 },
      { name: "Filing Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Done", completion: "May 10, 2022", progress: 100 },
      { name: "Prescreen Review", cp: "NCP", owner: "Commun-ET LLC", status: "Working", completion: "May 11, 2022", progress: 50 },
      { name: "Zoning Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 13, 2022", progress: 0 },
      { name: "Final Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 18, 2022", progress: 0 },
      { name: "Permit Issuance", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 19, 2022", progress: 0 },
    ],
  },
  {
    name: "Building Permit",
    accent: "hsl(24 95% 55%)",
    tasks: [
      { name: "Application Submittal", cp: "CP", owner: "Commun-ET LLC", status: "Done", completion: "May 9, 2022", progress: 100 },
      { name: "Filing Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Done", completion: "May 10, 2022", progress: 100 },
      { name: "Building Permit Review #1", cp: "NCP", owner: "Commun-ET LLC", status: "Working", completion: "May 31, 2022", progress: 60, subitems: reviewSubs("#1", "Jan 3, 2022") },
      { name: "Responses to Comments", cp: "NCP", owner: "Commun-ET LLC", status: "Working", completion: "Jun 14, 2022", progress: 40 },
      { name: "1st Resubmission", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 15, 2022", progress: 0 },
      { name: "Building Permit Review #2", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 6, 2022", progress: 0, subitems: reviewSubs("#2", "Jul 1, 2022") },
      { name: "Final Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 7, 2022", progress: 0 },
      { name: "Building Permit Issuance", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 8, 2022", progress: 0 },
    ],
  },
  {
    name: "Health Plan Review",
    accent: "hsl(150 65% 45%)",
    tasks: [
      { name: "Health Application Submittal", cp: "CP", owner: "Commun-ET LLC", status: "Working", completion: "May 12, 2022", progress: 50 },
      { name: "Health Review #1", cp: "NCP", owner: "Health Dept", status: "Not Started", completion: "Jun 1, 2022", progress: 0 },
      { name: "Health Responses", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 10, 2022", progress: 0 },
      { name: "Health Approval Issued", cp: "CP", owner: "Health Dept", status: "Not Started", completion: "Jun 20, 2022", progress: 0 },
    ],
  },
  {
    name: "Pre-Construction Meetings",
    accent: "hsl(190 80% 55%)",
    tasks: [
      { name: "Site Pre-Construction Meeting", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 12, 2022", progress: 0 },
      { name: "Building Pre-Construction Meeting", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
    ],
  },
  {
    name: "Signage Coordination",
    accent: "hsl(340 75% 60%)",
    tasks: [
      { name: "Request for Bidders", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 11, 2022", progress: 0 },
      { name: "Bids Received Back", cp: "NCP", owner: "Sign Contractor", status: "Not Started", completion: "Apr 22, 2022", progress: 0 },
      { name: "Wingstop CMs Review", cp: "NCP", owner: "Client", status: "Not Started", completion: "Apr 29, 2022", progress: 0 },
      { name: "Sign Contractor Team Chosen", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 2, 2022", progress: 0 },
      { name: "Sign Contractor Team Onboarding", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 6, 2022", progress: 0 },
      { name: "Signage Ordered", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 2, 2022", progress: 0 },
      { name: "Sign Permit Application Submittal", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 16, 2022", progress: 0 },
      { name: "Filing Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 17, 2022", progress: 0 },
      { name: "Prescreen Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 18, 2022", progress: 0 },
      { name: "Building Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 8, 2022", progress: 0 },
      { name: "Electrical Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 8, 2022", progress: 0 },
      { name: "Zoning Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 9, 2022", progress: 0 },
      { name: "Final Fee Payment", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 10, 2022", progress: 0 },
      { name: "Permit Issuance", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jul 21, 2022", progress: 0 },
      { name: "Signage Delivered", cp: "CP", owner: "Sign Contractor", status: "Not Started", completion: "Jul 25, 2022", progress: 0 },
      { name: "Sign Install", cp: "CP", owner: "Sign Contractor", status: "Not Started", completion: "Jul 28, 2022", progress: 0 },
    ],
  },
  {
    name: "FOH Equipment Coordination",
    accent: "hsl(260 70% 65%)",
    tasks: [
      { name: "POS Quote Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 16, 2022", progress: 0 },
      { name: "POS Quote Received", cp: "NCP", owner: "POS Company", status: "Not Started", completion: "May 20, 2022", progress: 0 },
      { name: "POS Contract Signed", cp: "CP", owner: "Client", status: "Not Started", completion: "Jun 1, 2022", progress: 0 },
      { name: "POS Delivery", cp: "CP", owner: "POS Company", status: "Not Started", completion: "Aug 1, 2022", progress: 0 },
      { name: "POS Installed", cp: "CP", owner: "POS Company", status: "Not Started", completion: "Aug 5, 2022", progress: 0 },
      { name: "Beverage Dispenser Quote Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 16, 2022", progress: 0 },
      { name: "Beverage Dispenser Quote Received", cp: "NCP", owner: "Beverage Vendor", status: "Not Started", completion: "May 20, 2022", progress: 0 },
      { name: "Beverage Dispenser Contract Signed", cp: "CP", owner: "Client", status: "Not Started", completion: "Jun 1, 2022", progress: 0 },
      { name: "Beverage Dispenser Delivery", cp: "CP", owner: "Beverage Vendor", status: "Not Started", completion: "Aug 1, 2022", progress: 0 },
      { name: "Beverage Dispenser Installed", cp: "CP", owner: "General Contractor", status: "Not Started", completion: "Aug 5, 2022", progress: 0 },
      { name: "CO2 Quote Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 16, 2022", progress: 0 },
      { name: "CO2 Quote Received", cp: "NCP", owner: "CO2 Vendor", status: "Not Started", completion: "May 20, 2022", progress: 0 },
      { name: "CO2 Contract Signed", cp: "CP", owner: "Client", status: "Not Started", completion: "Jun 1, 2022", progress: 0 },
      { name: "CO2 Delivery", cp: "CP", owner: "CO2 Vendor", status: "Not Started", completion: "Aug 1, 2022", progress: 0 },
      { name: "CO2 Installed", cp: "CP", owner: "General Contractor", status: "Not Started", completion: "Aug 5, 2022", progress: 0 },
    ],
  },
  {
    name: "Decor Coordination",
    accent: "hsl(20 85% 60%)",
    tasks: [
      { name: "Decor At Risk Evaluation Complete", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 7, 2022", progress: 0 },
      { name: "Decor NTP", cp: "CP", owner: "Client", status: "Not Started", completion: "Apr 8, 2022", progress: 0 },
      { name: "Decor Quote Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 11, 2022", progress: 0 },
      { name: "Decor Quote Received", cp: "NCP", owner: "Decor Vendor", status: "Not Started", completion: "Apr 18, 2022", progress: 0 },
      { name: "Decor Contract Signed", cp: "CP", owner: "Client", status: "Not Started", completion: "Apr 22, 2022", progress: 0 },
      { name: "Decor Delivery", cp: "CP", owner: "Decor Vendor", status: "Not Started", completion: "Jul 11, 2022", progress: 0 },
      { name: "Decor Installed", cp: "CP", owner: "Decor Vendor", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
      { name: "Window Coverings Quote Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "May 16, 2022", progress: 0 },
      { name: "Window Coverings Quote Received", cp: "NCP", owner: "Window Vendor", status: "Not Started", completion: "May 20, 2022", progress: 0 },
      { name: "Window Coverings Contract Signed", cp: "CP", owner: "Client", status: "Not Started", completion: "Jun 1, 2022", progress: 0 },
      { name: "Window Coverings Delivery", cp: "CP", owner: "Window Vendor", status: "Not Started", completion: "Aug 1, 2022", progress: 0 },
      { name: "Window Coverings Installed", cp: "CP", owner: "General Contractor", status: "Not Started", completion: "Aug 5, 2022", progress: 0 },
    ],
  },
  {
    name: "Kitchen Equipment & Millwork Coordination",
    accent: "hsl(45 92% 55%)",
    tasks: [
      { name: "Kitchen Equipment & Millwork At Risk Evaluation", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 7, 2022", progress: 0 },
      { name: "Kitchen Equipment & Millwork NTP", cp: "CP", owner: "Client", status: "Not Started", completion: "Apr 8, 2022", progress: 0 },
      { name: "Kitchen Equipment Quote Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 11, 2022", progress: 0 },
      { name: "Kitchen Equipment Quote Received", cp: "NCP", owner: "Kitchen Vendor", status: "Not Started", completion: "Apr 18, 2022", progress: 0 },
      { name: "Kitchen Equipment Contract Signed", cp: "CP", owner: "Client", status: "Not Started", completion: "Apr 22, 2022", progress: 0 },
      { name: "Kitchen Equipment Shop Drawings", cp: "NCP", owner: "Kitchen Vendor", status: "Not Started", completion: "Apr 25, 2022", progress: 0 },
      { name: "Kitchen Equipment Delivery", cp: "CP", owner: "Kitchen Vendor", status: "Not Started", completion: "Jul 11, 2022", progress: 0 },
      { name: "Kitchen Equipment Install", cp: "CP", owner: "General Contractor", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
    ],
  },
  {
    name: "Water & Sewer Authority Coordination",
    accent: "hsl(200 90% 60%)",
    tasks: [
      { name: "Water and Sewer Utility Application(s) Submittal", cp: "CP", owner: "Landlord", status: "Not Started", completion: "May 9, 2022", progress: 0 },
      { name: "Water and Sewer Utility Application(s) Design", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 4, 2022", progress: 0 },
      { name: "Water and Sewer Utility Application(s) Design Approval", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
      { name: "Inspection Updated in JHA's system", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 20, 2022", progress: 0 },
      { name: "Water and Sewer Utility Construction Schedule", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 25, 2022", progress: 0 },
      { name: "Water and Sewer Installed", cp: "CP", owner: "Landlord", status: "Not Started", completion: "Aug 10, 2022", progress: 0 },
      { name: "Wingstop Water and Sewer Account Set Up", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Aug 15, 2022", progress: 0 },
    ],
  },
  {
    name: "Gas Utility Coordination",
    accent: "hsl(30 90% 55%)",
    tasks: [
      {
        name: "Gas New Service Submittal Completed",
        cp: "CP",
        owner: "Landlord",
        status: "Not Started",
        completion: "May 9, 2022",
        progress: 0,
        subitems: [
          { name: "Service Application", approved: "N/A", completion: "—" },
          { name: "Site Plan Showing Gas Lines", approved: "N/A", completion: "—" },
          { name: "Construction Schedule", approved: "N/A", completion: "—" },
          { name: "MEP Drawings", approved: "N/A", completion: "—" },
          { name: "OO Utility Coordination Confirmation", approved: "N/A", completion: "—" },
        ],
      },
      { name: "Design and Cost Agreement Received", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 4, 2022", progress: 0 },
      { name: "Service Cost Agreement Signed and Returned", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
      { name: "Gas Line Inspection Updated in JHA's System", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 20, 2022", progress: 0 },
      { name: "Gas New Service Installation", cp: "CP", owner: "Landlord", status: "Not Started", completion: "Aug 5, 2022", progress: 0 },
      { name: "Gas Account Set Up", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Aug 10, 2022", progress: 0 },
    ],
  },
  {
    name: "Electrical Utility Coordination",
    accent: "hsl(50 95% 55%)",
    tasks: [
      {
        name: "Service Submittal Completed",
        cp: "CP",
        owner: "Landlord",
        status: "Not Started",
        completion: "May 9, 2022",
        progress: 0,
        subitems: [
          { name: "Service App", approved: "N/A", completion: "—" },
          { name: "Structural Facility Drawings", approved: "N/A", completion: "—" },
          { name: "MEP Drawings", approved: "N/A", completion: "—" },
          { name: "Construction Schedule", approved: "N/A", completion: "—" },
          { name: "OO Utility Coordination Confirmation", approved: "N/A", completion: "—" },
        ],
      },
      { name: "Design and Cost Agreement Received", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 4, 2022", progress: 0 },
      { name: "Service Cost Agreement Signed and Returned", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
      { name: "Inspection Updated in JHA's System", cp: "NCP", owner: "Landlord", status: "Not Started", completion: "Jul 20, 2022", progress: 0 },
      { name: "New Service Installation", cp: "CP", owner: "Landlord", status: "Not Started", completion: "Aug 5, 2022", progress: 0 },
      { name: "Electrical Utility Account Set Up", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Aug 10, 2022", progress: 0 },
    ],
  },
  {
    name: "Fire Suppression / Ansul Coordination",
    accent: "hsl(0 85% 60%)",
    tasks: [
      { name: "Fire Suppression/Ansul At Risk Evaluation Complete", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 7, 2022", progress: 0 },
      { name: "Fire Suppression/Ansul NTP", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 8, 2022", progress: 0 },
      { name: "Fire Suppression/Ansul Quote Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 11, 2022", progress: 0 },
      { name: "Fire Suppression/Ansul Quote Received", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 18, 2022", progress: 0 },
      { name: "Fire Suppression/Ansul Quote/Contract Signed", cp: "CP", owner: "Fire Suppression Co", status: "Not Started", completion: "Apr 22, 2022", progress: 0 },
      { name: "Fire Suppression/Ansul Shop Drawings Provided", cp: "NCP", owner: "Fire Suppression Co", status: "Not Started", completion: "Apr 25, 2022", progress: 0 },
      { name: "Application Submittal", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 26, 2022", progress: 0 },
      { name: "Filing Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 27, 2022", progress: 0 },
      { name: "Prescreen Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 28, 2022", progress: 0 },
      { name: "Fire Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 9, 2022", progress: 0 },
      { name: "Final Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 10, 2022", progress: 0 },
      { name: "Permit Issuance", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 10, 2022", progress: 0 },
      { name: "Fire Suppression/Ansul Delivery", cp: "CP", owner: "Fire Suppression Co", status: "Not Started", completion: "Jul 11, 2022", progress: 0 },
      { name: "Fire Suppression/Ansul Install", cp: "CP", owner: "General Contractor", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
    ],
  },
  {
    name: "Fire Sprinkler Coordination",
    accent: "hsl(210 90% 60%)",
    tasks: [
      { name: "Fire Sprinkler At Risk Evaluation Complete", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 7, 2022", progress: 0 },
      { name: "Fire Sprinkler NTP", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 8, 2022", progress: 0 },
      { name: "Sprinkler System Quote Requested", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 11, 2022", progress: 0 },
      { name: "Sprinkler System Quote Received", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 18, 2022", progress: 0 },
      { name: "Sprinkler System Quote/Contract Signed", cp: "NCP", owner: "Sprinkler Company", status: "Not Started", completion: "Apr 22, 2022", progress: 0 },
      { name: "Sprinkler Shop Drawings Provided", cp: "CP", owner: "Sprinkler Company", status: "Not Started", completion: "Apr 25, 2022", progress: 0 },
      { name: "Application Submittal", cp: "NCP", owner: "Sprinkler Company", status: "Not Started", completion: "Apr 26, 2022", progress: 0 },
      { name: "Filing Fee Payment", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 27, 2022", progress: 0 },
      { name: "Prescreen Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 28, 2022", progress: 0 },
      { name: "Fire Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 9, 2022", progress: 0 },
      { name: "Final Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 10, 2022", progress: 0 },
      { name: "Permit Issuance", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 10, 2022", progress: 0 },
      { name: "Sprinkler System Delivery", cp: "CP", owner: "Sprinkler Company", status: "Not Started", completion: "Jul 11, 2022", progress: 0 },
      { name: "Sprinkler System Install", cp: "CP", owner: "General Contractor", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
    ],
  },
  {
    name: "Fire Alarm Coordination",
    accent: "hsl(15 90% 55%)",
    tasks: [
      { name: "Fire Alarm At Risk Evaluation Complete", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 7, 2022", progress: 0 },
      { name: "Fire Alarm NTP", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 8, 2022", progress: 0 },
      { name: "Fire Alarm Shop Drawings Provided", cp: "NCP", owner: "Fire Alarm Company", status: "Not Started", completion: "Apr 25, 2022", progress: 0 },
      { name: "Application Submittal", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 26, 2022", progress: 0 },
      { name: "Filing Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 27, 2022", progress: 0 },
      { name: "Prescreen Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Apr 28, 2022", progress: 0 },
      { name: "Fire Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 9, 2022", progress: 0 },
      { name: "Final Fee Payment", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 10, 2022", progress: 0 },
      { name: "Permit Issuance", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Jun 10, 2022", progress: 0 },
      { name: "Fire Alarm System Delivery", cp: "CP", owner: "Fire Alarm Company", status: "Not Started", completion: "Jul 11, 2022", progress: 0 },
      { name: "Fire Alarm System Install", cp: "CP", owner: "General Contractor", status: "Not Started", completion: "Jul 15, 2022", progress: 0 },
    ],
  },
  {
    name: "Certificate of Occupancy",
    accent: "hsl(45 92% 55%)",
    tasks: [
      {
        name: "Occupancy Permit Submittal",
        cp: "CP",
        owner: "Commun-ET LLC",
        status: "Not Started",
        completion: "Sep 22, 2022",
        progress: 0,
        subitems: [
          { name: "All Inspection Reports Submitted", approved: "N/A", completion: "—" },
        ],
      },
      { name: "Occupancy Review", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Sep 29, 2022", progress: 0 },
      { name: "Fees Paid", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Sep 30, 2022", progress: 0 },
      { name: "Final Occupancy Issued", cp: "CP", owner: "Commun-ET LLC", status: "Not Started", completion: "Sep 30, 2022", progress: 0 },
    ],
  },
  {
    name: "Closeout and Store Opening",
    accent: "hsl(140 65% 50%)",
    tasks: [
      { name: "All Items Complete", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Oct 3, 2022", progress: 0 },
      { name: "Store Opening", cp: "CP", owner: "Client", status: "Not Started", completion: "Oct 3, 2022", progress: 0 },
      { name: "Permit and Utility Coordination Close Out Documentation", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Oct 3, 2022", progress: 0 },
      { name: "Reimbursable Reconciliation", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Oct 3, 2022", progress: 0 },
      { name: "Commun-ET PO Closeout", cp: "NCP", owner: "Commun-ET LLC", status: "Not Started", completion: "Oct 3, 2022", progress: 0 },
    ],
  },
];

export function filterMockReimbursables(
  rows: MockReimbursable[],
  query: string,
): MockReimbursable[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.item.toLowerCase().includes(q) ||
      r.project.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.permitNo.toLowerCase().includes(q),
  );
}

export function filterMockScopeLines(rows: MockScopeLine[], query: string): MockScopeLine[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.item.toLowerCase().includes(q) ||
      r.client.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q),
  );
}

export function filterMockWorkflowGroups(
  groups: MockWorkflowGroup[],
  query: string,
): MockWorkflowGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      tasks: g.tasks.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.owner.toLowerCase().includes(q) ||
          g.name.toLowerCase().includes(q),
      ),
    }))
    .filter((g) => g.tasks.length > 0);
}

export function mockReimbursableTotals(rows: MockReimbursable[]) {
  const sum = rows.reduce((acc, r) => acc + r.amount, 0);
  const invoiced = rows.filter((r) => r.invoiced === "Invoiced").length;
  const paidByGc = rows.filter((r) => r.invoiced === "Paid by GC").length;
  return { sum, invoiced, paidByGc, count: rows.length };
}

export function mockScopeTotals(rows: MockScopeLine[]) {
  const hours = rows.reduce((a, s) => a + s.hours, 0);
  const dollars = rows.reduce((a, s) => a + s.price, 0);
  return { hours, dollars };
}

export function mockCriticalPathTaskCount(groups: MockWorkflowGroup[] = mockWorkflowGroups) {
  return groups.flatMap((g) => g.tasks).filter((t) => t.cp === "CP").length;
}
