import { createFileRoute, Link } from "@tanstack/react-router";
import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Boxes,
  Check,
  Cloud,
  Cpu,
  Leaf,
  Radio,
  ScanLine,
  ShieldCheck,
  Truck,
  WifiOff,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ACCES_URL = "/login";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "AERIS · IA radiologique adaptative Edge-Cloud · UADB" },
      {
        name: "description",
        content:
          "AERIS : architecture Edge-Cloud générique qui décide automatiquement où exécuter chaque analyse radiologique. Mémoire de Master 2, Université Alioune Diop de Bambey, Sénégal.",
      },
      { property: "og:title", content: "AERIS · IA radiologique adaptative Edge-Cloud" },
      {
        property: "og:description",
        content:
          "Un moteur de décision Edge-Cloud pour la radiologie en zones à faible connectivité. Projet de recherche UADB 2025-2026.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

/* ---------------- helpers ---------------- */

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Counter({
  to,
  suffix = "",
  prefix = "",
}: {
  to: number;
  suffix?: string;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 900);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}
      {n}
      {suffix}
    </span>
  );
}

/* ---------------- navbar ---------------- */

const LINKS = [
  { href: "#projet", label: "Projet" },
  { href: "#architecture", label: "Architecture" },
  { href: "#experimentation", label: "Expérimentation" },
  { href: "#prototype", label: "Prototype" },
];

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={cn(
        "sticky top-0 z-50 bg-navy/95 backdrop-blur transition-colors",
        scrolled ? "border-b border-ok/25" : "border-b border-transparent",
      )}
    >
      <nav className="flex max-w-6xl items-center justify-between gap-4 px-0 py-3">
        <a href="#top">
          <img src="/logo-aeris.png" alt="AERIS" className="h-20 w-56 object-contain" />
        </a>

        <ul className="hidden items-center gap-6 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="text-[13px] font-medium text-navy-muted transition-colors hover:text-navy-foreground"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <Link
          to={ACCES_URL}
          search={{}}
          className="rounded-full bg-ok px-4 py-2 text-[13px] font-semibold text-navy transition-opacity hover:opacity-90"
        >
          Accéder au prototype →
        </Link>
      </nav>
    </header>
  );
}

/* ---------------- hero SVG ---------------- */

function HeroDiagram() {
  return (
    <svg
      viewBox="0 0 420 320"
      className="w-full max-w-[460px]"
      role="img"
      aria-label="Flux de décision AERIS : radiographie vers moteur de décision, puis Edge ou Cloud"
    >
      <defs>
        <linearGradient id="ax" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ok)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--ok)" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* chest x-ray silhouette */}
      <g transform="translate(10,90)">
        <rect
          x="0"
          y="0"
          width="110"
          height="130"
          rx="8"
          fill="url(#ax)"
          stroke="var(--ok)"
          strokeOpacity="0.45"
        />
        <path
          d="M55 18 C40 26 30 32 22 36 C24 60 26 88 36 108 C44 116 66 116 74 108 C84 88 86 60 88 36 C80 32 70 26 55 18 Z"
          fill="none"
          stroke="var(--ok)"
          strokeOpacity="0.8"
          strokeWidth="1.6"
        />
        {[0, 1, 2, 3, 4].map((i) => (
          <path
            key={i}
            d={`M30 ${48 + i * 12} Q55 ${58 + i * 12} 80 ${48 + i * 12}`}
            fill="none"
            stroke="var(--ok)"
            strokeOpacity="0.35"
            strokeWidth="1.2"
          />
        ))}
        <line
          x1="55"
          y1="24"
          x2="55"
          y2="108"
          stroke="var(--ok)"
          strokeOpacity="0.5"
          strokeWidth="1.2"
        />
      </g>

      {/* flow: xray -> engine */}
      <motion.path
        d="M124 155 H186"
        fill="none"
        stroke="var(--ok)"
        strokeWidth="1.8"
        strokeDasharray="6 6"
        animate={{ strokeDashoffset: [24, 0] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
      />

      {/* decision engine */}
      <g transform="translate(186,120)">
        <rect
          width="86"
          height="70"
          rx="10"
          fill="oklch(1 0 0 / 8%)"
          stroke="var(--ok)"
          strokeOpacity="0.6"
        />
        <text
          x="43"
          y="28"
          textAnchor="middle"
          fill="white"
          fontSize="10"
          fontFamily="var(--font-mono)"
        >
          DECISION
        </text>
        <text
          x="43"
          y="42"
          textAnchor="middle"
          fill="white"
          fontSize="10"
          fontFamily="var(--font-mono)"
        >
          ENGINE
        </text>
        <motion.circle
          cx="43"
          cy="56"
          r="4"
          fill="var(--ok)"
          animate={{ opacity: [1, 0.3, 1], r: [4, 5.5, 4] }}
          transition={{ duration: 2.2, repeat: Infinity }}
        />
      </g>

      {/* branches */}
      <motion.path
        d="M272 145 C310 145 310 70 336 70"
        fill="none"
        stroke="var(--ok)"
        strokeWidth="1.8"
        strokeDasharray="6 6"
        animate={{ strokeDashoffset: [24, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
      />
      <motion.path
        d="M272 165 C310 165 310 240 336 240"
        fill="none"
        stroke="oklch(1 0 0 / 45%)"
        strokeWidth="1.8"
        strokeDasharray="6 6"
        animate={{ strokeDashoffset: [24, 0] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
      />

      <g transform="translate(330,44)">
        <rect
          width="82"
          height="52"
          rx="10"
          fill="var(--ok)"
          fillOpacity="0.14"
          stroke="var(--ok)"
        />
        <text
          x="41"
          y="24"
          textAnchor="middle"
          fill="var(--ok)"
          fontSize="11"
          fontFamily="var(--font-mono)"
        >
          EDGE
        </text>
        <text x="41" y="38" textAnchor="middle" fill="white" fillOpacity="0.7" fontSize="9">
          local
        </text>
      </g>
      <g transform="translate(330,214)">
        <rect width="82" height="52" rx="10" fill="oklch(1 0 0 / 6%)" stroke="oklch(1 0 0 / 45%)" />
        <text
          x="41"
          y="24"
          textAnchor="middle"
          fill="white"
          fontSize="11"
          fontFamily="var(--font-mono)"
        >
          CLOUD
        </text>
        <text x="41" y="38" textAnchor="middle" fill="white" fillOpacity="0.7" fontSize="9">
          distant
        </text>
      </g>

      {/* pulse waveform */}
      <motion.path
        d="M10 296 H70 l10 -18 l12 34 l10 -16 H420"
        fill="none"
        stroke="var(--ok)"
        strokeOpacity="0.5"
        strokeWidth="1.4"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  );
}

/* ---------------- architecture SVG ---------------- */

function ArchitectureDiagram() {
  return (
    <svg
      viewBox="0 0 460 330"
      className="w-full"
      role="img"
      aria-label="Diagramme d'architecture AERIS"
    >
      <defs>
        <marker id="arw" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill="var(--navy)" />
        </marker>
      </defs>

      <g>
        <rect
          x="8"
          y="130"
          width="120"
          height="56"
          rx="8"
          fill="var(--card)"
          stroke="var(--border)"
        />
        <text x="68" y="155" textAnchor="middle" fontSize="11" fill="var(--foreground)">
          Source de
        </text>
        <text x="68" y="169" textAnchor="middle" fontSize="11" fill="var(--foreground)">
          données
        </text>
      </g>

      <line
        x1="128"
        y1="158"
        x2="168"
        y2="158"
        stroke="var(--navy)"
        strokeWidth="1.5"
        markerEnd="url(#arw)"
      />

      <g>
        <rect x="170" y="126" width="118" height="64" rx="8" fill="var(--navy)" />
        <text
          x="229"
          y="152"
          textAnchor="middle"
          fontSize="11"
          fill="white"
          fontFamily="var(--font-mono)"
        >
          MOTEUR DE
        </text>
        <text
          x="229"
          y="168"
          textAnchor="middle"
          fontSize="11"
          fill="white"
          fontFamily="var(--font-mono)"
        >
          DÉCISION
        </text>
      </g>

      <path
        d="M288 145 C316 145 314 70 336 70"
        fill="none"
        stroke="var(--navy)"
        strokeWidth="1.5"
        markerEnd="url(#arw)"
      />
      <path
        d="M288 172 C316 172 314 248 336 248"
        fill="none"
        stroke="var(--navy)"
        strokeWidth="1.5"
        markerEnd="url(#arw)"
      />

      <g>
        <rect
          x="338"
          y="44"
          width="114"
          height="56"
          rx="8"
          fill="none"
          stroke="var(--ok)"
          strokeWidth="1.6"
        />
        <text
          x="395"
          y="68"
          textAnchor="middle"
          fontSize="11"
          fill="var(--ok)"
          fontFamily="var(--font-mono)"
        >
          NŒUD EDGE
        </text>
        <text x="395" y="84" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
          modèle léger
        </text>
      </g>
      <g>
        <rect
          x="338"
          y="222"
          width="114"
          height="56"
          rx="8"
          fill="none"
          stroke="var(--cloud)"
          strokeWidth="1.6"
        />
        <text
          x="395"
          y="246"
          textAnchor="middle"
          fontSize="11"
          fill="var(--cloud)"
          fontFamily="var(--font-mono)"
        >
          NŒUD CLOUD
        </text>
        <text x="395" y="262" textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
          modèle complet
        </text>
      </g>

      <g>
        <rect x="170" y="278" width="118" height="44" rx="8" fill="var(--navy)" />
        <text
          x="229"
          y="305"
          textAnchor="middle"
          fontSize="10"
          fill="white"
          fontFamily="var(--font-mono)"
        >
          MONITORING
        </text>
      </g>
      <path
        d="M288 296 C330 296 340 282 350 278"
        fill="none"
        stroke="var(--navy)"
        strokeOpacity="0.45"
        strokeWidth="1.2"
        strokeDasharray="4 4"
      />
      <path
        d="M229 278 C229 200 300 120 338 84"
        fill="none"
        stroke="var(--navy)"
        strokeOpacity="0.45"
        strokeWidth="1.2"
        strokeDasharray="4 4"
      />
    </svg>
  );
}

/* ---------------- page ---------------- */

function Landing() {
  return (
    <div id="top" className="min-h-screen scroll-smooth bg-background">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden bg-navy text-navy-foreground">
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: "url(/landing-page.png)" }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-navy/70" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-ok/40 bg-ok/10 px-3 py-1 font-mono text-[10px] font-semibold tracking-[0.16em] text-ok uppercase">
                Mémoire de Master 2 · UADB · 2025-2026
              </span>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 className="mt-5 text-4xl leading-[1.08] font-bold tracking-tight sm:text-5xl lg:text-[3.4rem]">
                L'IA radiologique qui s'adapte à votre réseau
              </h1>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-5 max-w-xl text-base leading-relaxed font-light text-ok">
                Une architecture Edge-Cloud générique qui décide automatiquement où traiter chaque
                analyse — localement ou dans le Cloud — selon les ressources disponibles.
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to={ACCES_URL}
                  search={{}}
                  className="rounded-md bg-ok px-5 py-2.5 text-sm font-semibold text-navy transition-opacity hover:opacity-90"
                >
                  Voir le prototype →
                </Link>
                <a
                  href="#projet"
                  className="rounded-md border border-white/40 px-5 py-2.5 text-sm font-semibold text-navy-foreground transition-colors hover:bg-white/10"
                >
                  Lire la problématique
                </a>
              </div>
            </Reveal>
          </div>

          <Reveal delay={0.2} className="flex justify-center lg:justify-end">
            <HeroDiagram />
          </Reveal>
        </div>

        <div className="relative border-t border-navy-line">
          <div className="mx-auto grid max-w-6xl divide-y divide-navy-line px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              { v: <Counter to={200} prefix="< " suffix=" ms" />, l: "Latence moyenne Edge" },
              { v: <Counter to={3} suffix=" scénarios" />, l: "comparés expérimentalement" },
              { v: <Counter to={2} suffix=" pathologies" />, l: "tuberculose & pneumonie" },
            ].map((s, i) => (
              <Reveal key={i} delay={i * 0.08} className="px-2 py-6">
                <p className="font-mono text-2xl font-semibold text-ok">{s.v}</p>
                <p className="mt-1 text-xs tracking-wide text-navy-muted">{s.l}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section id="projet" className="bg-card">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <Reveal>
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Le défi de la radiologie en zones à faible connectivité
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: WifiOff,
                t: "Dépendance réseau",
                d: "Les services Cloud tombent sans connexion stable. Une coupure suspend tout le flux d'analyse.",
              },
              {
                icon: Cpu,
                t: "Ressources Edge limitées",
                d: "Les machines locales saturent sous la charge. Le temps d'inférence s'effondre aux heures de pointe.",
              },
              {
                icon: Activity,
                t: "Aucune adaptation automatique",
                d: "Le clinicien choisit manuellement le mode de traitement, sans visibilité sur l'état réel du système.",
              },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 0.08}>
                <article className="panel h-full p-5">
                  <span className="grid size-9 place-items-center rounded-md bg-ok-soft ring-1 ring-ok/30">
                    <c.icon className="size-4 text-ok" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold">{c.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.d}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.1}>
            <blockquote className="mt-10 border-l-2 border-ok pl-5 text-base italic text-ok">
              « Au Sénégal, 60% des postes de santé fonctionnent avec une connectivité intermittente
              ou absente. »
            </blockquote>
          </Reveal>
        </div>
      </section>

      {/* SOLUTION */}
      <section id="architecture" className="bg-muted">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              AERIS : un moteur de décision intelligent et générique
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:items-center">
            <ul className="space-y-4">
              {[
                "Architecture microservices conteneurisée (Docker)",
                "Moteur de décision basé sur métriques temps réel",
                "Déploiement Edge + Cloud en parallèle",
                "Transférable à tout domaine IA (transport, agriculture, sécurité)",
              ].map((f, i) => (
                <Reveal key={f} delay={i * 0.07}>
                  <li className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ok/15 ring-1 ring-ok/40">
                      <Check className="size-3 text-ok" />
                    </span>
                    <span className="text-sm leading-relaxed">{f}</span>
                  </li>
                </Reveal>
              ))}
            </ul>
            <Reveal delay={0.12}>
              <div className="panel p-4">
                <ArchitectureDiagram />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* EXPERIMENTATION */}
      <section id="experimentation" className="bg-card">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              3 scénarios expérimentaux comparés
            </h2>
          </Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Cloud,
                n: "Scénario 1",
                t: "Tout-Cloud",
                d: "Envoi systématique de chaque radiographie au modèle complet distant.",
                badge: "Vulnérable aux pannes réseau",
                highlight: false,
              },
              {
                icon: Boxes,
                n: "Scénario 2",
                t: "Tout-Edge",
                d: "Traitement local exclusif sur le nœud du poste de santé.",
                badge: "Saturation matérielle",
                highlight: false,
              },
              {
                icon: Zap,
                n: "Scénario 3",
                t: "Adaptatif ★",
                d: "Routage dynamique selon la télémétrie réseau et matérielle observée.",
                badge: "Meilleur compromis performance/disponibilité",
                highlight: true,
              },
            ].map((s, i) => (
              <Reveal key={s.t} delay={i * 0.08}>
                <article
                  className={cn(
                    "panel h-full p-5",
                    s.highlight
                      ? "border-transparent bg-navy text-navy-foreground shadow-raise"
                      : "bg-muted",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "grid size-9 place-items-center rounded-md",
                        s.highlight ? "bg-ok/15 ring-1 ring-ok/40" : "bg-card ring-1 ring-border",
                      )}
                    >
                      <s.icon
                        className={cn("size-4", s.highlight ? "text-ok" : "text-muted-foreground")}
                      />
                    </span>
                    {s.highlight && (
                      <span className="rounded-full bg-ok px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.1em] text-navy uppercase">
                        ★ Approche AERIS
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      "mt-4 font-mono text-[10px] tracking-[0.14em] uppercase",
                      s.highlight ? "text-ok" : "text-muted-foreground",
                    )}
                  >
                    {s.n}
                  </p>
                  <h3 className="mt-1 text-base font-semibold">{s.t}</h3>
                  <p
                    className={cn(
                      "mt-2 text-sm leading-relaxed",
                      s.highlight ? "text-navy-muted" : "text-muted-foreground",
                    )}
                  >
                    {s.d}
                  </p>
                  <p
                    className={cn(
                      "mt-4 inline-block rounded border px-2 py-1 font-mono text-[10px] tracking-wide uppercase",
                      s.highlight
                        ? "border-ok/40 bg-ok/10 text-ok"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {s.badge}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.1}>
            <div className="mt-8 flex flex-wrap gap-2">
              {["Latence", "Temps d'inférence", "CPU/RAM", "Débit", "Bande passante"].map((m) => (
                <span
                  key={m}
                  className="rounded-full border border-ok/40 px-3 py-1.5 font-mono text-[11px] text-ok"
                >
                  {m}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* TRANSFERABILITY */}
      <section className="bg-navy text-navy-foreground">
        <div className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Une technologie générique, pas un outil médical
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-navy-muted">
              Le moteur de décision route des charges de travail IA. Seuls les conteneurs de service
              changent.
            </p>
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              {
                icon: ScanLine,
                d: "Santé",
                data: "Radiographies",
                e: "CNN léger",
                c: "DenseNet121",
              },
              {
                icon: Leaf,
                d: "Agriculture",
                data: "Photos de cultures",
                e: "MobileNet",
                c: "ResNet50",
              },
              { icon: Truck, d: "Transport", data: "Flux vidéo", e: "YOLO-Tiny", c: "YOLOv8" },
              {
                icon: ShieldCheck,
                d: "Sécurité",
                data: "Surveillance",
                e: "Détection rapide",
                c: "Reconnaissance fine",
              },
            ].map((x, i) => (
              <Reveal key={x.d} delay={i * 0.07}>
                <article className="h-full rounded-lg border border-white/10 bg-white/5 p-5 transition-colors hover:border-ok/60">
                  <div className="flex items-center gap-3">
                    <span className="grid size-9 place-items-center rounded-md bg-ok/15 ring-1 ring-ok/30">
                      <x.icon className="size-4 text-ok" />
                    </span>
                    <h3 className="text-sm font-semibold">{x.d}</h3>
                  </div>
                  <dl className="mt-4 space-y-1.5 font-mono text-[11px]">
                    <div className="flex justify-between gap-3">
                      <dt className="text-navy-muted">données</dt>
                      <dd>{x.data}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-navy-muted">edge</dt>
                      <dd className="text-ok">{x.e}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-navy-muted">cloud</dt>
                      <dd>{x.c}</dd>
                    </div>
                  </dl>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* PROTOTYPE CTA */}
      <section
        id="prototype"
        className="bg-ok"
        style={{
          backgroundImage:
            "linear-gradient(135deg, var(--ok), color-mix(in oklab, var(--ok) 70%, var(--navy)))",
        }}
      >
        <div className="mx-auto max-w-3xl px-5 py-16 text-center lg:py-20">
          <Reveal>
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Le prototype est fonctionnel et démontrable
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/85">
              Tableau de bord temps réel, moteur de décision actif, monitoring Prometheus intégré.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <Link
              to={ACCES_URL}
              search={{}}
              className="mt-8 inline-flex items-center gap-2 rounded-md bg-white px-6 py-3 text-sm font-semibold text-navy transition-transform hover:-translate-y-0.5"
            >
              <Radio className="size-4" />
              Accéder au tableau de bord →
            </Link>
            <p className="mt-4 font-mono text-[11px] text-white/75">
              Prototype de recherche · Master 2 SI · UADB · 2025-2026
            </p>
          </Reveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-navy text-navy-foreground">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 text-sm sm:grid-cols-3 sm:items-center">
          <div>
            <p className="font-mono text-sm font-bold tracking-[0.22em]">AERIS</p>
            <p className="mt-1 text-xs text-navy-muted">Projet de mémoire de Master 2</p>
          </div>
          <p className="text-xs text-navy-muted sm:text-center">
            Université Alioune Diop de Bambey (UADB) · Sénégal
          </p>
          <div className="text-xs sm:text-right">
            <p>Boubacar NIANG</p>
            <a href="mailto:boubacar.niang@uadb.edu.sn" className="text-ok hover:underline">
              boubacar.niang@uadb.edu.sn
            </a>
          </div>
        </div>
        <div className="h-0.5 w-full bg-ok" />
      </footer>
    </div>
  );
}
