import { motion, animate } from "framer-motion";
import { CheckCircle, ArrowRight, FileSearch, Brain, Clock, Users, Building2, MapPin, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { PlatformDemoVideo } from "./PlatformDemoVideo";

const tourHighlights = [
  {
    icon: FileSearch,
    title: "Smart Jurisdiction Lookup",
    description: "Instantly find permit requirements for any location across the US",
  },
  {
    icon: Brain,
    title: "AI-Powered Form Filling",
    description: "Auto-populate applications with intelligent data extraction",
  },
  {
    icon: Clock,
    title: "Real-Time Status Tracking",
    description: "Monitor every permit from submission to approval",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Share projects and coordinate with stakeholders seamlessly",
  },
];

const stats = [
  {
    icon: Building2,
    value: 10000,
    suffix: "+",
    label: "Permits Processed",
  },
  {
    icon: MapPin,
    value: 2500,
    suffix: "+",
    label: "Jurisdictions Covered",
  },
  {
    icon: TrendingUp,
    value: 40,
    suffix: "%",
    label: "Faster Approvals",
  },
  {
    icon: Users,
    value: 500,
    suffix: "+",
    label: "Active Teams",
  },
];

function AnimatedCounter({ 
  value, 
  suffix = "", 
  duration = 2 
}: { 
  value: number; 
  suffix?: string; 
  duration?: number;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          const controls = animate(0, value, {
            duration,
            ease: "easeOut",
            onUpdate: (latest) => {
              setDisplayValue(Math.round(latest));
            },
          });
          return () => controls.stop();
        }
      },
      { threshold: 0.3 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [value, duration, hasAnimated]);

  return (
    <span ref={ref} className="tabular-nums">
      {displayValue.toLocaleString()}{suffix}
    </span>
  );
}

export function ProductTourSection() {
  const { flags } = useFeatureFlags();

  // If demo video is enabled, render the video component instead
  if (flags.showDemoVideo) {
    return <PlatformDemoVideo />;
  }

  return (
    <section className="py-20 md:py-28 bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            Platform Overview
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4">
            See How PermitPulse Works
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Streamline your entire permitting process with our intelligent platform
          </p>
        </motion.div>

        {/* Animated Stats Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-16"
        >
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: 0.2 + index * 0.1 }}
              className="relative group"
            >
              <div className="p-6 rounded-2xl bg-card border border-border/50 text-center hover:border-primary/30 hover:shadow-lg transition-all duration-300">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 group-hover:bg-primary/20 mb-4 transition-colors">
                  <stat.icon className="w-6 h-6 text-primary" />
                </div>
                <div className="text-3xl md:text-4xl font-bold text-foreground mb-1">
                  <AnimatedCounter value={stat.value} suffix={stat.suffix} />
                </div>
                <div className="text-sm text-muted-foreground font-medium">
                  {stat.label}
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Image/Visual Side */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative"
          >
            <div className="relative rounded-2xl overflow-hidden border border-border/50 shadow-2xl bg-card">
              {/* Decorative gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 via-transparent to-primary/10 pointer-events-none z-10" />
              
              {/* Dashboard mockup */}
              <div className="p-6 md:p-8">
                <div className="flex items-center gap-2 mb-6">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="ml-4 text-sm text-muted-foreground">PermitPulse Dashboard</span>
                </div>
                
                {/* Mock dashboard content */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                        <FileSearch className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-sm">123 Main Street Project</div>
                        <div className="text-xs text-muted-foreground">San Francisco, CA</div>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 text-xs font-medium">
                      Approved
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                        <Clock className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-sm">456 Oak Ave Renovation</div>
                        <div className="text-xs text-muted-foreground">Los Angeles, CA</div>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-yellow-500/10 text-yellow-600 text-xs font-medium">
                      In Review
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                        <Brain className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-medium text-sm">789 Pine St Addition</div>
                        <div className="text-xs text-muted-foreground">Seattle, WA</div>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 text-xs font-medium">
                      Submitted
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating accent elements */}
            <div className="absolute -top-4 -right-4 w-24 h-24 bg-primary/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-primary/5 rounded-full blur-3xl" />
          </motion.div>

          {/* Content Side */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="space-y-8"
          >
            <div className="space-y-6">
              {tourHighlights.map((highlight, index) => (
                <motion.div
                  key={highlight.title}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.4 + index * 0.1 }}
                  className="flex items-start gap-4 group"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                    <highlight.icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-1 flex items-center gap-2">
                      {highlight.title}
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    </h3>
                    <p className="text-muted-foreground">{highlight.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Button asChild size="lg" className="group">
                <Link to="/demos">
                  Explore Live Demos
                  <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/contact">
                  Schedule a Walkthrough
                </Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
