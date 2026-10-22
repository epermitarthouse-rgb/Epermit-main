/**
 * Plain-language script for the simulated Utility Coordination walkthrough.
 * Display copy only. Nothing here contacts a utility or writes a record.
 */

export const UCI_DEMO_STAGE_COUNT = 10;

export const UCI_DEMO_GUIDE_FRAMING =
  "Simulated demo. No utility, portal, email, payment, or submission activity.";

export const UCI_DEMO_GUIDE_CHAPTERS = [
  {
    index: 1,
    name: "Prepare the request",
    summary: "Stages 1–4 identify the utility, verify the load, assemble the application, and record the submission.",
    firstStage: 1,
    lastStage: 4,
  },
  {
    index: 2,
    name: "Resolve the utility response",
    summary: "Stages 5–7 confirm the utility received the package, settle the design, and agree the construction charge.",
    firstStage: 5,
    lastStage: 7,
  },
  {
    index: 3,
    name: "Deliver and close out",
    summary: "Stages 8–10 track long-lead equipment, confirm the site is ready, energize the service, and close the file.",
    firstStage: 8,
    lastStage: 10,
  },
] as const;

export type UciDemoStageGuide = {
  stage: number;
  title: string;
  chapterIndex: 1 | 2 | 3;
  chapterName: string;
  chapterSummary: string;
  whereYouAre: string;
  /** Why a client should care about this stage. */
  outcome: string;
  /** What the platform does while this stage is open. */
  platform: string;
  /** Evidence or human decision that allows the story to move on. */
  progression: string;
  /** Spoken and written handoff. Stages 1–9 start with "Next: Stage N —". */
  transition: string;
  narration: string;
};

export type UciDemoGuideAction = {
  action: "next" | "restart";
  stage: number;
  label: string;
  ariaLabel: string;
};

type GuideSeed = {
  stage: number;
  title: string;
  whereYouAre: string;
  outcome: string;
  platform: string;
  progression: string;
  /** Sentence that follows the generated "Next: Stage N — Title." prefix. */
  handoff?: string;
  /** Stage 10 only: completion, closeout, and restart. */
  closing?: string;
};

const GUIDE_SEEDS: GuideSeed[] = [
  {
    stage: 1,
    title: "Provider Mapping",
    whereYouAre: "You are at the start of the story. No application exists yet, and nothing has been sent.",
    outcome: "The project has to begin with the electric utility that actually serves this address. The wrong company cannot turn the power on.",
    platform: "The platform places the site on the map, checks which utility territory contains it, and shows the coordinator one match to confirm.",
    progression: "A person confirms the matched utility. The platform does not move on from an unverified guess.",
    handoff: "With the utility confirmed, the electrical load can be checked before any application is built.",
  },
  {
    stage: 2,
    title: "Load Profile and Service Sizing",
    whereYouAre: "The utility is known. The next risk is trusting the electrical load that utility will be asked to serve.",
    outcome: "Service size, equipment, and cost all start from these numbers. A wrong load becomes a wrong design.",
    platform: "The platform reads the load letter and one-line, lists connected load and demand load, and holds each value until an engineer verifies it.",
    progression: "An engineer verifies 410 kVA connected and 315 kVA demand. Only those verified numbers are released.",
    handoff: "Verified load values become the source for the utility application, so nobody retypes them.",
  },
  {
    stage: 3,
    title: "Application Preparation",
    whereYouAre: "The load is verified. The application can now be assembled from numbers the team already trusts.",
    outcome: "The client gets a complete package without rebuilding facts that were checked in the previous stage.",
    platform: "The platform fills the provider form from the verified load, voltage, and site plan, and checks that every required attachment is attached.",
    progression: "A coordinator reviews the package and approves it for submission. An incomplete package stays here.",
    handoff: "An approved package is ready to be recorded as submitted.",
  },
  {
    stage: 4,
    title: "Submission",
    whereYouAre: "The package is approved. This stage creates the single record of what was submitted, and when.",
    outcome: "The team can point to one reference number and one package snapshot, so the same application is not sent twice.",
    platform: "The platform stores the channel, the reference, and the package snapshot. In this demo that record is simulated: nothing is transmitted and no email is sent.",
    progression: "A person has already approved the package. The demo then records reference SEC-2026-0001. Without that approval, there is no submission record.",
    handoff: "Once the record exists, the story waits for the utility to confirm it was received.",
  },
  {
    stage: 5,
    title: "Acknowledgment",
    whereYouAre: "The request is on file. This stage answers a simple client question: did the utility actually receive it, and who owns it?",
    outcome: "The client sees a named utility project manager instead of wondering whether the application arrived.",
    platform: "The platform reads the reply, classifies it as an acknowledgment, and matches it to submission SEC-2026-0001.",
    progression: "Acknowledgment SEC-ACK-0113 is matched and reviewed. Until that evidence is in, the stage stays open.",
    handoff: "Receipt is confirmed, so the utility’s proposed service can be compared with what was requested.",
  },
  {
    stage: 6,
    title: "Class of Service and Design Review",
    whereYouAre: "The utility has the application. This stage checks that their design matches the service the project asked for.",
    outcome: "A design that is too small gets caught before equipment is ordered. Here the first proposal was 800 A against a 1000 A request.",
    platform: "The platform compares the Class of Service — the utility’s official service design — with the request, highlights every gap, and keeps both versions.",
    progression: "A coordinator accepts the revised 1000 A design. A discrepancy cannot be skipped.",
    handoff: "The accepted design is what the utility’s construction charge is based on.",
  },
  {
    stage: 7,
    title: "Cost Confirmation",
    whereYouAre: "The design is accepted. This stage agrees the utility’s construction charge before anyone records a payment.",
    outcome: "The client sees the estimate, the invoice, and the difference, and approves the amount before money moves.",
    platform: "The platform lines up the $12,500 estimate and the $12,000 invoice (CIAC, the utility’s construction charge) and blocks payment until the client approves. This demo does not take a payment.",
    progression: "The client approves the reconciled $12,000 charge. Payment and billing stay recorded as simulated, and only after that approval.",
    handoff: "With the cost settled, attention turns to the transformer that can delay the opening.",
  },
  {
    stage: 8,
    title: "Equipment and Long-Lead Items",
    whereYouAre: "The cost is settled. This stage watches the equipment that takes months to arrive.",
    outcome: "A late transformer is a common reason a site misses its power date. The slip is visible while there is still time to react.",
    platform: "The platform tracks the 500 kVA transformer, records check-ins, and shows the delivery move from April 10 to April 15.",
    progression: "Delivery on site is confirmed. A date change is noted along the way, but the stage finishes only when the equipment arrives.",
    handoff: "Equipment on site lets the team confirm the building is ready for the utility crew.",
  },
  {
    stage: 9,
    title: "Pre-Energization",
    whereYouAre: "The transformer is on site. This stage makes sure the building is ready before a crew is scheduled.",
    outcome: "The utility is not called out until inspection, site readiness, and the meter appointment all line up.",
    platform: "The platform keeps one checklist for the inspection release, site readiness, and the meter-set request.",
    progression: "All three prerequisites are confirmed. Any open item holds the stage.",
    handoff: "The site is ready, so the utility can energize and the client file can close.",
  },
  {
    stage: 10,
    title: "Energization and Closeout",
    whereYouAre: "The prerequisites are done. This is the last stage: prove the service is on, then close the file.",
    outcome: "The client leaves with proof of energization, the meter reading, and one closeout package for their records.",
    platform: "The platform collects the energization confirmation, the final meter reading, and the commissioning sign-off, then assembles the closeout package.",
    progression: "Those closeout items are reviewed together. The coordination is complete only when the package is in the file.",
    closing:
      "This completes the walkthrough. The service is energized, the closeout package is ready, and the coordination file can close. Restart to see Stage 1 again.",
  },
];

function chapterFor(stage: number) {
  const chapter = UCI_DEMO_GUIDE_CHAPTERS.find((item) => stage >= item.firstStage && stage <= item.lastStage);
  if (!chapter) return UCI_DEMO_GUIDE_CHAPTERS[0];
  return chapter;
}

export function buildUciDemoNarration(guide: Omit<UciDemoStageGuide, "narration" | "chapterIndex" | "chapterName" | "chapterSummary"> & {
  stage: number;
}): string {
  const simulated =
    guide.stage === 1
      ? " This walkthrough is simulated. No utility is contacted."
      : "";
  return [
    `Stage ${guide.stage} of 10, ${guide.title}.`,
    guide.whereYouAre,
    `Why this matters: ${guide.outcome}`,
    `What the platform does: ${guide.platform}`,
    `What allows progress: ${guide.progression}`,
    guide.transition,
  ].join(" ") + simulated;
}

function finishGuide(seed: GuideSeed, next: GuideSeed | undefined): UciDemoStageGuide {
  const chapter = chapterFor(seed.stage);
  const transition = next
    ? `Next: Stage ${next.stage} — ${next.title}. ${seed.handoff ?? ""}`.trim()
    : (seed.closing ?? "");
  const base = {
    stage: seed.stage,
    title: seed.title,
    chapterIndex: chapter.index,
    chapterName: chapter.name,
    chapterSummary: chapter.summary,
    whereYouAre: seed.whereYouAre,
    outcome: seed.outcome,
    platform: seed.platform,
    progression: seed.progression,
    transition,
  };
  return { ...base, narration: buildUciDemoNarration(base) };
}

export const UCI_DEMO_STAGE_GUIDES: readonly UciDemoStageGuide[] = GUIDE_SEEDS.map((seed, index) =>
  finishGuide(seed, GUIDE_SEEDS[index + 1]),
);

export function clampUciDemoGuideStage(stage: number): number {
  if (!Number.isFinite(stage)) return 1;
  return Math.max(1, Math.min(UCI_DEMO_STAGE_COUNT, Math.trunc(stage)));
}

export function getUciDemoStageGuide(stage: number): UciDemoStageGuide {
  return UCI_DEMO_STAGE_GUIDES[clampUciDemoGuideStage(stage) - 1];
}

export function nextUciDemoGuideStage(stage: number): number | null {
  const current = clampUciDemoGuideStage(stage);
  return current >= UCI_DEMO_STAGE_COUNT ? null : current + 1;
}

export function previousUciDemoGuideStage(stage: number): number | null {
  const current = clampUciDemoGuideStage(stage);
  return current <= 1 ? null : current - 1;
}

/** Guided tour start and the Stage 10 restart both return to Stage 1. */
export function restartUciDemoGuideStage(): 1 {
  return 1;
}

export function uciDemoGuidePrimaryAction(stage: number): UciDemoGuideAction {
  const current = getUciDemoStageGuide(stage);
  const nextStage = nextUciDemoGuideStage(current.stage);
  if (nextStage == null) {
    return {
      action: "restart",
      stage: restartUciDemoGuideStage(),
      label: "Restart walkthrough",
      ariaLabel: "Restart the guided walkthrough at Stage 1, Provider Mapping",
    };
  }
  const next = getUciDemoStageGuide(nextStage);
  return {
    action: "next",
    stage: next.stage,
    label: `Continue to Stage ${next.stage}`,
    ariaLabel: `Continue to Stage ${next.stage} — ${next.title}`,
  };
}

export function formatUciDemoOrientation(stage: number): string {
  const guide = getUciDemoStageGuide(stage);
  return `Stage ${guide.stage} of ${UCI_DEMO_STAGE_COUNT} · ${guide.title} · Part ${guide.chapterIndex} of 3 · ${guide.chapterName}`;
}

export function describeUciDemoTimelinePosition(input: {
  selectedStage: number;
  currentStage: number;
  currentState?: string | null;
}): string {
  const selected = clampUciDemoGuideStage(input.selectedStage);
  const current = clampUciDemoGuideStage(input.currentStage);
  if (selected > current) {
    return "The simulated timeline has not reached this stage yet. Continue to bring the story here and open the workspace.";
  }
  if (selected < current) {
    return "This stage is already complete earlier in the simulated timeline. The workspace shows its saved result.";
  }
  const state = String(input.currentState || "").toUpperCase();
  if (state === "COMPLETED") {
    return "The simulated timeline is at the end of this stage, so the workspace shows the finished result.";
  }
  if (state === "AWAITING_UTILITY") {
    return "The simulated timeline is in this stage and waiting on the utility. The workspace shows that pause.";
  }
  return "The simulated timeline is still inside this stage. The workspace shows the work in progress.";
}
