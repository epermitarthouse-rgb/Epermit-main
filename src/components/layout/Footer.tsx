import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/components/animations/variants";
const footerLinks = {
  product: [{
    name: "Features",
    href: "/#features"
  }, {
    name: "Demos",
    href: "/demos"
  }, {
    name: "Pricing",
    href: "/pricing"
  }, {
    name: "ROI Calculator",
    href: "/roi-calculator"
  }],
  company: [{
    name: "About",
    href: "/about"
  }, {
    name: "Contact",
    href: "/contact"
  }, {
    name: "Careers",
    href: "/careers"
  }, {
    name: "Blog",
    href: "/blog"
  }],
  legal: [{
    name: "Privacy Policy",
    href: "/privacy"
  }, {
    name: "Terms of Service",
    href: "/terms"
  }, {
    name: "Security",
    href: "/security"
  }]
};
interface FooterProps {
  className?: string;
}
export function Footer({
  className
}: FooterProps) {
  return <footer className={`border-t border-border bg-background text-foreground ${className || ''}`}>
      
    </footer>;
}