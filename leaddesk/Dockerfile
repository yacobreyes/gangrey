FROM node:22-slim
WORKDIR /app
# better-sqlite3 ships prebuilt binaries for this platform; build tools only
# needed if the prebuild is missing.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
ENV DATA_DIR=/data
EXPOSE 3100
CMD ["node", "server.mjs"]
