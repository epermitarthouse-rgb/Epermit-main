/**
 * Synthetic DC Code Modification application PDF for tests.
 * TEST FIXTURE ONLY — not used by prompts or production logic.
 */

import { PDFDocument, StandardFonts } from "pdf-lib";

export const SAMPLE_PAGE_TEXTS = [
  `APPLICATION FOR MODIFICATION OF CONSTRUCTION CODE REQUIREMENTS
(or Variance of Flood Hazard Rules)
Project / Address: 123 Historic Row NW, Washington, DC 20001
APPLICANT REQUEST:
The applicant requests a modification of IBC 1021.2 (2021) / 12A DCMR 1021.2
regarding egress / number of exits.
The existing historic stair makes strict compliance impractical.
The applicant states that the proposed modification complies with the intent and purpose of the Construction Codes.`,
  `PROPOSED ALTERNATIVE / COMPENSATING MEASURES:
1. Automatic sprinkler system designed and installed in accordance with NFPA 13
2. 2-hour fire-rated stair enclosure
3. Fire alarm system throughout the building
4. Occupant load signage at assembly spaces
5. Egress lighting and exit signage
Flood Hazard Applicable: No`,
  `FOR OFFICIAL USE ONLY
DOB Reviewer Name: ________________
DOB Reviewer Decision: ________________
DOB Approval Date: ________________
DOEE Reviewer: ________________
Conditions of Approval: ________________`,
];

export async function buildSampleCodeModificationPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const pageText of SAMPLE_PAGE_TEXTS) {
    const page = doc.addPage([612, 792]);
    let y = 740;
    for (const line of pageText.split("\n")) {
      page.drawText(line, { x: 48, y, size: 10, font, maxWidth: 516 });
      y -= 14;
    }
  }
  return Buffer.from(await doc.save());
}
