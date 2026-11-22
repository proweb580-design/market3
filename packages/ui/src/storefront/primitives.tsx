'use client';

import type { ComponentProps, ReactNode } from 'react';
import { Globe, Minus, Plus, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import { cn } from '../lib/utils';
import type { ProductColor, StoreConfig } from './types';

/** Size / fabric / option chip (reference §3.2: outlined, selected = solid). */
export function OptionChip({
  selected,
  unavailable,
  className,
  ...props
}: ComponentProps<'button'> & { selected?: boolean; unavailable?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'label-xs inline-flex h-11 min-w-12 items-center justify-center rounded-md border px-3 font-bold transition-all duration-200 active:scale-95 disabled:active:scale-100',
        selected
          ? 'border-primary bg-primary text-primary-foreground shadow-md'
          : 'border-border bg-background hover:border-foreground hover:shadow-sm',
        // Sold out: muted with a diagonal strike, the common storefront convention.
        unavailable &&
          'cursor-not-allowed border-dashed text-muted-foreground/60 hover:border-border hover:shadow-none [background-image:linear-gradient(to_top_right,transparent_calc(50%-0.5px),var(--color-border)_50%,transparent_calc(50%+0.5px))]',
        className,
      )}
      {...props}
    />
  );
}

export function Swatches({
  colors,
  selected,
  onSelect,
  size = 'sm',
}: {
  colors: ProductColor[];
  selected?: string;
  onSelect?: (name: string) => void;
  size?: 'sm' | 'lg';
}) {
  return (
    <div className="flex gap-1.5">
      {colors.map((c) => (
        <button
          key={c.name}
          type="button"
          title={c.name}
          aria-label={`Цвет ${c.name}`}
          aria-pressed={selected === c.name}
          onClick={() => onSelect?.(c.name)}
          className={cn(
            'rounded-sm border border-border p-0.5 transition-colors',
            selected === c.name && 'border-foreground',
            size === 'lg' ? 'size-9' : 'size-5',
          )}
        >
          <span className="block size-full rounded-[2px]" style={{ background: c.hex }} />
        </button>
      ))}
    </div>
  );
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 10,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
}) {
  const btn = 'inline-flex size-8 items-center justify-center transition-opacity hover:opacity-60 disabled:opacity-30';
  return (
    <div className={cn('inline-flex items-center rounded-sm border border-border', className)}>
      <button type="button" className={btn} aria-label="Уменьшить количество" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="size-3" />
      </button>
      <span className="w-6 text-center text-[11px] tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} aria-label="Увеличить количество" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="size-3" />
      </button>
    </div>
  );
}

export function SectionHeading({
  title,
  eyebrow,
  action,
  className,
}: {
  title: string;
  eyebrow?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('reveal flex items-end justify-between gap-4', className)}>
      <div>
        {eyebrow && <p className="label-xs mb-1 text-muted-foreground">{eyebrow}</p>}
        <h2 className="title-xl text-2xl sm:text-3xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

const TRUST_ICONS = { truck: Truck, shield: ShieldCheck, returns: RotateCcw, globe: Globe };

export function TrustBar({ items }: { items: StoreConfig['trust'] }) {
  return (
    <ul className="flex flex-col gap-4">
      {items.map(({ icon, title, text }) => {
        const Icon = TRUST_ICONS[icon];
        return (
          <li key={title} className="flex items-start gap-3">
            <Icon strokeWidth={1.5} className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="label-xs font-bold">{title}</p>
              <p className="text-xs text-muted-foreground">{text}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Grey card logos: Mastercard, МИР, Visa. */
export function PaymentBadges({ className }: { className?: string }) {
  return (
    <ul className={cn('flex items-center gap-3 text-muted-foreground', className)} aria-label="Способы оплаты">
      <li title="Mastercard">
        <svg viewBox="0 0 34 22" className="h-5 w-auto" role="img" aria-label="Mastercard">
          <circle cx="12" cy="11" r="9" fill="currentColor" opacity="0.55" />
          <circle cx="22" cy="11" r="9" fill="currentColor" opacity="0.85" />
        </svg>
      </li>
      <li title="МИР">
        <svg viewBox="0 0 48 22" className="h-5 w-auto" role="img" aria-label="МИР">
          <text x="0" y="17" fill="currentColor" fontSize="17" fontWeight="900" fontStyle="italic" fontFamily="Arial, sans-serif" letterSpacing="-0.5">МИР</text>
        </svg>
      </li>
      <li title="Visa">
        <svg viewBox="0 0 44 26" className="h-6 w-auto" role="img" aria-label="Visa">
          <rect width="44" height="26" rx="3" fill="currentColor" opacity="0.85" />
          <text x="22" y="18" textAnchor="middle" fill="var(--color-background, #fff)" fontSize="13" fontWeight="900" fontStyle="italic" fontFamily="Arial, sans-serif">VISA</text>
        </svg>
      </li>
    </ul>
  );
}
