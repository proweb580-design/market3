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

const DEFAULTS: Doc = {
  settings: { freeShippingThresholdMinor: null, shippingFlatMinor: 0, trust: [], paymentBadges: [], footer: { menu: [], help: [], socials: [] } },
  sections: {
    hero: { enabled: false, eyebrow: '', title: 'New collection', subtitle: '', panels: [ART] },
    featured: { enabled: false, title: 'Featured', subtitle: '', productSlugs: [] },
    grid: { enabled: false, title: 'New in', collection: '' },
    drop: { enabled: false, eyebrow: 'Next drop', title: 'Coming soon', endsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), panel: ART },
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
    <Card title={title} actions={onEnabled ? <Check label="Show on the store" checked={!!enabled} onChange={onEnabled} /> : undefined}>
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
      {panel.type === 'image' ? <img src={panel.src} alt={panel.alt} className="size-16 rounded-sm object-cover" /> : <span className="size-16 rounded-sm" style={{ background: `linear-gradient(${panel.from}, ${panel.to})` }} title="Placeholder artwork" />} {/* eslint-disable-line @next/next/no-img-element */}
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
        {panel.type === 'image' && <TextField label="Description (alt text)" value={panel.alt} onChange={(alt) => onChange({ ...panel, alt })} />}
        {onRemove && <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onRemove}>Remove</Button>}
      </div>
    </div>
  );
}

function Panels({ panels, onChange, max }: { panels: Panel[]; onChange: (p: Panel[]) => void; max: number }) {
  return (
    <div className="flex flex-col gap-3">
      {panels.map((p, i) => <PanelEditor key={i} panel={p} onChange={(x) => onChange(panels.map((y, j) => (j === i ? x : y)))} onRemove={panels.length > 0 ? () => onChange(panels.filter((_, j) => j !== i)) : undefined} />)}
      {panels.length < max && <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange([...panels, ART])}>Add picture</Button>}
    </div>
  );
}

function Editor({ initial }: { initial: Doc }) {
  const org = useOrg();
  const [doc, setDoc] = useState<Doc>(initial);
  const [threshold, setThreshold] = useState(fromMinor(initial.settings.freeShippingThresholdMinor));
  const [flat, setFlat] = useState(fromMinor(initial.settings.shippingFlatMinor));
  const [badges, setBadges] = useState(initial.settings.paymentBadges.join(', '));
  const [menu, setMenu] = useState(linksToLines(initial.settings.footer.menu, 'path'));
  const [help, setHelp] = useState(linksToLines(initial.settings.footer.help, 'path'));
  const [socials, setSocials] = useState(linksToLines(initial.settings.footer.socials, 'href'));
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
    if ((threshold.trim() && thresholdMinor === null) || flatMinor === null) return setError('Shipping amounts must look like 150 or 9.90.');
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
      <Block title="Shipping and footer">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label={`Free shipping from (${org.currency})`} value={threshold} onChange={setThreshold} hint="Empty = never free" />
          <TextField label={`Flat shipping fee (${org.currency})`} value={flat} onChange={setFlat} hint="Charged below the threshold" />
          <TextField label="Payment badges" value={badges} onChange={setBadges} hint="Comma separated: Visa, Mastercard" />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <TextArea label="Menu links" rows={4} value={menu} onChange={setMenu} hint="One per line: Label | /collections/new" />
          <TextArea label="Help links" rows={4} value={help} onChange={setHelp} hint="Label | /pages/shipping" />
          <TextArea label="Social links" rows={4} value={socials} onChange={setSocials} hint="Instagram | https://instagram.com/…" />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="label-xs mb-1">Reassurance bar (up to 4)</legend>
          {doc.settings.trust.map((t, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[8rem_1fr_2fr_auto]">
              <Select label="Icon" value={t.icon} onChange={(icon) => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: d.settings.trust.map((x, j) => (j === i ? { ...x, icon: icon as typeof t.icon } : x)) } }))} options={['truck', 'shield', 'returns', 'globe'].map((v) => ({ value: v, label: v }))} />
              <TextField label="Title" value={t.title} onChange={(title) => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: d.settings.trust.map((x, j) => (j === i ? { ...x, title } : x)) } }))} />
              <TextField label="Text" value={t.text} onChange={(text) => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: d.settings.trust.map((x, j) => (j === i ? { ...x, text } : x)) } }))} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: d.settings.trust.filter((_, j) => j !== i) } }))}>✕</Button>
            </div>
          ))}
          {doc.settings.trust.length < 4 && <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setDoc((d) => ({ ...d, settings: { ...d.settings, trust: [...d.settings.trust, { icon: 'truck', title: '', text: '' }] } }))}>Add</Button>}
        </fieldset>
      </Block>

      <Block title="Banner (top of the home page)" enabled={sec.hero.enabled} onEnabled={(enabled) => setSec('hero', { enabled })}>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Small heading" value={sec.hero.eyebrow} onChange={(eyebrow) => setSec('hero', { eyebrow })} />
          <TextField label="Title" value={sec.hero.title} onChange={(title) => setSec('hero', { title })} />
          <TextField label="Subtitle" value={sec.hero.subtitle} onChange={(subtitle) => setSec('hero', { subtitle })} />
        </div>
        <Panels panels={sec.hero.panels} max={5} onChange={(panels) => setSec('hero', { panels: panels.length ? panels : [ART] })} />
      </Block>

      <Block title="Featured products" enabled={sec.featured.enabled} onEnabled={(enabled) => setSec('featured', { enabled })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Title" value={sec.featured.title} onChange={(title) => setSec('featured', { title })} />
          <TextField label="Subtitle" value={sec.featured.subtitle} onChange={(subtitle) => setSec('featured', { subtitle })} />
        </div>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="label-xs mb-1">Products (up to 12)</legend>
          {(products.data?.items ?? []).map((p) => <Check key={p.slug} label={p.title} checked={sec.featured.productSlugs.includes(p.slug)} onChange={(on) => setSec('featured', { productSlugs: on ? [...sec.featured.productSlugs, p.slug].slice(0, 12) : sec.featured.productSlugs.filter((s) => s !== p.slug) })} />)}
        </fieldset>
      </Block>

      <Block title="Product grid" enabled={sec.grid.enabled} onEnabled={(enabled) => setSec('grid', { enabled })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Title" value={sec.grid.title} onChange={(title) => setSec('grid', { title })} />
          <Select label="Collection" value={sec.grid.collection} onChange={(collection) => setSec('grid', { collection })} options={[{ value: '', label: 'Choose…' }, ...(collections.data ?? []).map((c) => ({ value: c.slug, label: c.title }))]} />
        </div>
      </Block>

      <Block title="Drop countdown" enabled={sec.drop.enabled} onEnabled={(enabled) => setSec('drop', { enabled })}>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Small heading" value={sec.drop.eyebrow} onChange={(eyebrow) => setSec('drop', { eyebrow })} />
          <TextField label="Title" value={sec.drop.title} onChange={(title) => setSec('drop', { title })} />
          <TextField label="Ends at" type="datetime-local" value={dropAt} onChange={setDropAt} />
        </div>
        <PanelEditor panel={sec.drop.panel} onChange={(panel) => setSec('drop', { panel })} />
        <p className="text-[11px] text-muted-foreground">Needs a plan with the drop countdown.</p>
      </Block>

      <Block title="Collection tiles" enabled={sec.collections.enabled} onEnabled={(enabled) => setSec('collections', { enabled })}>
        <fieldset className="grid gap-1 sm:grid-cols-2">
          <legend className="label-xs mb-1">Collections (up to 8)</legend>
          {(collections.data ?? []).map((c) => <Check key={c.slug} label={c.title} checked={sec.collections.slugs.includes(c.slug)} onChange={(on) => setSec('collections', { slugs: on ? [...sec.collections.slugs, c.slug].slice(0, 8) : sec.collections.slugs.filter((s) => s !== c.slug) })} />)}
        </fieldset>
      </Block>

      <Block title="Social feed" enabled={sec.social.enabled} onEnabled={(enabled) => setSec('social', { enabled })}>
        <TextField label="Handle" value={sec.social.handle} onChange={(handle) => setSec('social', { handle })} placeholder="@yourbrand" />
        <Panels panels={sec.social.panels} max={10} onChange={(panels) => setSec('social', { panels })} />
      </Block>

      <Block title="Reviews">
        {doc.testimonials.map((t, i) => (
          <div key={i} className="grid items-start gap-2 sm:grid-cols-[10rem_8rem_1fr_auto]">
            <TextField label="Author" value={t.author} onChange={(author) => setDoc((d) => ({ ...d, testimonials: d.testimonials.map((x, j) => (j === i ? { ...x, author } : x)) }))} />
            <TextField label="Place" value={t.location} onChange={(location) => setDoc((d) => ({ ...d, testimonials: d.testimonials.map((x, j) => (j === i ? { ...x, location } : x)) }))} />
            <TextArea label="Quote" rows={2} value={t.quote} onChange={(quote) => setDoc((d) => ({ ...d, testimonials: d.testimonials.map((x, j) => (j === i ? { ...x, quote } : x)) }))} />
            <Button type="button" variant="ghost" size="sm" className="mt-5" onClick={() => setDoc((d) => ({ ...d, testimonials: d.testimonials.filter((_, j) => j !== i) }))}>✕</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setDoc((d) => ({ ...d, testimonials: [...d.testimonials, { author: '', location: '', quote: '' }] }))}>Add review</Button>
      </Block>

      <Block title="Music player">
        <p className="text-[11px] text-muted-foreground">Needs a plan with the music player. Upload audio in the Media section or here.</p>
        {doc.playlist.map((t, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <TextField label="Title" value={t.title} onChange={(title) => setDoc((d) => ({ ...d, playlist: d.playlist.map((x, j) => (j === i ? { ...x, title } : x)) }))} />
              <TextField label="Artist" value={t.artist} onChange={(artist) => setDoc((d) => ({ ...d, playlist: d.playlist.map((x, j) => (j === i ? { ...x, artist } : x)) }))} />
              <TextField label="Length (seconds)" type="number" value={String(t.durationSec)} onChange={(v) => setDoc((d) => ({ ...d, playlist: d.playlist.map((x, j) => (j === i ? { ...x, durationSec: Number(v) || 1 } : x)) }))} />
            </div>
            <p className="label-xs">Cover</p>
            <MediaPicker orgId={org.id} selected={t.coverMediaId ? [t.coverMediaId] : []} multiple={false} onChange={([id]) => setDoc((d) => ({ ...d, playlist: d.playlist.map((x, j) => (j === i ? { ...x, coverMediaId: id ?? null } : x)) }))} />
            <p className="label-xs">Audio</p>
            <MediaPicker orgId={org.id} kind="audio" selected={t.audioMediaId ? [t.audioMediaId] : []} multiple={false} onChange={([id]) => setDoc((d) => ({ ...d, playlist: d.playlist.map((x, j) => (j === i ? { ...x, audioMediaId: id ?? null } : x)) }))} />
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setDoc((d) => ({ ...d, playlist: d.playlist.filter((_, j) => j !== i) }))}>Remove track</Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setDoc((d) => ({ ...d, playlist: [...d.playlist, { title: '', artist: '', durationSec: 180, coverMediaId: null, audioMediaId: null }] }))}>Add track</Button>
      </Block>

      <Block title="Lookbook" enabled={!!lb} onEnabled={(on) => setDoc((d) => ({ ...d, lookbook: on ? { title: 'Lookbook', subtitle: '', items: [] } : null }))}>
        {lb && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Title" value={lb.title} onChange={(title) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, title } }))} />
              <TextField label="Subtitle" value={lb.subtitle} onChange={(subtitle) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, subtitle } }))} />
            </div>
            {lb.items.map((it, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
                <MediaPicker orgId={org.id} selected={[it.mediaId]} multiple={false} onChange={([id]) => id && setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.map((x, j) => (j === i ? { ...x, mediaId: id } : x)) } }))} />
                <div className="grid gap-2 sm:grid-cols-3">
                  <TextField label="Tag" value={it.tag} onChange={(tag) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.map((x, j) => (j === i ? { ...x, tag } : x)) } }))} />
                  <TextField label="Title" value={it.title} onChange={(title) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.map((x, j) => (j === i ? { ...x, title } : x)) } }))} />
                  <TextField label="Caption" value={it.caption} onChange={(caption) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.map((x, j) => (j === i ? { ...x, caption } : x)) } }))} />
                </div>
                <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: d.lookbook.items.filter((_, j) => j !== i) } }))}>Remove</Button>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground">To add a photo, upload it in Media first, then pick it for a new item below.</p>
            <NewLookbookItem orgId={org.id} onAdd={(mediaId) => setDoc((d) => ({ ...d, lookbook: d.lookbook && { ...d.lookbook, items: [...d.lookbook.items, { mediaId, tag: '', title: '', caption: '' }] } }))} />
            <p className="text-[11px] text-muted-foreground">Needs a plan with the lookbook.</p>
          </>
        )}
      </Block>

      <ErrorLine error={error} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save storefront'}</Button>
        {saved && <span role="status" className="text-xs">Saved. Changes appear on the store within a few minutes.</span>}
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
      <PageHead title="Storefront" subtitle="What shoppers see on the home page and in the footer." />
      <Async state={content}>{(c) => <Editor initial={withDefaults(c)} />}</Async>
    </>
  );
}
