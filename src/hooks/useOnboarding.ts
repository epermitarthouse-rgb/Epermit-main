import { useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";
import { supabase } from "@/lib/supabase";

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

      // Check localStorage first for quick response
      const localCompleted = localStorage.getItem(`${ONBOARDING_KEY}_${user.id}`);
      if (localCompleted === "true") {
        setShowOnboarding(false);
        setLoading(false);
        return;
      }

      // Check if user has a profile with a name (indicates they've gone through onboarding)
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", user.id)
          .single();

        // Also check if user has any projects
        const { data: projects } = await supabase
          .from("projects")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);

        // Show onboarding if no profile name and no projects
        const needsOnboarding = !profile?.full_name && (!projects || projects.length === 0);
        setShowOnboarding(needsOnboarding);
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
    if (user) {
      localStorage.setItem(`${ONBOARDING_KEY}_${user.id}`, "true");
      
      // Send welcome email and enroll in drip campaign in the background
      if (data) {
        sendWelcomeEmail(data);
        enrollInDripCampaign(data);
      }
    }
    setShowOnboarding(false);
  }, [user, sendWelcomeEmail, enrollInDripCampaign]);

  const resetOnboarding = useCallback(() => {
    if (user) {
      localStorage.removeItem(`${ONBOARDING_KEY}_${user.id}`);
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
