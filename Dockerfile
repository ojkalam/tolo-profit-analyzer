FROM node:22-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Dev deps are kept: the worker process runs through tsx.
RUN pnpm install --frozen-lockfile --prod=false && pnpm store prune

COPY . .

RUN pnpm prisma generate && pnpm run build

# Web process. The worker process runs `pnpm run worker` (see fly.toml).
CMD ["pnpm", "run", "docker-start"]
