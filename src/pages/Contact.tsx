import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mail, Phone, MapPin, Loader2, CheckCircle2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { motion } from "framer-motion";

const Contact = () => {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.message) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke('send-contact-email', {
        body: formData,
      });

      if (error) throw error;

      setIsSubmitted(true);
      toast.success("Message sent successfully! We'll be in touch soon.");
      setFormData({ firstName: "", lastName: "", email: "", message: "" });
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("Failed to send message. Please try again or email us directly.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto">
          <motion.div 
            className="text-center mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h1 className="text-4xl font-bold mb-4">Contact Us</h1>
            <p className="text-muted-foreground text-lg">
              Get in touch with our team — we typically respond within 24 hours
            </p>
          </motion.div>
          
          <div className="grid md:grid-cols-2 gap-8">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card>
                <CardHeader>
                  <CardTitle>Send a Message</CardTitle>
                </CardHeader>
                <CardContent>
                  {isSubmitted ? (
                    <motion.div 
                      className="text-center py-8"
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                    >
                      <div className="w-16 h-16 bg-accent/20 rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="h-8 w-8 text-accent" />
                      </div>
                      <h3 className="text-xl font-semibold mb-2">Message Sent!</h3>
                      <p className="text-muted-foreground mb-4">
                        Thank you for reaching out. We'll get back to you within 24 hours.
                      </p>
                      <Button 
                        variant="outline" 
                        onClick={() => setIsSubmitted(false)}
                      >
                        Send Another Message
                      </Button>
                    </motion.div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name</Label>
                          <Input 
                            id="firstName"
                            name="firstName"
                            placeholder="John" 
                            value={formData.firstName}
                            onChange={handleChange}
                            disabled={isSubmitting}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name</Label>
                          <Input 
                            id="lastName"
                            name="lastName"
                            placeholder="Doe" 
                            value={formData.lastName}
                            onChange={handleChange}
                            disabled={isSubmitting}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input 
                          id="email"
                          name="email"
                          type="email" 
                          placeholder="john@company.com" 
                          value={formData.email}
                          onChange={handleChange}
                          disabled={isSubmitting}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="message">Message</Label>
                        <Textarea 
                          id="message"
                          name="message"
                          placeholder="Tell us about your permit management needs..." 
                          rows={4} 
                          value={formData.message}
                          onChange={handleChange}
                          disabled={isSubmitting}
                        />
                      </div>
                      <Button 
                        type="submit" 
                        className="w-full bg-accent hover:bg-accent/90"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <Send className="mr-2 h-4 w-4" />
                            Send Message
                          </>
                        )}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </motion.div>
            
            <motion.div 
              className="space-y-6"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card>
                <CardContent className="pt-6">
                  <div className="space-y-6">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <Mail className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <p className="font-medium">Email</p>
                        <a 
                          href="mailto:hello@insightdesigncheck.com" 
                          className="text-muted-foreground hover:text-accent transition-colors"
                        >
                          hello@insightdesigncheck.com
                        </a>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <Phone className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <p className="font-medium">Phone</p>
                        <a 
                          href="tel:+15551234567" 
                          className="text-muted-foreground hover:text-accent transition-colors"
                        >
                          (555) 123-4567
                        </a>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                        <MapPin className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <p className="font-medium">Office</p>
                        <p className="text-muted-foreground">
                          123 Main St, Suite 100<br />
                          San Francisco, CA 94105
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-accent/5 border-accent/20">
                <CardContent className="pt-6">
                  <h3 className="font-semibold mb-2">Need immediate help?</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Schedule a free 15-minute consultation with our permit experts.
                  </p>
                  <Button variant="outline" className="w-full" asChild>
                    <a href="https://calendly.com" target="_blank" rel="noopener noreferrer">
                      Book a Call
                    </a>
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Contact;
