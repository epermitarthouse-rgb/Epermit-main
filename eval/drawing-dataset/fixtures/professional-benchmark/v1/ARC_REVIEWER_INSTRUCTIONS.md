# ARC professional review instructions

Thank you for reviewing PermitPilot’s drawing-analysis findings. This package helps you confirm what the software got right, correct mistakes, and note issues it missed.

You are **not** approving building-code compliance for a permit. Your review creates a controlled learning record so engineering can improve the product with your expertise.

## What you will review

- **18 benchmark items** covering guardrails, door schedules, hydraulic calculations, structural/MEP cross-sheet cases, and a few date/electrical regressions.
- Optional **missed issues** on six priority sheets if you see a real problem the analyzer never raised.

Each item shows:

- Drawing / sheet number  
- Analyzer conclusion and severity  
- Quoted evidence (when available) and location  
- Optional code reference (may be blank if unsupported)

## How to decide

Use one of these outcomes on the worksheet (or the matching action in the PermitPilot app):

| Your decision | When to use it | App action (if reviewing live findings) |
| --- | --- | --- |
| **Accept** (`confirmed_issue`) | The technical concern is real and fairly stated | **Accept** |
| **Reject** (`false_positive`) | The analyzer is wrong or misleading | **Reject** — add a short why |
| **Modify** (`partially_supported`) | Directionally useful but severity, wording, code cite, or evidence must change | **Modify** — write the corrected interpretation |
| **Insufficient evidence** | Drawing/evidence is incomplete; or another discipline should review | Use worksheet value `insufficient_evidence` (not a separate app button yet) |
| **Not applicable** | Out of scope for this sheet or review mode | Worksheet `not_applicable` |

### Required fields

1. Decision  
2. Short justification (what on the drawing supports your call)  
3. Your name/id and role (e.g., RA, PE, fire protection)  
4. Review date  

If you **Modify**, also state the corrected severity and/or corrected technical interpretation.

### Missed issues

If the analyzer missed a real issue:

1. Note the sheet and exact drawing location  
2. Describe the issue and supporting rationale  
3. Do **not** invent issues from AI suggestions alone  

Ops can record these with the missed-issue helper, or you can list them in the worksheet comments for intake.

## Discipline routing (recommendation)

| Topic family | Primary reviewer |
| --- | --- |
| Guardrails / means of egress architectural | Architect (RA) |
| Door hardware / fire rating | Architect + fire protection as needed |
| Hydraulic / sprinkler calculations | Fire protection / PE |
| Structural notes / reinforcement | Structural PE |
| Mechanical keynotes / refrigerant | Mechanical PE |
| Electrical note restatements | Electrical PE |

Mark **Insufficient evidence** and request second review when the item crosses disciplines.

## What happens to your decisions

- Original AI findings stay unchanged in history.  
- Your decision is stored as structured feedback for evaluation.  
- Nothing automatically rewrites production prompts or severity rules.  
- “Verified for metrics” requires an explicit engineering authorization step — ordinary review stays preliminary until then.

## Completion tracking

Engineering tracks:

- Items reviewed vs remaining (18 total)  
- Cases needing second review / disagreements  
- Recurring false positives and missed issues  

When finished with a batch, return the filled CSV worksheet (or confirm live Accept/Modify/Reject on the linked project findings).
