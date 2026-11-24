'use client';

import { supportMessageSchema, type SupportMessage } from '@repo/shared';
import { CheckCircle2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { cn } from '../lib/utils';
import { CheckoutError, sendSupportMessage } from './checkout-client';
import { useStore } from './store-context';

const TOPICS: { value: SupportMessage['topic']; label: string }[] = [
  { value: 'order', label: 'Заказ' },
  { value: 'delivery', label: 'Доставка' },
  { value: 'returns', label: 'Возврат' },
  { value: 'product', label: 'Товар' },
  { value: 'other', label: 'Другое' },
];

const field = 'h-11 rounded-xl bg-background';

/** /pages/support: a form whose message reaches the store team in Telegram. */
export function SupportView() {
  const { store } = useStore();
  const [topic, setTopic] = useState<SupportMessage['topic']>('order');
  const [invalid, setInvalid] = useState<Partial<Record<keyof SupportMessage, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const orderNumber = String(data.get('orderNumber') ?? '').trim();
    const parsed = supportMessageSchema.safeParse({
      name: data.get('name'),
      email: data.get('email'),
      message: data.get('message'),
      topic,
      ...(orderNumber ? { orderNumber } : {}),
    });
    if (!parsed.success) {
      setInvalid(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], true])));
      return;
    }
    setInvalid({});
    setError(null);
    setBusy(true);
    try {
      await sendSupportMessage(store.slug, parsed.data);
      setSent(true);
    } catch (err) {
      setError(
        err instanceof CheckoutError && err.status === 429
          ? 'Слишком много сообщений. Попробуйте через минуту.'
          : 'Не удалось отправить сообщение. Попробуйте позже.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-page mx-auto max-w-2xl pt-10 pb-16">
      <p className="label-xs text-muted-foreground">Помощь</p>
      <h1 className="title-xl mt-1 text-4xl sm:text-6xl">Поддержка</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Вопрос по заказу, доставке или товару? Напишите нам — сообщение сразу придёт команде {store.name}, ответим на почту в течение рабочего дня.
      </p>

      {sent ? (
        <div role="status" className="mt-10 flex flex-col items-center gap-3 rounded-2xl bg-muted p-10 text-center animate-in fade-in duration-300">
          <CheckCircle2 className="size-10" strokeWidth={1.5} />
          <p className="font-medium">Сообщение отправлено</p>
          <p className="text-sm text-muted-foreground">Спасибо! Мы ответим на указанную почту.</p>
          <Button variant="outline" className="mt-2 rounded-xl" onClick={() => setSent(false)}>
            Написать ещё
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="mt-10 flex flex-col gap-5">
          <fieldset>
            <legend className="text-xs text-muted-foreground">Тема</legend>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup">
              {TOPICS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={topic === t.value}
                  onClick={() => setTopic(t.value)}
                  className={cn(
                    'rounded-full border px-4 py-1.5 text-sm transition-colors',
                    topic === t.value ? 'border-foreground bg-foreground text-background' : 'border-border hover:border-foreground',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sp-name" className="text-xs text-muted-foreground">Имя</Label>
              <Input id="sp-name" name="name" autoComplete="name" aria-invalid={invalid.name} className={field} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sp-email" className="text-xs text-muted-foreground">Email для ответа</Label>
              <Input id="sp-email" name="email" type="email" autoComplete="email" aria-invalid={invalid.email} className={field} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sp-order" className="text-xs text-muted-foreground">Номер заказа (если есть)</Label>
            <Input id="sp-order" name="orderNumber" inputMode="numeric" aria-invalid={invalid.orderNumber} className={field} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sp-message" className="text-xs text-muted-foreground">Сообщение</Label>
            <textarea
              id="sp-message"
              name="message"
              rows={6}
              maxLength={2000}
              aria-invalid={invalid.message}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
            />
          </div>

          {Object.keys(invalid).length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              Проверьте выделенные поля: имя, корректный email и сообщение от 10 символов.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="h-12 rounded-xl text-sm font-bold uppercase tracking-wide">
            {busy ? 'Отправляем…' : 'Отправить'}
          </Button>
        </form>
      )}
    </div>
  );
}
