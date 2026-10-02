# Build context: radice del repository (serve la cartella shared/)
FROM node:24-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY shared /app/shared
COPY frontend/ ./
RUN npm run build
# Elenco aggiornato degli IP di Cloudflare per riconoscere l'IP reale dei client (con copia di riserva).
RUN node scripts/real-ip.mjs

FROM nginx:1.29-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/nginx/real-ip.conf /etc/nginx/conf.d/00-real-ip.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
# 80: gestionale; 8081: solo conferme degli appuntamenti (dominio pubblico dei link).
EXPOSE 80 8081
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
