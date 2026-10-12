# ---------- Сборка ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .

# ---------- Запуск ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/server.js ./
COPY --from=build /app/db.js ./
COPY --from=build /app/lib ./lib
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules

# База данных (SQLite) — постоянный том
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/stats >/dev/null || exit 1

USER node
CMD ["node", "server.js"]
