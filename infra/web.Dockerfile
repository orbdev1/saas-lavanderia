FROM node:26.13.0-bookworm-slim AS build
RUN npm install -g pnpm@12.18.0
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm install --frozen-lockfile --filter @lav/web...
RUN pnpm --filter @lav/web build

FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
COPY infra/Caddyfile /etc/caddy/Caddyfile
