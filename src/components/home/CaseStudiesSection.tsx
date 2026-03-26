import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Building2, 
  Clock, 
  TrendingDown, 
  CheckCircle2, 
  ArrowRight,
  MapPin,
  FileCheck
} from "lucide-react";

const caseStudies = [
  {
    id: 1,
    title: "Multi-Family Development",
    location: "Charlotte, NC",
    projectType: "New Construction",
    units: "48 units",
    beforeDays: 127,
    afterDays: 34,
    improvement: "73%",
    firstPassRate: "100%",
    rejections: { before: 4, after: 0 },
    highlight: "Zero corrections needed",
    description: "Pre-submittal detection caught 23 code issues before submission, including fire egress requirements specific to Mecklenburg County.",
    testimonial: "We went from dreading Charlotte submittals to having our fastest approval ever.",
    testimonialAuthor: "VP of Development, Regional Builder"
  },
  {
    id: 2,
    title: "Mixed-Use Retail + Residential",
    location: "Raleigh, NC",
    projectType: "Ground-Up Development",
    units: "12,000 SF retail + 24 units",
    beforeDays: 156,
    afterDays: 52,
    improvement: "67%",
    firstPassRate: "100%",
    rejections: { before: 6, after: 0 },
    highlight: "Expedited review qualification",
    description: "Jurisdiction lookup identified Raleigh's express review program eligibility, saving 8 weeks. Auto-fill reduced document prep from 3 days to 4 hours.",
    testimonial: "The platform knew about express review eligibility before our expeditor did.",
    testimonialAuthor: "Project Manager, Commercial Developer"
  },
  {
    id: 3,
    title: "Senior Living Facility",
    location: "Virginia Beach, VA",
    projectType: "Healthcare/Residential",
    units: "72 beds",
    beforeDays: 198,
    afterDays: 71,
    improvement: "64%",
    firstPassRate: "First pass",
    rejections: { before: 5, after: 0 },
    highlight: "ADA compliance verified",
    description: "Complex accessibility requirements across 3 Virginia jurisdictions handled seamlessly. Drawing viewer caught 17 ADA clearance issues pre-submission.",
    testimonial: "Healthcare projects used to be our nightmare. Now they're predictable.",
    testimonialAuthor: "Director of Construction, Senior Living Developer"
  },
  {
    id: 4,
    title: "Townhome Community",
    location: "Jacksonville, FL",
    projectType: "Subdivision Development",
    units: "36 townhomes",
    beforeDays: 89,
    afterDays: 28,
    improvement: "69%",
    firstPassRate: "100%",
    rejections: { before: 3, after: 0 },
    highlight: "Batch processing",
    description: "Submitted all 36 permits simultaneously using batch processing. Florida-specific wind load and flood zone requirements auto-populated.",
    testimonial: "36 permits in one week. Our previous record was 8.",
    testimonialAuthor: "Permit Coordinator, Production Builder"
  }
];

const aggregateStats = {
  avgImprovement: "68%",
  totalProjectsAnalyzed: "200+",
  avgDaysSaved: "84",
  firstPassRate: "94%"
};

export const CaseStudiesSection = () => {
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
            Proven Results
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Real Projects. Real Time Savings.
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Representative case studies from East Coast permit submissions showing measurable improvements in approval timelines.
          </p>
        </motion.div>

        {/* Aggregate Stats Bar */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12"
        >
          <div className="bg-primary/10 rounded-lg p-4 text-center">
            <div className="text-2xl md:text-3xl font-bold text-primary">{aggregateStats.avgImprovement}</div>
            <div className="text-sm text-muted-foreground">Avg. Time Reduction</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-4 text-center">
            <div className="text-2xl md:text-3xl font-bold text-primary">{aggregateStats.avgDaysSaved}</div>
            <div className="text-sm text-muted-foreground">Avg. Days Saved</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-4 text-center">
            <div className="text-2xl md:text-3xl font-bold text-primary">{aggregateStats.firstPassRate}</div>
            <div className="text-sm text-muted-foreground">First-Pass Rate</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-4 text-center">
            <div className="text-2xl md:text-3xl font-bold text-primary">{aggregateStats.totalProjectsAnalyzed}</div>
            <div className="text-sm text-muted-foreground">Projects Analyzed</div>
          </div>
        </motion.div>

        {/* Case Studies Grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {caseStudies.map((study, index) => (
            <motion.div
              key={study.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              <Card className="h-full hover:shadow-lg transition-shadow border-border/50">
                <CardContent className="p-6">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {study.location}
                      </div>
                      <h3 className="text-xl font-semibold">{study.title}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="secondary" className="text-xs">
                          {study.projectType}
                        </Badge>
                        <span className="text-sm text-muted-foreground">{study.units}</span>
                      </div>
                    </div>
                    <div className="bg-green-500/10 text-green-600 dark:text-green-400 px-3 py-1 rounded-full text-sm font-semibold">
                      -{study.improvement}
                    </div>
                  </div>

                  {/* Before/After Comparison */}
                  <div className="bg-muted/50 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="text-center flex-1">
                        <div className="text-sm text-muted-foreground mb-1">Before</div>
                        <div className="flex items-center justify-center gap-2">
                          <Clock className="h-4 w-4 text-destructive" />
                          <span className="text-2xl font-bold text-destructive">{study.beforeDays}</span>
                          <span className="text-sm text-muted-foreground">days</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {study.rejections.before} corrections
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-center px-4">
                        <ArrowRight className="h-5 w-5 text-primary" />
                        <TrendingDown className="h-4 w-4 text-green-500 mt-1" />
                      </div>
                      
                      <div className="text-center flex-1">
                        <div className="text-sm text-muted-foreground mb-1">After</div>
                        <div className="flex items-center justify-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <span className="text-2xl font-bold text-green-600 dark:text-green-400">{study.afterDays}</span>
                          <span className="text-sm text-muted-foreground">days</span>
                        </div>
                        <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                          {study.rejections.after} corrections
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Highlight Badge */}
                  <div className="flex items-center gap-2 mb-3">
                    <FileCheck className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-primary">{study.highlight}</span>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-muted-foreground mb-4">
                    {study.description}
                  </p>

                  {/* Testimonial */}
                  <div className="border-l-2 border-primary/30 pl-4">
                    <p className="text-sm italic text-foreground/80">
                      "{study.testimonial}"
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      — {study.testimonialAuthor}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Methodology Note */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-8 text-center"
        >
          <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
            * Case studies represent composite data from similar project types across our customer base. 
            "Before" metrics reflect industry averages for comparable projects. Individual results may vary 
            based on jurisdiction, project complexity, and submittal quality.
          </p>
        </motion.div>
      </div>
    </section>
  );
};
