# ---- Build stage ----
FROM node:20-alpine AS build

# better-sqlite3 has no musl prebuild, so it compiles from source on Alpine.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Install deps first for layer caching. Copy the workspace manifests so `npm ci` resolves.
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

# Build the workspace (server + shared -> dist).
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# node resolves `@stock-survival/shared` via the root node_modules symlink -> packages/shared/package.json.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
# better-sqlite3 (native) is not hoisted to root node_modules; it lives in the server workspace.
COPY --from=build /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/config ./config
COPY --from=build /app/packages/web/public ./packages/web/public

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
