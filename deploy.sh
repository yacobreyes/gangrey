#!/usr/bin/env bash
# Zero-downtime deploy for gangrey.org.
#
# The old container keeps serving traffic through the whole build; we only swap
# to the new image at the very end (a second or two of downtime instead of the
# ~8 minutes a Next.js build takes on this box). Run it from the repo root:
#
#     ./deploy.sh
#
set -euo pipefail

cd "$(dirname "$0")"

# --- Guard: this box needs swap or the build OOM-kills itself -----------------
# A Next.js 16 + sharp build peaks well above the 4 GB of RAM on this VPS. With
# no swap the kernel kills the build mid-compile, leaving the old container up
# and your changes undeployed (exactly the failure we hit once). Refuse to build
# until swap exists, and print how to add it.
if [ "$(swapon --show --noheadings 2>/dev/null | wc -l)" -eq 0 ]; then
  echo "ERROR: no swap is active — the build will likely run out of memory and be killed."
  echo
  echo "Add 4 GB of swap once (persists across reboots), then re-run ./deploy.sh:"
  echo
  echo "  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile \\"
  echo "    && sudo mkswap /swapfile && sudo swapon /swapfile \\"
  echo "    && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
  echo
  exit 1
fi

echo "==> Pulling latest code…"
git pull --ff-only

# Export .env.selfhost so NEXT_PUBLIC_* build args (e.g. NEXT_PUBLIC_GA_ID) are
# available to `docker compose build` — build args aren't read from env_file.
if [ -f .env.selfhost ]; then
  set -a; . ./.env.selfhost; set +a
fi

echo "==> Building new image (old container keeps serving)…"
docker compose build

echo "==> Swapping to the new image…"
docker compose up -d

echo "==> Waiting for the app to answer…"
for i in $(seq 1 30); do
  if curl -fsS -o /dev/null http://localhost:3000; then
    echo "==> Live. Deploy complete."
    exit 0
  fi
  sleep 2
done

echo "WARNING: app did not return 200 within 60s — check: docker compose logs --tail=40 imago"
exit 1
