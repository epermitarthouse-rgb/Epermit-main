#!/bin/sh
# Full-capture live test, step 1 (PRODUCTION WRITE, approval A-M): apply 20261112100000_permit_capture_retry.sql
# in one transaction and record exactly that version. Never `supabase db push` (D-040).
# Needs the Supabase CLI logged in to the account that owns eeqxyjrcldivtpikcpvk and the repo linked to it.
#   sh scripts/permit-repo/one-permit-live-test/11-apply-capture-retry.sh --i-have-approval
# Rollback (refuses while a deep job is active):
#   supabase db query --linked -f scripts/permit-repo/rollback-20261112100000_permit_capture_retry.sql
#   supabase migration repair --status reverted 20261112100000
set -eu
[ "${1:-}" = "--i-have-approval" ] || { echo "refusing: pass --i-have-approval (production migration)"; exit 2; }
cd "$(git rev-parse --show-toplevel)"
MIG=supabase/migrations/20261112100000_permit_capture_retry.sql
TX=$(mktemp -t 20261112100000.tx)
{ echo 'BEGIN;'; cat "$MIG"; echo 'COMMIT;'; } > "$TX"
supabase db query --linked -f scripts/permit-repo/one-permit-live-test/10-precheck-capture-retry.sql
supabase db query --linked -f "$TX"
supabase migration repair --status applied 20261112100000
supabase db query --linked -f scripts/permit-repo/one-permit-live-test/10-precheck-capture-retry.sql
rm -f "$TX"
