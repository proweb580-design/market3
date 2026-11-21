'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  BODY_TYPES,
  FIT_PREFERENCES,
  fitFinderSchema,
  recommendSize,
  type SizeRecommendation,
} from '@repo/shared';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import type { SizeChart } from './types';

/** Reference §2.7: plain measurement table. */
export function SizeGuideDialog({ chart, open, onOpenChange }: { chart: SizeChart; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 rounded-lg p-6">
        <DialogTitle className="label-xs font-bold">Таблица размеров</DialogTitle>
        <DialogDescription className="sr-only">Замеры изделия по размерам</DialogDescription>
        <table className="mt-5 w-full text-left">
          <thead>
            <tr className="border-b border-border">
              {['Размер', ...chart.columns].map((c) => (
                <th key={c} scope="col" className="label-xs pb-2 font-normal text-muted-foreground">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((r) => (
              <tr key={r.size} className="border-b border-border last:border-0">
                <th scope="row" className="label-xs py-2.5 font-bold">
                  {r.size}
                </th>
                {r.values.map((v, i) => (
                  <td key={i} className="label-xs py-2.5 tabular-nums">
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}

function Segmented<T extends string>({ label, options, names, value, onChange }: { label: string; options: readonly T[]; names: Record<T, string>; value: T; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="label-xs text-muted-foreground">{label}</legend>
      <div className="mt-1.5 grid grid-cols-3 rounded-md border border-border p-0.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={cn('label-xs rounded-[4px] py-2 transition-colors', value === o ? 'bg-primary font-bold text-primary-foreground' : 'hover:bg-accent')}
          >
            {names[o]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Reference §2.6: height / weight / body type / fit preference → recommended size (heuristic in @repo/shared). */
export function FitFinderDialog({
  chart,
  open,
  onOpenChange,
  onSelectSize,
  soldOut,
}: {
  chart: SizeChart;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectSize: (size: string) => void;
  soldOut: readonly string[];
}) {
  const [result, setResult] = useState<SizeRecommendation | null>(null);
  const form = useForm<z.input<typeof fitFinderSchema>, unknown, z.output<typeof fitFinderSchema>>({
    resolver: zodResolver(fitFinderSchema),
    defaultValues: { heightCm: '', weightKg: '', bodyType: 'regular', fit: 'regular' },
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit((values) => setResult(recommendSize(values, chart.rows)));
  const field = 'h-11 w-full rounded-md border border-input bg-transparent px-3 pr-10 text-sm outline-none focus:border-foreground aria-invalid:border-destructive';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setResult(null);
      }}
    >
      <DialogContent className="max-w-md gap-0 rounded-lg p-6">
        <DialogTitle className="label-xs font-bold">Подберите свой размер</DialogTitle>
        <DialogDescription className="mt-2 text-xs text-muted-foreground">
          Укажите пару параметров — и мы подскажем подходящий размер.
        </DialogDescription>

        <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-4">
          {(
            [
              ['heightCm', 'Рост', 'см', '170'],
              ['weightKg', 'Вес', 'кг', '70'],
            ] as const
          ).map(([name, label, unit, placeholder]) => (
            <label key={name} className="flex flex-col gap-1.5">
              <span className="label-xs text-muted-foreground">{label}</span>
              <span className="relative">
                <input inputMode="numeric" placeholder={placeholder} aria-invalid={!!errors[name]} {...form.register(name)} className={field} />
                <span className="label-xs absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">{unit}</span>
              </span>
              {errors[name] && <span className="text-[11px] text-destructive">Укажите реальный {label.toLowerCase()}</span>}
            </label>
          ))}
          <Segmented label="Телосложение" options={BODY_TYPES} names={{ slim: 'Худощавое', regular: 'Среднее', broad: 'Крупное' }} value={form.watch('bodyType')} onChange={(v) => form.setValue('bodyType', v)} />
          <Segmented label="Посадка" options={FIT_PREFERENCES} names={{ fitted: 'Облегающая', regular: 'Обычная', oversized: 'Свободная' }} value={form.watch('fit')} onChange={(v) => form.setValue('fit', v)} />
          <Button type="submit" className="mt-2 w-full">
            Подобрать размер
          </Button>
        </form>

        {result && (
          <div className="mt-5 flex items-center justify-between rounded-md border border-border p-4 animate-in fade-in" role="status">
            <div>
              <p className="label-xs text-muted-foreground">{result.fits ? 'Рекомендуем' : 'Ближайший размер (может быть тесноват)'}</p>
              <p className="title-xl mt-1 text-3xl">{result.size}</p>
              {soldOut.includes(result.size) && <p className="label-xs mt-1 text-destructive">Нет в наличии в этом цвете</p>}
            </div>
            <Button
              variant="outline"
              disabled={soldOut.includes(result.size)}
              onClick={() => {
                onSelectSize(result.size);
                onOpenChange(false);
                setResult(null);
              }}
            >
              Выбрать {result.size}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
