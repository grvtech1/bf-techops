FROM node:24-alpine AS rds-trust
RUN wget -qO /aws-rds-global-bundle.pem \
      https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    && test "$(grep -c 'BEGIN CERTIFICATE' /aws-rds-global-bundle.pem)" -ge 3

FROM node:24-alpine AS dependencies
WORKDIR /workspace
COPY package*.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/portal/package.json apps/portal/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/persistence/package.json packages/persistence/package.json
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build
COPY packages ./packages
COPY apps ./apps
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=rds-trust /aws-rds-global-bundle.pem /etc/ssl/certs/aws-rds-global-bundle.pem
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/package.json ./package.json
COPY --from=build --chown=node:node /workspace/packages/domain ./packages/domain
COPY --from=build --chown=node:node /workspace/packages/persistence/package.json ./packages/persistence/package.json
COPY --from=build --chown=node:node /workspace/packages/persistence/dist ./packages/persistence/dist
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /workspace/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /workspace/apps/api/dist ./apps/api/dist
EXPOSE 8080
CMD ["node", "apps/api/dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /workspace/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=node:node /workspace/apps/worker/dist ./apps/worker/dist
EXPOSE 9091
CMD ["node", "apps/worker/dist/main.js"]

FROM node:24-alpine AS portal
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /workspace
COPY --from=build --chown=node:node /workspace/apps/portal/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/portal/.next/static ./apps/portal/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/portal/server.js"]

FROM node:24-alpine AS migration
ENV NODE_ENV=production
WORKDIR /workspace
COPY --from=rds-trust /aws-rds-global-bundle.pem /etc/ssl/certs/aws-rds-global-bundle.pem
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs
COPY --chown=node:node scripts/provision-tenant.mjs ./scripts/provision-tenant.mjs
COPY --chown=node:node database/migrations ./database/migrations
USER node
CMD ["node", "scripts/migrate.mjs"]

FROM node:24-alpine AS local-seed
ENV NODE_ENV=development
WORKDIR /workspace
COPY --from=production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --chown=node:node scripts/seed-local.mjs ./scripts/seed-local.mjs
COPY --chown=node:node database/seeds ./database/seeds
USER node
CMD ["node", "scripts/seed-local.mjs"]
