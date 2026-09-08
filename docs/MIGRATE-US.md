# Migrating the server to Hetzner US (Ashburn)

Why: the current VPS is in Nuremberg. US government data sources
(tampa.gov, arcgis.tampagov.net, civicdata.com) 403 non-US datacenter
IPs, and every reader request crosses the Atlantic. Same domain, same
Stripe/Google/Resend config — they bind to the domain, not the IP.

## Phase 0 — prep (no downtime)
1. Lower DNS TTL on gangrey.org + www to 300s; wait out the old TTL.
2. Hetzner console: create a server in Ashburn (us-east), >= 4GB RAM,
   Ubuntu, your SSH key.

## Phase 1 — build the new box (no downtime)
On the NEW server:
    apt update && apt install -y docker.io docker-compose-v2 caddy git rsync
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
On the OLD server:
    rsync -az ~/gangrey NEW_IP:~/ --exclude node_modules --exclude .next --exclude backups
    scp /etc/caddy/Caddyfile NEW_IP:/etc/caddy/Caddyfile

## Phase 2 — test before touching DNS
New server: cd ~/gangrey && ./deploy.sh
Laptop: add "NEW_IP www.gangrey.org gangrey.org" to /etc/hosts, check the
site, Imago, and Lead Desk "Fetch latest report" (this is the moment that
tells you whether the US IP passes the city WAF). Certificate warnings are
expected until DNS moves. Remove the hosts entry after.

## Phase 3 — cutover (minutes of downtime)
1. OLD: cd ~/gangrey && docker compose down        # freeze writes
2. OLD: rsync -az --delete ~/gangrey/data/ NEW_IP:~/gangrey/data/
   (never run this again once the new box has taken live traffic)
3. NEW: docker compose up -d
4. DNS: point gangrey.org + www A records at NEW_IP.
5. Caddy fetches certs automatically once DNS lands.

## Phase 4 — aftercare
- NEW: ./auto-deploy.sh --install and ./backup.sh --install
- Enable Hetzner Cloud Backups on the new server in the console.
- Watch a day, delete the old server (billed until deleted), restore TTLs.

Caveat: a US datacenter IP usually passes these WAFs but is not
guaranteed; the browser-collect fallback in Lead Desk remains either way.
