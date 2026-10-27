# syntax=docker/dockerfile:1.7
# Static web app: build with pnpm, serve with unprivileged nginx (non-root, port 8080).

FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /repo
# Node 25+ no longer bundles corepack; keep in sync with "packageManager" in package.json.
ARG PNPM_VERSION=10.32.1
RUN npm install -g pnpm@${PNPM_VERSION}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/catalog/package.json packages/catalog/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @cloudarchitect/web...
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY packages/catalog packages/catalog
COPY apps/web apps/web
RUN pnpm --filter @cloudarchitect/web build

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
