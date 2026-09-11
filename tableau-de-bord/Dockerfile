# =============================================================
# AERIS — Tableau de bord (TanStack Start / SSR)
# Build multi-stage : deps -> build -> runtime Node
# =============================================================

# --- Étape 1 : dépendances --------------------------------------
# node:22-slim (Debian/glibc) requis pour les bindings natifs rolldown
# (l'alpine/musl fait échouer le build : binding-linux-x64-musl absent du lock)
FROM node:22-slim AS dependances
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Étape 2 : build de production (SSR, preset node-server) ----
FROM dependances AS assemblage
# URL de l'API (moteur de décision) vue par le navigateur. Passée par
# docker-compose (build arg) : Vite l'inline dans le bundle au build time.
ARG VITE_URL_API=http://localhost:8003
ENV VITE_URL_API=$VITE_URL_API
COPY . .
ENV NITRO_PRESET=node-server
# Machine de démonstration limitée (~1,5 Go disponibles) : on borne le heap
# du processus de build pour éviter le OOM du noyau pendant npm run build.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

# --- Étape 3 : runtime ------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=assemblage /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]