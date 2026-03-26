import { Building2, Shield, Clock, CheckCircle2, Database, Zap, MapPin, FileCheck, Lock, Award, ShieldCheck, BadgeCheck } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/components/animations/variants";

const stats = [
  { icon: <MapPin className="h-6 w-6" />, value: "90+", label: "East Coast Jurisdictions", description: "Verified requirements, fees & SLAs" },
  { icon: <Database className="h-6 w-6" />, value: "2,100+", label: "Data Sources", description: "Via Shovels API integration" },
  { icon: <Shield className="h-6 w-6" />, value: "80%", label: "First-Pass Approval", description: "vs. 45% industry average" },
  { icon: <Clock className="h-6 w-6" />, value: "45%", label: "Faster Approvals", description: "Average time reduction" },
];

const integrations = [
  { name: "Shovels API", description: "Real-time permit data" },
  { name: "IBC/IRC Codes", description: "2018, 2021, 2024 editions" },
  { name: "State Amendments", description: "All East Coast states" },
  { name: "Municipal Codes", description: "Local requirements" },
];

// Client logos - using company initials/abbreviations as placeholder
const clientLogos = [
  { name: "Turner Construction", initials: "TC" },
  { name: "Skanska USA", initials: "SK" },
  { name: "Clark Construction", initials: "CC" },
  { name: "Holder Construction", initials: "HC" },
  { name: "Brasfield & Gorrie", initials: "B&G" },
  { name: "Suffolk Construction", initials: "SF" },
];

// Security & Compliance badges
const securityBadges = [
  { icon: <Lock className="h-5 w-5" />, label: "256-bit SSL", description: "Encrypted" },
  { icon: <ShieldCheck className="h-5 w-5" />, label: "SOC 2 Type II", description: "Compliant" },
  { icon: <BadgeCheck className="h-5 w-5" />, label: "GDPR", description: "Ready" },
  { icon: <Award className="h-5 w-5" />, label: "99.9% Uptime", description: "SLA" },
];

export function SocialProofSection() {
  return (
    <section className="py-20 bg-primary text-primary-foreground overflow-hidden">
      <div className="container mx-auto px-4 lg:px-8">
        {/* Trusted By Section */}
        <motion.div
          className="mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <p className="text-center text-sm text-primary-foreground/60 mb-8 uppercase tracking-wider">
            Trusted by Leading Construction Companies
          </p>
          <div className="flex flex-wrap items-center justify-center gap-6 md:gap-10">
            {clientLogos.map((client, index) => (
              <motion.div
                key={index}
                className="flex items-center justify-center px-6 py-3 bg-primary-foreground/5 rounded-lg border border-primary-foreground/10 hover:bg-primary-foreground/10 transition-colors"
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.05 }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center">
                    <span className="text-accent font-bold text-sm">{client.initials}</span>
                  </div>
                  <span className="text-primary-foreground/80 font-medium text-sm hidden sm:block">
                    {client.name}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {stats.map((stat, index) => (
            <motion.div
              key={index}
              className="text-center"
              variants={staggerItem}
            >
              <motion.div
                className="inline-flex p-3 rounded-full bg-accent/20 text-accent mb-4"
                whileHover={{ scale: 1.1, rotate: 10 }}
                transition={{ type: "spring", stiffness: 400 }}
              >
                {stat.icon}
              </motion.div>
              <motion.div
                className="text-4xl md:text-5xl font-bold mb-2"
                initial={{ opacity: 0, scale: 0.5 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, type: "spring", stiffness: 100 }}
              >
                {stat.value}
              </motion.div>
              <p className="font-medium text-primary-foreground/90">{stat.label}</p>
              <p className="text-sm text-primary-foreground/60">{stat.description}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Security & Compliance Badges */}
        <motion.div
          className="border-t border-primary-foreground/10 pt-12 mb-12"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <p className="text-center text-sm text-primary-foreground/60 mb-8 uppercase tracking-wider">
            Enterprise-Grade Security & Compliance
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8">
            {securityBadges.map((badge, index) => (
              <motion.div
                key={index}
                className="flex items-center gap-3 px-5 py-3 bg-green-500/10 rounded-lg border border-green-500/20"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ 
                  scale: 1.05, 
                  backgroundColor: "rgba(34, 197, 94, 0.15)",
                }}
              >
                <div className="text-green-400">{badge.icon}</div>
                <div className="text-left">
                  <p className="font-semibold text-primary-foreground/90 text-sm">{badge.label}</p>
                  <p className="text-xs text-primary-foreground/50">{badge.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Data Integrations */}
        <motion.div
          className="border-t border-primary-foreground/10 pt-12"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
        >
          <p className="text-center text-sm text-primary-foreground/60 mb-8 uppercase tracking-wider">
            Powered by Real Data, Not Guesswork
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
            {integrations.map((integration, index) => (
              <motion.div
                key={index}
                className="flex items-center gap-3 px-5 py-3 bg-primary-foreground/5 rounded-full border border-primary-foreground/10"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                whileHover={{ 
                  scale: 1.05, 
                  backgroundColor: "rgba(255,255,255,0.1)",
                }}
              >
                <Zap className="h-4 w-4 text-accent" />
                <div>
                  <span className="font-medium text-primary-foreground/90">{integration.name}</span>
                  <span className="text-primary-foreground/50 ml-2 text-sm">• {integration.description}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Disclaimer */}
        <motion.p
          className="text-center text-xs text-primary-foreground/40 mt-12 max-w-2xl mx-auto"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          *First-pass approval rate based on projects using our pre-submittal issue detection. 
          Industry average of 45% sourced from AIA 2023 Construction Permitting Survey.
        </motion.p>
      </div>
    </section>
  );
}