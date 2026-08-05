import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  Calendar,
  Compass,
  FileCheck2,
  Gauge,
  Mail,
  RadioTower,
  ShieldCheck,
} from "lucide-react";
import communEtLogo from "@/assets/commun-et-logo-transparent.webp";
import ianSwainPhoto from "@/assets/ian-swain.jpg";
import { AuthGatedLink } from "@/components/layout/AuthGatedLink";
import { ContactForm } from "@/components/home/ContactForm";

/**
 * PermitPilot homepage content, rendered inside the app shell for anonymous
 * visitors (PD-3). Structure/composition mirrors Lovable's `Home.tsx`
 * (hero → mission → pillars → client value → founder bio → Mission Control CTA → contact),
 * adapted to real PermitPilot product copy and CTAs.
 */

const pillars = [
  {
    icon: Compass,
    title: "Permit Expediting, Reimagined",
    body: "Portal Harvest and Response Matrix reconcile jurisdictional comments and pull live portal status automatically — collapsing weeks of manual reconciliation into a single dashboard.",
  },
  {
    icon: FileCheck2,
    title: "DesignCheck™ Compliance",
    body: "AI-powered code compliance scans pre-screen drawings against jurisdiction-specific requirements, surfacing conflicts and rejections before they ever reach the counter.",
  },
  {
    icon: RadioTower,
    title: "Utility Coordination Intelligence",
    body: "Track utility provider lifecycle, service territory, and coordination status alongside your permit timeline — one workspace instead of a dozen disconnected portals.",
  },
];

const stats = [
  { stat: "9–13 wks", label: "Legacy permit cycle", tone: "muted" as const },
  { stat: "3–4 wks", label: "PermitPilot target", tone: "primary" as const },
  { stat: "90%", label: "Reduction in rework loops", tone: "primary" as const },
  { stat: "50+", label: "Jurisdictions modeled", tone: "muted" as const },
];

const clientValue = [
  {
    icon: Gauge,
    title: "Faster to ground-break",
    body: "Pre-screened submittals and AI-reconciled comments compress cycle times and cut avoidable resubmittal rounds.",
  },
  {
    icon: ShieldCheck,
    title: "Defensible compliance",
    body: "Every code citation, AHJ comment, and response is logged, versioned, and audit-ready — no more digging through email threads.",
  },
  {
    icon: Building2,
    title: "Portfolio visibility",
    body: "Owners and PMs see every project's permit posture, risk, and next milestone in one place, in real time.",
  },
];

export default function Home() {
  return (
    <div className="space-y-16 pb-16">
      {/* HERO */}
      <section className="signal-grid relative overflow-hidden rounded-2xl border border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background/95 to-primary/5" />
        <div className="relative z-10 grid gap-10 px-6 py-16 md:px-12 md:py-20 lg:grid-cols-[1.4fr_1fr] lg:items-end">
          <div className="max-w-2xl">
            <div className="pilot-kicker text-primary">PermitPilot · by Commun-ET, LLC</div>
            <h1 className="mt-4 font-tight text-4xl font-black tracking-tight text-foreground md:text-6xl">
              The AI-native operating system for permit expediting.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
              PermitPilot orchestrates portal harvesting, code compliance, comment
              reconciliation, and utility coordination into one intelligent
              workspace — built for the architects, engineers, and contractors
              who refuse to wait on paper.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/auth" className="pilot-button-primary">
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/demos" className="pilot-button-ghost">
                See a Demo
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {stats.map((n) => (
              <div key={n.label} className="pilot-card bg-background/70 p-4 backdrop-blur">
                <div
                  className={
                    "font-data text-2xl font-semibold " +
                    (n.tone === "primary" ? "text-primary" : "text-foreground")
                  }
                >
                  {n.stat}
                </div>
                <div className="pilot-kicker mt-2">{n.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MISSION */}
      <section className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:items-start">
        <div>
          <div className="pilot-kicker text-primary">Mission</div>
          <h2 className="mt-3 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">
            Move the built environment at the speed of intelligence.
          </h2>
        </div>
        <div className="pilot-card p-7 md:p-9">
          <p className="text-base leading-7 text-foreground md:text-lg">
            Permitting is the silent tax on every project — months of review cycles,
            fragmented portals, and comments that don't reconcile. PermitPilot exists
            to eliminate that drag. We give AEC teams a transparent, agentic platform
            that anticipates jurisdiction behavior, resolves conflicts before
            submittal, and keeps every stakeholder on the same single source of truth.
          </p>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            Owners get predictable timelines. Designers get their hours back.
            Contractors get to break ground when the schedule said they would.
          </p>
        </div>
      </section>

      {/* PILLARS */}
      <section>
        <div className="mb-8 flex items-end justify-between gap-6">
          <div>
            <div className="pilot-kicker text-primary">What PermitPilot does</div>
            <h2 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground">
              Three engines, one operating system.
            </h2>
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {pillars.map((p) => (
            <article key={p.title} className="pilot-card flex flex-col gap-4 p-6">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="font-tight text-lg font-bold text-foreground">{p.title}</h3>
              <p className="text-sm leading-6 text-muted-foreground">{p.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* CLIENT VALUE */}
      <section className="pilot-card overflow-hidden">
        <div className="grid gap-0 md:grid-cols-3">
          {clientValue.map((c) => (
            <div
              key={c.title}
              className="border-b border-border p-7 md:border-b-0 md:border-r md:last:border-r-0"
            >
              <c.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 font-tight text-base font-bold text-foreground">{c.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FOUNDER */}
      <section className="grid gap-8 overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[minmax(260px,360px)_1fr] md:gap-0">
        <div className="relative h-80 md:h-auto">
          <img
            src={ianSwainPhoto}
            alt="Ian Swain, founder of Commun-ET, LLC"
            width={839}
            height={798}
            loading="lazy"
            className="h-full w-full object-cover object-top"
          />
        </div>
        <div className="p-7 md:p-10">
          <div className="pilot-kicker text-primary">The Creator</div>
          <h2 className="mt-3 font-tight text-3xl font-black tracking-tight text-foreground">
            Ian Swain — Founder, Commun-ET, LLC
          </h2>
          <p className="mt-4 text-sm leading-7 text-muted-foreground md:text-base">
            Ian Swain is a veteran AEC operator and permit expediter who has spent his
            career guiding owners, architects, and contractors through the most
            complex jurisdictions in the country. He founded Commun-ET, LLC to turn
            that hard-won expertise into PermitPilot — a platform that pairs human
            judgment with AI agents so every project, large or small, gets elite
            representation at the permit counter.
          </p>
          <p className="mt-3 text-sm leading-7 text-muted-foreground md:text-base">
            A graduate of the{" "}
            <span className="font-semibold text-foreground">
              Harvard University Agentic AI certificate program
            </span>
            , Ian blends frontier AI fluency with deep, on-the-ground permitting
            practice — ensuring every PermitPilot agent is grounded in how real
            jurisdictions actually behave.
          </p>
          <p className="mt-3 text-sm leading-7 text-muted-foreground md:text-base">
            Approachable, candid, and relentlessly client-first, Ian and the
            Commun-ET team partner with clients in two ways:{" "}
            <span className="font-semibold text-foreground">consulting</span> on
            permitting strategy, jurisdiction navigation, and project recovery — or{" "}
            <span className="font-semibold text-foreground">building custom intelligence</span>,
            tooling, and workflows tailored to your portfolio. If you have a project
            on the line or an idea worth exploring, the door is open.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="mailto:ian@commun-et.com?subject=PermitPilot%20Consult%20Request"
              className="pilot-button-primary"
            >
              <Mail className="h-4 w-4" /> Start a Conversation
            </a>
            <a
              href="mailto:ian@commun-et.com?subject=Custom%20Build%20Inquiry"
              className="pilot-button-ghost"
            >
              <Calendar className="h-4 w-4 text-primary" /> Book a Working Session
            </a>
          </div>
          <div className="mt-6 flex items-center gap-4 border-t border-border pt-6">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center p-1">
              <img
                src={communEtLogo}
                alt="Commun-ET, LLC"
                width={48}
                height={48}
                className="h-full w-auto max-w-full object-contain"
              />
            </span>
            <div>
              <div className="font-tight text-sm font-bold text-foreground">Commun-ET, LLC</div>
              <div className="pilot-kicker mt-1">
                Consulting · Custom Builds · AI-native AEC intelligence
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MISSION CONTROL CTA */}
      <section className="pilot-card flex flex-col items-start justify-between gap-5 p-8 md:flex-row md:items-center">
        <div>
          <h2 className="font-tight text-2xl font-black tracking-tight text-foreground">
            Ready to see your portfolio in command view?
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Jump into Mission Control and watch agents work your active permits in real time.
          </p>
        </div>
        <AuthGatedLink to="/dashboard" className="pilot-button-primary">
          Open Mission Control <ArrowRight className="h-4 w-4" />
        </AuthGatedLink>
      </section>

      {/* CONTACT */}
      <ContactForm />
    </div>
  );
}
