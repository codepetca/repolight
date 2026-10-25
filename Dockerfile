# syntax=docker/dockerfile:1
FROM node:22.23.4-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json .node-version ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS source
ENV NEXT_TELEMETRY_DISABLED=1
COPY next.config.js tsconfig.json next-env.d.ts ./
COPY src ./src
COPY public ./public
COPY scripts/report-worker.ts scripts/build-worker.mjs ./scripts/

FROM source AS worker-build
RUN npm run build:worker

FROM source AS web-build
RUN npm run build

FROM node:22.23.4-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=worker-build --chown=node:node /app/dist/report-worker.cjs ./dist/report-worker.cjs
USER node
CMD ["node", "dist/report-worker.cjs", "--poll"]

FROM node:22.23.4-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=web-build --chown=node:node /app/.next/standalone ./
COPY --from=web-build --chown=node:node /app/.next/static ./.next/static
COPY --from=web-build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
