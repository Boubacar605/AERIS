/**
 * ImageViewer — grand espace de relecture radiologique avec zoom et panoramique.
 *
 * Implémentation 100 % CSS transforms (aucune bibliothèque externe) :
 *  - molette souris : zoom centré sur le curseur (borne 0.5× – 8×),
 *  - glisser : panoramique,
 *  - boutons + / − / Ajuster pour un contrôle précis du clinicien.
 */

import { Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

type Props = {
  fichier: File;
  className?: string;
};

const ECHELLE_MIN = 0.5;
const ECHELLE_MAX = 8;
const PAS_ZOOM = 1.25;

export function ImageViewer({ fichier, className }: Props) {
  const imagePreviewUrl = useMemo(() => URL.createObjectURL(fichier), [fichier]);

  useEffect(() => () => URL.revokeObjectURL(imagePreviewUrl), [imagePreviewUrl]);

  const conteneurRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const glisserRef = useRef<{
    origineX: number;
    origineY: number;
    decalX: number;
    decalY: number;
  } | null>(null);

  const [echelle, setEchelle] = useState(1);
  const [decal, setDecal] = useState({ x: 0, y: 0 });
  const [ajuste, setAjuste] = useState<{ largeur: number; hauteur: number } | null>(null);

  /** Recale l'image pour tenir entièrement dans le conteneur. */
  const ajuster = () => {
    const conteneur = conteneurRef.current;
    if (!conteneur || !imageRef.current) return;
    const { clientWidth, clientHeight } = conteneur;
    const { naturalWidth, naturalHeight } = imageRef.current;
    if (!naturalWidth || !naturalHeight) return;
    const e = Math.min(clientWidth / naturalWidth, clientHeight / naturalHeight);
    setEchelle(Math.min(Math.max(e, ECHELLE_MIN), ECHELLE_MAX));
    setDecal({ x: 0, y: 0 });
  };

  const surChargementPhoto = () => {
    const img = imageRef.current;
    if (img?.naturalWidth) {
      setAjuste({ largeur: img.naturalWidth, hauteur: img.naturalHeight });
    }
    ajuster();
  };

  const zoomer = (facteur: number, pointX?: number, pointY?: number) => {
    setEchelle((s0) => {
      const s1 = Math.min(Math.max(s0 * facteur, ECHELLE_MIN), ECHELLE_MAX);
      if (s0 === s1) return s0;
      // Si un point de la souris est fourni, on y ancre le zoom (le point de
      // l'image sous le curseur reste immobile pendant l'agrandissement).
      if (pointX !== undefined && pointY !== undefined) {
        const conteneur = conteneurRef.current;
        if (conteneur) {
          const rect = conteneur.getBoundingClientRect();
          const ox = pointX - rect.left - rect.width / 2;
          const oy = pointY - rect.top - rect.height / 2;
          setDecal((d) => ({
            x: d.x + ox * (1 / s1 - 1 / s0),
            y: d.y + oy * (1 / s1 - 1 / s0),
          }));
        }
      }
      return s1;
    });
  };

  const surMolette = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    zoomer(e.deltaY < 0 ? PAS_ZOOM : 1 / PAS_ZOOM, e.clientX, e.clientY);
  };

  const debuterGlisser = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    glisserRef.current = {
      origineX: e.clientX,
      origineY: e.clientY,
      decalX: decal.x,
      decalY: decal.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const poursuivreGlisser = (e: React.PointerEvent<HTMLDivElement>) => {
    const glisser = glisserRef.current;
    if (!glisser) return;
    setDecal({
      x: glisser.decalX + (e.clientX - glisser.origineX),
      y: glisser.decalY + (e.clientY - glisser.origineY),
    });
  };

  const terminerGlisser = (e: React.PointerEvent<HTMLDivElement>) => {
    glisserRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const styleImage: CSSProperties = {
    transform: `translate(calc(-50% + ${decal.x}px), calc(-50% + ${decal.y}px)) scale(${echelle})`,
  };

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        ref={conteneurRef}
        onWheel={surMolette}
        onPointerDown={debuterGlisser}
        onPointerMove={poursuivreGlisser}
        onPointerUp={terminerGlisser}
        onPointerCancel={terminerGlisser}
        className="relative h-[26rem] min-h-[18rem] cursor-grab touch-none overflow-hidden rounded-md border border-border bg-[#050a14] select-none active:cursor-grabbing"
        title="Molette : zoom — glisser : déplacer l'image"
      >
        {imagePreviewUrl ? (
          <img
            ref={imageRef}
            src={imagePreviewUrl}
            alt={`Radiographie ${fichier.name} en relecture`}
            onLoad={surChargementPhoto}
            className="absolute top-1/2 left-1/2 max-h-full max-w-full object-contain will-change-transform"
            style={styleImage}
            draggable={false}
          />
        ) : (
          <p className="absolute inset-0 grid place-items-center text-xs text-navy-muted">
            Impossible de préparer l'aperçu.
          </p>
        )}
      </div>

      {/* Barre de contrôle : nom du fichier + zoom */}
      <div className="flex flex-wrap items-center gap-3 border-t border-border/70 bg-muted/20 px-3 py-2">
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {fichier.name}
          {ajuste ? (
            <span className="ml-2 text-muted-foreground/60">
              {ajuste.largeur} × {ajuste.hauteur}px
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomer(1 / PAS_ZOOM)}
            disabled={echelle <= ECHELLE_MIN}
            aria-label="Dézoomer"
            className="grid size-7 place-items-center rounded border border-border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Minus className="size-3" />
          </button>
          <button
            type="button"
            onClick={ajuster}
            aria-label="Ajuster l'image"
            className="flex h-7 items-center gap-1 rounded border border-border bg-card px-2 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground transition-colors hover:text-foreground"
          >
            <Maximize2 className="size-3" />
            {Math.round(echelle * 100)} %
          </button>
          <button
            type="button"
            onClick={() => zoomer(PAS_ZOOM)}
            disabled={echelle >= ECHELLE_MAX}
            aria-label="Zoomer"
            className="grid size-7 place-items-center rounded border border-border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <Plus className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
