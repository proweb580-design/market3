'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { productInputSchema } from '@repo/shared';
import { Button } from '@repo/ui/components/ui/button';
import { Input } from '@repo/ui/components/ui/input';
import { api } from '../../../../lib/api';
import { ActionButton, Card, Check, ErrorLine, Select, TextArea, TextField, errText, fromMinor, slugify, toMinor, useLoad } from '../../kit';
import { MediaPicker } from '../../media-lib';
import { useOrg } from '../../org-context';

export interface ProductDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  label: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  gender: 'WOMAN' | 'MAN' | 'UNISEX';
  sizeChartId: string | null;
  sortOrder: number;
  options: { name: string; values: { value: string; swatchHex: string | null }[] }[];
  variants: { id: string; options: Record<string, string>; sku: string | null; priceMinor: number; compareAtPriceMinor: number | null; stock: number; isActive: boolean }[];
  media: { id: string }[];
  collectionIds: string[];
}

interface OptionDraft {
  name: string;
  /** One value per line; a colour may be followed by its hex: "Black #111111". */
  valuesText: string;
}

interface VariantDraft {
  id?: string;
  options: Record<string, string>;
  sku: string;
  price: string;
  compare: string;
  stock: string;
  isActive: boolean;
}

const MAX_VARIANTS = 250;
const comboKey = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

function parseOption(o: OptionDraft) {
  const values = o.valuesText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(.+?)\s+(#[0-9a-fA-F]{6})$/.exec(line);
      return m ? { value: m[1]!, swatchHex: m[2]! } : { value: line, swatchHex: null };
    });
  return { name: o.name.trim(), values: values.filter((v, i) => values.findIndex((x) => x.value === v.value) === i) };
}

/** All size × colour × … combinations of the options (one empty combination when there are no options). */
function combinations(options: ReturnType<typeof parseOption>[]): Record<string, string>[] {
  return options
    .filter((o) => o.name && o.values.length)
    .reduce<Record<string, string>[]>((acc, o) => acc.flatMap((a) => o.values.map((v) => ({ ...a, [o.name]: v.value }))), [{}]);
}

/** Keeps rows (and their ids, prices, stock) for combinations that still exist; adds blank rows for new ones. */
function rebuildVariants(options: OptionDraft[], current: VariantDraft[]): VariantDraft[] {
  const byKey = new Map(current.map((v) => [comboKey(v.options), v]));
  const template = current[0];
  return combinations(options.map(parseOption)).map((combo) => byKey.get(comboKey(combo)) ?? { options: combo, sku: '', price: template?.price ?? '', compare: '', stock: '0', isActive: true });
}

export function ProductForm({ product }: { product: ProductDto | null }) {
  const org = useOrg();
  const router = useRouter();
  const charts = useLoad<{ id: string; name: string }[]>(`/organizations/${org.id}/size-charts`);
  const collections = useLoad<{ id: string; title: string }[]>(`/organizations/${org.id}/collections`);

  const [slug, setSlug] = useState(product?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!product);
  const [title, setTitle] = useState(product?.title ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [label, setLabel] = useState(product?.label ?? '');
  const [status, setStatus] = useState<string>(product?.status ?? 'DRAFT');
  const [gender, setGender] = useState<string>(product?.gender ?? 'UNISEX');
  const [sizeChartId, setSizeChartId] = useState(product?.sizeChartId ?? '');
  const [sortOrder, setSortOrder] = useState(String(product?.sortOrder ?? 0));
  const [mediaIds, setMediaIds] = useState<string[]>(product?.media.map((m) => m.id) ?? []);
  const [collectionIds, setCollectionIds] = useState<string[]>(product?.collectionIds ?? []);
  const [options, setOptions] = useState<OptionDraft[]>(
    product?.options.map((o) => ({ name: o.name, valuesText: o.values.map((v) => (v.swatchHex ? `${v.value} ${v.swatchHex}` : v.value)).join('\n') })) ?? [{ name: 'Размер', valuesText: 'S\nM\nL' }],
  );
  const [variants, setVariants] = useState<VariantDraft[]>(
    product
      ? product.variants.map((v) => ({ id: v.id, options: v.options, sku: v.sku ?? '', price: fromMinor(v.priceMinor), compare: fromMinor(v.compareAtPriceMinor), stock: String(v.stock), isActive: v.isActive }))
      : rebuildVariants([{ name: 'Размер', valuesText: 'S\nM\nL' }], [{ options: {}, sku: '', price: '', compare: '', stock: '0', isActive: true }]),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeOptions = (next: OptionDraft[]) => {
    setOptions(next);
    setVariants((current) => rebuildVariants(next, current));
  };
  const patchVariant = (i: number, patch: Partial<VariantDraft>) => setVariants((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  async function save() {
    setError(null);
    const rows = [];
    for (const [i, v] of variants.entries()) {
      const priceMinor = toMinor(v.price);
      const compare = v.compare.trim() ? toMinor(v.compare) : null;
      const stock = Number(v.stock);
      if (priceMinor === null) return setError(`Вариант ${i + 1}: укажите цену, например 49.90`);
      if (v.compare.trim() && compare === null) return setError(`Вариант ${i + 1}: старая цена указана неверно`);
      if (!Number.isInteger(stock) || stock < 0) return setError(`Вариант ${i + 1}: количество должно быть целым числом`);
      rows.push({ ...(v.id ? { id: v.id } : {}), options: v.options, sku: v.sku.trim() || null, priceMinor, compareAtPriceMinor: compare, stock, isActive: v.isActive });
    }
    const parsed = productInputSchema.safeParse({
      slug,
      title,
      description,
      label: label.trim() || null,
      status,
      gender,
      sizeChartId: sizeChartId || null,
      sortOrder: Number(sortOrder) || 0,
      options: options.map(parseOption).filter((o) => o.name),
      variants: rows,
      mediaIds,
      collectionIds,
    });
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.join('.') || 'форма'}: ${i.message}`).slice(0, 3).join(' · '));

    setBusy(true);
    try {
      await api(product ? `/organizations/${org.id}/products/${product.id}` : `/organizations/${org.id}/products`, { method: product ? 'PUT' : 'POST', body: parsed.data });
      router.push(`/dashboard/${org.slug}/products`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col">
      <Card title="Основное">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Название" value={title} onChange={(v) => { setTitle(v); if (!slugTouched) setSlug(slugify(v)); }} maxLength={160} />
          <Select label="Показывать в магазине?" value={status} onChange={setStatus} options={[{ value: 'ACTIVE', label: 'Да — в продаже' }, { value: 'DRAFT', label: 'Нет — черновик' }, { value: 'ARCHIVED', label: 'Нет — в архиве' }]} />
          <Select label="Для кого" value={gender} onChange={setGender} options={[{ value: 'UNISEX', label: 'Унисекс' }, { value: 'WOMAN', label: 'Женское' }, { value: 'MAN', label: 'Мужское' }]} />
        </div>
        <div className="mt-3"><TextArea label="Описание" value={description} onChange={setDescription} hint="Каждый пункт — с новой строки" /></div>
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-muted-foreground">Дополнительно</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <TextField label="Адрес в ссылке" value={slug} onChange={(v) => { setSlugTouched(true); setSlug(v.toLowerCase()); }} hint="Заполняется сам из названия" />
            <TextField label="Метка" value={label} onChange={setLabel} maxLength={24} hint="Над названием, например FW26" />
            <TextField label="Порядок" type="number" value={sortOrder} onChange={setSortOrder} hint="Меньше — выше в каталоге" />
          </div>
        </details>
      </Card>

      <Card title="Фото"><MediaPicker orgId={org.id} selected={mediaIds} onChange={setMediaIds} /></Card>

      <Card title="Размеры, цвета и другие варианты" actions={options.length < 3 ? <Button type="button" variant="outline" size="sm" onClick={() => changeOptions([...options, { name: '', valuesText: '' }])}>+ Добавить</Button> : undefined}>
        <p className="mb-3 text-[11px] text-muted-foreground">«Размер», «Цвет» и «Ткань» показываются в магазине как выбор размера, образцы цвета и материал. К цвету можно добавить образец: <code>Чёрный #111111</code>.</p>
        <div className="flex flex-col gap-4">
          {options.map((o, i) => (
            <div key={i} className="grid items-start gap-3 sm:grid-cols-[10rem_1fr_auto]">
              <TextField label="Название" value={o.name} onChange={(v) => changeOptions(options.map((x, j) => (j === i ? { ...x, name: v } : x)))} maxLength={40} />
              <TextArea label="Значения (по одному в строке)" hint="Если переименовать или удалить значение, цена и остаток этого варианта сбросятся." rows={3} value={o.valuesText} onChange={(v) => changeOptions(options.map((x, j) => (j === i ? { ...x, valuesText: v } : x)))} />
              <Button type="button" variant="ghost" size="sm" className="mt-5" onClick={() => changeOptions(options.filter((_, j) => j !== i))}>Убрать</Button>
            </div>
          ))}
        </div>
      </Card>

      <Card title={`Цены и остатки (${variants.length})`}>
        {variants.length > MAX_VARIANTS && <p role="alert" className="mb-2 text-xs text-destructive">Слишком много сочетаний: не больше {MAX_VARIANTS} вариантов на товар.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground"><tr><th className="pr-2 font-normal">Вариант</th><th className="pr-2 font-normal">Цена</th><th className="pr-2 font-normal">Старая цена</th><th className="pr-2 font-normal">Остаток, шт</th><th className="pr-2 font-normal">Продаётся</th><th className="font-normal">Артикул</th></tr></thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={comboKey(v.options)}>
                  <td className="py-1 pr-2 font-bold">{Object.values(v.options).join(' / ') || 'Обычный'}</td>
                  <td className="py-1 pr-2"><Input aria-label="Цена" inputMode="decimal" value={v.price} onChange={(e) => patchVariant(i, { price: e.target.value })} className="h-8 w-24" /></td>
                  <td className="py-1 pr-2"><Input aria-label="Старая цена" placeholder="—" inputMode="decimal" value={v.compare} onChange={(e) => patchVariant(i, { compare: e.target.value })} className="h-8 w-24" /></td>
                  <td className="py-1 pr-2"><Input aria-label="Остаток" inputMode="numeric" value={v.stock} onChange={(e) => patchVariant(i, { stock: e.target.value })} className="h-8 w-20" /></td>
                  <td className="py-1 pr-2"><input type="checkbox" aria-label="Продаётся" checked={v.isActive} onChange={(e) => patchVariant(i, { isActive: e.target.checked })} /></td>
                  <td className="py-1"><Input aria-label="Артикул" placeholder="—" value={v.sku} onChange={(e) => patchVariant(i, { sku: e.target.value })} className="h-8 w-28" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Цены в {org.currency}. «Старая цена» — зачёркнутая цена для скидки, можно не заполнять.</p>
      </Card>

      <Card title="Таблица размеров и коллекции">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Таблица размеров" value={sizeChartId} onChange={setSizeChartId} options={[{ value: '', label: 'Нет' }, ...(charts.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <fieldset className="flex flex-col gap-1">
            <legend className="label-xs mb-1">Коллекции</legend>
            {(collections.data ?? []).length === 0 && <span className="text-xs text-muted-foreground">Коллекций пока нет.</span>}
            {(collections.data ?? []).map((c) => (
              <Check key={c.id} label={c.title} checked={collectionIds.includes(c.id)} onChange={(on) => setCollectionIds(on ? [...collectionIds, c.id] : collectionIds.filter((x) => x !== c.id))} />
            ))}
          </fieldset>
        </div>
      </Card>

      <ErrorLine error={error} />
      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : product ? 'Сохранить' : 'Добавить товар'}</Button>
        <Button asChild variant="ghost"><Link href={`/dashboard/${org.slug}/products`}>Отмена</Link></Button>
        {product && (
          <span className="ml-auto">
            <ActionButton variant="destructive" confirm="Удалить товар? В прошлых заказах он останется." run={async () => { await api(`/organizations/${org.id}/products/${product.id}`, { method: 'DELETE' }); router.push(`/dashboard/${org.slug}/products`); }}>Удалить</ActionButton>
          </span>
        )}
      </div>
    </form>
  );
}
