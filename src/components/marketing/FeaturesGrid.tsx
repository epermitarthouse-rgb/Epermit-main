import { motion } from "framer-motion";
import {
  FileSearch,
  Map,
  Clock,
  Shield,
  Zap,
  BarChart3,
  FileCheck,
  Users,
} from "lucide-react";

const features = [
  {
    icon: FileSearch,
    title: "AI Compliance Analysis",
    description:
      "Automatically detect code violations and get actionable recommendations before submission.",
  },
  {
    icon: Map,
    title: "Jurisdiction Intelligence",
    description:
      "Access real-time data on 200+ jurisdictions including fees, SLAs, and reviewer contacts.",
  },
  {
    icon: Clock,
    title: "Faster Approvals",
    description:
      "Reduce review cycles by 40% with pre-submittal checks and streamlined documentation.",
  },
  {
    icon: Shield,
    title: "Error Prevention",
    description:
      "Catch common mistakes that cause rejections before they reach the plan reviewer.",
  },
  {
    icon: Zap,
    title: "Smart Auto-Fill",
    description:
      "Automatically populate permit applications with project data and jurisdiction requirements.",
  },
  {
    icon: BarChart3,
    title: "Analytics Dashboard",
    description:
      "Track cycle times, costs, and approval rates across all your projects and jurisdictions.",
  },
  {
    icon: FileCheck,
    title: "Inspection Checklists",
    description:
      "Digital checklists with photo capture, signatures, and automatic punch list generation.",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description:
      "Real-time project updates, document annotations, and role-based access control.",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5 },
  },
};

export function FeaturesGrid() {
  return (
    <section id="features" className="py-20 lg:py-28 bg-background">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-sm font-medium text-primary uppercase tracking-wider mb-4"
          >
            Platform Features
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl lg:text-4xl font-bold text-foreground mb-4"
          >
            Everything You Need to Streamline Permits
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-lg text-muted-foreground"
          >
            From AI-powered compliance checks to comprehensive jurisdiction data,
            we've built the tools to make every permit submission successful.
          </motion.p>
        </div>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {features.map((feature, index) => (
            <motion.div
              key={feature.title}
              variants={itemVariants}
              className="group relative bg-card rounded-2xl border border-border p-6 hover:border-primary/50 hover:shadow-lg transition-all duration-300"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
                <feature.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
