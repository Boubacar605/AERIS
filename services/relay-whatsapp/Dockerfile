# ==== Étape 1 : dépendances ====
FROM node:22-slim AS dependances
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ==== Étape 2 : runtime ====
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependances /app/node_modules ./node_modules
COPY src/ ./src/

# La session WhatsApp (creds après scan QR) est persistée dans ce répertoire,
# monté via le volume nommé aeris-whatsapp-session.
RUN mkdir -p /app/auth_info

EXPOSE 3500

CMD ["node", "src/serveur.js"]