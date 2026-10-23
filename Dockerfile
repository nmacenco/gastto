# ── Builder stage ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# Install the exact pnpm version declared in package.json
RUN npm install -g pnpm@10.33.4

WORKDIR /app

# Copy dependency manifests first to leverage layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source code and build
COPY . .
RUN pnpm build

# ── Runner stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Install the exact pnpm version declared in package.json
RUN npm install -g pnpm@10.33.4

WORKDIR /app

# Copy dependency manifests and install only production dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Runtime configuration
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/main.js"]
