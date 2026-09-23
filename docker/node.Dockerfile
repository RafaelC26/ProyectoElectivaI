# Imagen única para los servicios Node (publisher, processor, backend, archiver).
# Cada servicio de docker-compose.yml la ejecuta con un comando distinto.
FROM node:22-alpine

RUN apk add --no-cache tzdata
WORKDIR /app

# 1) Dependencias (capa cacheada mientras no cambien los package.json / package-lock.json)
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/publisher/package.json apps/publisher/
COPY apps/processor/package.json apps/processor/
COPY apps/backend/package.json apps/backend/
COPY apps/archiver/package.json apps/archiver/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --omit=dev --no-audit --no-fund \
      -w @uptc/shared -w @uptc/publisher -w @uptc/processor -w @uptc/backend -w @uptc/archiver \
 && npm cache clean --force

# 2) Código fuente (TypeScript ejecutado con tsx)
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/publisher ./apps/publisher
COPY apps/processor ./apps/processor
COPY apps/backend ./apps/backend
COPY apps/archiver ./apps/archiver
COPY config ./config
COPY db ./db

ENV NODE_ENV=production \
    CONFIG_DIR=/app/config \
    TZ=America/Bogota

USER node
CMD ["node", "--import", "tsx", "apps/backend/src/index.ts"]
