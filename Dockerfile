# Seller Service dùng root context vì cần tsconfig.base.json và packages/common.
# Dockerfile.dockerignore giới hạn context, không gửi source service khác hoặc secret.

# -----------------------------------------------------------------------------
# Giai đoạn build: cài dependency theo lockfile và compile Seller Service.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifest trước source để Docker cache dependency khi chỉ thay đổi mã nguồn.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/common ./packages/common
COPY services/seller-service/package.json \
  services/seller-service/tsconfig.json \
  services/seller-service/tsconfig.build.json \
  services/seller-service/nest-cli.json \
  ./services/seller-service/

# npm ci bảo đảm dependency đúng với lockfile của monorepo; devDependency chỉ dùng ở builder.
ENV NODE_ENV=development
RUN npm ci --workspace=services/seller-service --include=dev --bin-links=true --ignore-scripts \
  && test -x node_modules/.bin/nest

# Chỉ đưa source Seller vào image sau khi dependency đã được cache.
COPY services/seller-service/src ./services/seller-service/src

WORKDIR /app/services/seller-service
RUN npm run build

# npm quản lý dependency workspace tại root /app/node_modules.
WORKDIR /app

# Runtime không cần Nest CLI, Jest hoặc TypeScript.
RUN npm prune --omit=dev

# Import @common/* cần artifact JavaScript ở đúng vị trí Node.js resolve được.
RUN mkdir -p node_modules/@common \
  && cp -R services/seller-service/dist/packages/common/. node_modules/@common/

# -----------------------------------------------------------------------------
# Giai đoạn runtime: image non-root, chỉ giữ dependency production và dist.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS production

# Update Alpine packages so the runtime receives current security fixes.
RUN apk upgrade --no-cache

# npm/npx chỉ cần ở builder để cài dependency; runtime chỉ chạy bằng node.
# Loại chúng khỏi final image để không mang theo dependency/tooling không cần thiết của npm.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
  && addgroup -g 1001 -S nodejs \
  && adduser -S nestjs -u 1001

WORKDIR /app

# Copy dependency production từ builder, không cài lại và không kéo devDependency.
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
# dist gồm Seller Service và artifact packages/common được compile cùng rootDir.
COPY --from=builder --chown=nestjs:nodejs /app/services/seller-service/dist ./dist

ENV NODE_ENV=production \
  PORT=3007 \
  NODE_OPTIONS=--max-old-space-size=128

EXPOSE 3007

# Endpoint thật sau global prefix và URI versioning là /api/v1/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD wget --quiet --tries=1 --spider "http://localhost:${PORT}/api/v1/health" || exit 1

USER nestjs

# Chạy Node trực tiếp để nhận SIGTERM đúng khi Compose/Kubernetes rollout.
CMD ["node", "dist/services/seller-service/src/main.js"]
