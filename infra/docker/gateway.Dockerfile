# syntax=docker/dockerfile:1.7
# AI gateway (Node runtime). The esbuild bundle is self-contained, so the runtime image has no node_modules.

FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /repo
# Node 25+ no longer bundles corepack; keep in sync with "packageManager" in package.json.
ARG PNPM_VERSION=10.32.1
RUN npm install -g pnpm@${PNPM_VERSION}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/gateway/package.json apps/gateway/
COPY packages/domain/package.json packages/domain/
COPY packages/catalog/package.json packages/catalog/
COPY packages/generator/package.json packages/generator/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cloudarchitect/gateway...
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/catalog packages/catalog
COPY packages/generator packages/generator
COPY apps/gateway apps/gateway
RUN pnpm --filter @cloudarchitect/gateway build

FROM node:26-alpine AS runtime
# NODE_USE_ENV_PROXY: fetch() honours HTTPS_PROXY / NO_PROXY from .env (icon download, Anthropic API).
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data NODE_USE_ENV_PROXY=1
WORKDIR /app
# Apply Alpine security fixes released after the base image was built (the Trivy gate fails on fixable CVEs).
RUN apk upgrade --no-cache
# Wizard settings (incl. the API key, mode 0600) live on a volume mounted here.
RUN mkdir -p /data && chown node:node /data
COPY --from=build --chown=node:node /repo/apps/gateway/dist/node.js ./node.js
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "--enable-source-maps", "node.js"]
