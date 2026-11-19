'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { PaymentBadges } from './primitives';
import { useStore } from './store-context';

const newsletterSchema = z.object({
  email: z.email('Enter a valid email'),
  consent: z.boolean().refine(Boolean, 'Please accept to subscribe'),
});
type NewsletterValues = z.infer<typeof newsletterSchema>;

function Newsletter({ onSubscribe }: { onSubscribe?: (email: string) => Promise<void> }) {
  const [status, setStatus] = useState<'idle' | 'done' | 'offline'>('idle');
  const form = useForm<NewsletterValues>({
    resolver: zodResolver(newsletterSchema),
    defaultValues: { email: '', consent: false },
  });
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async ({ email }) => {
    if (!onSubscribe) return setStatus('offline');
    await onSubscribe(email);
    setStatus('done');
  });

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-3">
      <h3 className="title-xl text-lg">Stay in the loop</h3>
      <p className="text-xs text-muted-foreground">Drops, restocks and early access — straight to your inbox.</p>
      <div className="flex gap-2">
        <input
          type="email"
          autoComplete="email"
          placeholder="Email address"
          aria-label="Email address"
          aria-invalid={!!errors.email}
          {...form.register('email')}
          className="h-11 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:border-foreground aria-invalid:border-destructive"
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Subscribe
        </Button>
      </div>
      <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <Checkbox
          checked={form.watch('consent')}
          onCheckedChange={(v) => form.setValue('consent', v === true, { shouldValidate: form.formState.isSubmitted })}
          aria-invalid={!!errors.consent}
          className="mt-px"
        />
        I agree to receive marketing emails and accept the privacy policy.
      </label>
      <p role="status" className="min-h-4 text-[11px]">
        {errors.email?.message ?? errors.consent?.message ?? (status === 'done' ? 'You are subscribed.' : status === 'offline' ? 'Newsletter is not connected yet (phase 8).' : '')}
      </p>
    </form>
  );
}

function Testimonials() {
  const { store } = useStore();
  const [i, setI] = useState(0);
  const items = store.testimonials;
  const t = items[i];
  if (!t) return null; // a new store has no reviews yet
  const go = (d: number) => setI((i + d + items.length) % items.length);

  return (
    <section aria-labelledby="reviews-title">
      <p className="label-xs text-muted-foreground">Reviews</p>
      <h2 id="reviews-title" className="title-xl mt-1 text-2xl sm:text-3xl">
        What they say
      </h2>
      <figure className="mt-6 border-t border-border pt-5" aria-live="polite">
        <blockquote className="text-sm leading-relaxed sm:text-base">“{t.quote}”</blockquote>
        <figcaption className="label-xs mt-4 flex items-center justify-between">
          <span>
            <b>{t.author}</b> <span className="text-muted-foreground">· {t.location}</span>
          </span>
          <span className="flex items-center gap-1">
            <button type="button" aria-label="Previous review" onClick={() => go(-1)} className="p-1 hover:opacity-60">
              <ArrowLeft className="size-3.5" />
            </button>
            <span className="tabular-nums text-muted-foreground">
              {i + 1}/{items.length}
            </span>
            <button type="button" aria-label="Next review" onClick={() => go(1)} className="p-1 hover:opacity-60">
              <ArrowRight className="size-3.5" />
            </button>
          </span>
        </figcaption>
      </figure>
    </section>
  );
}

export function Footer({ onSubscribe }: { onSubscribe?: (email: string) => Promise<void> }) {
  const { store, href } = useStore();
  const linkCls = 'text-xs text-muted-foreground transition-colors hover:text-foreground';

  return (
    <footer className="mt-24 overflow-hidden border-t border-border pt-14">
      <div className="grid gap-12 px-page md:grid-cols-12">
        <div className="md:col-span-6">
          <Testimonials />
        </div>
        <div className="flex flex-col gap-8 md:col-span-5 md:col-start-8">
          <div>
            <h3 className="label-xs font-bold">Early access, giveaways &amp; specials</h3>
            <p className="mt-2 text-xs text-muted-foreground">Members hear about every drop 24 hours before everyone else.</p>
          </div>
          <div>
            <h3 className="label-xs font-bold">Follow us</h3>
            <ul className="mt-2 flex gap-4">
              {store.footer.socials.map((s) => (
                <li key={s.label}>
                  <a href={s.href} target="_blank" rel="noreferrer" className={linkCls}>
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="md:col-span-6">
          <Newsletter onSubscribe={onSubscribe} />
        </div>
        <nav aria-label="Shop" className="md:col-span-2 md:col-start-8">
          <h3 className="label-xs font-bold">Menu</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {store.footer.menu.map((l) => (
              <li key={l.label}>
                <Link href={href(l.path)} className={linkCls}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Help" className="md:col-span-2">
          <h3 className="label-xs font-bold">Help</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {store.footer.help.map((l) => (
              <li key={l.label}>
                <Link href={href(l.path)} className={linkCls}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="mt-14 flex flex-wrap items-center justify-between gap-4 border-t border-border px-page py-5">
        <p className="label-xs text-muted-foreground">
          © {store.name}. All rights reserved.
        </p>
        <PaymentBadges badges={store.paymentBadges} />
      </div>

      <p
        aria-hidden
        className="title-xl -mb-[0.2em] select-none whitespace-nowrap text-center text-[23vw] leading-[0.8] tracking-tighter"
      >
        {store.name}
      </p>
    </footer>
  );
}
