import { useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, Phone, MapPin, Loader2, CheckCircle2, Send, CalendarClock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Panel, StatusPill } from "@/components/design/ProductPrimitives";

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
    setFormData((prev) => ({
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
      const { error } = await supabase.functions.invoke("send-contact-email", {
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
      <div className="container mx-auto max-w-5xl space-y-6 px-4 py-12 md:py-16">
        <header className="text-center">
          <div className="pilot-kicker text-primary">Support</div>
          <h1 className="mt-2 font-tight text-3xl font-black tracking-tight text-foreground md:text-4xl">
            Contact Us
          </h1>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">
            Get in touch with our team — we typically respond within 24 hours.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Panel eyebrow="Send a Message" title="How can we help?">
            {isSubmitted ? (
              <div className="py-8 text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-success/30 bg-success/10">
                  <CheckCircle2 className="h-7 w-7 text-success" />
                </div>
                <h3 className="font-tight text-xl font-bold text-foreground">Message Sent!</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Thank you for reaching out. We'll get back to you within 24 hours.
                </p>
                <Button variant="outline" className="mt-5" onClick={() => setIsSubmitted(false)}>
                  Send Another Message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="firstName" className="pilot-kicker text-foreground/80">
                      First Name
                    </Label>
                    <Input
                      id="firstName"
                      name="firstName"
                      className="pilot-input"
                      placeholder="John"
                      value={formData.firstName}
                      onChange={handleChange}
                      disabled={isSubmitting}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName" className="pilot-kicker text-foreground/80">
                      Last Name
                    </Label>
                    <Input
                      id="lastName"
                      name="lastName"
                      className="pilot-input"
                      placeholder="Doe"
                      value={formData.lastName}
                      onChange={handleChange}
                      disabled={isSubmitting}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="pilot-kicker text-foreground/80">
                    Email
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    className="pilot-input"
                    placeholder="john@company.com"
                    value={formData.email}
                    onChange={handleChange}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message" className="pilot-kicker text-foreground/80">
                    Message
                  </Label>
                  <Textarea
                    id="message"
                    name="message"
                    className="pilot-input min-h-[120px]"
                    placeholder="Tell us about your permit management needs..."
                    rows={4}
                    value={formData.message}
                    onChange={handleChange}
                    disabled={isSubmitting}
                  />
                </div>
                <Button type="submit" className="pilot-button-primary w-full" disabled={isSubmitting}>
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
          </Panel>

          <div className="space-y-4">
            <Panel eyebrow="Reach us" title="Direct channels">
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Email</p>
                    <a
                      href="mailto:hello@commun-et.com"
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      hello@commun-et.com
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Phone</p>
                    <a
                      href="tel:+15551234567"
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      (555) 123-4567
                    </a>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Office</p>
                    <p className="text-sm text-muted-foreground">
                      123 Main St, Suite 100
                      <br />
                      San Francisco, CA 94105
                    </p>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel eyebrow="Consultation" title="Need immediate help?">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Schedule a free 15-minute consultation with our permit experts.
                </p>
                <StatusPill tone="info">
                  <CalendarClock className="mr-1 h-3 w-3" />
                  15 min
                </StatusPill>
              </div>
              <Button variant="outline" className="pilot-button-ghost mt-4 w-full" asChild>
                <a href="https://calendly.com" target="_blank" rel="noopener noreferrer">
                  Book a Call
                </a>
              </Button>
            </Panel>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Contact;
