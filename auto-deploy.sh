#!/usr/bin/env bash
# Pull-based auto-deploy: checks whether origin has new commits on the current
# branch and runs ./deploy.sh when it does. Installed on a cron, this makes a
# push to the branch sufficient to deploy, with no ssh session needed.
#
# Install once (as root, from the repo):
#     ./auto-deploy.sh --install     # checks every 5 minutes
# Remove:
#     ./auto-deploy.sh --uninstall
# Logs:
#     tail -f /var/log/gangrey-autodeploy.log
set -euo pipefail
cd "$(dirname "$0")"

LOG=/var/log/gangrey-autodeploy.log
LOCK=/tmp/gangrey-autodeploy.lock

if [ "${1:-}" = "--install" ]; then
  line="*/5 * * * * $(pwd)/auto-deploy.sh >> $LOG 2>&1"
  ( crontab -l 2>/dev/null | grep -v "auto-deploy.sh" ; echo "$line" ) | crontab -
  echo "Installed. Checks every 5 minutes; log: $LOG"
  exit 0
fi
if [ "${1:-}" = "--uninstall" ]; then
  crontab -l 2>/dev/null | grep -v "auto-deploy.sh" | crontab -
  echo "Removed."
  exit 0
fi

# One at a time: a deploy takes minutes and the cron fires every five.
exec 9>"$LOCK"
if ! flock -n 9; then exit 0; fi

branch="$(git rev-parse --abbrev-ref HEAD)"
git fetch origin "$branch" --quiet
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse "origin/$branch")"
[ "$local_sha" = "$remote_sha" ] && exit 0

echo "==> $(date -u +%FT%TZ) new commits on $branch (${local_sha:0:7} -> ${remote_sha:0:7}), deploying"
git pull --ff-only
./deploy.sh
echo "==> $(date -u +%FT%TZ) deploy finished"
