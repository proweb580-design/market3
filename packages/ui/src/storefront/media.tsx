import { cn } from '../lib/utils';
import { GarmentArt } from './garment-art';
import type { Media, Panel } from './types';

/** Product cut-out: uploaded image or demo vector art tinted with the selected colour. */
export function ProductImage({
  media,
  tone,
  className,
  priority,
  eager,
}: {
  media: Media;
  tone: string;
  className?: string;
  priority?: boolean;
  /** Load now without raising fetch priority: for images that animate into view, where lazy loading paints them half-decoded mid-motion. */
  eager?: boolean;
}) {
  if (media.type === 'image') {
    return (
      <img
        src={media.src}
        alt={media.alt}
        loading={priority || eager ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        // Square box so cut-out photos of any shape line up in grids. No `cutout` glow: on a photo it reads as a white halo in dark mode.
        className={cn('aspect-square w-full object-contain', className)}
      />
    );
  }
  return <GarmentArt kind={media.kind} view={media.view} tone={tone} title={media.alt} className={cn('cutout', className)} />;
}

/** Editorial photo slot. Demo panels are gradients with a garment silhouette and film grain. */
export function PanelView({ panel, className, priority }: { panel: Panel; className?: string; priority?: boolean }) {
  if (panel.type === 'image') {
    return (
      <img
        src={panel.src}
        alt={panel.alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className={cn('size-full object-cover', className)}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={panel.alt}
      className={cn('relative size-full overflow-hidden [container-type:size]', className)}
      style={{ background: `radial-gradient(120% 90% at 30% 20%, ${panel.from}, ${panel.to})` }}
    >
      {panel.garment && (
        // Width capped by panel height so wide banners show a figure, not a giant crop.
        <GarmentArt
          kind={panel.garment.kind}
          tone={panel.garment.tone}
          className="absolute bottom-[-6%] left-1/2 w-[min(84cqw,95cqh)] -translate-x-1/2 opacity-90 drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)]"
        />
      )}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
