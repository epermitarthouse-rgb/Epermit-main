import { motion } from "framer-motion";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "How does the AI detect permit issues before submission?",
    answer: "Our AI analyzes your drawings against local building codes, zoning requirements, and ADA compliance standards. It cross-references jurisdiction-specific rules and flags potential issues like missing fire ratings, incorrect egress paths, or non-compliant accessibility features—all before you submit to the building department.",
  },
  {
    question: "What file formats do you support?",
    answer: "We support all major CAD and drawing formats including PDF, DWG, DXF, RVT (Revit), and standard image formats like PNG and JPEG. Our system automatically extracts relevant information regardless of the source software used to create your drawings.",
  },
  {
    question: "How accurate is the pre-submittal detection?",
    answer: "Our AI has been trained on millions of permit submissions and building code requirements. Users report an 80% reduction in permit rejections after using our pre-submittal detection. However, we recommend using our reports as a supplement to—not a replacement for—professional review.",
  },
  {
    question: "Which jurisdictions do you cover?",
    answer: "We currently cover over 3,000 jurisdictions across the United States, including major metropolitan areas and their surrounding municipalities. Our database is continuously updated to reflect the latest code amendments and local requirements. Contact us if you need coverage for a specific jurisdiction.",
  },
  {
    question: "Can I integrate Insight|DesignCheck with my existing workflow?",
    answer: "Yes! We offer integrations with popular project management tools like Procore, PlanGrid, and Autodesk Construction Cloud. We also provide a REST API for custom integrations, and our team can help set up workflows tailored to your specific needs.",
  },
  {
    question: "How long does it take to analyze a set of drawings?",
    answer: "Most drawing sets are analyzed within 5-15 minutes, depending on the project size and complexity. Large commercial projects with hundreds of sheets may take up to 30 minutes. You'll receive email notifications when your analysis is complete.",
  },
  {
    question: "Is my data secure?",
    answer: "Absolutely. We use bank-level encryption (AES-256) for all data at rest and in transit. Your drawings are stored in SOC 2 Type II compliant data centers, and we never share your project information with third parties. You can also request data deletion at any time.",
  },
  {
    question: "What's included in the free trial?",
    answer: "Our 14-day free trial includes full access to all Professional tier features: unlimited AI scans, pre-submittal detection, jurisdiction lookup, and basic integrations. No credit card required to start. At the end of your trial, you can choose the plan that best fits your needs.",
  },
];

export function FAQSection() {
  return (
    <section className="py-20 lg:py-28 bg-muted/30">
      <div className="container mx-auto px-4 lg:px-8">
        {/* Header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <HelpCircle className="h-4 w-4" />
            FAQ
          </span>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need to know about our AI-powered permit acceleration platform
          </p>
        </motion.div>

        {/* FAQ Accordion */}
        <motion.div
          className="max-w-3xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
              >
                <AccordionItem
                  value={`item-${index}`}
                  className="bg-card border border-border/50 rounded-xl px-6 shadow-sm hover:shadow-md hover:border-primary/20 transition-all duration-300 data-[state=open]:border-primary/30 data-[state=open]:shadow-lg"
                >
                  <AccordionTrigger className="text-left font-semibold hover:no-underline py-5 [&[data-state=open]>svg]:text-primary">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground pb-5 leading-relaxed">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              </motion.div>
            ))}
          </Accordion>
        </motion.div>

        {/* Contact CTA */}
        <motion.div
          className="text-center mt-12"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.4 }}
        >
          <p className="text-muted-foreground">
            Still have questions?{" "}
            <a
              href="/contact"
              className="text-primary font-medium hover:underline"
            >
              Contact our team
            </a>{" "}
            for personalized assistance.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
