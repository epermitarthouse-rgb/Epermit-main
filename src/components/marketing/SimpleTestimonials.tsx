import { motion } from "framer-motion";
import { Quote } from "lucide-react";

const testimonials = [
  {
    quote:
      "We cut our average permit cycle from 6 weeks to 3 weeks. The AI compliance check alone has saved us thousands in rework costs.",
    author: "Sarah Chen",
    title: "Principal Architect",
    company: "Chen & Associates",
  },
  {
    quote:
      "The jurisdiction database is a game-changer. No more calling offices to verify fees or submission requirements.",
    author: "Michael Torres",
    title: "Permit Expeditor",
    company: "FastTrack Permits",
  },
  {
    quote:
      "Finally, a tool that understands the complexity of commercial permitting. Our first-time approval rate jumped to 92%.",
    author: "Jennifer Williams",
    title: "Director of Operations",
    company: "BuildRight Construction",
  },
];

export function SimpleTestimonials() {
  return (
    <section className="py-20 lg:py-28 bg-muted/30">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-sm font-medium text-accent uppercase tracking-wider mb-4"
          >
            Customer Stories
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl lg:text-4xl font-bold text-foreground"
          >
            Trusted by Industry Leaders
          </motion.h2>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.author}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="bg-card rounded-xl border border-border p-6"
            >
              <Quote className="h-8 w-8 text-accent/30 mb-4" />
              <p className="text-muted-foreground mb-6 leading-relaxed">
                "{testimonial.quote}"
              </p>
              <div>
                <div className="font-semibold text-foreground">
                  {testimonial.author}
                </div>
                <div className="text-sm text-muted-foreground">
                  {testimonial.title}, {testimonial.company}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
