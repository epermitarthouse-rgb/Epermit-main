import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/components/animations/variants";
import { TrendingUp, Building2, DollarSign, Clock, Target, Layers } from "lucide-react";

const marketData = {
  tam: { value: "$47B", label: "Total Addressable Market", description: "U.S. Construction Permitting & Compliance Services" },
  sam: { value: "$12B", label: "Serviceable Addressable Market", description: "Commercial & Multi-Family Permit Management" },
  som: { value: "$1.2B", label: "Serviceable Obtainable Market", description: "Nationwide Mid-Market (Year 5 Target)" },
};

const moatFeatures = [
  {
    icon: <Layers className="h-6 w-6" />,
    title: "Jurisdiction Intelligence Database",
    description: "200+ jurisdictions across all 50 states with verified requirements, fees, SLAs, and reviewer contacts. Growing weekly.",
    metric: "200+ Jurisdictions",
  },
  {
    icon: <Target className="h-6 w-6" />,
    title: "Shovels API Integration",
    description: "Real-time permit data from 2,100+ jurisdictions. Track competitors, validate timelines, benchmark performance.",
    metric: "2,100+ Data Sources",
  },
  {
    icon: <Clock className="h-6 w-6" />,
    title: "Historical Rejection Analysis",
    description: "AI trained on 50,000+ permit submissions to predict and prevent common rejection causes.",
    metric: "80% First-Pass Rate",
  },
];

export function MarketDataSection() {
  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4 lg:px-8">
        {/* Market Opportunity */}
        <motion.div
          className="text-center max-w-3xl mx-auto mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
            <TrendingUp className="h-4 w-4" />
            <span className="text-sm font-medium">Market Opportunity</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            The $47B Permitting Problem
          </h2>
          <p className="text-lg text-muted-foreground">
            Construction permitting is the last major industry workflow still stuck in the fax-and-paper era. 
            We're building the data and AI layer that fixes it.
          </p>
        </motion.div>

        {/* TAM/SAM/SOM */}
        <motion.div
          className="grid md:grid-cols-3 gap-6 mb-20"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {Object.entries(marketData).map(([key, data], index) => (
            <motion.div
              key={key}
              variants={staggerItem}
              className="relative p-6 rounded-2xl bg-background border shadow-sm hover:shadow-lg transition-shadow"
            >
              <div className={`absolute top-0 left-6 h-1 w-16 rounded-full ${
                key === 'tam' ? 'bg-primary/30' : key === 'sam' ? 'bg-primary/60' : 'bg-accent'
              }`} />
              <div className="pt-4">
                <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {data.label}
                </p>
                <p className="text-4xl font-bold text-primary mb-2">{data.value}</p>
                <p className="text-sm text-muted-foreground">{data.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Competitive Moat */}
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h3 className="text-2xl md:text-3xl font-bold mb-4">
            Our Competitive Moat
          </h3>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Not just permit management—we're the <strong>data and AI layer</strong> that makes every submission 80% more likely to pass first review.
          </p>
        </motion.div>

        <motion.div
          className="grid md:grid-cols-3 gap-6"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {moatFeatures.map((feature, index) => (
            <motion.div
              key={index}
              variants={staggerItem}
              className="group p-6 rounded-2xl bg-background border hover:border-accent/50 transition-all hover:shadow-lg"
            >
              <div className="p-3 rounded-lg bg-accent/10 text-accent w-fit mb-4 group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
                {feature.icon}
              </div>
              <h4 className="text-lg font-semibold mb-2">{feature.title}</h4>
              <p className="text-muted-foreground text-sm mb-4">{feature.description}</p>
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-accent/10 text-accent text-sm font-medium">
                {feature.metric}
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
