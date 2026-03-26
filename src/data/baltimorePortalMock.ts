/**
 * Baltimore Accela portal mock data.
 * Structure is scraper-ready: replace with API/hydrated data later.
 */

export interface BaltimoreRecordSummary {
  recordId: string;
  recordNumber: string;
  permitType: string;
  status: string;
  address?: string;
  openedDate?: string;
  closedDate?: string;
}

export interface BaltimoreRecordDetail extends BaltimoreRecordSummary {
  expirationDate?: string;
  workLocation?: {
    address: string;
    city: string;
    state: string;
    zip: string;
  };
  recordDetails?: Record<string, string>;
  applicant?: {
    name: string;
    contact?: string;
  };
  licensedProfessional?: {
    name: string;
    licenseType?: string;
  };
  description?: string;
  owner?: Record<string, string>;
  processingStatus?: Array<{
    department: string;
    status: string;
    date?: string;
    comment?: string;
  }>;
  relatedRecords?: Array<{ recordNumber: string; recordId: string; type?: string }>;
  attachments?: Array<{
    name: string;
    type: string;
    uploadedDate?: string;
    actionLabel?: string;
  }>;
  inspections?: Array<{
    type: string;
    status: string;
    scheduledDate?: string;
    completedDate?: string;
    inspector?: string;
  }>;
  fees?: Array<{
    name: string;
    amount: string;
    status: string;
    dueDate?: string;
  }>;
  planReview?: Array<{
    discipline: string;
    status: string;
    reviewer?: string;
    completedDate?: string;
  }>;
}

const MOCK_RECORDS: BaltimoreRecordSummary[] = [
  {
    recordId: "REC25-00000-008PQ",
    recordNumber: "REC25-00000-008PQ",
    permitType: "Building",
    status: "In Progress",
    address: "1234 E Fayette St",
    openedDate: "01/15/2025",
    closedDate: "",
  },
  {
    recordId: "REC25-00000-007AB",
    recordNumber: "REC25-00000-007AB",
    permitType: "Electrical",
    status: "Approved",
    address: "500 N Charles St",
    openedDate: "12/01/2024",
    closedDate: "02/10/2025",
  },
  {
    recordId: "REC25-00000-006CD",
    recordNumber: "REC25-00000-006CD",
    permitType: "Building",
    status: "Pending Review",
    address: "2000 W Pratt St",
    openedDate: "02/01/2025",
    closedDate: "",
  },
  {
    recordId: "REC25-00000-005EF",
    recordNumber: "REC25-00000-005EF",
    permitType: "Plumbing",
    status: "In Progress",
    address: "300 S Broadway",
    openedDate: "01/20/2025",
    closedDate: "",
  },
  {
    recordId: "REC25-00000-004GH",
    recordNumber: "REC25-00000-004GH",
    permitType: "Building",
    status: "Closed",
    address: "100 N Howard St",
    openedDate: "10/15/2024",
    closedDate: "01/05/2025",
  },
];

const MOCK_DETAILS: Record<string, BaltimoreRecordDetail> = {
  "REC25-00000-008PQ": {
    ...MOCK_RECORDS[0],
    expirationDate: "07/15/2025",
    workLocation: {
      address: "1234 E Fayette St",
      city: "Baltimore",
      state: "MD",
      zip: "21202",
    },
    recordDetails: {
      "Record Type": "Building Permit",
      "Sub-Type": "Alteration/Repair",
      "Category": "Commercial",
      "Priority": "Standard",
    },
    applicant: {
      name: "ABC Property LLC",
      contact: "410-555-0100",
    },
    licensedProfessional: {
      name: "John Smith, PE",
      licenseType: "Professional Engineer",
    },
    description: "Interior tenant fit-out and electrical upgrade for Suite 200.",
    owner: {
      "Owner Name": "ABC Property LLC",
      "Contact": "Jane Doe",
      "Address": "1234 E Fayette St, Baltimore, MD 21202",
    },
    processingStatus: [
      { department: "Building", status: "Approved", date: "02/01/2025", comment: "Plans approved." },
      { department: "Fire", status: "In Review", date: "01/28/2025" },
      { department: "Zoning", status: "Approved", date: "01/20/2025" },
    ],
    relatedRecords: [
      { recordNumber: "REC25-00000-007AB", recordId: "REC25-00000-007AB", type: "Electrical" },
      { recordNumber: "REC25-00000-005EF", recordId: "REC25-00000-005EF", type: "Plumbing" },
    ],
    attachments: [
      { name: "Floor_Plan.pdf", type: "PDF", uploadedDate: "01/16/2025", actionLabel: "View" },
      { name: "Site_Plan.pdf", type: "PDF", uploadedDate: "01/16/2025", actionLabel: "View" },
    ],
    inspections: [
      { type: "Rough-in", status: "Scheduled", scheduledDate: "03/15/2025", inspector: "" },
      { type: "Final", status: "Pending", scheduledDate: "", completedDate: "", inspector: "" },
    ],
    fees: [
      { name: "Building Permit Fee", amount: "$450.00", status: "Paid", dueDate: "01/15/2025" },
      { name: "Plan Review Fee", amount: "$200.00", status: "Paid", dueDate: "01/15/2025" },
    ],
    planReview: [
      { discipline: "Building", status: "Approved", reviewer: "Building Division", completedDate: "02/01/2025" },
      { discipline: "Fire", status: "In Review", reviewer: "", completedDate: "" },
    ],
  },
  "REC25-00000-007AB": {
    ...MOCK_RECORDS[1],
    expirationDate: "06/01/2025",
    workLocation: {
      address: "500 N Charles St",
      city: "Baltimore",
      state: "MD",
      zip: "21201",
    },
    recordDetails: {
      "Record Type": "Electrical Permit",
      "Sub-Type": "Service Upgrade",
      "Category": "Commercial",
    },
    applicant: { name: "City Electric Co", contact: "410-555-0200" },
    licensedProfessional: { name: "Mike Jones", licenseType: "Master Electrician" },
    description: "200A service upgrade and panel replacement.",
    owner: { "Owner Name": "500 Charles LLC", "Address": "500 N Charles St, Baltimore, MD 21201" },
    processingStatus: [
      { department: "Electrical", status: "Approved", date: "02/10/2025" },
    ],
    relatedRecords: [
      { recordNumber: "REC25-00000-008PQ", recordId: "REC25-00000-008PQ", type: "Building" },
    ],
    attachments: [
      { name: "Electrical_Plans.pdf", type: "PDF", uploadedDate: "12/05/2024", actionLabel: "View" },
    ],
    inspections: [
      { type: "Rough-in", status: "Completed", completedDate: "01/15/2025", inspector: "R. Davis" },
      { type: "Final", status: "Completed", completedDate: "02/10/2025", inspector: "R. Davis" },
    ],
    fees: [
      { name: "Electrical Permit", amount: "$185.00", status: "Paid", dueDate: "12/01/2024" },
    ],
    planReview: [
      { discipline: "Electrical", status: "Approved", completedDate: "12/15/2024" },
    ],
  },
};

// Fill in minimal detail for other list records so detail page can resolve
MOCK_RECORDS.forEach((r) => {
  if (!MOCK_DETAILS[r.recordId]) {
    MOCK_DETAILS[r.recordId] = {
      ...r,
      expirationDate: "",
      recordDetails: {},
      applicant: { name: "" },
      licensedProfessional: { name: "" },
      processingStatus: [],
      relatedRecords: [],
      attachments: [],
      inspections: [],
      fees: [],
      planReview: [],
    };
  }
});

export function getBaltimoreRecordsList(page: number = 1, pageSize: number = 10): {
  records: BaltimoreRecordSummary[];
  total: number;
  page: number;
  pageSize: number;
} {
  const start = (page - 1) * pageSize;
  const records = MOCK_RECORDS.slice(start, start + pageSize);
  return { records, total: MOCK_RECORDS.length, page, pageSize };
}

export function getBaltimoreRecordDetail(recordId: string): BaltimoreRecordDetail | null {
  const normalized = recordId.replace(/\//g, "-");
  return MOCK_DETAILS[normalized] ?? MOCK_DETAILS[recordId] ?? null;
}

export { MOCK_RECORDS, MOCK_DETAILS };
