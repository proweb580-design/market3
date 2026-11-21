'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useStore } from './store-context';

const SEEN = 'intro-seen';

/**
 * First store home-page visit (/s/<store>) of the session: blurs the page before first paint (html[data-intro], styled
 * in tokens.css), so the hero never flashes before the intro. Render in the web app's <head>, next to ThemeScript.
 */
export function IntroScript() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `(function(){try{var s=location.pathname.split('/').filter(Boolean);if(s.length===2&&s[0]==='s'&&!sessionStorage.getItem('${SEEN}')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){var h=document.documentElement;h.dataset.intro='in';setTimeout(function(){if(h.dataset.intro==='in')delete h.dataset.intro},8000)}}catch(e){}})()`,
      }}
    />
  );
}

/** The store name in a run of lettering styles; the last one is the badge it lands with. */
const FLEX = 'var(--font-roboto-flex), sans-serif'; // loaded by the app; its width axis gives wide/condensed cuts on every platform
const STYLES: { className: string; style?: CSSProperties; lower?: boolean }[] = [
  { className: 'italic uppercase tracking-tight', style: { fontFamily: FLEX, fontWeight: 1000, fontStretch: '125%', transform: 'skewX(-12deg)' } },
  { className: 'lowercase', style: { fontFamily: FLEX, fontWeight: 900, fontStretch: '151%', letterSpacing: '-0.04em' } },
  { className: 'italic', style: { fontFamily: '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive', fontSize: '1.15em' }, lower: true },
  { className: 'uppercase text-transparent', style: { fontFamily: FLEX, fontWeight: 900, fontStretch: '120%', WebkitTextStroke: '2px #fff' } },
  { className: 'italic uppercase tracking-[0.2em]', style: { fontFamily: 'Georgia, "Times New Roman", serif' } },
  { className: 'font-bold uppercase tracking-[0.45em]', style: { fontFamily: '"Courier New", monospace', fontSize: '0.7em' } },
  { className: 'uppercase', style: { fontFamily: FLEX, fontWeight: 800, fontStretch: '25%', transform: 'scaleY(1.2)' } },
  { className: 'italic uppercase tracking-tight rounded-[50%] border-[3px] border-white px-[0.45em] py-[0.08em]', style: { fontFamily: FLEX, fontWeight: 1000, fontStretch: '115%' } },
];
const BADGE = STYLES.length - 1;

const MIN_MS = 1800; // the lettering run, even when everything is cached
const MAX_MS = 4500; // give up waiting for slow images
const FLY_MS = 750;
/** Latest effect run; a cleanup only lifts the blur if no newer run took over (React re-runs effects in dev). */
let run = 0;

export function Intro() {
  const { store } = useStore();
  const [on, setOn] = useState(false);
  const [look, setLook] = useState(0);
  const [phase, setPhase] = useState<'run' | 'hold' | 'fly' | 'land'>('run');
  const logo = useRef<HTMLDivElement>(null);
  const [fly, setFly] = useState<CSSProperties>({});

  useEffect(() => {
    const html = document.documentElement;
    if (html.dataset.intro !== 'in') return;
    const id = ++run;
    setOn(true);
    try {
      sessionStorage.setItem(SEEN, '1'); // once per session, even if the visitor leaves mid-intro
    } catch {}

    let loaded = document.readyState === 'complete';
    const onLoad = () => (loaded = true);
    window.addEventListener('load', onLoad);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const start = performance.now();
    let raf = 0;

    const finish = () => {
      setLook(BADGE);
      setPhase('hold');
      timers.push(
        setTimeout(() => {
          // Fly the badge into the header's store name, while the blur lifts and the page fades in.
          const target = document.querySelector<HTMLElement>('[data-brand]')?.getBoundingClientRect();
          const from = logo.current?.getBoundingClientRect();
          if (target && from) {
            const scale = Math.max(0.12, target.height / from.height);
            const dx = target.left + target.width / 2 - (from.left + from.width / 2);
            const dy = target.top + target.height / 2 - (from.top + from.height / 2);
            setFly({ transform: `translate(${dx}px, ${dy}px) scale(${scale})` });
          }
          setPhase('fly');
          html.dataset.intro = 'out';
        }, 350),
        setTimeout(() => {
          // Badge fades out while the header's store name fades in, in the same spot.
          setPhase('land');
          html.dataset.intro = 'land';
        }, 350 + FLY_MS),
        setTimeout(() => {
          delete html.dataset.intro;
          setOn(false);
        }, 350 + FLY_MS + 300),
      );
    };

    const tick = (now: number) => {
      const t = Math.max(0, now - start); // rAF's timestamp can predate `start`
      if ((loaded && t >= MIN_MS) || t >= MAX_MS) return finish();
      setLook(Math.floor(t / 140) % BADGE);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      window.removeEventListener('load', onLoad);
      setTimeout(() => {
        if (run === id) delete html.dataset.intro;
      }, 0);
    };
  }, []);

  if (!on) return null;
  const s = STYLES[look]!;
  const name = s.lower ? store.name.charAt(0).toUpperCase() + store.name.slice(1).toLowerCase() : store.name;
  const moving = phase === 'fly' || phase === 'land';

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] text-white">
      <p role="status" className="sr-only">Загрузка…</p>
      <div aria-hidden className="absolute inset-0 flex items-center justify-center">
        <div
          ref={logo}
          className="whitespace-nowrap text-6xl leading-none drop-shadow-[0_4px_24px_rgba(0,0,0,0.35)] sm:text-8xl"
          style={{
            ...fly,
            transition: moving ? `transform ${FLY_MS}ms cubic-bezier(0.7, 0, 0.2, 1), opacity 250ms ease` : undefined,
            opacity: phase === 'land' ? 0 : 1,
          }}
        >
          <span className={`inline-block ${s.className}`} style={s.style}>
            {name}
          </span>
        </div>
      </div>
    </div>
  );
}
