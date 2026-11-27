'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { storefrontContentSchema, type Panel, type StorefrontContent } from '@repo/shared';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../../lib/api';
import { Async, Card, Check, ErrorLine, PageHead, Select, TextArea, TextField, errText, fromMinor, toMinor, useLoad } from '../../kit';
import { MediaPicker, useLibrary } from '../../media-lib';
import { useOrg } from '../../org-context';

type Doc = StorefrontContent;
type Sections = Doc['sections'];

const ART: Panel = { type: 'art', from: '#3b3f46', to: '#16181b', alt: '' };
const TRUST_ICONS = { truck: 'Доставка', shield: 'Гарантия', returns: 'Возврат', globe: 'По всему миру' };

const DEFAULTS: Doc = {
  settings: { freeShippingThresholdMinor: null, shippingFlatMinor: 0, trust: [], paymentBadges: [], footer: { menu: [], help: [], socials: [] } },
  sections: {
    hero: { enabled: false, eyebrow: '', title: 'Новая коллекция', subtitle: '', panels: [ART] },
    featured: { enabled: false, title: 'Выбор сезона', subtitle: '', productSlugs: [] },
    grid: { enabled: false, title: 'Новинки', collection: '' },
    drop: { enabled: false, eyebrow: 'Следующий дроп', title: 'Скоро', endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), panel: ART },
    collections: { enabled: false, slugs: [] },
    social: { enabled: false, handle: '', panels: [] },
  },
  testimonials: [],
  playlist: [],
  lookbook: null,
};

/** The API returns `null` for sections the brand never saved; fill them from defaults. */
function withDefaults(raw: { settings: Doc['settings'] | null; sections: Record<string, unknown>; testimonials: Doc['testimonials']; playlist: Doc['playlist']; lookbook: Doc['lookbook'] }): Doc {
  const s = raw.sections as Partial<Sections>;
  return {
    settings: { ...DEFAULTS.settings, ...raw.settings },
    sections: { hero: s.hero ?? DEFAULTS.sections.hero, featured: s.featured ?? DEFAULTS.sections.featured, grid: s.grid ?? DEFAULTS.sections.grid, drop: s.drop ?? DEFAULTS.sections.drop, collections: s.collections ?? DEFAULTS.sections.collections, social: s.social ?? DEFAULTS.sections.social },
    testimonials: raw.testimonials,
    playlist: raw.playlist,
    lookbook: raw.lookbook,
  };
}

// "Label | /path" lines ⇄ link objects
const linesToLinks = (text: string, key: 'path' | 'href') =>
  text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [label = '', target = ''] = l.split('|').map((p) => p.trim()); return { label, [key]: target }; });
const linksToLines = (links: Record<string, string>[], key: string) => links.map((l) => `${l.label} | ${l[key]}`).join('\n');

function Block({ title, enabled, onEnabled, children }: { title: string; enabled?: boolean; onEnabled?: (v: boolean) => void; children: ReactNode }) {
  return (
    <Card title={title} actions={onEnabled ? <Check label="Показывать" checked={!!enabled} onChange={onEnabled} /> : undefined}>
      <div className="flex flex-col gap-3">{children}</div>
    </Card>
  );
}

/** One editorial picture slot: shows what is there and lets the brand replace it with an uploaded image. */
function PanelEditor({ panel, onChange, onRemove }: { panel: Panel; onChange: (p: Panel) => void; onRemove?: () => void }) {
  const org = useOrg();
  const lib = useLibrary();
  return (
    <div className="flex items-start gap-3">
      {panel.type === 'image' ? <img src={panel.src} alt={panel.alt} className="size-16 rounded-sm object-cover" /> : <span className="size-16 rounded-sm" style={{ background: `linear-gradient(${panel.from}, ${panel.to})` }} title="Заглушка" />} {/* eslint-disable-line @next/next/no-img-element */}
      <div className="flex flex-col gap-1">
        <MediaPicker
          orgId={org.id}
          selected={[]}
          multiple={false}
          onChange={([id]) => {
            const m = lib.data?.items.find((x) => x.id === id);
            if (m?.url) onChange({ type: 'image', src: m.url, alt: m.alt ?? '' });
          }}
        />
        {panel.type === 'image' && <TextField label="Описание фото" value={panel.alt} onChange={(alt) => onChange({ ...panel, alt })} />}
        {onRemove && <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onRemove}>Убрать</Button>}
      </div>
    </div>
  );
}

function Panels({ panels, onChange, max }: { panels: Panel[]; onChange: (p: Panel[]) => void; max: number }) {
  return (
    <div className="flex flex-col gap-3">
      {panels.map((p, i) => <PanelEditor key={i} panel={p} onChange={(x) => onChange(panels.map((y, j) => (j === i ? x : y)))} onRemove={panels.length > 0 ? () => onChange(panels.filter((_, j) => j !== i)) : undefined} />)}
      {panels.length < max && <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...panels, ART])}>+ Добавить фото</Button>}
    </div>
  );
}

function Editor({ initial }: { initial: Doc }) {
  const org = useOrg();
  const [doc, setDoc] = useState<Doc>(initial);
  const [threshold, setThreshold] = useState(fromMinor(initial.settings.freeShippingThresholdMinor));
  const [flat, setFlat] = useState(fromMinor(initial.settings.shippingFlatMinor));
  const [badges] = useState(initial.settings.paymentBadges.join(', '));
  const [menu, setMenu] = useState(linksToLines(initial.settings.footer.menu, 'path'));
  const [help, setHelp] = useState(linksToLines(initial.settings.footer.help, 'path'));
  const [socials] = useState(linksToLines(initial.settings.footer.socials, 'href')); // no longer edited or shown; kept as saved
  const [dropAt, setDropAt] = useState(initial.sections.drop.endsAt.slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const products = useLoad<{ items: { slug: string; title: string }[] }>(`/organizations/${org.id}/products?pageSize=100&status=ACTIVE`);
  const collections = useLoad<{ slug: string; title: string }[]>(`/organizations/${org.id}/collections`);
  const sec = doc.sections;
  const setSec = <K extends keyof Sections>(key: K, patch: Partial<Sections[K]>) => setDoc((d) => ({ ...d, sections: { ...d.sections, [key]: { ...d.sections[key], ...patch } } }));

  useEffect(() => setSaved(false), [doc, threshold, flat, badges, menu, help, socials, dropAt]);

  async function save() {
    setError(null);
    const thresholdMinor = threshold.trim() ? toMinor(threshold) : null;
    const flatMinor = flat.trim() ? toMinor(flat) : 0;
    if ((threshold.trim() && thresholdMinor === null) || flatMinor === null) return setError('Суммы доставки пишите так: 150 или 9.90.');
    const endsAt = new Date(dropAt);
    const candidate: Doc = {
      ...doc,
      settings: {
        freeShippingThresholdMinor: thresholdMinor,
        shippingFlatMinor: flatMinor,
        trust: doc.settings.trust,
        paymentBadges: badges.split(',').map((b) => b.trim()).filter(Boolean),
        footer: { menu: linesToLinks(menu, 'path') as Doc['settings']['footer']['menu'], help: linesToLinks(help, 'path') as Doc['settings']['footer']['help'], socials: linesToLinks(socials, 'href') as Doc['settings']['footer']['socials'] },
      },
      sections: { ...doc.sections, drop: { ...doc.sections.drop, endsAt: Number.isNaN(endsAt.getTime()) ? doc.sections.drop.endsAt : endsAt.toISOString() } },
    };
    const parsed = storefrontContentSchema.safeParse(candidate);
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join(' · '));
    setBusy(true);
    try {
      await api(`/organizations/${org.id}/storefront`, { method: 'PUT', body: parsed.data });
      setSaved(true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const lb = doc.lookbook;
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Block title="Доставка">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={`Бесплатная доставка от (${org.currency})`} value={threshold} onChange={setThreshold} hint="Пусто — всегда платная" />
          <TextField label={`Стоимость доставки (${org.currency})`} value={flat} onChange={setFlat} hint="Если заказ дешевле порога" />
        </div>
      </Block>

      <Block title="Подвал сайта">
        <div className="grid gap-3 md:grid-cols-2">
          <TextArea label="Меню" rows={4} value={menu} onChange={setMenu} hint="По одной в строке: Название | /collections/new" />
          <TextArea label="Помощь" rows={4} value={help} onChange={setHelp} hint="Название | /pages/shipping" />
        </div>
        <p className="text-[11px] text-muted-foreground">Внизу сайта показывается значок Telegram — он открывает магазин в боте из Настроек.</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="label-xs mb-1">Преимущества магазина (до 4)</legend>
          {doc.settings.trust.map((t, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[8rem_1fr_2fr_auto]">
              <Select label="Иконка" value={t.icon} onChange={(icon) => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: d.settings.trust.map((x, j) => (j === i ? { ...x, icon: icon as typeof t.icon } : x)) } }))} options={Object.entries(TRUST_ICONS).map(([value, label]) => ({ value, label }))} />
              <TextField label="Заголовок" value={t.title} onChange={(title) => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: d.settings.trust.map((x, j) => (j === i ? { ...x, title } : x)) } }))} />
              <TextField label="Текст" value={t.text} onChange={(text) => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: d.settings.trust.map((x, j) => (j === i ? { ...x, text } : x)) } }))} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: d.settings.trust.filter((_, j) => j !== i) } }))}>✕</Button>
            </div>
          ))}
          {doc.settings.trust.length < 4 && <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: [...d.settings.trust, { icon: 'truck', title: '', text: '' }] } }))}>+ Добавить</Button>}
        </fieldset>
      </Block>

      <Block title="Баннер вверху главной" enabled={sec.hero.enabled} onEnabled={(enabled) => setSec('hero', { enabled })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Заголовок" value={sec.hero.title} onChange={(title) => setSec('hero', { title })} />
        </div>
        <Panels panels={sec.hero.panels} max={5} onChange={(panels) => setSec('hero', { panels: panels.length ? panels : [ART] })} />
      </Block>

      <Block title="Избранные товары" enabled={sec.featured.enabled} onEnabled={(enabled) => setSec('featured', { enabled })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Заголовок" value={sec.featured.title} onChange={(title) => setSec('featured', { title })} />
          <TextField label="Подзаголовок" value={sec.featured.subtitle} onChange={(subtitle) => setSec('featured', { subtitle })} />
        </div>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="label-xs mb-1">Товары (до 12)</legend>
          {(products.data?.items ?? []).map((p) => <Check key={p.slug} label={p.title} checked={sec.featured.productSlugs.includes(p.slug)} onChange={(on) => setSec('featured', { productSlugs: on ? [...sec.featured.productSlugs, p.slug].slice(0, 12) : sec.featured.productSlugs.filter((s) => s !== p.slug) })} />)}
        </fieldset>
      </Block>

      <Block title="Сетка товаров из коллекции" enabled={sec.grid.enabled} onEnabled={(enabled) => setSec('grid', { enabled })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Заголовок" value={sec.grid.title} onChange={(title) => setSec('grid', { title })} />
          <Select label="Коллекция" value={sec.grid.collection} onChange={(collection) => setSec('grid', { collection })} options={[{ value: '', label: 'Выберите…' }, ...(collections.data ?? []).map((c) => ({ value: c.slug, label: c.title }))]} />
        </div>
      </Block>

      <details className="mb-6">
        <summary className="mb-4 cursor-pointer text-xs text-muted-foreground">Дополнительные блоки: отсчёт до дропа, соцсети, отзывы, лукбук</summary>
      <Block title="Отсчёт до дропа" enabled={sec.drop.enabled} onEnabled={(enabled) => setSec('drop', { enabled })}>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Надзаголовок" value={sec.drop.eyebrow} onChange={(eyebrow) => setSec('drop', { eyebrow })} />
          <TextField label="Заголовок" value={sec.drop.title} onChange={(title) => setSec('drop', { title })} />
          <TextField label="Когда закончится" type="datetime-local" value={dropAt} onChange={setDropAt} />
        </div>
        <PanelEditor panel={sec.drop.panel} onChange={(panel) => setSec('drop', { panel })} />
      </Block>

      <Block title="Плитки коллекций" enabled={sec.collections.enabled} onEnabled={(enabled) => setSec('collections', { enabled })}>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="label-xs mb-1">Коллекции (до 8)</legend>
          {(collections.data ?? []).map((c) => <Check key={c.slug} label={c.title} checked={sec.collections.slugs.includes(c.slug)} onChange={(on) => setSec('collections', { slugs: on ? [...sec.collections.slugs, c.slug].slice(0, 8) : sec.collections.slugs.filter((s) => s !== c.slug) })} />)}
        </fieldset>
      </Block>

      <Block title="Лента соцсетей" enabled={sec.social.enabled} onEnabled={(enabled) => setSec('social', { enabled })}>
        <TextField label="Аккаунт" value={sec.social.handle} onChange={(handle) => setSec('social', { handle })} placeholder="@yourbrand" />
        <Panels panels={sec.social.panels} max={10} onChange={(panels) => setSec('social', { panels })} />
      </Block>

      <Block title="Отзывы">
        {doc.testimonials.map((t, i) => (
          <div key={i} className="grid items-start gap-2 sm:grid-cols-[10rem_8rem_1fr_auto]">
            <TextField label="Автор" value={t.author} onChange={(author) => setDoc((d) => ({ ...d, testimonials: d.testimonials.map((x, j) => (j === i ? { ...x, author } : x)) }))} />
            <TextField label="Город" value={t.location} onChange={(location) => setDoc((d) => ({ ...d, testimonials: d.testimonials.map((x, j) => (j === i ? { ...x, location } : x)) }))} />
            <TextArea label="Отзыв" rows={2} value={t.quote} onChange={(quote) => setDoc((d) => ({ ...d, testimonials: d.testimonials.map((x, j) => (j === i ? { ...x, quote } : x)) }))} />
            <Button type="button" variant="ghost" size="sm" className="mt-5" onClick={() => setDoc((d) => ({ ...d, testimonials: d.testimonials.filter((_, j) => j !== i) }))}>✕</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setDoc((d) => ({ ...d, testimonials: [...d.testimonials, { author: '', location: '', quote: '' }] }))}>+ Добавить отзыв</Button>
      </Block>

      <Block title="Лукбук" enabled={!!lb} onEnabled={(on) => setDoc((d) => ({ ...d, lookbook: on ? { title: 'Lookbook', subtitle: '', items: [] } : null }))}>
        {lb && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Заголовок" value={lb.title} onChange={(title) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, title } }))} />
              <TextField label="Подзаголовок" value={lb.subtitle} onChange={(subtitle) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, subtitle } }))} />
            </div>
            {lb.items.map((it, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <MediaPicker orgId={org.id} selected={[it.mediaId]} multiple={false} onChange={([id]) => id && setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.map((x, j) => (j === i ? { ...x, mediaId: id } : x)) } }))} />
                <div className="grid gap-2 sm:grid-cols-3">
                  <TextField label="Тег" value={it.tag} onChange={(tag) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.map((x, j) => (j === i ? { ...x, tag } : x)) } }))} />
                  <TextField label="Заголовок" value={it.title} onChange={(title) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.map((x, j) => (j === i ? { ...x, title } : x)) } }))} />
                  <TextField label="Подпись" value={it.caption} onChange={(caption) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.map((x, j) => (j === i ? { ...x, caption } : x)) } }))} />
                </div>
                <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.filter((_, j) => j !== i) } }))}>Убрать</Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">Чтобы добавить фото, выберите или загрузите его ниже.</p>
            <NewLookbookItem orgId={org.id} onAdd={(mediaId) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: [...d.lookbook.items, { mediaId, tag: '', title: '', caption: '' }] } }))} />
          </>
        )}
      </Block>
      </details>

      <ErrorLine error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить витрину'}</Button>
        {saved && <span role="status" className="text-xs">Сохранено. Изменения появятся в магазине в течение нескольких минут.</span>}
      </div>
    </form>
  );
}

function NewLookbookItem({ orgId, onAdd }: { orgId: string; onAdd: (mediaId: string) => void }) {
  return <MediaPicker orgId={orgId} selected={[]} multiple={false} onChange={([id]) => id && onAdd(id)} />;
}

export default function StorefrontPage() {
  const org = useOrg();
  const content = useLoad<Parameters<typeof withDefaults>[0]>(`/organizations/${org.id}/storefront`);
  return (
    <>
      <PageHead title="Витрина" subtitle="Что покупатели видят на главной странице магазина и внизу сайта." />
      <Async state={content}>{(c) => <Editor initial={withDefaults(c)} />}</Async>
    </>
  );
}
