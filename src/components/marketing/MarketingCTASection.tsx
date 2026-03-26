import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

export function MarketingCTASection() {
  const navigate = useNavigate();

  return (
    <section className="py-20 lg:py-28 bg-primary text-primary-foreground">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center max-w-3xl mx-auto"
        >
          <h2 className="text-3xl lg:text-4xl font-bold mb-4">
            Ready to Accelerate Your Permits?
          </h2>
          <p className="text-lg text-primary-foreground/80 mb-8">
            Join thousands of architects, engineers, and permit expeditors who've
            streamlined their approval process with Insight|DesignCheck.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={() => navigate("/auth")}
              className="gap-2 px-8 rounded-full bg-primary-foreground text-primary hover:bg-primary-foreground/90 shadow-lg shadow-primary-foreground/20"
            >
              Start Free Trial
              <ArrowUpRight className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-6 text-sm text-primary-foreground/60">
            No credit card required • 14-day free trial • Cancel anytime
          </p>
        </motion.div>
      </div>
    </section>
  );
}
