# Build context is the repo root (npm workspaces share one lockfile there).
#   docker build -f apps/api/Dockerfile .

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma/

RUN npm ci -w apps/api --include-workspace-root=false

COPY apps/api ./apps/api/

WORKDIR /app/apps/api

RUN npx prisma generate && npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma/

RUN npm ci -w apps/api --include-workspace-root=false --omit=dev

WORKDIR /app/apps/api

RUN npx prisma generate

COPY --from=builder /app/apps/api/dist ./dist

EXPOSE 4000

CMD ["node", "dist/server.js"]
