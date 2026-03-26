import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play, CheckCircle2, Clock, Shield, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/components/animations/variants";
import heroWorkflowIllustration from "@/assets/hero-workflow-illustration.png";
import { LiveJurisdictionCounter } from "./LiveJurisdictionCounter";
export function HeroSection() {
  return (
    <section className="relative overflow-hidden gradient-hero text-primary-foreground">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute inset-0" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />
      </div>

      {/* Animated background shapes */}
      <motion.div
        className="absolute top-20 left-10 w-72 h-72 bg-accent/20 rounded-full blur-3xl"
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />
      <motion.div
        className="absolute bottom-20 right-10 w-96 h-96 bg-primary-foreground/10 rounded-full blur-3xl"
        animate={{
          scale: [1.2, 1, 1.2],
          opacity: [0.2, 0.4, 0.2],
        }}
        transition={{
          duration: 10,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <div className="container mx-auto px-4 py-20 lg:py-28 lg:px-8 relative">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <motion.div
            className="text-center lg:text-left"
            initial="hidden"
            animate="visible"
            variants={staggerContainer}
          >
            {/* Badge */}
            <motion.div
              variants={staggerItem}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/20 text-accent mb-8"
            >
              <Zap className="h-4 w-4" />
              <span className="text-sm font-medium">The Permit Intelligence Layer for AEC</span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              variants={staggerItem}
              className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6"
            >
              Every Permit Submission{" "}
              <span className="text-accent">80% More Likely to Pass.</span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              variants={staggerItem}
              className="text-lg md:text-xl text-primary-foreground/80 mb-10 max-w-2xl lg:max-w-none"
            >
              We're not just permit management—we're the data and AI layer that powers faster approvals. 
              200+ jurisdictions nationwide. Real-time permit intelligence. Pre-submittal issue detection that actually works.
            </motion.p>

            {/* CTAs */}
            <motion.div
              variants={staggerItem}
              className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-4 mb-12"
            >
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button asChild size="lg" className="bg-accent hover:bg-accent/90 text-accent-foreground px-8">
                  <Link to="/roi-calculator">
                    Calculate Your Permit Savings
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button 
                  size="lg" 
                  variant="outline" 
                  className="border-primary-foreground/50 bg-primary-foreground/10 text-primary-foreground hover:bg-primary-foreground/20"
                  onClick={() => {
                    const element = document.getElementById("product-tour");
                    if (element) {
                      element.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                >
                  <Play className="mr-2 h-5 w-5" />
                  See It In Action
                </Button>
              </motion.div>
            </motion.div>

            {/* Live Jurisdiction Counter */}
            <motion.div
              variants={staggerItem}
              className="pt-2"
            >
              <LiveJurisdictionCounter />
            </motion.div>

            {/* Stats */}
            <motion.div
              variants={staggerItem}
              className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2"
            >
              {[
                { icon: Shield, label: "All 50 States", sublabel: "Nationwide Coverage" },
                { icon: Clock, label: "80% First-Pass Rate", sublabel: "vs. 45% Industry Avg" },
                { icon: CheckCircle2, label: "Real-Time Data", sublabel: "Shovels API Powered" },
              ].map((stat, index) => (
                <motion.div
                  key={stat.label}
                  className="flex flex-col items-center lg:items-start gap-1 text-primary-foreground/90"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + index * 0.1 }}
                >
                  <div className="flex items-center gap-2">
                    <stat.icon className="h-5 w-5 text-accent" />
                    <span className="font-semibold">{stat.label}</span>
                  </div>
                  <span className="text-sm text-primary-foreground/60">{stat.sublabel}</span>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>

          {/* Right Illustration */}
          <motion.div
            className="relative hidden lg:block"
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          >
            <motion.div
              className="relative rounded-2xl overflow-hidden shadow-2xl"
              whileHover={{ scale: 1.02 }}
              transition={{ duration: 0.3 }}
            >
              <img 
                src={heroWorkflowIllustration} 
                alt="Permit Acceleration Workflow - From drawing upload to AI analysis to approval" 
                className="w-full h-auto rounded-2xl"
              />
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-t from-primary/20 to-transparent pointer-events-none" />
            </motion.div>
            
            {/* Floating elements */}
            <motion.div
              className="absolute -top-4 -right-4 bg-accent text-accent-foreground px-4 py-2 rounded-full shadow-lg font-semibold text-sm"
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <CheckCircle2 className="inline h-4 w-4 mr-1" />
              AI Verified
            </motion.div>
            
            <motion.div
              className="absolute -bottom-4 -left-4 bg-primary-foreground text-primary px-4 py-2 rounded-full shadow-lg font-semibold text-sm"
              animate={{ y: [0, 10, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            >
              <Clock className="inline h-4 w-4 mr-1" />
              45% Faster
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Bottom Wave */}
      <div className="absolute bottom-0 left-0 right-0">
        <svg viewBox="0 0 1440 120" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
          <path d="M0 120L60 110C120 100 240 80 360 70C480 60 600 60 720 65C840 70 960 80 1080 85C1200 90 1320 90 1380 90L1440 90V120H1380C1320 120 1200 120 1080 120C960 120 840 120 720 120C600 120 480 120 360 120C240 120 120 120 60 120H0Z" fill="hsl(var(--background))"/>
        </svg>
      </div>
    </section>
  );
}
