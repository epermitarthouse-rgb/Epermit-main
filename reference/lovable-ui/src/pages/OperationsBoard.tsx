import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Banknote,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Clock,
  Download,
  Filter,
  Plus,
  Search,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";

/**
 * Monday.com-style operations board recreated inside PermitPilot.
 * Three views: Reimbursables, Scope & Pricing, PM Workflow (grouped critical path).
 * Data mirrors the McDonald's Langston Blvd + Rockville Pike boards the
 * expediting team currently runs in Monday.
 */

type Tab = "reimbursables" | "scope" | "workflow";

type Reimbursable = {
  item: string;
  logged: string;
  project: string;
  permitNo: string;
  description: string;
  amount: number;
  team: string;
  invoiced: "Invoiced" | "Pending" | "Paid by GC";
  invoice: string;
  payment: "Done" | "Open" | "Paid by GC";
  progress: number;
};

const langston: Reimbursable[] = [
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

const rockville: Reimbursable[] = [
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
  { item: "Wash Gas Connect", logged: "Apr 3, 2025", project: "Rockville Pike", permitNo: "1081112 / 1057…", description: "Washington Gas Connect", amount: 6043, team: "IS", invoiced: "Invoiced", invoice: "2694", payment: "Done", progress: 100 },
];

type ScopeLine = {
  item: string;
  client: string;
  email: string;
  dateNeeded: string;
  hours: number;
  price: number;
};

const scope: ScopeLine[] = [
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

type Task = {
  name: string;
  cp: "CP" | "NCP";
  owner: string;
  status: "Done" | "Working" | "Stuck" | "Not Started";
  completion: string;
  progress: number;
  subitems?: Subitem[];
};

type Subitem = {
  name: string;
  approved: "Done" | "N/A" | "Open";
  completion: string;
  dependsOn?: string;
};

const reviewSubs = (label: "#1" | "#2", baseDate: string): Subitem[] => [
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

type Group = { name: string; accent: string; tasks: Task[] };

const workflow: Group[] = [
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

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const statusStyles: Record<Task["status"], string> = {
  Done: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Working: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Stuck: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  "Not Started": "bg-muted/40 text-muted-foreground border-border",
};

const invoiceStyles: Record<Reimbursable["invoiced"], string> = {
  Invoiced: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Paid by GC": "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

const OperationsBoard = () => {
  const [tab, setTab] = useState<Tab>("reimbursables");
  const [query, setQuery] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(workflow.map((g) => [g.name, true])),
  );
  const [params] = useSearchParams();
  const projectParam = params.get("project") ?? "";

  const reimbursables = useMemo(() => {
    const all = [...langston, ...rockville];
    if (!query) return all;
    const q = query.toLowerCase();
    return all.filter(
      (r) =>
        r.item.toLowerCase().includes(q) ||
        r.project.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.permitNo.toLowerCase().includes(q),
    );
  }, [query]);

  const totals = useMemo(() => {
    const sum = reimbursables.reduce((acc, r) => acc + r.amount, 0);
    const invoiced = reimbursables.filter((r) => r.invoiced === "Invoiced").length;
    const paidByGc = reimbursables.filter((r) => r.invoiced === "Paid by GC").length;
    return { sum, invoiced, paidByGc, count: reimbursables.length };
  }, [reimbursables]);

  const scopeTotals = useMemo(() => {
    const hours = scope.reduce((a, s) => a + s.hours, 0);
    const dollars = scope.reduce((a, s) => a + s.price, 0);
    return { hours, dollars };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-gradient-to-b from-muted/40 to-background">
        <div className="mx-auto max-w-[1600px] px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Operations Board · Monday.com replacement
              </p>
              <h1 className="mt-1 font-serif text-3xl leading-tight">
                RBD-L/C 450011 · NSN 445-4834 Langston Blvd
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Daily permitting, reimbursables, scope pricing and critical-path workflow –
                unified into PermitPilot. {projectParam && (
                  <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-mono">
                    project · {projectParam}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted">
                <Filter className="h-3.5 w-3.5" /> Filter
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted">
                <Users className="h-3.5 w-3.5" /> Person
              </button>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
              <Link
                to="/matrix/ai-workflow"
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                <Sparkles className="h-3.5 w-3.5" /> Auto-reconcile with AI
              </Link>
            </div>
          </div>

          {/* KPI row */}
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi icon={<Banknote className="h-4 w-4" />} label="Reimbursables tracked" value={String(langston.length + rockville.length)} sub={usd(totals.sum) + " summed"} />
            <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Invoiced line items" value={String(totals.invoiced)} sub={`${totals.paidByGc} paid by GC`} />
            <Kpi icon={<Clock className="h-4 w-4" />} label="Scope hours" value={scopeTotals.hours.toLocaleString()} sub={usd(scopeTotals.dollars) + " sum"} />
            <Kpi icon={<Sun className="h-4 w-4" />} label="Critical-path tasks" value={String(workflow.flatMap((g) => g.tasks).filter((t) => t.cp === "CP").length)} sub="Live status" />
          </div>

          {/* Tabs */}
          <div className="mt-6 flex flex-wrap items-center gap-1 border-b border-border">
            {(
              [
                { id: "reimbursables", label: "Reimbursables" },
                { id: "scope", label: "Scope & Pricing" },
                { id: "workflow", label: "PM Workflow" },
              ] as { id: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  tab === t.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 pb-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search items…"
                  className="w-56 rounded-md border border-border bg-card pl-7 pr-3 py-1.5 text-sm outline-none focus:border-primary"
                />
              </div>
              <button className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
                <Plus className="h-3.5 w-3.5" /> New item
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] px-6 py-6">
        {tab === "reimbursables" && (
          <ReimbursablesTable rows={reimbursables} totals={totals} />
        )}
        {tab === "scope" && <ScopeTable rows={scope} totals={scopeTotals} />}
        {tab === "workflow" && (
          <WorkflowGroups
            groups={workflow}
            openGroups={openGroups}
            onToggle={(g) =>
              setOpenGroups((prev) => ({ ...prev, [g]: !prev[g] }))
            }
          />
        )}
      </div>
    </div>
  );
};

const Kpi = ({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) => (
  <div className="rounded-lg border border-border bg-card p-3">
    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
      {icon} {label}
    </div>
    <div className="mt-1 font-mono text-2xl">{value}</div>
    <div className="text-xs text-muted-foreground">{sub}</div>
  </div>
);

const ReimbursablesTable = ({ rows, totals }: { rows: Reimbursable[]; totals: { sum: number; invoiced: number; paidByGc: number; count: number } }) => {
  const grouped = useMemo(() => {
    const g = new Map<string, Reimbursable[]>();
    rows.forEach((r) => {
      const arr = g.get(r.project) ?? [];
      arr.push(r);
      g.set(r.project, arr);
    });
    return Array.from(g.entries());
  }, [rows]);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
        Reimbursables · {totals.count} items · {usd(totals.sum)}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium">Date Logged</th>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Permit No.</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 font-medium text-right">Amount</th>
              <th className="px-3 py-2 font-medium">Team</th>
              <th className="px-3 py-2 font-medium">Invoiced</th>
              <th className="px-3 py-2 font-medium">Invoice #</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium w-32">Progress</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map(([project, list]) => (
              <>
                <tr key={`hdr-${project}`} className="bg-muted/20">
                  <td colSpan={11} className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    ↳ {project} · {list.length} items · {usd(list.reduce((a, r) => a + r.amount, 0))}
                  </td>
                </tr>
                {list.map((r, i) => (
                  <tr key={`${project}-${i}`} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{r.item}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.logged}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.project}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.permitNo}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.description}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.amount ? usd(r.amount) : "—"}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary">
                        {r.team}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${invoiceStyles[r.invoiced]}`}>
                        {r.invoiced}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.invoice}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${r.payment === "Done" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : r.payment === "Paid by GC" ? "bg-violet-500/15 text-violet-300 border-violet-500/30" : "bg-amber-500/15 text-amber-400 border-amber-500/30"}`}>
                        {r.payment}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <ProgressBar value={r.progress} />
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/40 font-semibold">
              <td className="px-4 py-3" colSpan={5}>Sum</td>
              <td className="px-3 py-3 text-right font-mono">{usd(totals.sum)}</td>
              <td colSpan={5}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

const ScopeTable = ({ rows, totals }: { rows: ScopeLine[]; totals: { hours: number; dollars: number } }) => (
  <div className="rounded-lg border border-border bg-card overflow-hidden">
    <div className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
      Scope · {rows.length} items
    </div>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
            <th className="px-4 py-2 font-medium">Item</th>
            <th className="px-3 py-2 font-medium">Client Name</th>
            <th className="px-3 py-2 font-medium">Client PM Email</th>
            <th className="px-3 py-2 font-medium">Date Needed</th>
            <th className="px-3 py-2 font-medium text-right">Hours</th>
            <th className="px-3 py-2 font-medium text-right">Unit Pricing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">{r.item}</td>
              <td className="px-3 py-2 text-muted-foreground">{r.client}</td>
              <td className="px-3 py-2 font-mono text-xs text-sky-400">{r.email}</td>
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.dateNeeded}</td>
              <td className="px-3 py-2 text-right font-mono">{r.hours || "—"}</td>
              <td className="px-3 py-2 text-right font-mono">{r.price ? usd(r.price) : "$0"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-semibold">
            <td className="px-4 py-3" colSpan={4}>Sum</td>
            <td className="px-3 py-3 text-right font-mono">{totals.hours}</td>
            <td className="px-3 py-3 text-right font-mono">{usd(totals.dollars)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
);

const WorkflowGroups = ({
  groups,
  openGroups,
  onToggle,
}: {
  groups: Group[];
  openGroups: Record<string, boolean>;
  onToggle: (name: string) => void;
}) => {
  const [openTasks, setOpenTasks] = useState<Record<string, boolean>>({});
  const toggleTask = (k: string) => setOpenTasks((p) => ({ ...p, [k]: !p[k] }));
  return (
  <div className="space-y-4">
    {groups.map((g) => {
      const open = openGroups[g.name];
      const done = g.tasks.filter((t) => t.status === "Done").length;
      return (
        <div key={g.name} className="rounded-lg border border-border bg-card overflow-hidden">
          <button
            onClick={() => onToggle(g.name)}
            className="flex w-full items-center gap-2 border-b border-border bg-muted/30 px-4 py-2 text-left"
            style={{ borderLeft: `4px solid ${g.accent}` }}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <span className="font-serif text-lg" style={{ color: g.accent }}>{g.name}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {g.tasks.length} items · {done} done
            </span>
          </button>
          {open && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Critical Path</th>
                    <th className="px-3 py-2 font-medium">Responsible Coordinator</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Completion</th>
                    <th className="px-3 py-2 font-medium w-40">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {g.tasks.map((t, i) => {
                    const key = `${g.name}-${i}`;
                    const expanded = openTasks[key];
                    return (
                    <>
                    <tr key={key} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {t.subitems ? (
                            <button onClick={() => toggleTask(key)} className="text-muted-foreground hover:text-foreground">
                              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          ) : (
                            <span className="w-3.5" />
                          )}
                          {t.status === "Done" ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                          <span>{t.name}</span>
                          {t.subitems && (
                            <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {t.subitems.length}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-[10px] font-bold ${
                            t.cp === "CP"
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          {t.cp}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{t.owner}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${statusStyles[t.status]}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {t.completion}
                      </td>
                      <td className="px-3 py-2">
                        <ProgressBar value={t.progress} />
                      </td>
                    </tr>
                    {expanded && t.subitems && (
                      <tr key={`${key}-sub`} className="bg-muted/10">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="ml-6 rounded-md border border-border bg-background/60 overflow-hidden">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-border text-left uppercase tracking-wider text-muted-foreground">
                                  <th className="px-3 py-1.5 font-medium">Subitem</th>
                                  <th className="px-3 py-1.5 font-medium">Approved</th>
                                  <th className="px-3 py-1.5 font-medium">Completion</th>
                                  <th className="px-3 py-1.5 font-medium">Dependent On</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.subitems.map((s, si) => (
                                  <tr key={si} className="border-b border-border/30 hover:bg-muted/30">
                                    <td className="px-3 py-1.5">{s.name}</td>
                                    <td className="px-3 py-1.5">
                                      <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] ${
                                        s.approved === "Done"
                                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                          : s.approved === "N/A"
                                          ? "bg-muted text-muted-foreground border-border"
                                          : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                      }`}>{s.approved}</span>
                                    </td>
                                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{s.completion}</td>
                                    <td className="px-3 py-1.5">
                                      {s.dependsOn ? (
                                        <span className="rounded bg-sky-500/10 text-sky-400 border border-sky-500/30 px-1.5 py-0.5 text-[10px]">
                                          {s.dependsOn}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground">—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    })}
  </div>
  );
};

const ProgressBar = ({ value }: { value: number }) => (
  <div className="flex items-center gap-2">
    <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full ${value >= 100 ? "bg-emerald-500" : value > 0 ? "bg-amber-500" : "bg-muted"}`}
        style={{ width: `${value}%` }}
      />
    </div>
    <span className="w-9 text-right font-mono text-[11px] text-muted-foreground">{value}%</span>
  </div>
);

export default OperationsBoard;