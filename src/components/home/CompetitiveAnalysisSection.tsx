import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  XCircle, 
  Database, 
  Bot, 
  Building2, 
  FileSearch,
  Zap,
  Users,
  Globe,
  Shield
} from "lucide-react";

const comparisonData = [
  {
    feature: "Jurisdiction Database",
    us: "200+ jurisdictions across all 50 states with verified SLAs, fees, reviewer contacts",
    competitor: "National coverage but shallow data—often just contact info",
    usAdvantage: true,
    icon: Database,
  },
  {
    feature: "Regional Expertise",
    us: "Deep knowledge from NYC DOB to LA DBS to Chicago DOB—know the quirks that cause rejections",
    competitor: "Generalist approach—one-size-fits-all templates",
    usAdvantage: true,
    icon: Building2,
  },
  {
    feature: "Real Permit Data",
    us: "Shovels API integration—real-time permit activity, approval rates, cycle times",
    competitor: "No third-party data integration—relies on self-reported info",
    usAdvantage: true,
    icon: Globe,
  },
  {
    feature: "AI Pre-Submittal Detection",
    us: "Functional demos you can try now—catches code issues before submission",
    competitor: "\"AI-powered\" claims but demos are mockups or vaporware",
    usAdvantage: true,
    icon: Bot,
  },
  {
    feature: "Drawing Analysis",
    us: "Interactive viewer with AI markup detection, code compliance overlay",
    competitor: "Basic document storage and viewer—no intelligent analysis",
    usAdvantage: true,
    icon: FileSearch,
  },
  {
    feature: "Pricing Transparency",
    us: "Usage-based pricing visible on site—calculate your cost upfront",
    competitor: "\"Book a demo\" wall—pricing hidden until sales call",
    usAdvantage: true,
    icon: Zap,
  },
];

const ourDifferentiators = [
  {
    title: "Data-First, Not Workflow-First",
    description: "We built the intelligence layer first. Others built task management and added \"AI\" as marketing.",
    icon: Database,
  },
  {
    title: "Functional AI, Not Slideware",
    description: "Every AI feature on our site has a working demo. Try jurisdiction lookup, pre-submittal detection, auto-fill—right now.",
    icon: Bot,
  },
  {
    title: "Regional Expertise > National Breadth",
    description: "We know that Chicago DOB requires separate MEP permits, Miami-Dade requires NOA for windows, and NYC DOB has different forms for NB vs. Alt1.",
    icon: Shield,
  },
  {
    title: "Self-Serve Discovery",
    description: "No sales call required. Explore the platform, run your ROI calculation, see pricing—then decide. We respect your time.",
    icon: Users,
  },
];

export const CompetitiveAnalysisSection = () => {
  return (
    <section className="py-20 bg-muted/30">
      <div className="container mx-auto px-4">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <Badge variant="outline" className="mb-4 border-primary/30 text-primary">
            Why We're Different
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built Different. Built Better.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            We're not another permit management tool. We're the permit intelligence layer that makes every submission smarter.
          </p>
        </motion.div>

        {/* Our Differentiators */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {ourDifferentiators.map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card className="h-full border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
                <CardContent className="p-6">
                  <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                    <item.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Feature Comparison Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <Card>
            <CardContent className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-4 font-semibold">Feature</th>
                      <th className="text-left p-4 font-semibold">
                        <span className="inline-flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-primary" />
                          Our Platform
                        </span>
                      </th>
                      <th className="text-left p-4 font-semibold text-muted-foreground">
                        <span className="inline-flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full bg-muted-foreground/50" />
                          Typical Competitors
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonData.map((row, index) => (
                      <motion.tr
                        key={row.feature}
                        className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        initial={{ opacity: 0, x: -20 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.3, delay: index * 0.05 }}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            <row.icon className="h-5 w-5 text-primary shrink-0" />
                            <span className="font-medium">{row.feature}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                            <span className="text-sm">{row.us}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-start gap-2">
                            <XCircle className="h-5 w-5 text-muted-foreground/50 shrink-0 mt-0.5" />
                            <span className="text-sm text-muted-foreground">{row.competitor}</span>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Bottom Note */}
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="text-center text-sm text-muted-foreground mt-8 max-w-2xl mx-auto"
        >
          We believe in transparency. Every claim we make has a working demo. 
          Every stat is backed by real data. No slideware, no vaporware—just permit intelligence that works.
        </motion.p>
      </div>
    </section>
  );
};
