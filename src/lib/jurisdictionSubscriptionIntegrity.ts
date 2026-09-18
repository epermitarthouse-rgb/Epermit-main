const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidSubscriptionJurisdictionId(value: string | null | undefined): boolean {
  if (!value) return false;
  return UUID_REGEX.test(value.trim());
}

export function shouldSyncSubscriptionDenorm(
  previous: { name: string; state: string },
  next: { name?: string; state?: string },
): boolean {
  const nameChanged = next.name !== undefined && next.name !== previous.name;
  const stateChanged = next.state !== undefined && next.state !== previous.state;
  return nameChanged || stateChanged;
}

export function isForeignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  return code === '23503';
}

export function isMissingRpcError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: string }).message ?? '');
  const code = String((error as { code?: string }).code ?? '');
  return (
    code === 'PGRST202' ||
    message.includes('Could not find the function') ||
    message.includes('function public.get_jurisdiction_subscription_count')
  );
}

export function subscriptionBlockMessage(count: number): string {
  if (count === 1) {
    return 'This jurisdiction has 1 active subscriber. Deactivate it instead of deleting.';
  }
  return `This jurisdiction has ${count} active subscribers. Deactivate it instead of deleting.`;
}
