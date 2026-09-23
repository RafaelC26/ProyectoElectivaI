# Imagen "todo en uno" para Render (plan gratuito: un único servicio web).
# Compila el dashboard, empaqueta cada servicio Node en un solo archivo JavaScript (esbuild) y
# ejecuta publisher, processor, archiver y backend en el mismo contenedor
# (scripts/render-start.mjs). El backend sirve el dashboard y escucha en $PORT.
# Precompilar evita transpilar TypeScript al arrancar, que con 0,1 CPU tarda más de dos minutos.
# Para uso local sigue usándose docker-compose.yml, con un contenedor por servicio.

# 1) Compilación: dashboard (Vite) + servicios (esbuild)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/publisher/package.json apps/publisher/
COPY apps/processor/package.json apps/processor/
COPY apps/backend/package.json apps/backend/
COPY apps/archiver/package.json apps/archiver/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps ./apps
RUN npm run build -w @uptc/frontend \
 && for service in backend processor archiver publisher; do \
      npx esbuild "apps/$service/src/index.ts" --bundle --platform=node --format=esm --target=node22 \
        --external:ioredis --external:zod --external:pg --external:express --external:cors --external:socket.io \
        --outfile="build/$service.mjs" --log-level=warning || exit 1; \
    done

# 2) Ejecución: dependencias de producción + archivos compilados
FROM node:22-alpine
RUN apk add --no-cache tzdata
WORKDIR /app
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

COPY config ./config
COPY db ./db
COPY scripts/render-start.mjs ./scripts/
COPY --from=build /app/build ./build
COPY --from=build /app/apps/frontend/dist ./public

ENV NODE_ENV=production \
    CONFIG_DIR=/app/config \
    STATIC_DIR=/app/public \
    TZ=America/Bogota \
    PORT=10000

USER node
EXPOSE 10000
CMD ["node", "scripts/render-start.mjs"]
