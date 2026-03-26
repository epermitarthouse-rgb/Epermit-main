import { motion } from "framer-motion";
import { MapPin, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LocationMap } from "@/components/ui/expand-map";
import { useNavigate } from "react-router-dom";

export function StaticMapPreview() {
  const navigate = useNavigate();

  return (
    <section className="py-20 lg:py-28">
      <div className="container mx-auto px-4 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <p className="text-sm font-medium text-primary uppercase tracking-wider mb-4">
              Jurisdiction Coverage
            </p>
            <h2 className="text-3xl lg:text-4xl font-bold text-foreground mb-4">
              200+ Jurisdictions at Your Fingertips
            </h2>
            <p className="text-lg text-muted-foreground mb-6">
              Access comprehensive permit data across the East Coast. From major
              metros to small municipalities, we've got you covered with real-time
              fee schedules, SLA estimates, and submission requirements.
            </p>
            <ul className="space-y-3 mb-8">
              {[
                "Real-time fee schedules and calculators",
                "Plan reviewer contact information",
                "Submission method preferences (online, in-person)",
                "Average review timelines by permit type",
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MapPin className="h-3 w-3" />
                  </div>
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
            <Button
              onClick={() => navigate("/auth")}
              className="gap-2 rounded-full"
            >
              Explore Full Map
              <ArrowRight className="h-4 w-4" />
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative"
          >
            <LocationMap 
              location="East Coast Coverage" 
              coordinates="14 States • 200+ Jurisdictions • Daily Updates"
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
