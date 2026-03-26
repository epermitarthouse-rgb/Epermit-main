// Stripe subscription tier configuration
export const SUBSCRIPTION_TIERS = {
  free: {
    name: "Free",
    productId: null,
    priceId: null,
    price: 0,
    annualPrice: 0,
  },
  starter: {
    name: "Starter",
    productId: "prod_Tt117EaQ2zMjnE",
    priceId: "price_1SvEzFLlsKC8uwPJjj0l0OCP",
    price: 99,
    annualPrice: 79,
  },
  professional: {
    name: "Professional",
    productId: "prod_Tt11mscNlOcrcz",
    priceId: "price_1SvEzXLlsKC8uwPJdzalLINQ",
    price: 249,
    annualPrice: 199,
    popular: true,
  },
  business: {
    name: "Business",
    productId: "prod_Tt11XNeEHlHCaf",
    priceId: "price_1SvEzkLlsKC8uwPJ3xuvq6wN",
    price: 449,
    annualPrice: 359,
  },
  enterprise: {
    name: "Enterprise",
    productId: "prod_Tt12LVzcadJGLU",
    priceId: "price_1SvF00LlsKC8uwPJJpL6y5R0",
    price: 999,
    annualPrice: 799,
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

export function getTierByProductId(productId: string): SubscriptionTier | null {
  for (const [tier, config] of Object.entries(SUBSCRIPTION_TIERS)) {
    if (config.productId === productId) {
      return tier as SubscriptionTier;
    }
  }
  return null;
}

export function getTierConfig(tier: SubscriptionTier) {
  return SUBSCRIPTION_TIERS[tier];
}
