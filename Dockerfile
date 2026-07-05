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
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV STORAGE_BACKEND=sqlite
ENV DATA_DIR=/data
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
