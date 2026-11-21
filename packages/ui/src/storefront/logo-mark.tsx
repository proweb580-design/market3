'use client';

import { useEffect, useRef, type PointerEvent } from 'react';
import { cn } from '../lib/utils';

/* ── Geometry: a sharpened four-point shuriken ─────────────────────────────────────────────
 * Flat centre faces (front and back) with a hole through the middle; from the edge of each face a bevel
 * runs out to a single sharp edge at z = 0 along the whole star outline — the blade profile.
 * Built once as triangles in emblem space (x right, y down, z towards the viewer, star spans -1..1).
 */
type V = [number, number, number];
type Tri = [V, V, V];

/** The star outline: four cubic Béziers of the original 48×48 emblem path, centred and scaled to -1..1. */
const CURVES: number[][] = [
  [24, 2, 25.6, 14.5, 28.8, 19.4, 46, 24],
  [46, 24, 28.8, 28.6, 25.6, 33.5, 24, 46],
  [24, 46, 22.4, 33.5, 19.2, 28.6, 2, 24],
  [2, 24, 19.2, 19.4, 22.4, 14.5, 24, 2],
];
const STEPS = 28; // samples per curve
const FACE = 0.42; // flat face size relative to the blade (how far in the bevel starts)
const THICK = 0.2; // half thickness at the faces
const HOLE = 0.13; // radius of the hole through the centre

function buildShuriken(): Tri[] {
  const outline: [number, number][] = [];
  for (const [x0, y0, x1, y1, x2, y2, x3, y3] of CURVES)
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS;
      const u = 1 - t;
      const bx = u * u * u * x0! + 3 * u * u * t * x1! + 3 * u * t * t * x2! + t * t * t * x3!;
      const by = u * u * u * y0! + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t * t * t * y3!;
      outline.push([(bx - 24) / 22, (by - 24) / 22]);
    }
  const n = outline.length;
  const tris: Tri[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [ax, ay] = outline[i]!;
    const [bx, by] = outline[j]!;
    const ha = Math.atan2(ay, ax);
    const hb = Math.atan2(by, bx);
    for (const side of [1, -1]) {
      const z = THICK * side;
      const edgeA: V = [ax, ay, 0];
      const edgeB: V = [bx, by, 0];
      const faceA: V = [ax * FACE, ay * FACE, z];
      const faceB: V = [bx * FACE, by * FACE, z];
      const holeA: V = [Math.cos(ha) * HOLE, Math.sin(ha) * HOLE, z];
      const holeB: V = [Math.cos(hb) * HOLE, Math.sin(hb) * HOLE, z];
      // faces and bevels look out along their side's z
      const up: V = [0, 0, side];
      tris.push(outward([faceA, edgeA, edgeB], up), outward([faceA, edgeB, faceB], up)); // bevel
      tris.push(outward([holeA, faceA, faceB], up), outward([holeA, faceB, holeB], up)); // flat face
    }
    // wall of the hole, looking into the hole (towards the axis)
    const fa: V = [Math.cos(Math.atan2(ay, ax)) * HOLE, Math.sin(Math.atan2(ay, ax)) * HOLE, THICK];
    const fb: V = [Math.cos(Math.atan2(by, bx)) * HOLE, Math.sin(Math.atan2(by, bx)) * HOLE, THICK];
    const ba: V = [fa[0], fa[1], -THICK];
    const bb: V = [fb[0], fb[1], -THICK];
    const axis: V = [-(fa[0] + fb[0]), -(fa[1] + fb[1]), 0];
    tris.push(outward([fa, ba, bb], axis), outward([fa, bb, fb], axis));
  }
  return tris;
}

const normal = ([a, b, c]: Tri): V => {
  const u: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: V = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
};
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Winds a triangle so its normal points out of the solid (along `ref`), which lets the renderer skip back faces. */
const outward = (t: Tri, ref: V): Tri => (dot(normal(t), ref) < 0 ? [t[0], t[2], t[1]] : t);

const MESH = buildShuriken();
const LIGHT: V = (() => {
  const l: V = [-0.45, -0.6, 0.66];
  const m = Math.hypot(...l);
  return [l[0] / m, l[1] / m, l[2] / m];
})();

const parseRgb = (c: string): V => {
  const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0];
};
const mix = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Default brand emblem (brands upload their own later): a 3D sharpened shuriken drawn on a canvas (no WebGL, no library).
 * Idles with a slow spin; drag it (mouse or touch) to turn it any way, it keeps a little momentum.
 * A plain click still goes through to the surrounding link.
 */
export function LogoMark({ className, spin = true }: { className?: string; spin?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({ rx: -14, ry: 0, vx: 0, vy: 0, dragging: false, moved: 0, lastX: 0, lastY: 0, lastT: 0 });

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let prev = performance.now();
    let base: V = [0, 0, 0];
    let tick = 0;
    const drawn = { rx: NaN, ry: NaN }; // rotation of the last drawn frame

    const draw = () => {
      const s = state.current;
      const dpr = window.devicePixelRatio || 1;
      const size = el.clientWidth;
      if (el.width !== Math.round(size * dpr)) el.width = el.height = Math.round(size * dpr);
      if (tick++ % 30 === 0) base = parseRgb(getComputedStyle(el).color); // follows the theme
      // light emblem (dark theme) gets its shading towards black, a dark one towards white highlights
      const light = base[0] + base[1] + base[2] > 382;
      const shadow = light ? mix(base, [0, 0, 0], 0.55) : base;
      const highlight = light ? base : mix(base, [255, 255, 255], 0.62);

      const ax = (s.rx * Math.PI) / 180;
      const ay = (s.ry * Math.PI) / 180;
      const [cx, sx, cy, sy] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay)];
      // same order as CSS rotateX(..) rotateY(..): Y first, then X
      const rot = ([x, y, z]: V): V => {
        const x1 = x * cy + z * sy;
        const z1 = -x * sy + z * cy;
        return [x1, y * cx - z1 * sx, y * sx + z1 * cx];
      };
      const half = el.width / 2;
      const scale = half * 0.9;
      const project = ([x, y, z]: V): [number, number] => {
        const p = 4 / (4 - z); // gentle perspective
        return [half + x * scale * p, half + y * scale * p];
      };

      const faces: { pts: [number, number][]; z: number; shade: number }[] = [];
      for (const tri of MESH) {
        const [a, b, c] = tri.map(rot) as Tri;
        let [nx, ny, nz] = normal([a, b, c]);
        // closed mesh: a face turned away from the camera (at z = 4) is always covered, so it is never drawn
        if (dot([nx, ny, nz], [-a[0], -a[1], 4 - a[2]]) <= 0) continue;
        // shade the side that faces the viewer; far faces are painted first and covered (depth sort below)
        if (nz < 0) [nx, ny, nz] = [-nx, -ny, -nz];
        const len = Math.hypot(nx, ny, nz) || 1;
        const diffuse = Math.max(0, (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / len);
        const spec = Math.pow(diffuse, 12); // metal glint on the bevels
        faces.push({ pts: [project(a), project(b), project(c)], z: a[2] + b[2] + c[2], shade: Math.min(1, 0.12 + diffuse * 0.7 + spec * 0.5) });
      }
      faces.sort((p, q) => p.z - q.z);

      ctx.clearRect(0, 0, el.width, el.height);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.6 * dpr; // hides hairline seams between triangles
      // Consecutive faces of the same colour go into one path: same picture, far fewer fill/stroke calls.
      let color = '';
      const flush = () => {
        if (!color) return;
        ctx.fill();
        ctx.stroke();
      };
      for (const f of faces) {
        const [r, g, b] = mix(shadow, highlight, f.shade);
        const next = `rgb(${r | 0},${g | 0},${b | 0})`;
        if (next !== color) {
          flush();
          color = next;
          ctx.fillStyle = ctx.strokeStyle = color;
          ctx.beginPath();
        }
        ctx.moveTo(...f.pts[0]!);
        ctx.lineTo(...f.pts[1]!);
        ctx.lineTo(...f.pts[2]!);
        ctx.closePath();
      }
      flush();
    };

    const loop = (now: number) => {
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
        // drift back to a slight tilt — the nearest one, so a big flip doesn't unwind several turns
        const rest = -14 + 360 * Math.round((s.rx + 14) / 360);
        s.rx += (rest - s.rx) * 0.02;
      }
      // At rest (reduced motion, no spin) the picture doesn't change: skip the redraw, but still notice theme changes.
      if (Math.abs(s.rx - drawn.rx) + Math.abs(s.ry - drawn.ry) > 0.01 || tick % 30 === 0) {
        draw();
        drawn.rx = s.rx;
        drawn.ry = s.ry;
      } else tick++;
      frame = requestAnimationFrame(loop);
    };
    // Drawing a frame is real work: run only while the emblem is on screen (the header scrolls away).
    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(frame);
      if (!entry?.isIntersecting) return;
      prev = performance.now();
      frame = requestAnimationFrame(loop);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [spin]);

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = state.current;
    Object.assign(s, { dragging: true, moved: 0, vx: 0, vy: 0, lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp });
    try {
      e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves when the pointer leaves the small emblem
    } catch {
      // pointer already gone (e.g. synthetic event): dragging still works while over the emblem
    }
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
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
  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    state.current.dragging = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn('inline-block cursor-grab touch-none select-none active:cursor-grabbing', className)}
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
    />
  );
}
