'use client';

import { useRouter } from 'next/navigation';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * A link without an `href`, so hovering it doesn't flash the URL in the browser's status bar.
 * Keeps what a link gives: Enter to open, Ctrl/Cmd/middle-click for a new tab, prefetch on hover.
 */
export function NavBlock({
  href,
  onNavigate,
  className,
  label,
  children,
}: {
  href: string;
  onNavigate?: () => void;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const open = (e: MouseEvent | KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || ('button' in e && e.button === 1)) {
      window.open(href, '_blank', 'noopener');
      return;
    }
    onNavigate?.();
    router.push(href);
  };
  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={label}
      className={cn('cursor-pointer', className)}
      onClick={open}
      onAuxClick={(e) => e.button === 1 && open(e)}
      onKeyDown={(e) => e.key === 'Enter' && open(e)}
      onMouseEnter={() => router.prefetch(href)}
    >
      {children}
    </div>
  );
}
