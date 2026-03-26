"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";

// Validation schema for the form
const formSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email." }),
  password: z
    .string()
    .min(8, { message: "Password must be at least 8 characters." }),
  rememberMe: z.boolean().default(false).optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface AuthFormSplitScreenProps {
  logo: React.ReactNode;
  title: string;
  description: string;
  imageSrc: string;
  imageAlt: string;
  onSubmit: (data: FormValues) => Promise<void>;
  forgotPasswordHref: string;
  createAccountHref: string;
  isLoading?: boolean;
  onCreateAccountClick?: () => void;
}

/**
 * A responsive, split-screen authentication form component.
 */
export function AuthFormSplitScreen({
  logo,
  title,
  description,
  imageSrc,
  imageAlt,
  onSubmit,
  forgotPasswordHref,
  createAccountHref,
  isLoading: externalLoading,
  onCreateAccountClick,
}: AuthFormSplitScreenProps) {
  const [isLoading, setIsLoading] = React.useState(false);
  const loading = externalLoading ?? isLoading;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  const handleFormSubmit = async (data: FormValues) => {
    setIsLoading(true);
    try {
      await onSubmit(data);
    } catch (error) {
      console.error("Submission failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Animation variants for staggering children
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 },
  };

  return (
    <div className="flex min-h-screen w-full">
      {/* Left Panel: Form */}
      <div className="flex w-full flex-col justify-center px-4 py-12 sm:px-6 lg:w-1/2 lg:px-20 xl:px-24">
        <motion.div
          className="mx-auto w-full max-w-sm lg:w-96"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div variants={itemVariants}>
            <div className="mb-8">{logo}</div>
            <div className="mb-10">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                {title}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {description}
              </p>
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleFormSubmit)}
                className="space-y-6"
              >
                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="you@example.com"
                            {...field}
                            disabled={loading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>

                <motion.div variants={itemVariants}>
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="••••••••"
                            {...field}
                            disabled={loading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </motion.div>

                <motion.div
                  variants={itemVariants}
                  className="flex items-center justify-between"
                >
                  <FormField
                    control={form.control}
                    name="rememberMe"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            disabled={loading}
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
                    href={forgotPasswordHref}
                    className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    Forgotten Password
                  </a>
                </motion.div>

                <motion.div variants={itemVariants}>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading}
                  >
                    {loading && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Continue
                  </Button>
                </motion.div>
              </form>
            </Form>

            <motion.p
              variants={itemVariants}
              className="mt-8 text-center text-sm text-muted-foreground"
            >
              Don't have an account?{" "}
              {onCreateAccountClick ? (
                <button
                  type="button"
                  onClick={onCreateAccountClick}
                  className="font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  Create one here
                </button>
              ) : (
                <a
                  href={createAccountHref}
                  className="font-semibold text-primary hover:text-primary/80 transition-colors"
                >
                  Create one here
                </a>
              )}
              .
            </motion.p>
          </motion.div>
        </motion.div>
      </div>

      {/* Right Panel: Image */}
      <div className="relative hidden w-0 lg:block lg:w-1/2">
        <div className="absolute inset-0 bg-primary/10" />
        <img
          className="absolute inset-0 h-full w-full object-cover"
          src={imageSrc}
          alt={imageAlt}
        />
      </div>
    </div>
  );
}
