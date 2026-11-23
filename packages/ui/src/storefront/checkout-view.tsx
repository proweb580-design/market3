'use client';

import { orderCheckoutSchema, type Quote } from '@repo/shared';
import Link from 'next/link';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ChevronRight, CreditCard, MapPin, Navigation, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { formatMoney } from '../lib/format';
import { cn } from '../lib/utils';
import { CheckoutError, placeOrder, quoteCart } from './checkout-client';
import { ProductImage } from './media';
import { PICKUP_CITY, PICKUP_POINTS, type PickupPoint } from './pickup-points';
import { QuantityStepper } from './primitives';
import { useStore, variantFor } from './store-context';

type Fields = { email: string; name: string; line1: string; city: string; postalCode: string };
const EMPTY: Fields = { email: '', name: '', line1: '', city: '', postalCode: '' };
type Field = { key: keyof Fields; label: string; autoComplete: string; type?: string };

const RECIPIENT: Field[] = [
  { key: 'name', label: 'Имя и фамилия', autoComplete: 'name' },
  { key: 'email', label: 'Эл. почта', autoComplete: 'email', type: 'email' },
];
const ADDRESS: Field[] = [
  { key: 'city', label: 'Город', autoComplete: 'address-level2' },
  { key: 'line1', label: 'Улица, дом, квартира', autoComplete: 'address-line1' },
  { key: 'postalCode', label: 'Индекс', autoComplete: 'postal-code' },
];

function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl bg-secondary p-5 sm:p-6', className)} aria-label={title}>
      {title && (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-bold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Checkout page: recipient, delivery and items on the left, totals and payment on the right.
 * The server re-prices the cart; the browser only says *what* to buy. Paying sends the buyer to the hosted payment page.
 */
export function CheckoutView() {
  const { store, cart, productBySlug, setQuantity, variant, host, href } = useStore();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [form, setForm] = useState<Fields>(EMPTY);
  const [invalid, setInvalid] = useState<Partial<Record<keyof Fields, true>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'courier' | 'pickup'>('pickup');
  const [point, setPoint] = useState<PickupPoint | null>(null);
  const [picking, setPicking] = useState(false);
  const [pointMissing, setPointMissing] = useState(false);
  // The cart is restored from storage after hydration (same commit as this effect); until then don't claim it is empty.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const rows = cart.flatMap((line) => {
    const product = productBySlug(line.productSlug);
    const v = product && variantFor(product, line.size, line.color);
    return product && v ? [{ line, product, variantId: v.id }] : [];
  });
  const lines = rows.map((r) => ({ variantId: r.variantId, quantity: r.line.quantity }));
  const linesKey = JSON.stringify(lines);

  useEffect(() => {
    if (lines.length === 0) return setQuote(null);
    let cancelled = false;
    setMessage(null);
    quoteCart(store.slug, lines)
      .then((q) => !cancelled && setQuote(q))
      .catch((e: unknown) => !cancelled && setMessage(e instanceof CheckoutError ? e.message : 'Не удалось рассчитать стоимость корзины.'));
    return () => {
      cancelled = true;
    };
    // `lines` is derived from `linesKey`; depending on the string avoids re-running on every render.
  }, [linesKey, store.slug]);

  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: quote?.currency ?? store.currency });
  const quoted = (variantId: string) => quote?.lines.find((l) => l.variantId === variantId);
  const count = cart.reduce((n, l) => n + l.quantity, 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    const missing = mode === 'pickup' && !point;
    setPointMissing(missing);
    const parsed = orderCheckoutSchema.safeParse({
      lines,
      channel: variant === 'miniapp' ? 'telegram' : 'web',
      email: form.email,
      shippingAddress:
        mode === 'pickup'
          ? // Pickup goes in the ordinary address fields, so the order and admin screens need no changes.
            {
              name: form.name,
              line1: point ? `Пункт выдачи: ${point.name}, ${point.district}` : '-',
              city: PICKUP_CITY,
              postalCode: point?.index ?? '-',
              country: 'UZ',
            }
          : { name: form.name, line1: form.line1, city: form.city, postalCode: form.postalCode, country: 'RU' },
    });
    if (!parsed.success || missing) {
      if (parsed.success) return setInvalid({});
      const next: typeof invalid = {};
      for (const issue of parsed.error.issues) {
        const key = (issue.path[0] === 'shippingAddress' ? issue.path[1] : issue.path[0]) as keyof Fields;
        if (key in EMPTY) next[key] = true;
        else setMessage(issue.message);
      }
      setInvalid(next);
      return;
    }
    setInvalid({});
    setBusy(true);
    try {
      const token = (await host?.getAuthToken()) ?? null;
      const order = await placeOrder(store.slug, parsed.data, token);
      // The cart is cleared when the order page confirms payment, so a cancelled payment keeps it.
      if (host) host.openLink(order.checkoutUrl);
      else window.location.assign(order.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof CheckoutError ? error.message : 'Что-то пошло не так. Попробуйте ещё раз.');
      // Stock may have changed: refresh the quote.
      quoteCart(store.slug, lines).then(setQuote).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const inputs = (fields: Field[]) =>
    fields.map((f) => (
      <div key={f.key} className="flex flex-col gap-1.5">
        <Label htmlFor={`co-${f.key}`} className="text-xs text-muted-foreground">
          {f.label}
        </Label>
        <Input
          id={`co-${f.key}`}
          type={f.type ?? 'text'}
          value={form[f.key]}
          autoComplete={f.autoComplete}
          aria-invalid={invalid[f.key]}
          className="h-11 rounded-xl bg-background"
          onChange={(e) => {
            setForm({ ...form, [f.key]: e.target.value });
            if (invalid[f.key]) setInvalid({ ...invalid, [f.key]: undefined });
          }}
        />
      </div>
    ));
  const sectionError = (fields: Field[], text: string) =>
    fields.some((f) => invalid[f.key]) && (
      <p role="alert" className="mt-3 text-sm text-destructive">
        {text}
      </p>
    );

  if (!mounted) return null;
  if (cart.length === 0) {
    return (
      <div className="px-page py-24 text-center">
        <h1 className="title-xl text-4xl">Корзина пуста</h1>
        <Link href={href()} className="label-xs mt-6 inline-block font-bold underline">
          Вернуться в магазин
        </Link>
      </div>
    );
  }

  return (
    <div className="px-page pb-24 pt-10">
      <h1 className="title-xl text-4xl sm:text-5xl">Оформление заказа</h1>
      <form onSubmit={submit} noValidate className="mt-8 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
        <div className="flex flex-col gap-4">
          <Panel title="Получатель">
            <div className="grid gap-3 sm:grid-cols-2">{inputs(RECIPIENT)}</div>
            {sectionError(RECIPIENT, 'Необходимо заполнить все данные получателя')}
          </Panel>

          <Panel
            title="Доставка"
            action={
              mode === 'pickup' && (
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <Navigation className="size-3.5" /> {PICKUP_CITY}
                </span>
              )
            }
          >
            <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md" role="radiogroup" aria-label="Способ доставки">
              {(
                [
                  ['pickup', 'Пункт выдачи', 'Почта, Ташкент'],
                  ['courier', 'Курьер', 'До двери'],
                ] as const
              ).map(([value, title, hint]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    'rounded-xl border bg-background px-4 py-2.5 text-left transition-colors',
                    mode === value ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-foreground/40',
                  )}
                >
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-xs text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>

            {mode === 'pickup' ? (
              <>
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  aria-invalid={pointMissing}
                  className={cn(
                    'flex w-full items-center gap-4 border-b py-3 text-left',
                    pointMissing ? 'border-destructive' : 'border-border hover:border-foreground/40',
                  )}
                >
                  <MapPin className="size-5 shrink-0" />
                  {point ? (
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{point.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {point.district}, {point.index}
                      </span>
                    </span>
                  ) : (
                    <span className="flex-1 text-sm text-muted-foreground">Пункт выдачи</span>
                  )}
                  <ChevronRight className="size-5 shrink-0" />
                </button>
                {pointMissing && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    Необходимо выбрать пункт выдачи
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr]">{inputs(ADDRESS)}</div>
                {sectionError(ADDRESS, 'Необходимо указать адрес доставки')}
              </>
            )}
          </Panel>

          <Dialog open={picking} onOpenChange={setPicking}>
            <DialogContent className="max-h-[85svh] max-w-md gap-0 overflow-y-auto rounded-2xl p-6">
              <DialogTitle className="text-lg font-bold">Пункты выдачи · {PICKUP_CITY}</DialogTitle>
              <DialogDescription className="mt-1 text-xs text-muted-foreground">Отделения почты. Заберите заказ с паспортом.</DialogDescription>
              <ul className="mt-4 flex flex-col gap-2">
                {PICKUP_POINTS.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPoint(p);
                        setPointMissing(false);
                        setPicking(false);
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                        point?.id === p.id ? 'border-foreground' : 'border-border hover:border-foreground/40',
                      )}
                    >
                      <MapPin className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.district}, {p.index}
                        </span>
                      </span>
                      {point?.id === p.id && <Check className="size-4" />}
                    </button>
                  </li>
                ))}
              </ul>
            </DialogContent>
          </Dialog>

          <Panel title={`Товары · ${count}`}>
            <ul className="divide-y divide-border">
              {rows.map(({ line, product, variantId }) => {
                const color = product.colors.find((c) => c.name === line.color) ?? product.colors[0]!;
                const q = quoted(variantId);
                return (
                  <li key={`${line.productSlug}-${line.size}-${line.color}`} className="flex gap-4 py-4 first:pt-0 last:pb-0">
                    <Link href={href(`/products/${product.slug}`)} className="w-20 shrink-0 rounded-xl bg-background p-1 sm:w-24">
                      <ProductImage media={product.media[0]!} tone={color.hex} />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{product.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {line.size} · {line.color}
                          </p>
                        </div>
                        <p className="text-sm font-bold tabular-nums">
                          {money(q ? q.totalMinor : product.price.amountMinor * line.quantity)}
                        </p>
                      </div>
                      {q && !q.ok && (
                        <p className="text-xs text-destructive">{q.available > 0 ? `Осталось ${q.available} шт.` : 'Нет в наличии'}</p>
                      )}
                      <div className="mt-auto flex items-center justify-between">
                        <QuantityStepper value={line.quantity} onChange={(n) => setQuantity(line, n)} />
                        <button
                          type="button"
                          onClick={() => setQuantity(line, 0)}
                          className="p-1 text-muted-foreground hover:text-foreground"
                          aria-label={`Удалить ${product.title}`}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Panel>
            {quote ? (
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt>Товары · {count}</dt>
                  <dd className="tabular-nums">{money(quote.subtotalMinor)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Доставка</dt>
                  <dd className="tabular-nums">{quote.shippingMinor === 0 ? 'Бесплатно' : money(quote.shippingMinor)}</dd>
                </div>
                <div className="mt-3 flex items-baseline justify-between border-t border-border pt-4">
                  <dt className="text-2xl font-bold">Итого</dt>
                  <dd className="text-2xl font-bold tabular-nums">{money(quote.totalMinor)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground" aria-busy={!message}>
                {message ? 'Итог недоступен' : 'Считаем итог…'}
              </p>
            )}
          </Panel>

          <Panel>
            <div className="flex items-center gap-4" role="radio" aria-checked="true" aria-label="Оплата картой любого банка">
              <CreditCard strokeWidth={1.5} className="size-7 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Оплата картой</p>
                <p className="text-xs text-muted-foreground">любого банка, на защищённой странице</p>
              </div>
              <span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
                <Check className="size-3.5" strokeWidth={3} />
              </span>
            </div>
          </Panel>

          {quote && !quote.ok && (
            <p role="alert" className="text-sm text-destructive">
              Некоторых товаров нет в наличии. Уменьшите количество или удалите их, чтобы продолжить.
            </p>
          )}
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <Button type="submit" size="lg" className="h-14 w-full rounded-2xl text-sm" disabled={busy || !quote?.ok}>
            {busy ? 'Переходим к оплате…' : `Оплатить ${quote ? money(quote.totalMinor) : ''}`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Нажимая «Оплатить», вы соглашаетесь с условиями продажи и политикой конфиденциальности
          </p>
        </aside>
      </form>
    </div>
  );
}
