import { motion } from "framer-motion";
import { Quote, Star } from "lucide-react";
import { staggerContainer, staggerItem } from "@/components/animations/variants";

const testimonials = [
  {
    quote: "Insight|DesignCheck cut our permit review time in half. We used to spend days checking code compliance manually—now AI catches issues before we even submit.",
    name: "Sarah Chen",
    role: "Principal Architect",
    company: "Chen & Associates",
    persona: "Architect",
    rating: 5,
  },
  {
    quote: "The pre-submittal detection is a game-changer. We've gone from a 40% rejection rate to under 10%. Our clients are thrilled with the faster project timelines.",
    name: "Marcus Johnson",
    role: "General Contractor",
    company: "Johnson Construction Group",
    persona: "Contractor",
    rating: 5,
  },
  {
    quote: "As a permit expeditor handling 50+ projects monthly, this platform is essential. The jurisdiction lookup alone saves me hours of research every week.",
    name: "Elena Rodriguez",
    role: "Senior Permit Expeditor",
    company: "FastTrack Permits",
    persona: "Expeditor",
    rating: 5,
  },
  {
    quote: "The ROI was immediate. Within the first month, we avoided two costly rejections that would have delayed our hospital project by weeks.",
    name: "David Park",
    role: "Project Manager",
    company: "HealthBuild Partners",
    persona: "Project Manager",
    rating: 5,
  },
  {
    quote: "Finally, a tool that understands the complexity of multi-jurisdiction projects. The AI adapts to each municipality's specific requirements.",
    name: "Amanda Foster",
    role: "Design Director",
    company: "Urban Edge Architects",
    persona: "Architect",
    rating: 5,
  },
  {
    quote: "We integrated Insight|DesignCheck into our workflow last year. It's become as essential as our CAD software. Couldn't imagine going back.",
    name: "Robert Kim",
    role: "Owner",
    company: "Kim Builders LLC",
    persona: "Contractor",
    rating: 5,
  },
];

const personaColors: Record<string, string> = {
  Architect: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  Contractor: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  Expeditor: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  "Project Manager": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
};

export function TestimonialsSection() {
  return (
    <section className="py-20 lg:py-28 bg-muted/30">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            Testimonials
          </span>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Trusted by Industry Leaders
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            See how architects, contractors, and expeditors are accelerating their permit approvals
          </p>
        </motion.div>

        <motion.div
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={index}
              variants={staggerItem}
              whileHover={{ y: -8, transition: { duration: 0.2 } }}
              className="group"
            >
              <div className="h-full bg-card rounded-xl p-6 shadow-sm border border-border/50 hover:shadow-lg hover:border-primary/20 transition-all duration-300">
                {/* Quote Icon */}
                <div className="flex items-start justify-between mb-4">
                  <Quote className="h-8 w-8 text-primary/20 group-hover:text-primary/40 transition-colors" />
                  <div className="flex gap-0.5">
                    {[...Array(testimonial.rating)].map((_, i) => (
                      <Star
                        key={i}
                        className="h-4 w-4 fill-amber-400 text-amber-400"
                      />
                    ))}
                  </div>
                </div>

                {/* Quote Text */}
                <p className="text-foreground/80 mb-6 leading-relaxed">
                  "{testimonial.quote}"
                </p>

                {/* Author Info */}
                <div className="flex items-center gap-4 pt-4 border-t border-border/50">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground font-bold text-lg">
                    {testimonial.name.split(" ").map(n => n[0]).join("")}
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">
                      {testimonial.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {testimonial.role}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {testimonial.company}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      personaColors[testimonial.persona]
                    }`}
                  >
                    {testimonial.persona}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
