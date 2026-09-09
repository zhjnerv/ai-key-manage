FROM node:22-alpine AS builder

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=builder --chown=node:node /app/out ./out
COPY --from=builder --chown=node:node /app/scripts/serve-static.mjs ./scripts/serve-static.mjs
USER node
EXPOSE 3000
CMD ["node", "scripts/serve-static.mjs"]