# ADR-0004 : Tunnel public permanent et gratuit via Tailscale Funnel

## Statut

Accepte

## Contexte

La demonstration AERIS doit etre accessible a distance devant un jury (soutenance de Master 2), depuis n'importe quel reseau. Les premieres tentatives utilisaient les tunnels Cloudflare `cloudflared` : l'URL changeait a chaque lancement et le tunnel mourait a chaque mise en veille de la machine. Un domaine et un tunnel Cloudflare nomme (URL fixe) auraient repondu, mais sur un abonnement payant — hors budget. Le besoin : une URL **permanente et gratuite**, qui survit a la veille et aux redemarrages.

## Options considerees

| Option | Cout | URL permanente | Survie a la veille/reboot |
|--------|------|----------------|---------------------------|
| Cloudflare `cloudflared` (quick tunnel) | Gratuit | Non (change a chaque run) | Non |
| Cloudflare tunnel nomme | ~5$/mois | Oui | Oui |
| **Tailscale Funnel** | **Gratuit (plan Personnel)** | **Oui (`*.ts.net`)** | **Oui (daemon auto-restart)** |

## Decision

Utiliser **Tailscale Funnel** comme tunnel public : une adresse `https://<machine>.<tailnet>.ts.net` stable, fournie gratuitement, portee par le daemon Tailscale qui redemarre automatiquement avec la machine.

### Mise en place

1. **Auth** : `sudo tailscale up` (compte Personnel, une machine `niang-hp-probook-650-g5`).
2. **Activation de Serve/Funnel** une seule fois dans la console admin : `https://login.tailscale.com/f/serve?node=<node>`.
3. **Routage par chemin** (chacun via `tailscale funnel --set-path`, voir le piege ci-dessous) :
   - `/`  → `http://127.0.0.1:3000`  (tableau de bord React)
   - `/api` → `http://127.0.0.1:8003`  (moteur de decision)
4. **Frontend** : rebuild avec `VITE_URL_API_PUBLIQUE="/api"` pour que les appels API du navigateur soient **relatifs** et passent par le tunnel (`BASE_URL = "/api"`, plus de `http://localhost:8003` code en dur).
5. **Anti-veille** : `gsettings set org.gnome.settings-daemon.plugins.power lid-close-ac-action 'nothing'` (+ variante batterie) pour que la fermeture de l'ecran ne suspende pas la machine et ne coupe pas le tunnel.

### Piege de configuration documente

`tailscale funnel --bg 443` (sans cible) **ecrase le handler racine** et le fait pointer vers le port 443 local (boucle → HTTP 502 sur le frontend). Il faut au contraire passer chaque cible avec `--set-path`, en une passe :

```bash
tailscale funnel --bg --set-path=/   --https=443 http://127.0.0.1:3000
tailscale funnel --bg --set-path=/api --https=443 http://127.0.0.1:8003
```

Le script reproductible est `infrastructure/scripts/configurer-tunnel.sh`.

## Justification

- **Gratuit** : le plan Personnel couvre le Funnel sans abonnement.
- **Permanent** : l'hote `*.ts.net` est stable tant que le daemon tourne ; il survit aux veilles/redemarrages (contrairement a `cloudflared`).
- **Simple** : pas de domaine achete, pas de reverse proxy nginx externe necessaire — le Funnel gere le TLS en HTTPS sur `:443`.
- **Maintenable** : le routage par chemin et le script reproductible rendent la reconstitution triviale.

## Consequences

### Impacts

- Adresse publique : `https://niang-hp-probook-650-g5.tail23cc4d.ts.net/`
  - Frontend : `https://niang-hp-probook-650-g5.tail23cc4d.ts.net/`
  - API moteur : `https://niang-hp-probook-650-g5.tail23cc4d.ts.net/api/sante`
- `VITE_URL_API_PUBLIQUE` doit valoir `/api` au build du frontend (relatif). En local sans variable, le fallback `http://localhost:8003` reste actif.
- La machine doit rester allumee (anti-veille configuree) pour servir la demo.
- Fichiers : `infrastructure/scripts/configurer-tunnel.sh`, documentation ADR.

### Limites documentees

- L'URL est censee rester stable, mais elle derive de l'hote Tailscale : renommer la machine changerait l'adresse. Inchange sinon.
- Le Funnel expose la machine sur l'Internet public (par design) : la demo AERIS ne traite pas de donnees patients reelles (images anonymisees) — acceptable pour la soutenance.
- Sans abonnement Pay-as-you-go, Tailscale limite le plan gratuit : verifier que le Funnel reste active sur le compte au moment de la soutenance.
- Le reverse proxy nginx (`infrastructure/nginx/aeris.conf`) est conserve comme repli si on preferait un point d'entree unifie sur un port unique — non utilise en l'etat.