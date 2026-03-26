import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Check, PenTool, FileCheck, Hammer } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const personas = [
  {
    id: "architects",
    label: "Design Professionals",
    icon: <PenTool className="h-5 w-5" />,
    title: "For Architects & Engineers",
    description: "Catch code issues during design—not during permit review",
    benefits: [
      "Identify code compliance issues in real-time as you design",
      "Reduce revision cycles by 60% with proactive checking",
      "Access jurisdiction requirements before you start drawing",
      "Generate code-compliant documentation automatically",
      "Maintain your professional reputation with first-time approvals",
    ],
    stat: "60% fewer revision cycles",
  },
  {
    id: "expeditors",
    label: "Permit Expeditors",
    icon: <FileCheck className="h-5 w-5" />,
    title: "For Permit Expeditors",
    description: "Handle more permits with less effort and fewer surprises",
    benefits: [
      "Process 3x more permits per month with automation",
      "Standardize workflows across all jurisdictions",
      "Track every permit from submission to approval",
      "Pre-screen drawings before they reach the city",
      "Build stronger relationships with consistent approvals",
    ],
    stat: "3x permit throughput",
  },
  {
    id: "contractors",
    label: "General Contractors",
    icon: <Hammer className="h-5 w-5" />,
    title: "For General Contractors",
    description: "Start construction sooner and keep projects on schedule",
    benefits: [
      "Reduce permit delays that cost $10K+ per week",
      "Coordinate inspections seamlessly across trades",
      "Manage documents and changes in one place",
      "Get visibility into permit status in real-time",
      "Close out projects faster with organized documentation",
    ],
    stat: "$10K+ saved per project",
  },
];

export function PersonaSection() {
  const [activeTab, setActiveTab] = useState("architects");

  return (
    <section className="py-20 bg-background">
      <div className="container mx-auto px-4 lg:px-8">
        <motion.div
          className="text-center max-w-3xl mx-auto mb-12"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Built for Your Role
          </h2>
          <p className="text-lg text-muted-foreground">
            Whether you design, expedite, or build—we accelerate your permits
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <Tabs value={activeTab} onValueChange={setActiveTab} className="max-w-4xl mx-auto">
            <TabsList className="grid w-full grid-cols-3 mb-8">
              {personas.map((persona) => (
                <TabsTrigger
                  key={persona.id}
                  value={persona.id}
                  className="flex items-center gap-2 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground transition-all"
                >
                  {persona.icon}
                  <span className="hidden sm:inline">{persona.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>

            <AnimatePresence mode="wait">
              {personas.map((persona) => (
                <TabsContent key={persona.id} value={persona.id}>
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.3 }}
                  >
                    <Card className="border-2 border-accent/20">
                      <CardContent className="p-8">
                        <div className="grid md:grid-cols-2 gap-8 items-center">
                          <div>
                            <motion.h3
                              className="text-2xl font-bold mb-2"
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.1 }}
                            >
                              {persona.title}
                            </motion.h3>
                            <motion.p
                              className="text-muted-foreground mb-6"
                              initial={{ opacity: 0, x: -20 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: 0.2 }}
                            >
                              {persona.description}
                            </motion.p>
                            
                            <ul className="space-y-3">
                              {persona.benefits.map((benefit, index) => (
                                <motion.li
                                  key={index}
                                  className="flex items-start gap-3"
                                  initial={{ opacity: 0, x: -20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: 0.2 + index * 0.1 }}
                                >
                                  <motion.div
                                    className="p-1 rounded-full bg-accent/10 mt-0.5"
                                    whileHover={{ scale: 1.2 }}
                                  >
                                    <Check className="h-4 w-4 text-accent" />
                                  </motion.div>
                                  <span className="text-sm">{benefit}</span>
                                </motion.li>
                              ))}
                            </ul>
                          </div>

                          <div className="flex items-center justify-center">
                            <motion.div
                              className="relative"
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 0.3, type: "spring" }}
                            >
                              <motion.div
                                className="absolute inset-0 bg-accent/20 blur-3xl rounded-full"
                                animate={{
                                  scale: [1, 1.1, 1],
                                  opacity: [0.5, 0.8, 0.5],
                                }}
                                transition={{
                                  duration: 3,
                                  repeat: Infinity,
                                  ease: "easeInOut",
                                }}
                              />
                              <div className="relative bg-card border-2 border-accent/30 rounded-2xl p-8 text-center">
                                <motion.div
                                  className="text-5xl font-bold text-accent mb-2"
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={{ delay: 0.4, type: "spring", stiffness: 200 }}
                                >
                                  {persona.stat.split(" ")[0]}
                                </motion.div>
                                <p className="text-muted-foreground">{persona.stat.split(" ").slice(1).join(" ")}</p>
                              </div>
                            </motion.div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                </TabsContent>
              ))}
            </AnimatePresence>
          </Tabs>
        </motion.div>
      </div>
    </section>
  );
}
