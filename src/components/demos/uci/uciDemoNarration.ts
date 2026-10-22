/**
 * Opt-in narration for the Utility Coordination demo.
 * Uses the browser speechSynthesis API only. Never autoplays and never calls a network service.
 */

/** Playback starts only from an explicit user control. Do not set this to true. */
export const UCI_DEMO_NARRATION_AUTOPLAY = false;

export type UciDemoNarrationStatus = "idle" | "playing" | "paused" | "unsupported";

export type UciDemoNarrationUtterance = {
  text: string;
  lang?: string;
  onend: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
};

export type UciDemoNarrationSynth = {
  speak: (utterance: UciDemoNarrationUtterance) => void;
  cancel: () => void;
  pause: () => void;
  resume: () => void;
  speaking?: boolean;
  paused?: boolean;
};

export type UciDemoNarrationController = {
  readonly autoplay: false;
  status: () => UciDemoNarrationStatus;
  play: (text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

export function browserNarrationSupport(
  host: { speechSynthesis?: UciDemoNarrationSynth; SpeechSynthesisUtterance?: unknown } | null | undefined = typeof window === "undefined" ? null : window,
): boolean {
  if (!host) return false;
  const synth = host.speechSynthesis;
  const Utterance = host.SpeechSynthesisUtterance ?? (typeof SpeechSynthesisUtterance === "function" ? SpeechSynthesisUtterance : undefined);
  return typeof synth?.speak === "function"
    && typeof synth.cancel === "function"
    && typeof synth.pause === "function"
    && typeof synth.resume === "function"
    && typeof Utterance === "function";
}

export function createUciDemoNarration(options: {
  getSynth: () => UciDemoNarrationSynth | null;
  createUtterance: (text: string) => UciDemoNarrationUtterance;
  onStatus?: (status: UciDemoNarrationStatus) => void;
}): UciDemoNarrationController {
  let status: UciDemoNarrationStatus = options.getSynth() ? "idle" : "unsupported";
  let token = 0;

  const publish = (next: UciDemoNarrationStatus) => {
    status = next;
    options.onStatus?.(next);
  };

  const stop = () => {
    token += 1;
    options.getSynth()?.cancel();
    if (status !== "unsupported") publish("idle");
  };

  return {
    autoplay: UCI_DEMO_NARRATION_AUTOPLAY,
    status: () => status,
    play(text: string) {
      const synth = options.getSynth();
      if (!synth) {
        publish("unsupported");
        return;
      }
      if (status === "paused") {
        synth.resume();
        publish("playing");
        return;
      }
      const generation = ++token;
      if (synth.speaking || synth.paused || status === "playing") synth.cancel();
      const utterance = options.createUtterance(text);
      utterance.onend = () => {
        if (token === generation) publish("idle");
      };
      utterance.onerror = () => {
        if (token === generation) publish("idle");
      };
      publish("playing");
      synth.speak(utterance);
    },
    pause() {
      if (status !== "playing") return;
      options.getSynth()?.pause();
      publish("paused");
    },
    resume() {
      if (status !== "paused") return;
      const synth = options.getSynth();
      if (!synth) {
        publish("unsupported");
        return;
      }
      synth.resume();
      publish("playing");
    },
    stop,
  };
}

export function createBrowserNarration(
  onStatus?: (status: UciDemoNarrationStatus) => void,
): UciDemoNarrationController {
  return createUciDemoNarration({
    getSynth: () => (browserNarrationSupport() ? (window.speechSynthesis as UciDemoNarrationSynth) : null),
    createUtterance: (text) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 1;
      return utterance as UciDemoNarrationUtterance;
    },
    onStatus,
  });
}
