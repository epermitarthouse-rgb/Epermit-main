export function formatUsd(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function formatAddress(parts: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}): string | null {
  const line = [parts.address, parts.city, parts.state, parts.zip_code]
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter(Boolean)
    .join(", ");
  return line || null;
}

export function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
