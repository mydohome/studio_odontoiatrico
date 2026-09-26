# Build context: radice del repository (serve la cartella shared/)
FROM node:24-alpine
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY shared /app/shared
COPY backend/src ./src
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=160 --disable-warning=ExperimentalWarning"
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "src/server.ts"]
