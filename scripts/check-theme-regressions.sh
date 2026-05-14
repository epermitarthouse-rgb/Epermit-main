#!/usr/bin/env bash
# Surface-as-text / dark-mode contrast regression gate (run after theme changes).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GREP="${GREP:-grep}"

echo "=== dark:text-cream (review; gold variant buttons may be intentional) ==="
"$GREP" -Rsn "dark:text-cream" src --include='*.tsx' --include='*.ts' || true

echo ""
echo "=== text-cream typography (exclude border/bg-cream contexts manually) ==="
"$GREP" -Rsn 'text-cream' src --include='*.tsx' || true

echo ""
echo "=== text-ink-primary-light pairing (spot-check) ==="
"$GREP" -Rsn "text-ink-primary-light" src/pages src/components/layout --include='*.tsx' || true

echo ""
echo "Done."
