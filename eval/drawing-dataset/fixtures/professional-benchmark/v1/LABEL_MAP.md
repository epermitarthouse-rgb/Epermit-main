# Professional benchmark label map

Maps reviewer overall classifications used in this pack to Phase 2A.6 adjudication dimensions in `eval/drawing-dataset/lib/adjudicateSchema.mjs`.

| Professional review outcome | Phase 2A.6 `findingValidity` | Phase 2A.6 `technicalCorrectness` | Notes |
| --- | --- | --- | --- |
| `confirmed_issue` | `confirmed_valid` | `technically_correct` | Issue is real and correctly framed |
| `false_positive` | `false_positive` | `technically_incorrect` | Analyzer conclusion wrong |
| `partially_supported` | `needs_more_evidence` | `technically_uncertain` | Some support; incomplete |
| `insufficient_evidence` | `needs_more_evidence` | `technically_uncertain` | Cannot decide from drawing/evidence |
| `not_applicable` | `not_applicable` | `not_reviewed` | Out of scope for sheet/mode |

Evidence grounding remains a **separate** dimension (`evidence_present` / `partial` / `absent` / `misleading`). Evidence presence does not imply technical correctness (see C-002).

Technical-check outcomes (`supported_issue` / `no_issue_evidenced` / `unresolved` / `not_applicable`) are **machine hints only** and never set `professionallyVerified`.
