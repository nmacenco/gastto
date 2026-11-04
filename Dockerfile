# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS builder

# Install the exact pnpm version declared in package.json
RUN npm install -g pnpm@10.34.9

WORKDIR /app

# Copy dependency manifests first to leverage layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source code and build
COPY . .
RUN pnpm build

# ── Production dependencies stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS production-deps

# Install the exact pnpm version declared in package.json
RUN npm install -g pnpm@10.34.9

WORKDIR /app

# Copy dependency manifests and install only production dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# ── Runner stage ─────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS runner

# Package managers are build tools and are not needed to execute the application.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Runtime configuration
ENV NODE_ENV=production
ENV PORT=3000

USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
