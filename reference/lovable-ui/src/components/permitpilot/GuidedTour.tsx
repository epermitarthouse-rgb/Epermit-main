import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type TourStep = {
  target: string; // data-tour id
  title: string;
  body: string;
  cta?: { label: string; to: string };
};

type Props = {
  steps: TourStep[];
  storageKey?: string;
  autoStart?: boolean;
  launcherLabel?: string;
};

type Rect = { top: number; left: number; width: number; height: number };

export const GuidedTour = ({
  steps,
  storageKey = "commun-et:tour:demo-mcd",
  autoStart = false,
  launcherLabel = "Start guided tour",
}: Props) => {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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

  // Position + track the current target.
  useLayoutEffect(() => {
    if (!open || !step) return;
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    // Scroll into view first, then measure a couple of frames later.
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = window.setTimeout(() => {
      measure();
      raf = window.requestAnimationFrame(measure);
    }, 350);
    const onScroll = () => measure();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.clearTimeout(t);
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
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

  // Pin the tooltip card next to the target, keeping it inside the viewport.
  const cardPos = (() => {
    const pad = 16;
    const cardW = 380;
    const cardH = 240;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
    const vh = typeof window !== "undefined" ? window.innerHeight : 900;
    if (!rect) {
      return { top: vh / 2 - cardH / 2, left: vw / 2 - cardW / 2 };
    }
    // Prefer below, then above, then right, then left.
    const below = rect.top + rect.height + pad;
    const above = rect.top - cardH - pad;
    if (below + cardH < vh) {
      const left = Math.min(Math.max(pad, rect.left), vw - cardW - pad);
      return { top: below, left };
    }
    if (above > pad) {
      const left = Math.min(Math.max(pad, rect.left), vw - cardW - pad);
      return { top: above, left };
    }
    const rightSpace = vw - (rect.left + rect.width);
    if (rightSpace > cardW + pad * 2) {
      return { top: Math.max(pad, rect.top), left: rect.left + rect.width + pad };
    }
    return { top: Math.max(pad, rect.top), left: Math.max(pad, rect.left - cardW - pad) };
  })();

  return (
    <>
      {/* Launcher */}
      <button
        type="button"
        onClick={start}
        className="pilot-button-primary fixed bottom-6 right-6 z-40 shadow-lg"
        aria-label={launcherLabel}
      >
        <Sparkles className="h-4 w-4" /> {launcherLabel}
      </button>

      {open && step && (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label={`Guided tour · step ${i + 1} of ${steps.length}`}
        >
          {/* Backdrop with a cut-out over the target */}
          <svg
            className="pointer-events-auto absolute inset-0 h-full w-full"
            onClick={close}
            aria-hidden="true"
          >
            <defs>
              <mask id="tour-mask">
                <rect width="100%" height="100%" fill="white" />
                {rect && (
                  <rect
                    x={rect.left - 8}
                    y={rect.top - 8}
                    width={rect.width + 16}
                    height={rect.height + 16}
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
              mask="url(#tour-mask)"
            />
          </svg>

          {/* Spotlight ring */}
          {rect && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute rounded-2xl ring-2 ring-primary/80 shadow-[0_0_0_4px_hsl(var(--primary)/0.25)] transition-all duration-300"
              style={{
                top: rect.top - 8,
                left: rect.left - 8,
                width: rect.width + 16,
                height: rect.height + 16,
              }}
            />
          )}

          {/* Card */}
          <div
            ref={cardRef}
            className={cn(
              "pilot-card pointer-events-auto absolute w-[380px] max-w-[calc(100vw-2rem)]",
              "border-primary/40 bg-background/95 p-5 shadow-2xl backdrop-blur",
              "transition-all duration-300",
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
            {step.cta && (
              <a
                href={step.cta.to}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              >
                {step.cta.label} <ArrowRight className="h-3.5 w-3.5" />
              </a>
            )}

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
      )}
    </>
  );
};

export default GuidedTour;