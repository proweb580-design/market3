'use client';

import { useState } from 'react';
import { createPlanSchema, PLAN_FEATURES, updatePlanSchema } from '@repo/shared';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../lib/api';
import { ActionButton, Async, Card, Check, ErrorLine, PageHead, Select, TextField, errText, fromMinor, toMinor, useLoad } from '../../dashboard/kit';
import { money } from '../admin-kit';

interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMinor: number;
  currency: string;
  interval: 'MONTH' | 'YEAR';
  trialDays: number;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  features: Record<string, { enabled: boolean; limit: number | null }>;
  liveSubscriptions: number;
}

type FeatureDraft = Record<string, { enabled: boolean; limit: string }>;
const KEYS = Object.keys(PLAN_FEATURES) as (keyof typeof PLAN_FEATURES)[];

function PlanForm({ plan, onDone }: { plan: Plan | null; onDone: () => void }) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [price, setPrice] = useState(fromMinor(plan?.priceMinor ?? 0));
  const [currency, setCurrency] = useState(plan?.currency ?? 'USD');
  const [interval, setInterval] = useState<string>(plan?.interval ?? 'MONTH');
  const [trialDays, setTrialDays] = useState(String(plan?.trialDays ?? 0));
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 0));
  const [isActive, setActive] = useState(plan?.isActive ?? true);
  const [isPublic, setPublic] = useState(plan?.isPublic ?? true);
  const [features, setFeatures] = useState<FeatureDraft>(() => Object.fromEntries(KEYS.map((k) => [k, { enabled: plan?.features[k]?.enabled ?? false, limit: plan?.features[k]?.limit === null || plan?.features[k]?.limit === undefined ? '' : String(plan.features[k]!.limit) }])));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    const priceMinor = toMinor(price);
    if (priceMinor === null) return setError('Enter the price like 19 or 19.90.');
    const feats = Object.fromEntries(
      KEYS.filter((k) => features[k]!.enabled || PLAN_FEATURES[k].kind === 'limit').map((k) => {
        const f = features[k]!;
        return PLAN_FEATURES[k].kind === 'limit' ? [k, { enabled: f.enabled, limit: f.limit.trim() === '' ? null : Number(f.limit) }] : [k, { enabled: f.enabled }];
      }),
    );
    const body = { name, description: description.trim() || undefined, priceMinor, currency, interval, trialDays: Number(trialDays) || 0, sortOrder: Number(sortOrder) || 0, isActive, isPublic, features: feats };
    const parsed = plan ? updatePlanSchema.safeParse(body) : createPlanSchema.safeParse({ ...body, code });
    if (!parsed.success) return setError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join(' · '));
    setBusy(true);
    try {
      await api(plan ? `/admin/plans/${plan.id}` : '/admin/plans', { method: plan ? 'PATCH' : 'POST', body: parsed.data });
      onDone();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Card title={plan ? `Edit ${plan.name}` : 'New plan'}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {!plan && <TextField label="Code" value={code} onChange={(v) => setCode(v.toUpperCase())} hint="UPPER_SNAKE_CASE, can't be changed later" />}
          <TextField label="Name" value={name} onChange={setName} maxLength={60} />
          <TextField label="Price" value={price} onChange={setPrice} />
          <TextField label="Currency" value={currency} onChange={(v) => setCurrency(v.toUpperCase())} maxLength={3} />
          <Select label="Period" value={interval} onChange={setInterval} options={[{ value: 'MONTH', label: 'Month' }, { value: 'YEAR', label: 'Year' }]} />
          <TextField label="Trial days" type="number" value={trialDays} onChange={setTrialDays} />
          <TextField label="Sort order" type="number" value={sortOrder} onChange={setSortOrder} />
        </div>
        <TextField label="Description" value={description} onChange={setDescription} maxLength={500} />
        <div className="flex gap-6"><Check label="Active (can be bought)" checked={isActive} onChange={setActive} /><Check label="Shown to stores" checked={isPublic} onChange={setPublic} /></div>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="label-xs mb-1">Features</legend>
          {KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <Check label={PLAN_FEATURES[k].description} checked={features[k]!.enabled} onChange={(enabled) => setFeatures({ ...features, [k]: { ...features[k]!, enabled } })} />
              {PLAN_FEATURES[k].kind === 'limit' && <input aria-label={`Limit for ${k}`} placeholder="no limit" inputMode="numeric" value={features[k]!.limit} onChange={(e) => setFeatures({ ...features, [k]: { ...features[k]!, limit: e.target.value } })} className="h-7 w-24 rounded-md border border-input bg-transparent px-2 text-xs" />}
            </div>
          ))}
        </fieldset>
        <p className="text-[11px] text-muted-foreground">New prices apply to future payments only. Limits are soft: lowering one blocks creating more, it deletes nothing.</p>
        <ErrorLine error={error} />
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save plan'}</Button><Button type="button" variant="ghost" onClick={onDone}>Cancel</Button></div>
      </form>
    </Card>
  );
}

export default function PlansPage() {
  const list = useLoad<Plan[]>('/admin/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const done = () => { setEditing(null); void list.reload(); };
  return (
    <>
      <PageHead title="Plans" actions={<Button onClick={() => setEditing('new')}>New plan</Button>} />
      {editing && <PlanForm key={editing === 'new' ? 'new' : editing.id} plan={editing === 'new' ? null : editing} onDone={done} />}
      <Async state={list}>
        {(plans) => (
          <ul className="divide-y divide-border rounded-md border border-border">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs">
                <span><b>{p.name}</b> <span className="text-muted-foreground">{p.code} · {p.priceMinor === 0 ? 'free' : `${money(p.priceMinor, p.currency)} / ${p.interval === 'YEAR' ? 'year' : 'month'}`} · {p.liveSubscriptions} live{!p.isActive ? ' · inactive' : ''}{!p.isPublic ? ' · hidden' : ''}</span></span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(p)}>Edit</Button>
                  <ActionButton variant="outline" confirm={`Delete the ${p.name} plan? Only plans nobody ever used can be deleted.`} run={async () => { await api(`/admin/plans/${p.id}`, { method: 'DELETE' }); await list.reload(); }}>Delete</ActionButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </>
  );
}
