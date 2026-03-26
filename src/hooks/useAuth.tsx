import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

// 1. Define Types
export interface SubscriptionStatus {
  subscribed: boolean;
  tier: "starter" | "professional" | "business" | "enterprise" | null;
  subscriptionEnd: string | null;
  productId: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  subscription: SubscriptionStatus;
  subscriptionLoading: boolean;
  signUp: (email: string, password: string, metadata?: Record<string, string>) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  checkSubscription: () => Promise<void>;
}

// 2. Create Context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

const defaultSubscription: SubscriptionStatus = {
  subscribed: false,
  tier: null,
  subscriptionEnd: null,
  productId: null,
};

// 3. Define Provider
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<SubscriptionStatus>(defaultSubscription);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);

  const checkSubscription = useCallback(async () => {
    const currentUserId = session?.user?.id;

    if (!currentUserId) {
      setSubscription(defaultSubscription);
      return;
    }

    setSubscriptionLoading(true);
    try {
      // ✅ DIRECT DATABASE CHECK
      const { data, error } = await supabase
        .from("profiles")
        .select("subscription_tier, subscription_status, subscription_end")
        .eq("user_id", currentUserId)
        .single();

      if (error) {
        console.error("Error fetching subscription from DB:", error);
        setSubscription(defaultSubscription);
      } else {
        const isActive = data.subscription_status === "active" || data.subscription_status === "trialing";

        setSubscription({
          subscribed: isActive,
          tier: isActive ? (data.subscription_tier as any) : null, // using 'any' to prevent strict type errors
          subscriptionEnd: data.subscription_end,
          productId: null,
        });
      }
    } catch (err) {
      console.error("Unexpected error checking subscription:", err);
      setSubscription(defaultSubscription);
    } finally {
      setSubscriptionLoading(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => authSubscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      checkSubscription();
    } else {
      setSubscription(defaultSubscription);
    }
  }, [session?.user?.id, checkSubscription]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const interval = setInterval(() => checkSubscription(), 60000);
    return () => clearInterval(interval);
  }, [session?.user?.id, checkSubscription]);

  const signUp = async (email: string, password: string, metadata?: Record<string, string>) => {
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectUrl, data: metadata },
    });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSubscription(defaultSubscription);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        subscription,
        subscriptionLoading,
        signUp,
        signIn,
        signOut,
        checkSubscription,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// 4. Export the Hook
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    return {
      user: null,
      session: null,
      loading: true,
      subscription: defaultSubscription,
      subscriptionLoading: false,
      signUp: async () => ({ error: new Error("Not initialized") }),
      signIn: async () => ({ error: new Error("Not initialized") }),
      signOut: async () => {},
      checkSubscription: async () => {},
    };
  }
  return context;
}
