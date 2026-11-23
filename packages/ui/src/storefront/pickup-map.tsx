'use client';

import 'leaflet/dist/leaflet.css';
import type { CircleMarker, Map as LeafletMap } from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Clock, CreditCard, IdCard, MapPin, Phone, Search, Wallet } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { PICKUP_CITY, PICKUP_POINTS, type PickupPoint } from './pickup-points';

/**
 * Pickup picker: search + list on the left, map on the right (map above on phones). Picking an office, in the list
 * or on the map, turns the left side into its card; the arrow goes back to the list.
 */
export function PickupPicker({
  selected,
  shipping,
  onClose,
  onConfirm,
}: {
  selected: PickupPoint | null;
  /** Delivery price as shown in the checkout total, e.g. "Бесплатно". */
  shipping?: string;
  onClose: () => void;
  onConfirm: (p: PickupPoint) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<PickupPoint | null>(selected);
  const q = query.trim().toLowerCase();
  const shown = q ? PICKUP_POINTS.filter((p) => `${p.name} ${p.address} ${p.index}`.toLowerCase().includes(q)) : PICKUP_POINTS;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="grid h-[88svh] max-w-[calc(100%-1rem)] grid-rows-[40%_1fr] gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[1100px] md:grid-cols-[380px_1fr] md:grid-rows-1">
        {active ? (
          <div className="flex min-h-0 flex-col p-5 md:p-6">
            <button type="button" onClick={() => setActive(null)} className="-ml-1 self-start p-1 hover:opacity-60" aria-label="Назад к списку">
              <ArrowLeft className="size-6" strokeWidth={1.5} />
            </button>
            <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
              <DialogTitle className="text-2xl font-bold">{active.name}</DialogTitle>
              <DialogDescription className="sr-only">Пункт выдачи: адрес и часы работы</DialogDescription>
              {shipping && (
                <p className="mt-4 flex items-center gap-2 text-sm">
                  <Wallet className="size-4" strokeWidth={1.5} /> Доставка: {shipping}
                </p>
              )}
              <hr className="my-5 border-border" />
              <h3 className="text-lg font-bold">Как добраться</h3>
              <ul className="mt-3 flex flex-col gap-3 text-sm">
                <li className="flex gap-3">
                  <MapPin className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                  {[PICKUP_CITY, active.address, active.index].filter(Boolean).join(', ')}
                </li>
                {active.hours && (
                  <li className="flex gap-3">
                    <Clock className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                    {active.hours}
                  </li>
                )}
                {active.phone && (
                  <li className="flex gap-3">
                    <Phone className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                    <a href={`tel:${active.phone.replace(/[^+\d]/g, '')}`} className="hover:underline">
                      {active.phone}
                    </a>
                  </li>
                )}
                <li className="flex gap-3">
                  <IdCard className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                  Выдача по паспорту
                </li>
                <li className="flex gap-3">
                  <CreditCard className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                  Оплата онлайн
                </li>
              </ul>
            </div>
            <Button type="button" className="mt-4 h-12 w-full rounded-xl" onClick={() => onConfirm(active)}>
              Заберу здесь
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-col p-5 md:p-6">
            <DialogTitle className="text-xl font-bold">Выберите пункт выдачи</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              Отделения почты в г. {PICKUP_CITY}: {PICKUP_POINTS.length}. Найдите на карте или по адресу.
            </DialogDescription>
            <label className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-foreground">
              <Search className="size-4 shrink-0 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Улица, номер или индекс"
                aria-label="Найти пункт выдачи"
                className="h-11 w-full bg-transparent text-sm outline-none"
              />
            </label>
            <ul className="-mx-2 mt-3 min-h-0 flex-1 overflow-y-auto px-2" aria-label="Пункты выдачи">
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setActive(p)}
                    className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span>
                      <span className="block text-sm font-medium">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{[p.address, p.index].filter(Boolean).join(', ')}</span>
                    </span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="px-3 py-6 text-sm text-muted-foreground">Ничего не найдено.</li>}
            </ul>
          </div>
        )}
        <div className="relative order-first min-h-0 md:order-none">
          <PickupMap points={PICKUP_POINTS} active={active?.id ?? null} onPick={setActive} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

const TASHKENT: [number, number] = [41.311, 69.279];
const style = (active: boolean) =>
  active
    ? { radius: 11, color: '#fff', weight: 3, fillColor: '#0a0a0a', fillOpacity: 1 }
    : { radius: 8, color: '#fff', weight: 2, fillColor: '#e4572e', fillOpacity: 0.95 };

/** OpenStreetMap with a dot per post office. Leaflet loads on first open only (it touches `window`). */
export function PickupMap({ points, active, onPick }: { points: PickupPoint[]; active: string | null; onPick: (p: PickupPoint) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef(new Map<string, CircleMarker>());
  const pick = useRef(onPick);
  pick.current = onPick;
  const current = useRef(active);
  current.current = active;

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((L) => {
      if (cancelled || !box.current) return;
      const m = L.map(box.current, { zoomControl: true, attributionControl: false }).setView(TASHKENT, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(m);
      for (const p of points) {
        const marker = L.circleMarker([p.lat, p.lon], style(p.id === current.current)).addTo(m).bindTooltip(p.name, { direction: 'top', offset: [0, -8] });
        marker.on('click', () => pick.current(p));
        markers.current.set(p.id, marker);
      }
      map.current = m;
      const selected = current.current && markers.current.get(current.current);
      if (selected) m.setView(selected.getLatLng(), 15);
      // The dialog animates in; measure again once it has its final size.
      setTimeout(() => m.invalidateSize(), 250);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    };
  }, [points]);

  useEffect(() => {
    for (const [id, marker] of markers.current) marker.setStyle(style(id === active));
    const marker = active && markers.current.get(active);
    if (marker) {
      marker.bringToFront();
      map.current?.flyTo(marker.getLatLng(), Math.max(map.current.getZoom(), 15), { duration: 0.6 });
    }
  }, [active]);

  return <div ref={box} className="size-full bg-muted" aria-label="Карта пунктов выдачи" />;
}
