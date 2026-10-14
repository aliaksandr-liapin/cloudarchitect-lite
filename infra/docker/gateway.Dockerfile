# syntax=docker/dockerfile:1.7
# AI gateway (Node runtime). The esbuild bundle is self-contained, so the runtime image has no node_modules.

FROM node:26-alpine AS build
WORKDIR /repo
# Node 25+ no longer bundles corepack; keep in sync with "packageManager" in package.json.
ARG PNPM_VERSION=10.32.1
RUN npm install -g pnpm@${PNPM_VERSION}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/gateway/package.json apps/gateway/
COPY packages/domain/package.json packages/domain/
COPY packages/catalog/package.json packages/catalog/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cloudarchitect/gateway...
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/catalog packages/catalog
COPY apps/gateway apps/gateway
RUN pnpm --filter @cloudarchitect/gateway build

FROM node:26-alpine AS runtime
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
# Wizard settings (incl. the API key, mode 0600) live on a volume mounted here.
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /repo/apps/gateway/dist/node.js ./node.js
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "--enable-source-maps", "node.js"]
