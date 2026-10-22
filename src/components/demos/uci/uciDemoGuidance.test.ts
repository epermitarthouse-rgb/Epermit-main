import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { UCI_DEMO_TRANSITIONS, uciDemoStepForStage } from "./uciDemoScenario";
import {
  UCI_DEMO_GUIDE_FRAMING,
  UCI_DEMO_STAGE_COUNT,
  UCI_DEMO_STAGE_GUIDES,
  describeUciDemoTimelinePosition,
  formatUciDemoOrientation,
  getUciDemoStageGuide,
  nextUciDemoGuideStage,
  previousUciDemoGuideStage,
  restartUciDemoGuideStage,
  uciDemoGuidePrimaryAction,
} from "./uciDemoGuidance";
import {
  UCI_DEMO_NARRATION_AUTOPLAY,
  createUciDemoNarration,
  type UciDemoNarrationSynth,
  type UciDemoNarrationUtterance,
} from "./uciDemoNarration";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readDemoSource(name: string): string {
  return readFileSync(join(__dirname, name), "utf8");
}

function fakeSynth() {
  const utterances: UciDemoNarrationUtterance[] = [];
  const synth: UciDemoNarrationSynth & { cancelCount: number; pauseCount: number; resumeCount: number } = {
    cancelCount: 0,
    pauseCount: 0,
    resumeCount: 0,
    speaking: false,
    paused: false,
    speak(utterance) {
      utterances.push(utterance);
      synth.speaking = true;
      synth.paused = false;
    },
    cancel() {
      synth.cancelCount += 1;
      synth.speaking = false;
      synth.paused = false;
    },
    pause() {
      synth.pauseCount += 1;
      synth.paused = true;
      synth.speaking = false;
    },
    resume() {
      synth.resumeCount += 1;
      synth.paused = false;
      synth.speaking = true;
    },
  };
  return { synth, utterances };
}

describe("UCI demo guided walkthrough", () => {
  it("has plain-language guidance for all 10 stages", () => {
    assert.equal(UCI_DEMO_STAGE_GUIDES.length, UCI_DEMO_STAGE_COUNT);
    assert.deepEqual(
      UCI_DEMO_STAGE_GUIDES.map((guide) => guide.stage),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    );
    for (const guide of UCI_DEMO_STAGE_GUIDES) {
      assert.ok(guide.title.length > 3, `stage ${guide.stage} title`);
      assert.ok(guide.outcome.length > 40, `stage ${guide.stage} outcome`);
      assert.ok(guide.platform.length > 40, `stage ${guide.stage} platform`);
      assert.ok(guide.progression.length > 40, `stage ${guide.stage} progression`);
      assert.ok(guide.whereYouAre.length > 20, `stage ${guide.stage} location`);
      assert.ok(guide.chapterSummary.length > 20, `stage ${guide.stage} flow`);
      assert.ok(guide.chapterIndex >= 1 && guide.chapterIndex <= 3);
      assert.match(formatUciDemoOrientation(guide.stage), new RegExp(`Stage ${guide.stage} of 10`));
      assert.match(formatUciDemoOrientation(guide.stage), new RegExp(`Part ${guide.chapterIndex} of 3`));
      assert.ok(guide.narration.includes(guide.outcome));
      assert.ok(guide.narration.includes(guide.platform));
      assert.ok(guide.narration.includes(guide.progression));
      assert.ok(guide.narration.includes(guide.transition));
      assert.match(guide.narration, new RegExp(`Stage ${guide.stage} of 10`));
    }
    assert.equal(getUciDemoStageGuide(1).chapterIndex, 1);
    assert.equal(getUciDemoStageGuide(5).chapterIndex, 2);
    assert.equal(getUciDemoStageGuide(8).chapterIndex, 3);
    assert.match(UCI_DEMO_GUIDE_FRAMING, /Simulated demo/);
    assert.match(UCI_DEMO_GUIDE_FRAMING, /No utility/);
    assert.match(getUciDemoStageGuide(4).platform, /nothing is transmitted/i);
    assert.match(getUciDemoStageGuide(7).platform, /does not take a payment/i);
    assert.match(getUciDemoStageGuide(1).narration, /simulated/i);
  });

  it("explains the transition into every following stage and the closeout restart", () => {
    for (const guide of UCI_DEMO_STAGE_GUIDES) {
      if (guide.stage < 10) {
        const next = getUciDemoStageGuide(guide.stage + 1);
        assert.match(guide.transition, new RegExp(`^Next: Stage ${next.stage} — ${next.title}\\.`));
        assert.match(guide.narration, new RegExp(`Next: Stage ${next.stage} — ${next.title}`));
        const action = uciDemoGuidePrimaryAction(guide.stage);
        assert.equal(action.action, "next");
        assert.equal(action.stage, guide.stage + 1);
        assert.equal(action.label, `Continue to Stage ${guide.stage + 1}`);
        assert.match(action.ariaLabel, new RegExp(`Stage ${guide.stage + 1} — ${next.title}`));
        assert.equal(nextUciDemoGuideStage(guide.stage), guide.stage + 1);
      } else {
        assert.match(guide.transition, /completes/i);
        assert.match(guide.transition, /closeout/i);
        assert.match(guide.transition, /Restart/);
        assert.doesNotMatch(guide.transition, /Next: Stage/);
        const action = uciDemoGuidePrimaryAction(10);
        assert.equal(action.action, "restart");
        assert.equal(action.stage, restartUciDemoGuideStage());
        assert.equal(action.stage, 1);
        assert.equal(action.label, "Restart walkthrough");
        assert.equal(nextUciDemoGuideStage(10), null);
      }
    }
    assert.equal(previousUciDemoGuideStage(1), null);
    assert.equal(previousUciDemoGuideStage(2), 1);
    assert.equal(previousUciDemoGuideStage(10), 9);
    const opening = UCI_DEMO_TRANSITIONS[uciDemoStepForStage(restartUciDemoGuideStage())];
    assert.equal(opening.to_stage, 1);
    assert.equal(opening.to_state, "COMPLETED");
  });

  it("describes where the simulated timeline sits", () => {
    assert.match(describeUciDemoTimelinePosition({ selectedStage: 4, currentStage: 2, currentState: "COMPLETED" }), /not reached/i);
    assert.match(describeUciDemoTimelinePosition({ selectedStage: 2, currentStage: 6, currentState: "COMPLETED" }), /already complete/i);
    assert.match(describeUciDemoTimelinePosition({ selectedStage: 3, currentStage: 3, currentState: "COMPLETED" }), /end of this stage/i);
    assert.match(describeUciDemoTimelinePosition({ selectedStage: 5, currentStage: 5, currentState: "AWAITING_UTILITY" }), /waiting on the utility/i);
  });

  it("keeps narration opt-in and local to the browser", () => {
    assert.equal(UCI_DEMO_NARRATION_AUTOPLAY, false);
    const { synth, utterances } = fakeSynth();
    const narration = createUciDemoNarration({
      getSynth: () => synth,
      createUtterance: (text) => ({ text, onend: null, onerror: null }),
    });
    assert.equal(narration.autoplay, false);
    assert.equal(narration.status(), "idle");
    assert.equal(utterances.length, 0);

    narration.play("Stage 1 of 10");
    assert.equal(utterances.length, 1);
    assert.equal(utterances[0].text, "Stage 1 of 10");
    assert.equal(narration.status(), "playing");

    narration.pause();
    assert.equal(synth.pauseCount, 1);
    assert.equal(narration.status(), "paused");
    narration.resume();
    assert.equal(synth.resumeCount, 1);
    assert.equal(narration.status(), "playing");

    const first = utterances[0];
    narration.play("Stage 2 of 10");
    first.onend?.();
    assert.equal(narration.status(), "playing");
    assert.equal(utterances.length, 2);

    narration.stop();
    assert.equal(synth.cancelCount > 0, true);
    assert.equal(narration.status(), "idle");
    utterances[1].onend?.();
    assert.equal(narration.status(), "idle");

    const unsupported = createUciDemoNarration({
      getSynth: () => null,
      createUtterance: (text) => ({ text, onend: null, onerror: null }),
    });
    unsupported.play("should not speak");
    assert.equal(unsupported.status(), "unsupported");
    assert.equal(utterances.length, 2);

    for (const name of ["uciDemoNarration.ts", "uciDemoGuidance.ts", "UciDemoGuidedTour.tsx", "../UciLifecycleDemo.tsx"]) {
      const source = readDemoSource(name);
      assert.doesNotMatch(source, /uciApi|supabase|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|new Audio\(|https?:\/\//, name);
    }
    const narrationSource = readDemoSource("uciDemoNarration.ts");
    assert.match(narrationSource, /speechSynthesis/);
    assert.match(narrationSource, /SpeechSynthesisUtterance/);
    assert.match(narrationSource, /UCI_DEMO_NARRATION_AUTOPLAY = false/);

    const tourSource = readDemoSource("UciDemoGuidedTour.tsx");
    assert.match(tourSource, /Play narration/);
    assert.match(tourSource, /Pause narration/);
    assert.match(tourSource, /Resume narration/);
    assert.match(tourSource, /Stop narration/);
    assert.match(tourSource, /onClick=\{playNarration\}/);
    assert.equal(tourSource.includes("playNarration("), false);
    assert.match(tourSource, /Spoken narration is not available in this browser/);
    assert.match(tourSource, /not sent to a service/);
    assert.match(tourSource, /No voice service is contacted/);
    const blockStart = tourSource.indexOf("Cancel narration when the stage changes");
    const blockEnd = tourSource.indexOf("}, [stage]);", blockStart);
    const block = tourSource.slice(blockStart, blockEnd);
    assert.match(block, /stop\(\)/);
    assert.doesNotMatch(block, /\.play\(|speak\(/);

    const demoSource = readDemoSource("../UciLifecycleDemo.tsx");
    assert.match(demoSource, /uci-demo-simulation-label/);
    assert.match(demoSource, /UciDemoGuidedTour/);
    assert.match(demoSource, /uciDemoStepForStage\(1\)/);
    assert.match(demoSource, /onGoToStage=\{showGuideStage\}/);
    assert.match(demoSource, /onSelectStage=\{showGuideStage\}/);
    assert.match(demoSource, /goToStep\(uciDemoStepForStage\(stage\)\)/);
    assert.match(tourSource, /uci-demo-start-tour/);
    assert.match(tourSource, /uci-demo-tour-next/);
    assert.match(tourSource, /uci-demo-tour-restart/);
    assert.match(tourSource, /uci-demo-tour-previous/);
    assert.match(tourSource, /Stage \{guide\.stage\} of \{UCI_DEMO_STAGE_COUNT\}/);
  });
});
