#!/usr/bin/env bash
# Deploy the Railway permit-sync-worker from one committed, CI-green revision of main (D-105).
#
#   scripts/permit-repo/deploy-worker.sh <commit> --i-have-approval
#   scripts/permit-repo/deploy-worker.sh <commit> --dry-run          # every check, then stop before uploading
#
# The service has no repo source, so Railway's "Wait for CI" cannot gate it. This script does instead:
#   1. the commit is on origin/main (so what runs can always be found and rebuilt);
#   2. PermitPilot CI finished with success for exactly that commit;
#   3. the Railway CLI is linked to project PermitPilot, environment production;
#   4. a clean `git archive` of scraper-service at that commit is uploaded with the worker config as railway.toml
#      and BUILD_VERSION = the commit, which the worker reports in its heartbeat (Management Admin -> Sync workers).
# Rollback: run it again with the previous commit (each deploy is appended to exports.local/worker-deploys.log),
# or Railway -> permit-sync-worker -> Deployments -> previous deployment -> Redeploy.
# Never changes variables, replicas, schedules, migrations or Edge Functions. Prints no secrets.
set -euo pipefail

usage() { echo "usage: $0 <commit> (--i-have-approval | --dry-run)" >&2; exit 2; }
[ $# -eq 2 ] || usage
REV="$1"
MODE="$2"
case "$MODE" in --i-have-approval|--dry-run) ;; *) usage ;; esac

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
SERVICE="permit-sync-worker"
ENVIRONMENT="production"

git fetch --quiet origin main
SHA="$(git rev-parse --verify "${REV}^{commit}")"
SHORT="${SHA:0:12}"
if ! git merge-base --is-ancestor "$SHA" origin/main; then
  echo "refused: $SHORT is not on origin/main; push and merge it first" >&2
  exit 1
fi

CI="$(gh run list --workflow permitpilot-ci.yml --commit "$SHA" --json status,conclusion --jq '[.[] | select(.status == "completed")][0].conclusion // "none"')"
if [ "$CI" != "success" ]; then
  echo "refused: PermitPilot CI for $SHORT is '$CI', not 'success'" >&2
  exit 1
fi

STATUS="$(railway status 2>&1)"
if ! grep -q "Project:[[:space:]]*PermitPilot" <<<"$STATUS" || ! grep -q "Environment:[[:space:]]*$ENVIRONMENT" <<<"$STATUS"; then
  echo "refused: the Railway CLI is not linked to PermitPilot / $ENVIRONMENT" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git archive "$SHA" scraper-service | tar -x -C "$WORK"
APP="$WORK/scraper-service"
[ -f "$APP/railway.permit-sync-worker.toml" ] || { echo "refused: $SHORT has no railway.permit-sync-worker.toml" >&2; exit 1; }
cp "$APP/railway.permit-sync-worker.toml" "$APP/railway.toml"
printf '%s\n' "$SHA" > "$APP/BUILD_VERSION"
[ ! -e "$APP/.env" ] || { echo "refused: the archive contains .env" >&2; exit 1; }

echo "checks passed: $SHORT on origin/main, CI success, Railway PermitPilot/$ENVIRONMENT, service $SERVICE"
if [ "$MODE" = "--dry-run" ]; then
  echo "dry run: nothing uploaded"
  exit 0
fi

railway up "$APP" --path-as-root --service "$SERVICE" --environment "$ENVIRONMENT" --detach --message "permit-sync-worker $SHORT"
mkdir -p "$ROOT/exports.local"
printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SHA" "$SERVICE" >> "$ROOT/exports.local/worker-deploys.log"
echo "uploaded $SHORT. Next: railway deployment list --service $SERVICE (wait for SUCCESS), then confirm the worker heartbeat shows version $SHORT and scope 'all'."
