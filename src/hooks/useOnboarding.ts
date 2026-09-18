import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { supabase } from "@/lib/supabase";
import { shouldShowOnboarding } from "./onboardingLogic";

const ONBOARDING_KEY = "insight_onboarding_completed";

interface OnboardingData {
  profileName?: string;
  companyName?: string;
  projectName?: string;
}

export function useOnboarding() {
  const { user, loading: authLoading } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      if (authLoading) return;

      if (!user) {
        setShowOnboarding(false);
        setLoading(false);
        return;
      }

      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("user_id", user.id)
          .single();

        if (error) {
          throw error;
        }

        setShowOnboarding(
          shouldShowOnboarding({
            isAuthenticated: true,
            onboardingCompleted: profile?.onboarding_completed,
          }),
        );
      } catch (error) {
        // If there's an error, don't show onboarding to avoid blocking the user
        console.error("Error checking onboarding status:", error);
        setShowOnboarding(false);
      } finally {
        setLoading(false);
      }
    };

    checkOnboardingStatus();
  }, [user, authLoading]);

  const sendWelcomeEmail = useCallback(async (data: OnboardingData) => {
    if (!user?.email) {
      console.log("No user email available, skipping welcome email");
      return;
    }

    try {
      console.log("Sending welcome email to:", user.email);

      const { data: response, error } = await supabase.functions.invoke("send-welcome-email", {
        body: {
          email: user.email,
          name: data.profileName || "there",
          companyName: data.companyName,
          firstProjectName: data.projectName,
        },
      });

      if (error) {
        console.error("Error sending welcome email:", error);
      } else {
        console.log("Welcome email sent successfully:", response);
      }
    } catch (error) {
      console.error("Failed to send welcome email:", error);
      // Don't throw - email failure shouldn't block onboarding completion
    }
  }, [user]);

  const enrollInDripCampaign = useCallback(async (data: OnboardingData) => {
    if (!user?.email || !user?.id) {
      console.log("No user available, skipping drip campaign enrollment");
      return;
    }

    try {
      console.log("Enrolling user in drip campaign:", user.email);

      const { error } = await supabase
        .from("user_drip_campaigns")
        .insert({
          user_id: user.id,
          email: user.email,
          user_name: data.profileName || null,
          campaign_type: "onboarding",
        });

      if (error) {
        // Ignore unique constraint errors (user already enrolled)
        if (!error.message.includes("unique_user_campaign")) {
          console.error("Error enrolling in drip campaign:", error);
        }
      } else {
        console.log("User enrolled in drip campaign successfully");
      }
    } catch (error) {
      console.error("Failed to enroll in drip campaign:", error);
      // Don't throw - enrollment failure shouldn't block onboarding completion
    }
  }, [user]);

  const completeOnboarding = useCallback(async (data?: OnboardingData) => {
    if (!user) {
      setShowOnboarding(false);
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ onboarding_completed: true })
        .eq("user_id", user.id);

      if (error) {
        console.error("Error persisting onboarding completion:", error);
      } else {
        localStorage.setItem(`${ONBOARDING_KEY}_${user.id}`, "true");
      }
    } catch (error) {
      console.error("Failed to persist onboarding completion:", error);
    }

    if (data) {
      sendWelcomeEmail(data);
      enrollInDripCampaign(data);
    }

    setShowOnboarding(false);
  }, [user, sendWelcomeEmail, enrollInDripCampaign]);

  const resetOnboarding = useCallback(async () => {
    if (!user) {
      setShowOnboarding(true);
      return;
    }

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ onboarding_completed: false })
        .eq("user_id", user.id);

      if (error) {
        console.error("Error resetting onboarding:", error);
      } else {
        localStorage.removeItem(`${ONBOARDING_KEY}_${user.id}`);
      }
    } catch (error) {
      console.error("Failed to reset onboarding:", error);
    }

    setShowOnboarding(true);
  }, [user]);

  return {
    showOnboarding,
    loading,
    completeOnboarding,
    resetOnboarding,
  };
}
