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
  CheckCircle2,
} from "lucide-react";

const AUTH_INPUT_CLASSES = "pilot-input";

const AUTH_LABEL_CLASSES = "pilot-kicker text-foreground";

const HERO_FEATURES = ["Portal Harvest", "DesignCheck", "Agent Control"];

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

  type AuthLocationState = {
    from?: { pathname: string };
    inviteEmail?: string;
    authView?: 'login' | 'signup';
  };

  const locationState = (location.state as AuthLocationState) || {};
  const from = locationState.from?.pathname || "/dashboard";

  useEffect(() => {
    if (locationState.authView === 'signup') {
      setActiveView('signup');
    }
  }, [locationState.authView]);

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

  useEffect(() => {
    if (locationState.inviteEmail && activeView === 'signup') {
      signupForm.setValue('email', locationState.inviteEmail);
    }
  }, [locationState.inviteEmail, activeView, signupForm]);

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
    <div className="signal-grid flex min-h-screen w-full flex-col overflow-x-hidden bg-background text-foreground lg:flex-row">
      {/* Hero panel — PermitPilot signal grid */}
      <section className="relative hidden w-1/2 shrink-0 flex-col justify-between overflow-hidden border-r border-border p-10 lg:flex">
        <div className="absolute inset-x-0 top-1/4 h-48 bg-primary/10 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Lock className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <div className="font-tight text-2xl font-black tracking-tight">PermitPilot</div>
            <div className="pilot-kicker">by Commun-ET</div>
          </div>
        </div>
        <div className="relative max-w-2xl">
          <div className="pilot-kicker text-primary">Permitting · Utility Coordination · Results</div>
          <h1 className="mt-5 font-display text-5xl font-semibold leading-none tracking-tight">
            The Intelligence Layer for Permits and Utilities.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
            Mission control, DesignCheck agents, queue management, document intelligence, and utility coordination in one product shell.
          </p>
        </div>
        <div className="relative grid grid-cols-3 gap-3">
          {HERO_FEATURES.map((item) => (
            <div key={item} className="pilot-card p-4">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div className="mt-3 font-tight text-sm font-semibold">{item}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Auth panel */}
      <section className="flex min-h-0 flex-1 flex-col justify-center px-5 py-10 sm:px-10 lg:px-14 xl:px-24">
          <motion.div
            className="mx-auto w-full max-w-[420px]"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            key={activeView}
          >
            <motion.div variants={itemVariants}>
              <Link
                to="/"
                className="mb-8 inline-flex items-center gap-2 text-sm font-tight text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                Back to home
              </Link>
            </motion.div>

            <motion.div variants={itemVariants} className="mb-6 flex flex-col items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Lock className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <div>
                <h1 className="font-tight text-2xl font-black tracking-tight text-foreground">
                  {activeView === "login" ? "Sign in" : "Create your account"}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {activeView === "login"
                    ? "Access your PermitPilot workspace"
                    : "Get started with your free account today"}
                </p>
              </div>
            </motion.div>

            <div className="pilot-card-raised p-6 md:p-8">
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
                              className="text-xs font-semibold uppercase tracking-[0.12em] text-primary underline-offset-4 transition-colors hover:text-primary/80"
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
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
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
                            <FormLabel className="cursor-pointer font-tight text-sm font-normal normal-case tracking-normal text-muted-foreground">
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
                      variant="default"
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
                              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                              <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                              <Briefcase className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
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
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
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
                      variant="default"
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
            </div>

            <motion.p variants={itemVariants} className="mt-6 text-center text-sm text-muted-foreground">
              {activeView === "login" ? (
                <>
                  Need access?{" "}
                  <button
                    type="button"
                    onClick={() => setActiveView("signup")}
                    className="font-semibold text-primary transition-colors hover:text-primary/80"
                  >
                    Create an account
                  </button>{" "}
                  <span className="text-muted-foreground" aria-hidden>
                    ·
                  </span>{" "}
                  <a
                    href="mailto:hello@commun-et.com"
                    className="font-semibold text-primary transition-colors hover:text-primary/80"
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
                    className="font-semibold text-primary transition-colors hover:text-primary/80"
                  >
                    Sign in here
                  </button>
                  .
                </>
              )}
            </motion.p>

            <motion.p
              variants={itemVariants}
              className="mt-6 text-center text-xs leading-relaxed text-muted-foreground"
            >
              By signing up, you agree to our Terms of Service and Privacy Policy.
            </motion.p>
          </motion.div>

        <footer className="mt-8 shrink-0 text-center">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            © 2026 Commun-ET, LLC. PermitPilot is a registered product of Commun-ET, LLC.
          </p>
        </footer>
      </section>
    </div>
  );
}
