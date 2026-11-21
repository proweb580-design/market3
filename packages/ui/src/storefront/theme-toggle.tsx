'use client';

import { flushSync } from 'react-dom';
import { useLayoutEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);

  // ThemeScript already set the class before paint; sync React state with it.
  useLayoutEffect(() => setDark(document.documentElement.classList.contains('dark')), []);

  const toggle = () => {
    const apply = () => {
      const next = !document.documentElement.classList.contains('dark');
      document.documentElement.classList.toggle('dark', next);
      flushSync(() => setDark(next));
      try {
        localStorage.setItem('theme', next ? 'dark' : 'light');
      } catch {
        // storage blocked (private mode) — theme still switches for this page view
      }
    };
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      aria-pressed={dark}
      className={className}
    >
      {dark ? <Sun strokeWidth={1.5} className="size-4" /> : <Moon strokeWidth={1.5} className="size-4" />}
    </button>
  );
}
