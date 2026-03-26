import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, CheckCircle2, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";

const benefits = [
  "80% higher first-time approval rate",
  "40% faster permit turnaround",
  "Real-time jurisdiction data",
];

const stats = [
  { value: "$2.4M+", label: "Saved in delays" },
  { value: "200+", label: "Jurisdictions" },
  { value: "40%", label: "Faster approvals" },
];

const trustedLogos = ["loom", "HubSpot", "ramp"];

export function MarketingHeroSection() {
  const navigate = useNavigate();

  return (
    <section className="relative min-h-[90vh] flex items-center py-20 lg:py-32 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/30 dark:from-background dark:via-background dark:to-muted/10" />
      
      {/* Decorative blur orbs */}
      <div className="absolute top-20 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute bottom-20 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />

      <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 md:px-6 lg:px-8 relative">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: Content */}
          <div className="text-center lg:text-left">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-8">
                <span className="text-sm font-medium text-primary">
                  AI-Powered Permit Intelligence
                </span>
              </div>

              {/* Headline */}
              <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-6 leading-tight">
                Secure your permits{" "}
                <br />
                <span className="text-primary">with precision.</span>
              </h1>

              {/* Subheadline */}
              <p className="text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 mb-8">
                Join over a million professionals who choose InsightDesignCheck for fast, 
                accurate permit submissions and real-time compliance tracking.
              </p>
            </motion.div>

            {/* CTAs */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-4 mb-10"
            >
              <Button
                size="lg"
                onClick={() => navigate("/auth")}
                className="gap-2 px-8 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25"
              >
                Open Account
                <ArrowUpRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => navigate("/demos")}
                className="gap-2 rounded-full border-border/50 hover:bg-muted"
              >
                <Play className="h-4 w-4" />
                Watch Demo
              </Button>
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex flex-wrap justify-center lg:justify-start gap-8 mb-10"
            >
              {stats.map((stat, index) => (
                <div key={index} className="text-center lg:text-left">
                  <div className="text-2xl md:text-3xl font-bold text-foreground">{stat.value}</div>
                  <div className="text-sm text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </motion.div>

            {/* Trusted by */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="pt-8 border-t border-border/50"
            >
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-4">
                Trusted by the best
              </p>
              <div className="flex items-center justify-center lg:justify-start gap-8">
                {trustedLogos.map((logo) => (
                  <span key={logo} className="text-lg font-semibold text-muted-foreground/60">
                    {logo}
                  </span>
                ))}
              </div>
            </motion.div>
          </div>

          {/* Right: Animated Cards */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="relative hidden lg:block"
          >
            <div className="grid grid-cols-2 gap-4">
              {/* Secure Card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="col-span-2 rounded-3xl bg-card border border-border p-6 shadow-xl"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-primary" />
                  </div>
                  <span className="font-semibold text-foreground">Extra Secure</span>
                </div>
                <p className="text-muted-foreground text-sm">
                  AI-powered fraud detection and compliance checks keep your submissions safe.
                </p>
              </motion.div>

              {/* Jurisdictions Card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="rounded-3xl bg-card border border-border p-6 shadow-xl"
              >
                <div className="w-12 h-12 rounded-full bg-primary mb-4 flex items-center justify-center">
                  <span className="text-xl">🌍</span>
                </div>
                <p className="font-medium text-foreground text-sm">Jurisdictions</p>
                <p className="text-muted-foreground text-xs mt-1">
                  Hundreds of regions in one platform
                </p>
              </motion.div>

              {/* Growth Card */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7 }}
                className="rounded-3xl bg-primary text-primary-foreground p-6 shadow-xl"
              >
                <p className="text-xs uppercase tracking-wider opacity-80 mb-2">Growth Revenue</p>
                <p className="text-2xl font-bold mb-1">$50,240</p>
                <p className="text-xs opacity-80">↑ 24% this month</p>
                {/* Mini bars */}
                <div className="flex items-end gap-1.5 mt-4 h-12">
                  {[18, 48, 72, 96].map((h, i) => (
                    <motion.div
                      key={i}
                      initial={{ height: 0 }}
                      animate={{ height: `${h}%` }}
                      transition={{ delay: 0.8 + i * 0.1, duration: 0.5 }}
                      className="flex-1 rounded-full bg-primary-foreground/30"
                    />
                  ))}
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
