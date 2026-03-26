import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { 
  Calculator, 
  Clock, 
  DollarSign, 
  TrendingUp, 
  ArrowRight,
  Building2,
  FileCheck,
  Zap
} from "lucide-react";
import { Link } from "react-router-dom";

export const HomeROICalculator = () => {
  const [permitsPerYear, setPermitsPerYear] = useState(25);
  const [avgProjectValue, setAvgProjectValue] = useState(500000);
  const [currentApprovalDays, setCurrentApprovalDays] = useState(90);

  // Calculate savings
  const calculateSavings = () => {
    // Time savings: 68% average improvement based on case studies
    const timeSavingsPercent = 0.68;
    const daysSaved = Math.round(currentApprovalDays * timeSavingsPercent);
    const newApprovalDays = currentApprovalDays - daysSaved;

    // Cost of delay per day (0.1% of project value per day is industry standard)
    const delayCostPerDay = avgProjectValue * 0.001;
    const annualDelaySavings = daysSaved * delayCostPerDay * permitsPerYear;

    // Staff time savings (40 hours per permit at $85/hr, 45% time reduction)
    const hoursPerPermit = 40;
    const hourlyRate = 85;
    const timeReduction = 0.45;
    const laborSavings = permitsPerYear * hoursPerPermit * hourlyRate * timeReduction;

    // Rejection cost savings (industry avg 35% rejection, we achieve 6%)
    const industryRejectionRate = 0.35;
    const ourRejectionRate = 0.06;
    const costPerRejection = 2500;
    const rejectionsSaved = permitsPerYear * (industryRejectionRate - ourRejectionRate);
    const rejectionSavings = rejectionsSaved * costPerRejection;

    const totalAnnualSavings = annualDelaySavings + laborSavings + rejectionSavings;

    return {
      daysSaved,
      newApprovalDays,
      annualDelaySavings,
      laborSavings,
      rejectionSavings,
      totalAnnualSavings,
      hoursSaved: Math.round(permitsPerYear * hoursPerPermit * timeReduction),
    };
  };

  const results = calculateSavings();

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `$${Math.round(value / 1000)}K`;
    }
    return `$${Math.round(value)}`;
  };

  return (
    <section className="py-20 bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-12"
        >
          <Badge variant="outline" className="mb-4 border-primary/30 text-primary">
            <Calculator className="h-3.5 w-3.5 mr-1" />
            Interactive Calculator
          </Badge>
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Calculate Your Permit Savings
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            See how much time and money you could save with AI-powered permit intelligence.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Input Side */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Card className="h-full">
              <CardContent className="p-6 space-y-8">
                <div className="flex items-center gap-3 mb-2">
                  <Building2 className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Your Project Details</h3>
                </div>

                {/* Permits per year */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-base">Permits per year</Label>
                    <span className="text-2xl font-bold text-primary">{permitsPerYear}</span>
                  </div>
                  <Slider
                    value={[permitsPerYear]}
                    onValueChange={([value]) => setPermitsPerYear(value)}
                    min={5}
                    max={200}
                    step={5}
                    className="py-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>5</span>
                    <span>200+</span>
                  </div>
                </div>

                {/* Average project value */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-base">Average project value</Label>
                    <span className="text-2xl font-bold text-primary">
                      {formatCurrency(avgProjectValue)}
                    </span>
                  </div>
                  <Slider
                    value={[avgProjectValue]}
                    onValueChange={([value]) => setAvgProjectValue(value)}
                    min={100000}
                    max={10000000}
                    step={100000}
                    className="py-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>$100K</span>
                    <span>$10M+</span>
                  </div>
                </div>

                {/* Current approval time */}
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <Label className="text-base">Current avg. approval time</Label>
                    <span className="text-2xl font-bold text-primary">{currentApprovalDays} days</span>
                  </div>
                  <Slider
                    value={[currentApprovalDays]}
                    onValueChange={([value]) => setCurrentApprovalDays(value)}
                    min={14}
                    max={180}
                    step={7}
                    className="py-2"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>14 days</span>
                    <span>180 days</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Results Side */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="h-full bg-primary text-primary-foreground">
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <TrendingUp className="h-5 w-5 text-accent" />
                  <h3 className="text-lg font-semibold">Your Potential Savings</h3>
                </div>

                {/* Total Savings */}
                <div className="text-center mb-8 p-6 bg-primary-foreground/10 rounded-xl">
                  <p className="text-primary-foreground/70 text-sm mb-1">Estimated Annual Savings</p>
                  <p className="text-4xl md:text-5xl font-bold text-accent">
                    {formatCurrency(results.totalAnnualSavings)}
                  </p>
                  <p className="text-primary-foreground/70 text-sm mt-2">per year</p>
                </div>

                {/* Breakdown */}
                <div className="space-y-4 mb-8">
                  <div className="flex items-center justify-between p-3 bg-primary-foreground/5 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Clock className="h-4 w-4 text-accent" />
                      <span className="text-sm">Time to approval</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm line-through text-primary-foreground/50 mr-2">
                        {currentApprovalDays} days
                      </span>
                      <span className="font-bold text-accent">{results.newApprovalDays} days</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-primary-foreground/5 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Zap className="h-4 w-4 text-accent" />
                      <span className="text-sm">Staff hours saved</span>
                    </div>
                    <span className="font-bold">{results.hoursSaved.toLocaleString()} hrs/year</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-primary-foreground/5 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileCheck className="h-4 w-4 text-accent" />
                      <span className="text-sm">Rejection cost savings</span>
                    </div>
                    <span className="font-bold">{formatCurrency(results.rejectionSavings)}</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-primary-foreground/5 rounded-lg">
                    <div className="flex items-center gap-3">
                      <DollarSign className="h-4 w-4 text-accent" />
                      <span className="text-sm">Delay cost reduction</span>
                    </div>
                    <span className="font-bold">{formatCurrency(results.annualDelaySavings)}</span>
                  </div>
                </div>

                {/* CTA */}
                <div className="space-y-3">
                  <Button 
                    asChild 
                    size="lg" 
                    className="w-full bg-accent hover:bg-accent/90 text-accent-foreground"
                  >
                    <Link to="/roi-calculator">
                      Get Detailed Analysis
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <p className="text-xs text-center text-primary-foreground/60">
                    Full ROI report with personalized recommendations
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
