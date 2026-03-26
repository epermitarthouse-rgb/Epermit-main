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
import { Loader2, User, Building2, Briefcase, Phone, ArrowLeft, Eye, EyeOff } from "lucide-react";

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
    <div className="flex min-h-screen w-full">
      {/* Left Panel: Form */}
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-1/2 lg:px-20 xl:px-24 bg-background">
        <motion.div
          className="mx-auto w-full max-w-sm lg:w-96"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          key={activeView}
        >
          <motion.div variants={itemVariants}>
            {/* Back Button */}
            <Link 
              to="/" 
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm">Back to home</span>
            </Link>

            {/* Logo */}
            <div className="mb-8">
              <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                  <span className="text-lg font-bold text-primary-foreground">I</span>
                </div>
                <span className="text-lg font-bold tracking-tight">
                  Insight<span className="text-accent">|</span>DesignCheck
                </span>
              </Link>
            </div>

            {/* Header */}
            <div className="mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                {activeView === "login" ? "Welcome back!" : "Create your account"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {activeView === "login"
                  ? "Sign in by entering the information below"
                  : "Get started with your free account today"}
              </p>
            </div>

            {activeView === "login" ? (
              /* Login Form */
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-6">
                  <motion.div variants={itemVariants}>
                    <FormField
                      control={loginForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email Address</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="you@example.com"
                              {...field}
                              disabled={isLoading}
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
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showLoginPassword ? "text" : "password"}
                                placeholder="••••••••"
                                {...field}
                                disabled={isLoading}
                                className="pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowLoginPassword(!showLoginPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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

                  <motion.div variants={itemVariants} className="flex items-center justify-between">
                    <FormField
                      control={loginForm.control}
                      name="rememberMe"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={isLoading}
                            />
                          </FormControl>
                          <div className="leading-none">
                            <FormLabel className="text-sm font-normal cursor-pointer">
                              Remember Me
                            </FormLabel>
                          </div>
                        </FormItem>
                      )}
                    />
                    <a
                      href="#"
                      className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                    >
                      Forgotten Password
                    </a>
                  </motion.div>

                  <motion.div variants={itemVariants}>
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Continue
                    </Button>
                  </motion.div>
                </form>
              </Form>
            ) : (
              /* Signup Form */
              <Form {...signupForm}>
                <form onSubmit={signupForm.handleSubmit(handleSignup)} className="space-y-4">
                  <motion.div variants={itemVariants}>
                    <FormField
                      control={signupForm.control}
                      name="fullName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name *</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                              <Input {...field} placeholder="John Smith" className="pl-10" disabled={isLoading} />
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
                          <FormLabel>Email Address *</FormLabel>
                          <FormControl>
                            <Input
                              type="email"
                              placeholder="you@example.com"
                              {...field}
                              disabled={isLoading}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>

                  <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={signupForm.control}
                      name="companyName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Building2 className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                              <Input {...field} placeholder="Acme Inc" className="pl-10" disabled={isLoading} />
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
                          <FormLabel>Job Title</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Briefcase className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                              <Input {...field} placeholder="Architect" className="pl-10" disabled={isLoading} />
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
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                              <Input {...field} type="tel" placeholder="(555) 123-4567" className="pl-10" disabled={isLoading} />
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
                          <FormLabel>Password *</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showSignupPassword ? "text" : "password"}
                                placeholder="••••••••"
                                {...field}
                                disabled={isLoading}
                                className="pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowSignupPassword(!showSignupPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
                          <FormLabel>Confirm Password *</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Input
                                type={showConfirmPassword ? "text" : "password"}
                                placeholder="••••••••"
                                {...field}
                                disabled={isLoading}
                                className="pr-10"
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Account
                    </Button>
                  </motion.div>
                </form>
              </Form>
            )}

            <motion.p variants={itemVariants} className="mt-8 text-center text-sm text-muted-foreground">
              {activeView === "login" ? (
                <>
                  Don't have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setActiveView("signup")}
                    className="font-semibold text-primary hover:text-primary/80 transition-colors"
                  >
                    Create one here
                  </button>
                  .
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => setActiveView("login")}
                    className="font-semibold text-primary hover:text-primary/80 transition-colors"
                  >
                    Sign in here
                  </button>
                  .
                </>
              )}
            </motion.p>

            <motion.p variants={itemVariants} className="mt-4 text-center text-xs text-muted-foreground">
              By signing up, you agree to our Terms of Service and Privacy Policy.
            </motion.p>
          </motion.div>
        </motion.div>
      </div>

      {/* Right Panel: Image */}
      <div className="relative hidden w-0 lg:block lg:w-1/2">
        <div className="absolute inset-0 bg-primary/20" />
        <img
          className="absolute inset-0 h-full w-full object-cover"
          src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?ixlib=rb-4.0.3&auto=format&fit=crop&w=2070&q=80"
          alt="Modern architecture building"
        />
        {/* Overlay content */}
        <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/40 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-12 text-primary-foreground">
          <div className="max-w-lg">
            <h3 className="text-2xl font-bold mb-4">Streamline Your Permit Process</h3>
            <p className="text-primary-foreground/80 mb-6">
              Join thousands of architects, engineers, and permit expeditors who've 
              accelerated their approval process with Insight|DesignCheck.
            </p>
            <div className="flex gap-8">
              <div>
                <div className="text-2xl font-bold">80%</div>
                <div className="text-sm text-primary-foreground/60">Higher approval rate</div>
              </div>
              <div>
                <div className="text-2xl font-bold">40%</div>
                <div className="text-sm text-primary-foreground/60">Faster turnaround</div>
              </div>
              <div>
                <div className="text-2xl font-bold">200+</div>
                <div className="text-sm text-primary-foreground/60">Jurisdictions</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
