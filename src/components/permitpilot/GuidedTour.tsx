import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TourStep = {
  target: string; // data-tour id
  title: string;
  body: string;
  cta?: { label: string; to: string; upcoming?: boolean };
};

type Props = {
  steps: TourStep[];
  storageKey?: string;
  autoStart?: boolean;
  launcherLabel?: string;
};

type Rect = { top: number; left: number; width: number; height: number };

/** Small consistent padding around the real target (viewport CSS px). */
const SPOTLIGHT_PAD = 8;
const CARD_W = 380;
const CARD_FALLBACK_H = 240;
const CARD_GAP = 16;

/** Viewport rect from getBoundingClientRect — never mix with document/scroll offsets. */
function readViewportRect(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top,
    left: r.left,
    width: r.width,
    height: r.height,
  };
}

function rectsEqual(a: Rect | null, b: Rect | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  );
}

function placeCard(rect: Rect | null, cardW: number, cardH: number): { top: number; left: number } {
  const pad = CARD_GAP;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  if (!rect) {
    return { top: vh / 2 - cardH / 2, left: vw / 2 - cardW / 2 };
  }

  const clampLeft = (left: number) => Math.min(Math.max(pad, left), Math.max(pad, vw - cardW - pad));
  const clampTop = (top: number) => Math.min(Math.max(pad, top), Math.max(pad, vh - cardH - pad));

  const below = rect.top + rect.height + SPOTLIGHT_PAD + pad;
  const above = rect.top - SPOTLIGHT_PAD - cardH - pad;
  const right = rect.left + rect.width + SPOTLIGHT_PAD + pad;
  const left = rect.left - SPOTLIGHT_PAD - cardW - pad;

  // Prefer outside the spotlight: below → above → right → left.
  if (below + cardH <= vh - pad) {
    return { top: below, left: clampLeft(rect.left) };
  }
  if (above >= pad) {
    return { top: above, left: clampLeft(rect.left) };
  }
  if (right + cardW <= vw - pad) {
    return { top: clampTop(rect.top), left: right };
  }
  if (left >= pad) {
    return { top: clampTop(rect.top), left: left };
  }
  // Last resort: park in the largest remaining viewport band without covering target center.
  const targetMidY = rect.top + rect.height / 2;
  if (targetMidY < vh / 2) {
    return { top: clampTop(vh - cardH - pad), left: clampLeft(pad) };
  }
  return { top: clampTop(pad), left: clampLeft(pad) };
}

export const GuidedTour = ({
  steps,
  storageKey = "commun-et:tour:demo-mcd",
  autoStart = false,
  launcherLabel = "Start guided tour",
}: Props) => {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: CARD_W, h: CARD_FALLBACK_H });
  const cardRef = useRef<HTMLDivElement>(null);
  const maskId = useId().replace(/:/g, "");

  // Autostart first time only.
  useEffect(() => {
    if (!autoStart) return;
    try {
      if (window.localStorage.getItem(storageKey) === "done") return;
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => setOpen(true), 500);
    return () => window.clearTimeout(t);
  }, [autoStart, storageKey]);

  const step = steps[i];

  // Measure actual tooltip size for collision placement.
  useLayoutEffect(() => {
    if (!open) return;
    const el = cardRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      setCardSize({
        w: Math.max(1, r.width),
        h: Math.max(1, r.height),
      });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, step, i]);

  // Track the current target in viewport coordinates (fixed overlay / portal).
  useLayoutEffect(() => {
    if (!open || !step) {
      setRect(null);
      return;
    }

    let cancelled = false;
    let raf = 0;
    let settleTimer = 0;
    let scrolling = false;
    let targetEl: HTMLElement | null = null;

    const applyRect = (next: Rect | null) => {
      if (cancelled) return;
      setRect((prev) => (rectsEqual(prev, next) ? prev : next));
    };

    const measure = () => {
      if (cancelled) return;
      const el =
        targetEl ??
        document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(step.target)}"]`);
      targetEl = el;
      if (!el) {
        applyRect(null);
        return;
      }
      applyRect(readViewportRect(el));
    };

    const scheduleSettleRemeasure = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        scrolling = false;
        measure();
        // One more frame after layout/fonts can settle.
        raf = window.requestAnimationFrame(() => {
          measure();
          raf = window.requestAnimationFrame(measure);
        });
      }, 120);
    };

    const onScrollOrResize = () => {
      scrolling = true;
      measure();
      scheduleSettleRemeasure();
    };

    const tickWhileScrolling = () => {
      if (cancelled) return;
      measure();
      if (scrolling) {
        raf = window.requestAnimationFrame(tickWhileScrolling);
      }
    };

    // Immediate measure so Next/Back updates spotlight without waiting on scroll.
    measure();

    targetEl = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(step.target)}"]`);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      scrolling = true;
      raf = window.requestAnimationFrame(tickWhileScrolling);
      scheduleSettleRemeasure();
    }

    const ro = targetEl ? new ResizeObserver(onScrollOrResize) : null;
    if (targetEl && ro) ro.observe(targetEl);

    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scrollend", onScrollOrResize, true);
    window.visualViewport?.addEventListener("resize", onScrollOrResize);
    window.visualViewport?.addEventListener("scroll", onScrollOrResize);

    // Fonts / late layout can shift targets after first paint.
    void document.fonts?.ready?.then(() => {
      if (!cancelled) measure();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(settleTimer);
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scrollend", onScrollOrResize, true);
      window.visualViewport?.removeEventListener("resize", onScrollOrResize);
      window.visualViewport?.removeEventListener("scroll", onScrollOrResize);
    };
  }, [open, step, i]);

  // Keyboard nav.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i]);

  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(storageKey, "done");
    } catch {
      /* ignore */
    }
  };
  const next = () => {
    if (i < steps.length - 1) setI(i + 1);
    else close();
  };
  const prev = () => setI((v) => Math.max(0, v - 1));
  const start = () => {
    setI(0);
    setOpen(true);
  };

  const cardPos = placeCard(rect, cardSize.w, cardSize.h);
  const spotlight = rect
    ? {
        top: rect.top - SPOTLIGHT_PAD,
        left: rect.left - SPOTLIGHT_PAD,
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2,
      }
    : null;

  const overlay =
    open && step ? (
      <div
        className="fixed inset-0 z-[100]"
        role="dialog"
        aria-modal="true"
        aria-label={`Guided tour · step ${i + 1} of ${steps.length}`}
      >
        <svg
          className="pointer-events-auto absolute inset-0 h-full w-full"
          onClick={close}
          aria-hidden="true"
        >
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse">
              <rect width="100%" height="100%" fill="white" />
              {spotlight && (
                <rect
                  x={spotlight.left}
                  y={spotlight.top}
                  width={spotlight.width}
                  height={spotlight.height}
                  rx={14}
                  ry={14}
                  fill="black"
                />
              )}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="hsl(215 35% 8% / 0.72)"
            mask={`url(#${maskId})`}
          />
        </svg>

        {spotlight && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute rounded-2xl ring-2 ring-primary/80 shadow-[0_0_0_4px_hsl(var(--primary)/0.25)]"
            style={{
              top: spotlight.top,
              left: spotlight.left,
              width: spotlight.width,
              height: spotlight.height,
            }}
          />
        )}

        <div
          ref={cardRef}
          className={cn(
            "pilot-card pointer-events-auto absolute w-[380px] max-w-[calc(100vw-2rem)]",
            "border-primary/40 bg-background/95 p-5 shadow-2xl backdrop-blur",
          )}
          style={{ top: cardPos.top, left: cardPos.left }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="pilot-kicker text-primary">
                Step {i + 1} / {steps.length}
              </div>
              <h3 className="mt-1 font-display text-lg font-semibold leading-snug">
                {step.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close guided tour"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
          {step.cta &&
            (step.cta.upcoming ? (
              <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                {step.cta.label}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
                  Upcoming
                </span>
              </span>
            ) : (
              <Link
                to={step.cta.to}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                {step.cta.label} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ))}

          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {steps.map((_, idx) => (
                <span
                  key={idx}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    idx === i ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30",
                  )}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={prev}
                disabled={i === 0}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                type="button"
                onClick={next}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:bg-brand-orange-deep"
              >
                {i === steps.length - 1 ? "Finish" : "Next"}
                {i < steps.length - 1 && <ArrowRight className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="mt-3 w-full text-center text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </button>
        </div>
      </div>
    ) : null;

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="pilot-button-primary fixed bottom-6 right-6 z-40 shadow-lg"
        aria-label={launcherLabel}
      >
        <Sparkles className="h-4 w-4" /> {launcherLabel}
      </button>

      {typeof document !== "undefined" && overlay
        ? createPortal(overlay, document.body)
        : overlay}
    </>
  );
};

export default GuidedTour;
