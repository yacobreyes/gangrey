# Imago — self-contained editorial CMS.
# Build:  docker compose up --build
# Data:   one SQLite file + a media folder, both on the ./data volume.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json ./
COPY package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV STANDALONE=1
ENV STORAGE_BACKEND=sqlite
# Public env the client bundle expects; harmless placeholders for self-hosted.
ENV NEXT_PUBLIC_SANITY_PROJECT_ID=selfhosted
# Google Analytics 4 id — NEXT_PUBLIC_ vars must be baked at build. Passed as a
# build arg (empty by default → no analytics); deploy.sh sources it from
# .env.selfhost.
ARG NEXT_PUBLIC_GA_ID=""
ENV NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID
# Per-deploy id for version-skew protection (baked into the client bundle so it
# matches the server's navigation header). deploy.sh passes the git short SHA.
ARG NEXT_DEPLOYMENT_ID=""
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV STORAGE_BACKEND=sqlite
ENV DATA_DIR=/data
# Same deploy id at runtime so the server's navigation header matches the value
# baked into the client bundle above.
ARG NEXT_DEPLOYMENT_ID=""
ENV NEXT_DEPLOYMENT_ID=$NEXT_DEPLOYMENT_ID
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The archive rebuild dataset — read at runtime by /api/admin/rebuild-archive
# (a plain file, not a JS import, so it doesn't bloat the server bundle).
COPY --from=build /app/scripts/archive-rebuild.json ./scripts/archive-rebuild.json

# Litestream: streams the SQLite write-ahead log to object storage so the
# recovery point is seconds rather than a nightly snapshot. Inert unless
# LITESTREAM_REPLICA_URL is set (see docker-entrypoint.sh).
ARG LITESTREAM_VERSION=0.3.13
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.tar.gz" \
      -o /tmp/litestream.tar.gz \
 && tar -C /usr/local/bin -xzf /tmp/litestream.tar.gz litestream \
 && rm /tmp/litestream.tar.gz \
 && apt-get purge -y curl && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*
COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
