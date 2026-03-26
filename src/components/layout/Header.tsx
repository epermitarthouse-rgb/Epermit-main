import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Menu, X, User, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
const navigation = [
  { name: "Home", href: "/" },
  { name: "AI Compliance", href: "/code-compliance" },
  { name: "Code Library", href: "/code-reference" },
  { name: "Demos", href: "/demos" },
  { name: "Pricing", href: "/pricing" },
  { name: "Contact", href: "/contact" },
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <motion.header
      className={cn(
        "sticky top-0 z-50 w-full border-b transition-all duration-300",
        scrolled
          ? "bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm"
          : "bg-background/80 backdrop-blur"
      )}
      initial={{ y: -100 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <nav className="container mx-auto flex h-14 sm:h-16 items-center justify-between px-3 sm:px-4 lg:px-8 max-w-full">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Link to="/" className="flex items-center space-x-2 group">
            <div className="flex items-center">
              <span className="text-base sm:text-xl font-bold text-primary">Insight</span>
              <span className="text-base sm:text-xl font-light text-muted-foreground">|</span>
              <motion.span
                className="text-base sm:text-xl font-bold text-accent"
                whileHover={{ scale: 1.05 }}
              >
                DesignCheck
              </motion.span>
              <span className="text-xs font-medium text-accent ml-0.5">™</span>
            </div>
          </Link>
        </motion.div>

        {/* Desktop Navigation */}
        <motion.div
          className="hidden lg:flex lg:items-center lg:gap-x-8"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          {navigation.map((item, index) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 + index * 0.05 }}
            >
              <Link
                to={item.href}
                className={cn(
                  "relative text-sm font-medium transition-colors hover:text-accent py-2",
                  location.pathname === item.href
                    ? "text-accent"
                    : "text-muted-foreground"
                )}
              >
                {item.name}
                {location.pathname === item.href && (
                  <motion.div
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
                    layoutId="navbar-indicator"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  />
                )}
              </Link>
            </motion.div>
          ))}
        </motion.div>

        {/* CTA Button */}
        <motion.div
          className="hidden lg:flex lg:items-center lg:gap-x-4"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <ThemeToggle />
          {user ? (
            <div className="flex items-center gap-2">
              <NotificationBell />
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button asChild variant="outline">
                  <Link to="/dashboard">
                    <User className="mr-2 h-4 w-4" />
                    Dashboard
                  </Link>
                </Button>
              </motion.div>
            </div>
          ) : (
            <>
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button asChild variant="ghost">
                  <Link to="/auth">
                    <LogIn className="mr-2 h-4 w-4" />
                    Sign In
                  </Link>
                </Button>
              </motion.div>
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Button asChild className="bg-accent hover:bg-accent/90 text-accent-foreground">
                  <Link to="/roi-calculator">Calculate Your Permit Savings</Link>
                </Button>
              </motion.div>
            </>
          )}
        </motion.div>

        {/* Mobile menu button */}
        <motion.button
          type="button"
          className="lg:hidden rounded-md p-2 text-foreground"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          whileTap={{ scale: 0.95 }}
        >
          <AnimatePresence mode="wait">
            {mobileMenuOpen ? (
              <motion.div
                key="close"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <X className="h-6 w-6" />
              </motion.div>
            ) : (
              <motion.div
                key="menu"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Menu className="h-6 w-6" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.button>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            className="lg:hidden border-t bg-background overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="space-y-1 px-4 py-4">
              {navigation.map((item, index) => (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Link
                    to={item.href}
                    className={cn(
                      "block rounded-md px-3 py-2 text-base font-medium transition-colors",
                      location.pathname === item.href
                        ? "bg-accent/10 text-accent"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                    )}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    {item.name}
                  </Link>
                </motion.div>
              ))}
              <motion.div
                className="pt-4 space-y-2"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm text-muted-foreground">Theme</span>
                  <ThemeToggle />
                </div>
                {user ? (
                  <Button asChild className="w-full" variant="outline">
                    <Link to="/dashboard" onClick={() => setMobileMenuOpen(false)}>
                      <User className="mr-2 h-4 w-4" />
                      Dashboard
                    </Link>
                  </Button>
                ) : (
                  <>
                    <Button asChild className="w-full" variant="outline">
                      <Link to="/auth" onClick={() => setMobileMenuOpen(false)}>
                        <LogIn className="mr-2 h-4 w-4" />
                        Sign In
                      </Link>
                    </Button>
                    <Button asChild className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
                      <Link to="/roi-calculator" onClick={() => setMobileMenuOpen(false)}>
                        Calculate Your Permit Savings
                      </Link>
                    </Button>
                  </>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
