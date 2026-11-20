'use client';

import { useEffect, useRef, type PointerEvent } from 'react';
import { cn } from '../lib/utils';

/** Star with a hole through the middle (evenodd), so the opening stays see-through from every angle. */
const STAR =
  'M24 2C25.6 14.5 28.8 19.4 46 24C28.8 28.6 25.6 33.5 24 46C22.4 33.5 19.2 28.6 2 24C19.2 19.4 22.4 14.5 24 2Z' +
  'M27.2 24a3.2 3.2 0 1 0-6.4 0a3.2 3.2 0 1 0 6.4 0Z';

/** Slices stacked along Z give the flat star its thickness (CSS 3D, no WebGL). */
const LAYERS = 12;
const DEPTH = 0.22; // total thickness as a share of the emblem's width

/**
 * Default brand emblem (brands upload their own later): an extruded 3D star.
 * Idles with a slow spin; drag it (mouse or touch) to turn it any way, it keeps a little momentum.
 * A plain click still goes through to the surrounding link.
 */
export function LogoMark({ className, spin = true }: { className?: string; spin?: boolean }) {
  const body = useRef<HTMLSpanElement>(null);
  const state = useRef({ rx: -12, ry: 0, vx: 0, vy: 0, dragging: false, moved: 0, lastX: 0, lastY: 0, lastT: 0 });

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const s = state.current;
      const dt = Math.min(now - prev, 50);
      prev = now;
      if (!s.dragging) {
        // momentum from the last drag, then ease back into the idle spin
        s.ry += s.vy * dt;
        s.rx += s.vx * dt;
        s.vx *= 0.94;
        s.vy *= 0.94;
        if (spin && !reduced && Math.abs(s.vy) < 0.05) s.ry += 0.05 * dt;
        // drift back to a slight downward tilt — the nearest one, so a big flip doesn't unwind several turns
        const rest = -12 + 360 * Math.round((s.rx + 12) / 360);
        s.rx += (rest - s.rx) * 0.02;
      }
      if (body.current) body.current.style.transform = `rotateX(${s.rx}deg) rotateY(${s.ry}deg)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [spin]);

  const down = (e: PointerEvent<HTMLSpanElement>) => {
    const s = state.current;
    Object.assign(s, { dragging: true, moved: 0, vx: 0, vy: 0, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp });
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLSpanElement>) => {
    const s = state.current;
    if (!s.dragging) return;
    const dx = e.clientX - s.lastX;
    const dy = e.clientY - s.lastY;
    const dt = Math.max(e.timeStamp - s.lastT, 1);
    s.ry += dx * 1.2;
    s.rx -= dy * 1.2;
    s.vy = (dx * 1.2) / dt;
    s.vx = (-dy * 1.2) / dt;
    s.moved += Math.abs(dx) + Math.abs(dy);
    Object.assign(s, { lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp });
  };
  const up = (e: PointerEvent<HTMLSpanElement>) => {
    state.current.dragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <span
      className={cn('inline-block cursor-grab touch-none select-none [container-type:inline-size] [perspective:300px] active:cursor-grabbing', className)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      // a drag is not a click: keep the surrounding link from navigating after one
      onClickCapture={(e) => {
        if (state.current.moved > 4) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onDragStart={(e) => e.preventDefault()}
    >
      <span ref={body} className="relative block size-full [transform-style:preserve-3d]">
        {Array.from({ length: LAYERS }, (_, i) => {
          const t = i / (LAYERS - 1); // 0 = back face, 1 = front face
          const face = i === 0 || i === LAYERS - 1;
          return (
            <svg
              key={i}
              viewBox="0 0 48 48"
              aria-hidden
              className="absolute inset-0 size-full"
              style={{
                transform: `translateZ(${((t - 0.5) * DEPTH * 100).toFixed(2)}cqw)`,
                // the slices in between read as the star's edge: a shade lighter than the faces
                color: face ? 'currentColor' : 'color-mix(in oklab, currentColor 72%, var(--background))',
              }}
            >
              <path fill="currentColor" fillRule="evenodd" d={STAR} />
            </svg>
          );
        })}
      </span>
    </span>
  );
}
