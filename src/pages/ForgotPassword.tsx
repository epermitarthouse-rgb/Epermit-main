import { useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { supabase } from "@/lib/supabase";
import { buildPasswordResetRedirectUrl } from "@/lib/authPasswordReset";
import { toast } from "sonner";

const forgotSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address"),
});

type ForgotFormData = z.infer<typeof forgotSchema>;

export default function ForgotPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm<ForgotFormData>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const handleSubmit = async (data: ForgotFormData) => {
    setIsLoading(true);
    try {
      const redirectTo = buildPasswordResetRedirectUrl();
      const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
        redirectTo,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      setSubmitted(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <Link
          to="/auth"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <div className="rounded-full bg-primary/10 p-2 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Reset your password</h1>
              <p className="text-sm text-muted-foreground">
                Enter the email for your PermitPilot account. We&apos;ll send a reset
                link if an account exists.
              </p>
            </div>
          </div>

          {submitted ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>
                If an account exists for that email, a password reset link has been
                sent. Check your inbox and spam folder.
              </p>
              <p>The link expires after a short time. Request a new one if it expires.</p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/auth">Return to sign in</Link>
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="name@company.com"
                          autoComplete="email"
                          disabled={isLoading}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Send reset link
                </Button>
              </form>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}
