/** Pure onboarding gate — DB `onboarding_completed` is the source of truth. */
export function shouldShowOnboarding(params: {
  isAuthenticated: boolean;
  onboardingCompleted: boolean | null | undefined;
}): boolean {
  if (!params.isAuthenticated) {
    return false;
  }
  return params.onboardingCompleted !== true;
}
