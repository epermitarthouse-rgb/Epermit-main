# Professional accuracy methodology (Supabase Code Analyzer)

**Status:** Measurement design for qualified review. No precision/recall is claimed until reviewers complete authorized labels with `contributesToMetrics: true`.

Related pack: [`fixtures/professional-benchmark/v1/`](./fixtures/professional-benchmark/v1/).

## Goals

1. Separate **professionally verified** metrics from **proxy** signals (technical checks, persist-time overlays, semantic retrieval).
2. Measure finding **consistency** independently of accuracy.
3. Enable false-negative discovery via missed-issue slots.

## Reviewer workflow (practical)

### Offline (preferred for v1)

1. Open `fixtures/professional-benchmark/v1/items.json` (or the generated CSV worksheet).
2. For each item, view sheet PDF outside Git (client drawing set) and the listed evidence quote/location.
3. Set `reviewer.decision` to one of: `confirmed_issue`, `false_positive`, `partially_supported`, `insufficient_evidence`, `not_applicable`.
4. Fill `explanation`, `identity`, `role`, `reviewedAt` (ISO date).
5. Keep `professionallyVerified` / `contributesToMetrics` false unless metrics contribution is explicitly authorized.
6. Record missed issues in `missed-issue-slots.json` (do not invent from AI).
7. Optionally mirror decisions into Phase 2A.6 adjudication via the [LABEL_MAP.md](./fixtures/professional-benchmark/v1/LABEL_MAP.md).

### In-app (existing UI — no new interface)

Use Supabase Code Analyzer **Accept / Modify / Reject** on published findings for project delivery decisions. That path is **not** the professional accuracy gold set unless reviewers also complete the benchmark pack fields above.

Internal quality drawer overlays remain diagnostic only.

## Labeling instructions

| Field | Requirement |
| --- | --- |
| Decision | Required from the five outcomes |
| Explanation | Required; cite drawing location |
| Identity / role | Required (e.g., PE / RA / reviewer id) |
| Date | Required ISO timestamp |
| Evidence grounding | Optional Phase 2A.6 dimension |
| Technical correctness | Optional; **independent** of evidence presence |
| Missed issue | Only when the analyzer omitted a real issue you confirm |

**Do not** mark OCR or GPT text as professionally verified by default.

## Metrics (repeatable definitions)

### Professionally verified (only after authorized reviews)

| Metric | Definition | Gate |
| --- | --- | --- |
| Precision | TP / (TP + FP) where TP=`confirmed_issue`, FP=`false_positive` | Items with `contributesToMetrics` |
| False-positive rate | FP / (TP + FP) | Same |
| Recall | TP / (TP + FN) | Requires missed-issue review coverage on the sheet set |
| False-negative rate | FN / (TP + FN) | Same |
| Severity accuracy | Share of confirmed issues where severity matches reviewer expectation | Confirmed subset |
| Citation/evidence correctness | Share with correct quote/location/code section when provided | Reviewed subset |

### Proxy / consistency (may be reported without professional verification)

| Metric | Definition |
| --- | --- |
| Technical-check coverage | Share of pilot sheets with applicable checks evaluated |
| Check outcome agreement | Deterministic re-run agreement on fixed fixtures (expect 100%) |
| Topic retention | Heuristic sheet::topic retention across frozen runs |
| Unexplained disappearance | Topics present in run A missing in run B without validator withhold |
| Unsupported absence claims | Absence Criticals contradicted by quoted pack evidence (check `supported_issue`) |
| Reviewer disagreement | Conflicting decisions on the same item id |

### Explicitly forbidden

- A single overall “accuracy %” from incomplete or AI-only labels.
- Treating Stage 3 OCR recovery as verified compliance.
- Inferring recall without independent missed-issue review.

## Consistency vs accuracy

- **Consistency** asks whether the same technical checks and topics recur under fixed evidence/rules.
- **Accuracy** asks whether conclusions match professional ground truth.
- Improving consistency (technical checks) does not by itself prove accuracy.

## Optional paid GPT (approval required)

If needed later: one 2-sheet check-vs-model agreement run (A-3.06 + A-6.00), Stage 3 run-scoped only, budget **≤ $0.10**. Present a one-page plan before execution. Not required for this methodology or the v1 pack.
