/**
 * TEST FIXTURE ONLY.
 * Do not import this sample into prompts, extraction heuristics as hardcoded
 * project facts, or business-logic branches. The pages exercise the extractor.
 */

import type { FormPage } from "./model";

export const SAMPLE_DC_CODE_MODIFICATION_PAGES: FormPage[] = [
  {
    pageNumber: 1,
    text: `APPLICATION FOR MODIFICATION OF CONSTRUCTION CODE REQUIREMENTS
(or Variance of Flood Hazard Rules)

District of Columbia Department of Buildings

Project / Address: 123 Historic Row NW, Washington, DC 20001

APPLICANT REQUEST:
The applicant requests a modification of IBC 1021.2 (2021) / 12A DCMR 1021.2
regarding egress / number of exits.

The existing historic stair makes strict compliance with the required number of
exits impractical. Altering the stair would destroy character-defining historic fabric.

The applicant states that the proposed modification complies with the intent and
purpose of the Construction Codes.

Reason strict application is impractical: The existing historic stair cannot be
altered without destroying character-defining fabric of the designated historic building.
`,
  },
  {
    pageNumber: 2,
    text: `PROPOSED ALTERNATIVE / COMPENSATING MEASURES:

1. Automatic sprinkler system designed and installed in accordance with NFPA 13
2. 2-hour fire-rated stair enclosure
3. Fire alarm system throughout the building
4. Occupant load signage at assembly spaces
5. Egress lighting and exit signage

Flood Hazard Applicable: No

Supporting narrative: The combination of sprinkler protection, a 2-hour fire-rated
stair enclosure, fire alarm, occupant load signage, and egress lighting/signage is
offered as equivalent life-safety performance for the requested egress modification.
`,
  },
  {
    pageNumber: 3,
    text: `FOR OFFICIAL USE ONLY

DOB Reviewer Name: ________________
DOB Reviewer Decision: ________________
DOB Approval Date: ________________
DOEE Reviewer: ________________
DOEE Comments: ________________
Conditions of Approval: ________________

This section is reserved for District of Columbia Department of Buildings and DOEE
reviewers. Do not complete. Blank reviewer fields are not applicant evidence.
`,
  },
];
