# syntax=docker/dockerfile:1

# --- deps: ставим только продакшн-зависимости отдельным слоем, чтобы он кэшировался
# между сборками, пока package*.json не меняются -----------------------------------
FROM node:22-slim AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# npm ci вместо install: детерминированная установка строго по lock-файлу.
# sharp скачивает нативный биндинг под платформу сборки — на Debian slim (glibc) это
# работает "из коробки", в отличие от alpine (musl), поэтому базовый образ не alpine.
RUN npm ci --omit=dev

# --- runtime -------------------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# непривилегированный пользователь — процесс никогда не работает от root
RUN groupadd --system atlas && useradd --system --gid atlas --home /app atlas

COPY --from=deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY public ./public

# том для базы/загрузок/бэкапов монтируется поверх этого — на всякий случай создаём
# структуру заранее с нужным владельцем, иначе первый старт под non-root её не создаст
RUN mkdir -p /app/uploads /app/backups /app/data \
    && chown -R atlas:atlas /app

USER atlas
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/api/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
