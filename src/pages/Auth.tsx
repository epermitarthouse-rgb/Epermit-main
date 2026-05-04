import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Loader2,
  User,
  Building2,
  Briefcase,
  Phone,
  ArrowLeft,
  Eye,
  EyeOff,
  Lock,
} from "lucide-react";

const AUTH_INPUT_CLASSES =
  "bg-cream shadow-inner border-cream-sunken text-ink-primary-light placeholder:text-ink-tertiary-light focus-visible:border-gold/45 focus-visible:ring-2 focus-visible:ring-gold/35 focus-visible:ring-offset-2 focus-visible:ring-offset-cream dark:bg-cream dark:border-cream-sunken dark:text-ink-primary-light dark:placeholder:text-ink-tertiary-light dark:focus-visible:ring-offset-cream";

const AUTH_LABEL_CLASSES =
  "font-mono-data text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-primary-light";

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  rememberMe: z.boolean().default(false).optional(),
});

const signupSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  companyName: z.string().trim().max(100).optional(),
  jobTitle: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(20).optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginFormData = z.infer<typeof loginSchema>;
type SignupFormData = z.infer<typeof signupSchema>;

export default function Auth() {
  const [activeView, setActiveView] = useState<"login" | "signup">("login");
  const [isLoading, setIsLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { user, signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || "/dashboard";

  useEffect(() => {
    if (user) {
      navigate(from, { replace: true });
    }
  }, [user, navigate, from]);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: false },
  });

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      fullName: "",
      companyName: "",
      jobTitle: "",
      phone: "",
    },
  });

  const handleLogin = async (data: LoginFormData) => {
    setIsLoading(true);
    const { error } = await signIn(data.email, data.password);
    setIsLoading(false);

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        toast.error("Invalid email or password. Please try again.");
      } else if (error.message.includes("Email not confirmed")) {
        toast.error("Please confirm your email before logging in.");
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success("Welcome back!");
    navigate(from, { replace: true });
  };

  const handleSignup = async (data: SignupFormData) => {
    setIsLoading(true);
    const { error } = await signUp(data.email, data.password, {
      full_name: data.fullName,
      company_name: data.companyName || "",
      job_title: data.jobTitle || "",
      phone: data.phone || "",
    });
    setIsLoading(false);

    if (error) {
      if (error.message.includes("already registered")) {
        toast.error("This email is already registered. Please log in instead.");
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success("Account created successfully!");
    navigate(from, { replace: true });
  };

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

  return (
    <div className="flex min-h-screen w-full flex-col overflow-x-hidden lg:flex-row">
      {/* Editorial hero — navy / obsidian + grid */}
      <div className="relative flex w-full min-h-[34vh] shrink-0 flex-col justify-between bg-gradient-to-br from-navy-deep via-navy-deep to-obsidian-sunken px-6 pb-8 pt-7 text-ink-primary-dark lg:order-none lg:h-auto lg:min-h-screen lg:w-1/2 lg:px-11 lg:pb-14 lg:pt-11">
        <div
          className="pointer-events-none absolute inset-0 z-0 opacity-[0.42] bg-grid-navy-lines"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-40 bg-gradient-to-t from-black/35 to-transparent"
          aria-hidden
        />

        <header className="relative z-[1]">
          <p className="font-display text-2xl font-semibold tracking-tight text-ink-primary-dark lg:text-[1.7rem]">
            PermitPilot
          </p>
          <p className="mt-0.5 text-[11px] font-tight tracking-wide text-ink-secondary-dark">by Commun-ET</p>
        </header>

        <div className="relative z-[1] mt-8 flex max-w-xl flex-col justify-center lg:mt-0 lg:flex-1">
          <div className="font-display tracking-tight text-ink-primary-dark">
            <span className="block text-xl font-normal leading-snug text-ink-secondary-dark lg:text-2xl">
              Welcome to
            </span>
            <span className="mt-3 block text-[2.125rem] font-medium leading-none lg:mt-4 lg:text-[2.875rem]">
              PermitPilot by
            </span>
            <span className="mt-3 block text-[2.125rem] font-medium leading-none lg:mt-3 lg:text-[2.875rem]">
              Commun-ET.
            </span>
          </div>
          <p className="mt-6 max-w-md text-[0.938rem] font-tight leading-relaxed text-ink-secondary-dark lg:mt-8 lg:text-base">
            The Intelligence Layer for Permits and Utilities.
            <span className="mt-2 block max-w-sm text-[0.875rem] text-ink-secondary-dark lg:text-[0.938rem]">
              Currently exclusive to Commun-ET clients.
            </span>
          </p>
        </div>

        <p className="relative z-[1] mt-8 font-mono-data text-[9px] uppercase tracking-[0.2em] text-ink-tertiary-dark lg:mt-auto lg:pb-2">
          PERMITTING · UTILITY COORDINATION · RESULTS
        </p>
      </div>

      {/* Cream auth panel */}
      <div className="flex min-h-0 flex-1 flex-col bg-gradient-to-b from-cream via-cream to-cream-raised/95 lg:h-auto lg:min-h-screen lg:w-1/2">
        <div className="flex flex-1 flex-col justify-center px-5 py-10 sm:px-10 lg:px-14 xl:px-24">
          <motion.div
            className="mx-auto w-full max-w-[412px]"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            key={activeView}
          >
            <motion.div variants={itemVariants}>
              <Link
                to="/"
                className="mb-9 inline-flex items-center gap-2 text-sm font-tight text-ink-secondary-light transition-colors hover:text-ink-primary-light"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                Back to home
              </Link>
            </motion.div>

            <motion.div variants={itemVariants} className="mb-8 flex flex-col items-start gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-black/15 bg-gradient-to-br from-obsidian-raised to-obsidian shadow-sm">
                <Lock className="h-5 w-5 text-ink-primary-dark" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-primary-light">
                  {activeView === "login" ? "Sign in" : "Create your account"}
                </h1>
                <p className="mt-2 font-tight text-sm text-ink-secondary-light">
                  {activeView === "login"
                    ? "Access your PermitPilot workspace"
                    : "Get started with your free account today"}
                </p>
              </div>
            </motion.div>

            {activeView === "login" ? (
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-6">
                  <motion.div variants={itemVariants}>
                    <FormField
                      control={loginForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={AUTH_LABEL_CLASSES}>Email Address</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="name@company.com"
                              {...field}
                              disabled={isLoading}
                              className={AUTH_INPUT_CLASSES}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between gap-4">
                            <FormLabel className={AUTH_LABEL_CLASSES}>Password</FormLabel>
                            <a
                              href="#"
                              className="text-xs font-semibold uppercase tracking-[0.12em] text-gold underline-offset-4 transition-colors hover:text-gold-deep"
                            >
                              Forgot password?
                            </a>
                          </div>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showLoginPassword ? "text" : "password"}
                                placeholder="••••••••"
                                {...field}
                                disabled={isLoading}
                                className={cn(AUTH_INPUT_CLASSES, "pr-11")}
                              />
                              <button
                                type="button"
                                onClick={() => setShowLoginPassword(!showLoginPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary-light transition-colors hover:text-ink-primary-light"
                                tabIndex={-1}
                              >
                                {showLoginPassword ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={loginForm.control}
                      name="rememberMe"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={isLoading}
                            />
                          </FormControl>
                          <div className="leading-none">
                            <FormLabel className="cursor-pointer font-tight text-sm font-normal normal-case tracking-normal text-ink-secondary-light">
                              Remember Me
                            </FormLabel>
                          </div>
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <Button
                      type="submit"
                      variant="gold"
                      className="h-11 w-full rounded-xl font-tight text-xs font-semibold uppercase tracking-[0.18em]"
                      disabled={isLoading}
                    >
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      SIGN IN
                    </Button>
                  </motion.div>
                </form>
              </Form>
            ) : (
              <Form {...signupForm}>
                <form onSubmit={signupForm.handleSubmit(handleSignup)} className="space-y-4">
                  <motion.div variants={itemVariants}>
                    <FormField
                      control={signupForm.control}
                      name="fullName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={AUTH_LABEL_CLASSES}>Full Name *</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary-light" />
                              <Input
                                {...field}
                                placeholder="John Smith"
                                disabled={isLoading}
                                className={cn(AUTH_INPUT_CLASSES, "pl-10")}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={signupForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={AUTH_LABEL_CLASSES}>Email Address *</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="you@example.com"
                              {...field}
                              disabled={isLoading}
                              className={AUTH_INPUT_CLASSES}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField
                      control={signupForm.control}
                      name="companyName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={AUTH_LABEL_CLASSES}>Company</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary-light" />
                              <Input
                                {...field}
                                placeholder="Acme Inc"
                                disabled={isLoading}
                                className={cn(AUTH_INPUT_CLASSES, "pl-10")}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={signupForm.control}
                      name="jobTitle"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={AUTH_LABEL_CLASSES}>Job Title</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary-light" />
                              <Input
                                {...field}
                                placeholder="Architect"
                                disabled={isLoading}
                                className={cn(AUTH_INPUT_CLASSES, "pl-10")}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={signupForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={AUTH_LABEL_CLASSES}>Phone</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary-light" />
                              <Input
                                {...field}
                                type="tel"
                                placeholder="(555) 123-4567"
                                disabled={isLoading}
                                className={cn(AUTH_INPUT_CLASSES, "pl-10")}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={signupForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={AUTH_LABEL_CLASSES}>Password *</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showSignupPassword ? "text" : "password"}
                                placeholder="••••••••"
                                {...field}
                                disabled={isLoading}
                                className={cn(AUTH_INPUT_CLASSES, "pr-11")}
                              />
                              <button
                                type="button"
                                onClick={() => setShowSignupPassword(!showSignupPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary-light transition-colors hover:text-ink-primary-light"
                                tabIndex={-1}
                              >
                                {showSignupPassword ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <FormField
                      control={signupForm.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className={AUTH_LABEL_CLASSES}>Confirm Password *</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="••••••••"
                                {...field}
                                disabled={isLoading}
                                className={cn(AUTH_INPUT_CLASSES, "pr-11")}
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-tertiary-light transition-colors hover:text-ink-primary-light"
                                tabIndex={-1}
                              >
                                {showConfirmPassword ? (
                                  <EyeOff className="h-4 w-4" />
                                ) : (
                                  <Eye className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <Button
                      type="submit"
                      variant="gold"
                      className="h-11 w-full rounded-xl font-tight text-xs font-semibold uppercase tracking-[0.18em]"
                      disabled={isLoading}
                    >
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      CREATE ACCOUNT
                    </Button>
                  </motion.div>
                </form>
              </Form>
            )}

            <motion.p variants={itemVariants} className="mt-9 text-center text-sm text-ink-secondary-light">
              {activeView === "login" ? (
                <>
                  Need access?{" "}
                  <button
                    type="button"
                    onClick={() => setActiveView("signup")}
                    className="font-semibold text-gold transition-colors hover:text-gold-deep"
                  >
                    Create an account
                  </button>{" "}
                  <span className="text-ink-tertiary-light" aria-hidden>
                    ·
                  </span>{" "}
                  <a
                    href="mailto:hello@commun-et.com"
                    className="font-semibold text-gold transition-colors hover:text-gold-deep"
                  >
                    Become a client
                  </a>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setActiveView("login")}
                    className="font-semibold text-gold transition-colors hover:text-gold-deep"
                  >
                    Sign in here
                  </button>
                  .
                </>
              )}
            </motion.p>

            <motion.p
              variants={itemVariants}
              className="mt-6 text-center text-xs leading-relaxed text-ink-secondary-light"
            >
              By signing up, you agree to our Terms of Service and Privacy Policy.
            </motion.p>
          </motion.div>
        </div>

        <footer className="shrink-0 px-6 pb-8 pt-2 text-center">
          <p className="text-[11px] leading-relaxed text-ink-tertiary-light">
            © 2026 Commun-ET, LLC. PermitPilot is a registered product of Commun-ET, LLC.
          </p>
        </footer>
      </div>
    </div>
  );
}
