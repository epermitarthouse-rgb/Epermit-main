import { motion } from "framer-motion";
import { Shield, Award, Lock, Users } from "lucide-react";

const trustItems = [
  {
    icon: Shield,
    title: "SOC 2 Compliant",
    description: "Enterprise-grade security for your data",
  },
  {
    icon: Award,
    title: "99.9% Uptime",
    description: "Reliable platform you can count on",
  },
  {
    icon: Lock,
    title: "256-bit Encryption",
    description: "Bank-level data protection",
  },
  {
    icon: Users,
    title: "5,000+ Users",
    description: "Trusted by AEC professionals",
  },
];

export function TrustSection() {
  return (
    <section className="py-12 border-y border-border/50 bg-muted/20">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="flex flex-wrap justify-center items-center gap-8 lg:gap-16">
          {trustItems.map((item, index) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="flex items-center gap-3"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <item.icon className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-foreground">{item.title}</div>
                <div className="text-xs text-muted-foreground">
                  {item.description}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
