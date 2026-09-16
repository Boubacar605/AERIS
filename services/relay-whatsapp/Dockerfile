# ==== Étape 1 : dépendances ====
FROM node:22-slim AS dependances
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ==== Étape 2 : runtime ====
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Installer Chromium et les dépendances système pour Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Dire à Puppeteer d'utiliser Chromium du système
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=dependances /app/node_modules ./node_modules
COPY src/ ./src/

# La session WhatsApp est persistée dans ce répertoire
RUN mkdir -p /app/.wwebjs_auth

EXPOSE 3500

CMD ["node", "src/serveur.js"]
