import { motion } from "framer-motion";
import { Upload, Brain, CheckCircle, ArrowRight } from "lucide-react";

const steps = [
  {
    icon: Upload,
    title: "Upload Drawings",
    description: "Upload your architectural drawings, plans, and specifications in any format. Our system handles PDFs, CAD files, and images.",
    color: "from-blue-500 to-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    iconBg: "bg-blue-100 dark:bg-blue-900/50",
  },
  {
    icon: Brain,
    title: "AI Scans & Analyzes",
    description: "Our AI engine scans every detail, cross-references local codes, and identifies potential compliance issues before submission.",
    color: "from-primary to-primary/80",
    bgColor: "bg-primary/5",
    iconBg: "bg-primary/10",
  },
  {
    icon: CheckCircle,
    title: "Get Approved Faster",
    description: "Submit with confidence. Pre-validated drawings pass review faster, reducing rejections and accelerating your project timeline.",
    color: "from-emerald-500 to-emerald-600",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/50",
  },
];

export function WorkflowStepsSection() {
  return (
    <section className="py-20 lg:py-28 bg-background overflow-hidden">
      <div className="container mx-auto px-4 lg:px-8">
        {/* Header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            How It Works
          </span>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Three Steps to Faster Permits
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From upload to approval, our AI-powered platform streamlines every step of the permit process
          </p>
        </motion.div>

        {/* Steps Container */}
        <div className="relative max-w-5xl mx-auto">
          {/* Connecting Line - Desktop */}
          <div className="hidden lg:block absolute top-24 left-[16.67%] right-[16.67%] h-1">
            <motion.div
              className="h-full bg-gradient-to-r from-blue-500 via-primary to-emerald-500 rounded-full"
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 1, delay: 0.5 }}
              style={{ transformOrigin: "left" }}
            />
          </div>

          {/* Steps Grid */}
          <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
            {steps.map((step, index) => (
              <motion.div
                key={index}
                className="relative"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.2 }}
              >
                {/* Step Card */}
                <motion.div
                  className={`relative ${step.bgColor} rounded-2xl p-8 h-full border border-border/50`}
                  whileHover={{ y: -8, transition: { duration: 0.2 } }}
                >
                  {/* Step Number */}
                  <motion.div
                    className="absolute -top-4 -left-4 w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center text-primary-foreground font-bold text-lg shadow-lg"
                    initial={{ scale: 0 }}
                    whileInView={{ scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ type: "spring", delay: 0.3 + index * 0.2 }}
                  >
                    {index + 1}
                  </motion.div>

                  {/* Icon Container */}
                  <motion.div
                    className={`w-16 h-16 ${step.iconBg} rounded-xl flex items-center justify-center mb-6`}
                    whileHover={{ rotate: [0, -10, 10, 0], transition: { duration: 0.5 } }}
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      whileInView={{ scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ type: "spring", delay: 0.4 + index * 0.2 }}
                    >
                      <step.icon className={`w-8 h-8 bg-gradient-to-br ${step.color} bg-clip-text`} style={{ color: index === 0 ? '#3b82f6' : index === 1 ? 'hsl(var(--primary))' : '#10b981' }} />
                    </motion.div>
                  </motion.div>

                  {/* Content */}
                  <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>

                  {/* Arrow for mobile */}
                  {index < steps.length - 1 && (
                    <motion.div
                      className="lg:hidden flex justify-center mt-6"
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.5 + index * 0.2 }}
                    >
                      <motion.div
                        animate={{ y: [0, 5, 0] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      >
                        <ArrowRight className="w-6 h-6 text-muted-foreground rotate-90" />
                      </motion.div>
                    </motion.div>
                  )}
                </motion.div>

                {/* Animated Pulse on Icon */}
                <motion.div
                  className="absolute top-4 left-4 w-16 h-16 rounded-xl"
                  initial={{ opacity: 0 }}
                  whileInView={{ opacity: 1 }}
                  viewport={{ once: true }}
                >
                  <motion.div
                    className={`w-full h-full rounded-xl ${step.iconBg}`}
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.5, 0, 0.5],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      delay: index * 0.3,
                    }}
                  />
                </motion.div>
              </motion.div>
            ))}
          </div>

          {/* Animated Data Points - Desktop Only */}
          <div className="hidden lg:block">
            {[0, 1].map((i) => (
              <motion.div
                key={i}
                className="absolute top-[92px] w-3 h-3 rounded-full bg-accent shadow-lg shadow-accent/50"
                initial={{ left: "16.67%", opacity: 0 }}
                animate={{
                  left: ["16.67%", "50%", "83.33%"],
                  opacity: [0, 1, 1, 0],
                }}
                transition={{
                  duration: 3,
                  repeat: Infinity,
                  delay: i * 1.5,
                  ease: "easeInOut",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
