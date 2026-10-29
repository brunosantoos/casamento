# syntax=docker/dockerfile:1.7
#   server → API, worker e migração (mesma imagem, comandos diferentes)
#   web    → painel + portal (estático) e proxy para a API, em nginx sem root
FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat postgresql17-client \
  && corepack enable && corepack prepare pnpm@11.15.0 --activate
ENV PNPM_HOME=/pnpm CI=true
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .
RUN pnpm --filter @casa/db generate

FROM source AS web-build
RUN pnpm --filter @casa/web exec vite build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080

FROM source AS server
ENV NODE_ENV=production
RUN chown -R node:node /app/apps /app/packages
USER node
WORKDIR /app/apps/api
EXPOSE 4100
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
