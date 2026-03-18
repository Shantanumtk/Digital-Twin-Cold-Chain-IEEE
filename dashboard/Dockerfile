FROM node:20-alpine AS base

# Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

# Build
FROM base AS builder
WORKDIR /app

ARG NEXT_PUBLIC_API_URL
ARG MCP_AGENT_URL=http://localhost:8001
ARG AUTH_MONGO_URI=mongodb://localhost:27017
ARG NEXTAUTH_SECRET=coldchain-digital-twin-secret-2026
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV MCP_AGENT_URL=$MCP_AGENT_URL
ENV AUTH_MONGO_URI=$AUTH_MONGO_URI
ENV NEXTAUTH_SECRET=$NEXTAUTH_SECRET

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV API_URL=http://state-engine.coldchain.svc.cluster.local

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]