# Dashboard: compilación con Vite y publicación estática con nginx
# (nginx también reenvía /api y /socket.io al backend).
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/publisher/package.json apps/publisher/
COPY apps/processor/package.json apps/processor/
COPY apps/backend/package.json apps/backend/
COPY apps/archiver/package.json apps/archiver/
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --no-audit --no-fund -w @uptc/shared -w @uptc/frontend --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/frontend ./apps/frontend
RUN npm run build -w @uptc/frontend

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
EXPOSE 80
