import {
  Rocket,
  MapPin,
  FileCheck,
  BarChart3,
  Users,
  Bell,
  CheckCircle2
} from "lucide-react";
import { motion } from "framer-motion";

interface FeaturesStepProps {
  onComplete: () => void;
  onBack: () => void;
}

const FEATURES = [
  {
    icon: MapPin,
    title: "Jurisdiction Intelligence",
    description: "Access fee schedules, SLA data, and requirements for 2,500+ jurisdictions",
  },
  {
    icon: FileCheck,
    title: "Document Management",
    description: "Upload, version, and organize all your permit documents in one place",
  },
  {
    icon: BarChart3,
    title: "Analytics Dashboard",
    description: "Track cycle times, costs, and identify bottlenecks across projects",
  },
  {
    icon: Users,
    title: "Team Collaboration",
    description: "Invite team members and share projects with clients via secure links",
  },
  {
    icon: Bell,
    title: "Smart Notifications",
    description: "Get alerts for deadlines, jurisdiction updates, and inspection schedules",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export function FeaturesStep({ onComplete: _onComplete, onBack: _onBack }: FeaturesStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Rocket className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold">You're All Set!</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Here's what you can do with PermitPilot
        </p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid gap-3"
      >
        {FEATURES.map((feature) => (
          <motion.div
            key={feature.title}
            variants={itemVariants}
            className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <feature.icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h4 className="font-medium text-sm">{feature.title}</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                {feature.description}
              </p>
            </div>
            <CheckCircle2 className="w-5 h-5 text-primary/50 flex-shrink-0 ml-auto" />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
