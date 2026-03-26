import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useTheme } from "@/hooks/useTheme";

const useInView = (threshold = 0.15): [React.RefObject<HTMLElement | null>, boolean] => {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return [ref, inView];
};

interface AnimCounterProps {
  target: number;
  suffix?: string;
  duration?: number;
}

const AnimCounter = ({ target, suffix = "", duration = 2000 }: AnimCounterProps) => {
  const [val, setVal] = useState(0);
  const [ref, inView] = useInView();
  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = Math.ceil(target / (duration / 16));
    const t = setInterval(() => {
      start = Math.min(start + step, target);
      setVal(start);
      if (start >= target) clearInterval(t);
    }, 16);
    return () => clearInterval(t);
  }, [inView, target, duration]);
  return <span ref={ref as React.RefObject<HTMLSpanElement>}>{val}{suffix}</span>;
};

const GoldLine = ({ w = "100%", delay = 0 }: { w?: string; delay?: number }) => (
  <div style={{
    height: 1,
    background: `linear-gradient(90deg, transparent, #FF6B2B, transparent)`,
    width: w,
    opacity: 0.4,
    animationDelay: `${delay}s`,
  }} />
);

export default function CommunETLanding() {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const tc = useThemeColors();
  const COLORS = {
    obsidian: tc.bg,
    slate: tc.bgSecondary,
    panel: tc.panel,
    border: tc.border,
    gold: tc.gold,
    goldLight: tc.goldLight,
    goldDim: tc.goldDim,
    steel: tc.steel,
    fog: tc.fog,
    white: tc.white,
    offwhite: tc.offwhite,
    teal: tc.teal,
    tealDim: tc.tealDim,
    red: tc.red,
  };
  const competitiveMatrixRef = useRef<HTMLElement | null>(null);
  const [activeModule, setActiveModule] = useState(0);
  
  const [, setScrollY] = useState(0);
  const [heroVisible, setHeroVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setHeroVisible(true), 100);
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const modules = [
    { id: "01", name: "DesignCheck™", tag: "FLAGSHIP", desc: "AI-powered permit comment reconciliation. Reduces 8+ hours of manual review to under 60 minutes. Analyzes agency comments, matches to code sections, generates resolution instructions.", icon: "◈", color: COLORS.gold },
    { id: "02", name: "SubmitIQ™", tag: "WAVE 1", desc: "Pre-submission quality assurance engine. Validates drawing packages against jurisdiction-specific requirements before first submittal, eliminating predictable rejections.", icon: "⬡", color: COLORS.teal },
    { id: "03", name: "UtilitySync™", tag: "WAVE 1", desc: "Utility coordination command center. Maps existing infrastructure, tracks locate requests, manages conflict resolution, and maintains agency communication threads.", icon: "⬢", color: "#818CF8" },
    { id: "04", name: "CommentTrace™", tag: "WAVE 2", desc: "Historical comment intelligence. Mines proprietary comment database to predict agency objections before submission and surfaces resolution precedents.", icon: "◉", color: "#FF6B2B" },
    { id: "05", name: "AgencyPulse™", tag: "WAVE 2", desc: "Real-time agency relationship monitoring. Tracks reviewer preferences, turnaround velocity, and jurisdictional pattern shifts across all active projects.", icon: "◎", color: "#38BDF8" },
    { id: "06", name: "ConstructionOS™", tag: "WAVE 3", desc: "Unified construction management platform. Integrates all 12 Insight modules into a single command interface with project health scoring and cascading delay forecasts.", icon: "⬛", color: "#FB7185" },
  ];

  const infographicSteps = [
    { n: "01", label: "Plans Submitted", sub: "Architect delivers drawings", icon: "◈", color: "#6B9AC4" },
    { n: "02", label: "Agency Review", sub: "30–90 day review cycle", icon: "◉", color: "#6B9AC4" },
    { n: "03", label: "Comments Issued", sub: "8–40 correction items", icon: "◎", color: COLORS.red },
    { n: "04", label: "Manual Reconciliation", sub: "8+ hrs per comment set", icon: "⬡", color: COLORS.red },
    { n: "05", label: "Resubmittal", sub: "Often repeat 3–4 cycles", icon: "⬢", color: COLORS.red },
  ];

  const insightSteps = [
    { n: "01", label: "Comment Ingestion", sub: "AI parses agency PDF/portal", icon: "◈", color: COLORS.gold },
    { n: "02", label: "Code Mapping", sub: "Context & Reference Engine", icon: "⬡", color: COLORS.gold },
    { n: "03", label: "Resolution Generation", sub: "Proprietary history + LLM", icon: "◉", color: COLORS.gold },
    { n: "04", label: "Human Review", sub: "Expert validates in <10 min", icon: "✓", color: COLORS.teal },
    { n: "05", label: "Client Delivery", sub: "Marked PDF + JSON output", icon: "⚡", color: COLORS.teal },
  ];

  const competitors = [
    { name: "Burnham Nationwide", age: "30 yrs", tech: "Manual", ai: false, portal: "Basic", intel: false },
    { name: "Permit Place", age: "20 yrs", tech: "Manual+", ai: false, portal: "Status only", intel: false },
    { name: "McCormick Permits", age: "Est'd", tech: "Manual", ai: false, portal: "None", intel: false },
    { name: "Commun-ET + Insight™", age: "AI-Native", tech: "AI-Powered", ai: true, portal: "Full Platform", intel: true },
  ];

  const style = {
    page: {
      background: COLORS.obsidian,
      color: COLORS.white,
      fontFamily: "'Georgia', 'Times New Roman', serif",
      minHeight: "100vh",
      overflowX: "hidden" as const,
    },
    mono: { fontFamily: "'Courier New', monospace" },
    sans: { fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  };

  return (
    <div style={style.page}>
      <style>{`
        
        .fade-up { opacity: 0; transform: translateY(32px); transition: all 0.8s cubic-bezier(0.16,1,0.3,1); }
        .fade-up.visible { opacity: 1; transform: translateY(0); }
        .module-card { transition: all 0.4s cubic-bezier(0.16,1,0.3,1); cursor: pointer; }
        .module-card:hover { transform: translateY(-4px); }
        .gold-hover { transition: color 0.3s ease; }
        .gold-hover:hover { color: #FF6B2B; }
        .grid-bg {
          background-image: 
            linear-gradient(${isDark ? "rgba(56,189,248,0.04)" : "rgba(15,23,42,0.04)"} 1px, transparent 1px),
            linear-gradient(90deg, ${isDark ? "rgba(56,189,248,0.04)" : "rgba(15,23,42,0.04)"} 1px, transparent 1px);
          background-size: 60px 60px;
        }
        .shimmer {
          background: linear-gradient(90deg, transparent 0%, rgba(255,107,43,0.12) 50%, transparent 100%);
          background-size: 200% 100%;
          animation: shimmer 3s infinite;
        }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        @keyframes pulse-gold { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
        .scan-line {
          position: absolute; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255,107,43,${isDark ? "0.4" : "0.15"}), transparent);
          animation: scan 8s linear infinite;
        }
        .stat-number {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-weight: 300;
          font-size: clamp(3rem, 6vw, 5rem);
          color: #FF6B2B;
          letter-spacing: -0.02em;
          line-height: 1;
        }
        .section-eyebrow {
          font-family: 'DM Mono', 'Courier New', monospace;
          font-size: 0.65rem;
          letter-spacing: 0.25em;
          color: #FF6B2B;
          text-transform: uppercase;
        }
        .display-headline {
          font-family: 'Cormorant Garamond', Georgia, serif;
          font-weight: 300;
          line-height: 1.1;
          letter-spacing: -0.01em;
        }
        .body-text {
          font-family: 'Barlow', 'Trebuchet MS', sans-serif;
          font-weight: 300;
          line-height: 1.7;
          color: ${COLORS.fog};
        }
        .tag {
          font-family: 'DM Mono', monospace;
          font-size: 0.6rem;
          letter-spacing: 0.15em;
          padding: 3px 8px;
          border-radius: 2px;
          text-transform: uppercase;
        }
        .arrow-connector {
          display: flex;
          align-items: center;
          color: ${COLORS.steel};
          font-size: 1.2rem;
          padding: 0 8px;
          flex-shrink: 0;
        }
      `}</style>

      {/* HERO */}
      <section style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        padding: "0 clamp(24px, 5vw, 80px) 0",
      }} className="grid-bg">
        <div className="scan-line" />

        {["0 0", "0 auto", "auto 0", "auto auto"].map((m, i) => (
          <div key={i} style={{
            position: "absolute",
            top: i < 2 ? 32 : "auto",
            bottom: i >= 2 ? 32 : "auto",
            left: i % 2 === 0 ? 32 : "auto",
            right: i % 2 !== 0 ? 32 : "auto",
            width: 20, height: 20,
            borderTop: i < 2 ? `1px solid ${COLORS.goldDim}` : "none",
            borderBottom: i >= 2 ? `1px solid ${COLORS.goldDim}` : "none",
            borderLeft: i % 2 === 0 ? `1px solid ${COLORS.goldDim}` : "none",
            borderRight: i % 2 !== 0 ? `1px solid ${COLORS.goldDim}` : "none",
            opacity: 0.5,
          }} />
        ))}

        {/* Nav */}
        <nav style={{
          position: "fixed", top: 0, left: 0, right: 0,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "20px clamp(24px, 5vw, 80px)",
          background: isDark ? "linear-gradient(180deg, rgba(5,14,31,0.96) 0%, transparent 100%)" : "linear-gradient(180deg, rgba(255,255,255,0.95) 0%, transparent 100%)",
          backdropFilter: "blur(12px)",
          zIndex: 100,
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 36, height: 36,
              border: `1px solid ${COLORS.gold}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1rem",
            }}>⬡</div>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1rem", letterSpacing: "0.1em", color: COLORS.white }}>COMMUN-ET</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.55rem", letterSpacing: "0.2em", color: COLORS.goldDim }}>INTELLIGENCE PLATFORM</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 32, fontFamily: "'Barlow', sans-serif", fontSize: "0.8rem", letterSpacing: "0.08em", color: COLORS.fog }}>
            {["Services", "Insight™", "Results", "Contact"].map(n => (
              <span key={n} className="gold-hover" style={{ cursor: "pointer" }} data-testid={`link-nav-${n.toLowerCase().replace("™", "")}`}>{n}</span>
            ))}
          </div>
          <div
            data-testid="button-request-access"
            onClick={() => navigate("/auth")}
            style={{
              padding: "8px 20px",
              border: `1px solid ${COLORS.gold}`,
              fontFamily: "'DM Mono', monospace",
              fontSize: "0.65rem",
              letterSpacing: "0.15em",
              color: COLORS.gold,
              cursor: "pointer",
            }}>REQUEST ACCESS</div>
        </nav>

        {/* Hero Content */}
        <div style={{ maxWidth: 900, paddingTop: 100 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32, opacity: heroVisible ? 1 : 0, transition: "opacity 1s ease 0.2s" }}>
            <div style={{ width: 40, height: 1, background: COLORS.gold, opacity: 0.6 }} />
            <span className="section-eyebrow">Permit Intelligence · Utility Coordination · Construction Management</span>
          </div>

          <h1 className="display-headline" style={{
            fontSize: "clamp(2.8rem, 6.5vw, 6rem)",
            color: COLORS.white,
            marginBottom: 24,
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "none" : "translateY(40px)",
            transition: "all 1s cubic-bezier(0.16,1,0.3,1) 0.3s",
          }}>
            The Intelligence Layer<br />
            <span style={{ color: COLORS.gold }}>Every Project</span><br />
            Has Been Missing.
          </h1>

          <p className="body-text" style={{
            fontSize: "1.1rem",
            maxWidth: 560,
            marginBottom: 48,
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "none" : "translateY(20px)",
            transition: "all 1s cubic-bezier(0.16,1,0.3,1) 0.5s",
          }}>
            Commun-ET combines 20 years of permit intelligence with proprietary AI to eliminate the delays that cascade through your projects. We don't just expedite permits — we engineer certainty.
          </p>

          <div style={{
            display: "flex", gap: 16, flexWrap: "wrap",
            marginBottom: 40,
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "none" : "translateY(20px)",
            transition: "all 1s cubic-bezier(0.16,1,0.3,1) 0.7s",
          }}>
            <button
              data-testid="button-explore-platform"
              onClick={() => navigate("/auth")}
              style={{
                padding: "14px 36px",
                background: COLORS.gold,
                border: "none",
                color: COLORS.obsidian,
                fontFamily: "'DM Mono', monospace",
                fontSize: "0.7rem",
                letterSpacing: "0.15em",
                cursor: "pointer",
                fontWeight: 500,
              }}>EXPLORE INSIGHT™ PLATFORM</button>
            <button
              data-testid="button-view-case-results"
              onClick={() => competitiveMatrixRef.current?.scrollIntoView({ behavior: "smooth" })}
              style={{
                padding: "14px 36px",
                background: "transparent",
                border: `1px solid ${COLORS.steel}`,
                color: COLORS.fog,
                fontFamily: "'DM Mono', monospace",
                fontSize: "0.7rem",
                letterSpacing: "0.15em",
                cursor: "pointer",
              }}>VIEW CASE RESULTS</button>
          </div>
        </div>

        <div style={{ flex: 1 }} />
        {/* Stats strip */}
        <div style={{
          marginLeft: `calc(-1 * clamp(24px, 5vw, 80px))`,
          marginRight: `calc(-1 * clamp(24px, 5vw, 80px))`,
          borderTop: `1px solid ${COLORS.border}`,
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          background: isDark ? "rgba(9,20,40,0.85)" : "rgba(255,255,255,0.9)",
          backdropFilter: "blur(20px)",
        }}>
          {[
            { val: 90, suffix: "%", label: "Reduction in Review Time" },
            { val: 50, suffix: "+", label: "Jurisdictions Covered" },
            { val: 12, suffix: " Modules", label: "Insight™ Platform Roadmap" },
            { val: 8, suffix: " Agents", label: "AI Agents in DesignCheck" },
          ].map((s, i) => (
            <div key={i} style={{
              padding: "28px 24px",
              borderRight: i < 3 ? `1px solid ${COLORS.border}` : "none",
              textAlign: "center",
            }}>
              <div className="stat-number" data-testid={`text-stat-${i}`}><AnimCounter target={s.val} suffix={s.suffix} /></div>
              <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.75rem", color: COLORS.fog, marginTop: 6, letterSpacing: "0.05em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* PROBLEM/SOLUTION INFOGRAPHIC */}
      <section style={{ padding: "120px clamp(24px, 5vw, 80px)", background: COLORS.slate }}>
        <GoldLine />
        <div style={{ paddingTop: 80 }}>
          <div style={{ textAlign: "center", marginBottom: 80 }}>
            <div className="section-eyebrow" style={{ marginBottom: 16 }}>The Core Problem · Solved</div>
            <h2 className="display-headline" style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)", color: COLORS.white }}>
              Why Projects Stall — and<br /><span style={{ color: COLORS.gold }}>How We End It</span>
            </h2>
          </div>

          {/* Traditional Flow */}
          <div style={{ marginBottom: 60 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.65rem", letterSpacing: "0.2em", color: COLORS.red }}>◉ LEGACY PROCESS</span>
              <div style={{ flex: 1, height: 1, background: `${COLORS.red}33` }} />
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.65rem", color: COLORS.fog }}>8+ HOURS PER PROJECT</span>
            </div>
            <div style={{ display: "flex", alignItems: "stretch", overflowX: "auto", gap: 0, paddingBottom: 8 }}>
              {infographicSteps.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", flex: "1 1 0", minWidth: 140 }}>
                  <div style={{
                    flex: 1,
                    background: i >= 2 ? `${COLORS.red}11` : `${COLORS.steel}22`,
                    border: `1px solid ${i >= 2 ? `${COLORS.red}44` : COLORS.border}`,
                    padding: "20px 16px",
                    textAlign: "center",
                    position: "relative",
                  }}>
                    <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>{s.icon}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.55rem", letterSpacing: "0.15em", color: i >= 2 ? COLORS.red : COLORS.fog, marginBottom: 6 }}>{s.n}</div>
                    <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.8rem", color: COLORS.offwhite, fontWeight: 500, marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.7rem", color: COLORS.fog }}>{s.sub}</div>
                    {i >= 2 && <div style={{ position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: "50%", background: COLORS.red, animation: "pulse-gold 2s infinite" }} />}
                  </div>
                  {i < infographicSteps.length - 1 && <div className="arrow-connector">→</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Versus divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 20, margin: "40px 0" }}>
            <div style={{ flex: 1, height: 1, background: COLORS.border }} />
            <div style={{
              padding: "10px 32px",
              border: `1px solid ${COLORS.gold}`,
              fontFamily: "'DM Mono', monospace",
              fontSize: "0.7rem",
              letterSpacing: "0.2em",
              color: COLORS.gold,
            }}>INSIGHT™ DESIGNCHECK</div>
            <div style={{ flex: 1, height: 1, background: COLORS.border }} />
          </div>

          {/* Insight Flow */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.65rem", letterSpacing: "0.2em", color: COLORS.gold }}>◈ INSIGHT™ PROCESS</span>
              <div style={{ flex: 1, height: 1, background: `${COLORS.gold}33` }} />
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.65rem", color: COLORS.teal }}>UNDER 60 MINUTES</span>
            </div>
            <div style={{ display: "flex", alignItems: "stretch", overflowX: "auto", gap: 0, paddingBottom: 8 }}>
              {insightSteps.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", flex: "1 1 0", minWidth: 140 }}>
                  <div style={{
                    flex: 1,
                    background: `${COLORS.gold}09`,
                    border: `1px solid ${COLORS.goldDim}44`,
                    padding: "20px 16px",
                    textAlign: "center",
                    position: "relative",
                    boxShadow: `0 0 20px ${COLORS.gold}08`,
                  }}>
                    <div style={{ fontSize: "1.2rem", color: s.color, marginBottom: 8 }}>{s.icon}</div>
                    <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.55rem", letterSpacing: "0.15em", color: COLORS.goldDim, marginBottom: 6 }}>{s.n}</div>
                    <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.8rem", color: COLORS.white, fontWeight: 500, marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.7rem", color: COLORS.fog }}>{s.sub}</div>
                  </div>
                  {i < insightSteps.length - 1 && <div className="arrow-connector" style={{ color: COLORS.goldDim }}>→</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Impact callout */}
          <div style={{
            marginTop: 60,
            padding: "32px 40px",
            background: `linear-gradient(135deg, ${COLORS.gold}11, transparent)`,
            border: `1px solid ${COLORS.goldDim}44`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 24,
          }}>
            {[
              { val: "8 hrs → 45 min", label: "Comment Resolution Time" },
              { val: "90%", label: "Efficiency Gain Per Project" },
              { val: "$1M+", label: "DesignCheck ARR Projection" },
            ].map((item, i) => (
              <div key={i} style={{ textAlign: "center", flex: "1 1 150px" }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.8rem", color: COLORS.gold, fontWeight: 300 }}>{item.val}</div>
                <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.75rem", color: COLORS.fog, marginTop: 4 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPETITIVE MATRIX */}
      <section
        ref={competitiveMatrixRef as React.RefObject<HTMLElement>}
        id="competitive-matrix"
        data-testid="section-competitive-matrix"
        style={{ padding: "120px clamp(24px, 5vw, 80px)", background: COLORS.obsidian }}
        className="grid-bg"
      >
        <div style={{ textAlign: "center", marginBottom: 80 }}>
          <div className="section-eyebrow" style={{ marginBottom: 16 }}>Competitive Intelligence</div>
          <h2 className="display-headline" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", color: COLORS.white }}>
            The Industry Has Experience.<br /><span style={{ color: COLORS.gold }}>We Have Intelligence.</span>
          </h2>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr>
                {["Firm", "Approach", "AI-Powered", "Client Portal", "Predictive Intel"].map((h, i) => (
                  <th key={i} style={{
                    padding: "16px 20px",
                    textAlign: i === 0 ? "left" : "center",
                    fontFamily: "'DM Mono', monospace",
                    fontSize: "0.6rem",
                    letterSpacing: "0.2em",
                    color: COLORS.goldDim,
                    borderBottom: `1px solid ${COLORS.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {competitors.map((c, i) => {
                const isUs = i === competitors.length - 1;
                return (
                  <tr key={i} style={{
                    background: isUs ? `${COLORS.gold}08` : "transparent",
                    borderBottom: `1px solid ${COLORS.border}`,
                    transition: "background 0.3s",
                  }}>
                    <td style={{ padding: "20px", fontFamily: "'Barlow', sans-serif", fontSize: "0.9rem", color: isUs ? COLORS.gold : COLORS.white, fontWeight: isUs ? 500 : 300 }}>
                      {c.name}
                      {isUs && <span style={{ marginLeft: 10, background: COLORS.gold, color: COLORS.obsidian, fontSize: "0.55rem", padding: "2px 8px", fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em" }}>YOU ARE HERE</span>}
                    </td>
                    <td style={{ padding: "20px", textAlign: "center", fontFamily: "'Barlow', sans-serif", fontSize: "0.8rem", color: isUs ? COLORS.teal : COLORS.fog }}>{c.tech}</td>
                    <td style={{ padding: "20px", textAlign: "center", fontSize: "1.1rem" }}>{c.ai ? <span style={{ color: COLORS.teal }}>✓</span> : <span style={{ color: `${COLORS.fog}44` }}>—</span>}</td>
                    <td style={{ padding: "20px", textAlign: "center", fontFamily: "'Barlow', sans-serif", fontSize: "0.8rem", color: isUs ? COLORS.teal : COLORS.fog }}>{c.portal}</td>
                    <td style={{ padding: "20px", textAlign: "center", fontSize: "1.1rem" }}>{c.intel ? <span style={{ color: COLORS.teal }}>✓</span> : <span style={{ color: `${COLORS.fog}44` }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p style={{ fontFamily: "'Barlow', sans-serif", fontSize: "0.75rem", color: COLORS.fog, textAlign: "center", marginTop: 20 }}>
          Competitors cited from public records and web presence research. Data current as of Q1 2026.
        </p>
      </section>

      {/* INSIGHT PLATFORM */}
      <section style={{ padding: "120px clamp(24px, 5vw, 80px)", background: COLORS.panel }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 40, marginBottom: 80 }}>
          <div style={{ flex: "1 1 400px" }}>
            <div className="section-eyebrow" style={{ marginBottom: 16 }}>Product Architecture</div>
            <h2 className="display-headline" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", color: COLORS.white }}>
              Insight™ Platform<br /><span style={{ color: COLORS.gold }}>12 Modules. One Mission.</span>
            </h2>
          </div>
          <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {["Wave 1 · Prove the Intelligence", "Wave 2 · Scale the Platform", "Wave 3 · Own the Category"].map((w, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 10,
                fontFamily: "'DM Mono', monospace", fontSize: "0.6rem",
                letterSpacing: "0.1em", color: COLORS.fog,
              }}>
                <div style={{ width: 24, height: 1, background: [COLORS.gold, COLORS.teal, "#818CF8"][i] }} />
                {w}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 1, background: COLORS.border }}>
          {modules.map((m, i) => (
            <div
              key={i}
              className="module-card"
              data-testid={`card-module-${i}`}
              onClick={() => setActiveModule(i)}
              style={{
                padding: "36px 32px",
                background: activeModule === i ? `${m.color}12` : COLORS.panel,
                borderLeft: activeModule === i ? `2px solid ${m.color}` : "2px solid transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div style={{ fontSize: "1.6rem", color: m.color }}>{m.icon}</div>
                <span className="tag" style={{ background: `${m.color}18`, color: m.color, border: `1px solid ${m.color}44` }}>{m.tag}</span>
              </div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.6rem", letterSpacing: "0.15em", color: COLORS.fog, marginBottom: 8 }}>{m.id}</div>
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.3rem", color: COLORS.white, marginBottom: 12, fontWeight: 400 }}>{m.name}</h3>
              <p className="body-text" style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* UX PRINCIPLES */}
      <section style={{ padding: "120px clamp(24px, 5vw, 80px)", background: COLORS.slate }}>
        <div style={{ textAlign: "center", marginBottom: 80 }}>
          <div className="section-eyebrow" style={{ marginBottom: 16 }}>Client Experience Design</div>
          <h2 className="display-headline" style={{ fontSize: "clamp(2rem, 4vw, 3rem)", color: COLORS.white }}>
            The Luxury Standard<br /><span style={{ color: COLORS.gold }}>Applied to Permitting</span>
          </h2>
          <p className="body-text" style={{ maxWidth: 560, margin: "20px auto 0", fontSize: "0.95rem" }}>
            Every touchpoint engineered to the standard of the world's premier professional services firms.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {[
            { icon: "◈", title: "Proactive Intelligence", sub: "Client Portal Experience", desc: "Clients see what's happening before they ask. Real-time permit status, predicted timelines, and risk flags — presented through a portal as refined as a private banking dashboard.", benchmark: "Benchmark: JPMorgan Private" },
            { icon: "⬡", title: "Concierge Communication", sub: "Dedicated Success Architecture", desc: "Every engagement includes a named Insight Advisor. White-glove onboarding. SLA commitments published in writing. No tickets. No hold queues. Direct lines only.", benchmark: "Benchmark: Four Seasons Hotels" },
            { icon: "◉", title: "Radical Transparency", sub: "Full Project Visibility", desc: "Show the work. Every comment, every response, every revision — documented, timestamped, and searchable. Clients don't wonder what we're doing. They watch it happen.", benchmark: "Benchmark: Stripe Dashboard" },
            { icon: "⬢", title: "Outcome Guarantees", sub: "Performance SLAs", desc: "Comment responses within 24 hours. Pre-submission QA completed in 48 hours. First-pass approval rate tracked and published quarterly. We tie our value to measurable results.", benchmark: "Benchmark: Amazon Prime SLA" },
            { icon: "◎", title: "Expertise On Demand", sub: "Strategic Advisory Layer", desc: "Insight transforms expeditors from processors into strategic advisors. Clients access AI-powered analysis plus human judgment on jurisdiction strategy, phasing, and risk mitigation.", benchmark: "Benchmark: McKinsey Engagement Model" },
            { icon: "✦", title: "Continuous Learning", sub: "Platform That Gets Smarter", desc: "Every project enriches the proprietary comment database. Every interaction trains the AI. The longer you're a client, the more intelligent the system becomes for your project types.", benchmark: "Benchmark: Netflix Recommendation Engine" },
          ].map((p, i) => (
            <div key={i} style={{
              padding: "36px 32px",
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              position: "relative",
              transition: "border-color 0.3s",
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = COLORS.goldDim)}
            onMouseLeave={e => (e.currentTarget.style.borderColor = COLORS.border)}
            >
              <div style={{ fontSize: "1.4rem", color: COLORS.gold, marginBottom: 16 }}>{p.icon}</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.55rem", letterSpacing: "0.15em", color: COLORS.goldDim, marginBottom: 8 }}>{p.sub}</div>
              <h3 style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "1.2rem", color: COLORS.white, marginBottom: 12, fontWeight: 400 }}>{p.title}</h3>
              <p className="body-text" style={{ fontSize: "0.82rem", marginBottom: 20 }}>{p.desc}</p>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                fontFamily: "'DM Mono', monospace", fontSize: "0.55rem",
                letterSpacing: "0.1em", color: `${COLORS.teal}88`,
              }}>
                <div style={{ width: 16, height: 1, background: COLORS.tealDim }} />
                {p.benchmark}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding: "120px clamp(24px, 5vw, 80px)",
        background: COLORS.obsidian,
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }} className="grid-bg">
        <div style={{
          position: "absolute", inset: 0,
          background: `radial-gradient(ellipse 60% 40% at 50% 50%, ${COLORS.gold}08, transparent)`,
          pointerEvents: "none",
        }} />
        <div className="section-eyebrow" style={{ marginBottom: 24 }}>Ready to Transform Your Practice</div>
        <h2 className="display-headline" style={{ fontSize: "clamp(2.5rem, 5vw, 4.5rem)", color: COLORS.white, marginBottom: 24, maxWidth: 700, margin: "0 auto 24px" }}>
          The Permits Will Still Be Complex.<br /><span style={{ color: COLORS.gold }}>Your Experience Won't Be.</span>
        </h2>
        <p className="body-text" style={{ maxWidth: 500, margin: "0 auto 48px", fontSize: "1rem" }}>
          Join the firms already running projects through Insight™. Early access pricing available through Q2 2026.
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
          <button
            data-testid="button-request-demo"
            onClick={() => navigate("/auth")}
            style={{
              padding: "16px 48px",
              background: COLORS.gold,
              border: "none",
              color: COLORS.obsidian,
              fontFamily: "'DM Mono', monospace",
              fontSize: "0.75rem",
              letterSpacing: "0.15em",
              cursor: "pointer",
              fontWeight: 500,
            }}>REQUEST INSIGHT™ DEMO</button>
          <button
            data-testid="button-download-brief"
            onClick={() => navigate("/auth")}
            style={{
              padding: "16px 48px",
              background: "transparent",
              border: `1px solid ${COLORS.steel}`,
              color: COLORS.fog,
              fontFamily: "'DM Mono', monospace",
              fontSize: "0.75rem",
              letterSpacing: "0.15em",
              cursor: "pointer",
            }}>DOWNLOAD PLATFORM BRIEF</button>
        </div>

        <div style={{ marginTop: 100, borderTop: `1px solid ${COLORS.border}`, paddingTop: 40, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 28, height: 28, border: `1px solid ${COLORS.goldDim}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", color: COLORS.gold }}>⬡</div>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "0.85rem", letterSpacing: "0.1em", color: COLORS.white }}>COMMUN-ET, LLC</div>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.5rem", letterSpacing: "0.2em", color: COLORS.goldDim }}>INSIGHT™ INTELLIGENCE PLATFORM</div>
            </div>
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.55rem", letterSpacing: "0.1em", color: COLORS.fog }}>
            PERMIT EXPEDITING · UTILITY COORDINATION · CONSTRUCTION MANAGEMENT
          </div>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.55rem", letterSpacing: "0.1em", color: COLORS.fog }}>
            © 2026 COMMUN-ET, LLC. ALL RIGHTS RESERVED.
          </div>
        </div>
      </section>
    </div>
  );
}
