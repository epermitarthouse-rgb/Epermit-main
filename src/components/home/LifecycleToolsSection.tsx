import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderOpen, Calendar, MessageSquare, ClipboardCheck } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/components/animations/variants";

const lifecycleTools = [
  {
    icon: <FolderOpen className="h-6 w-6" />,
    title: "Document Management & Versioning",
    description: "Track drawing revisions, submittals, and approvals with full version history. Never lose track of document changes.",
  },
  {
    icon: <Calendar className="h-6 w-6" />,
    title: "Inspection Scheduling & Tracking",
    description: "Request inspections, track results, and manage re-inspections. Stay on top of every inspection milestone.",
  },
  {
    icon: <MessageSquare className="h-6 w-6" />,
    title: "RFI & Change Order Management",
    description: "Handle requests for information and scope changes with a complete audit trail. Keep projects moving forward.",
  },
  {
    icon: <ClipboardCheck className="h-6 w-6" />,
    title: "Punch List & Closeout",
    description: "Final inspection items, certificate of occupancy tracking, and smooth project handoff to owners.",
  },
];

export function LifecycleToolsSection() {
  return (
    <section className="py-20 bg-secondary/30">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          className="text-center max-w-3xl mx-auto mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Complete Construction Lifecycle Tools
          </h2>
          <p className="text-lg text-muted-foreground">
            Beyond permits—manage your entire project from design through closeout
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
        >
          {lifecycleTools.map((tool, index) => (
            <motion.div
              key={index}
              variants={staggerItem}
              whileHover={{ y: -8, transition: { duration: 0.3 } }}
            >
              <Card className="group transition-all duration-300 hover:shadow-xl h-full">
                <CardHeader>
                  <motion.div
                    className="p-3 rounded-lg bg-primary/10 text-primary w-fit mb-4 group-hover:bg-accent/10 group-hover:text-accent transition-colors"
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ type: "spring", stiffness: 400 }}
                  >
                    {tool.icon}
                  </motion.div>
                  <CardTitle className="text-lg">{tool.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">{tool.description}</CardDescription>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
