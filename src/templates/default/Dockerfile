# Multi-stage build for the Nextellar default scaffold (#937).
#
# Relies on `output: "standalone"` in next.config.ts, which makes `next build`
# emit a self-contained `.next/standalone/` directory (app code + only the
# node_modules actually reachable at runtime, not the full install) — so the
# final image never needs a `node_modules` install step or the source tree.
#
# Build:
#   docker build -t my-nextellar-app .
# Run:
#   docker run -p 3000:3000 --env-file .env.local my-nextellar-app

# ── deps ──────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ── builder ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* values are baked into the client bundle at build time — pass
# your real values as build args, or accept the .env.example defaults below
# for a quick local build.
ARG NEXT_PUBLIC_HORIZON_URL
ARG NEXT_PUBLIC_SOROBAN_URL
ARG NEXT_PUBLIC_NETWORK
ARG NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_HORIZON_URL=${NEXT_PUBLIC_HORIZON_URL}
ENV NEXT_PUBLIC_SOROBAN_URL=${NEXT_PUBLIC_SOROBAN_URL}
ENV NEXT_PUBLIC_NETWORK=${NEXT_PUBLIC_NETWORK}
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
RUN npm run build

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
