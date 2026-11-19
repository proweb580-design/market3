'use client';

import { useState } from 'react';
import { sizeChartInputSchema } from '@repo/shared';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../../lib/api';
import { ActionButton, Async, Card, ErrorLine, PageHead, TextArea, TextField, errText, useLoad } from '../../kit';
import { useOrg } from '../../org-context';

interface Chart {
  id: string;
  name: string;
  columns: string[];
  rows: { size: string; chestCm: number; values: string[] }[];
}

/** Rows are typed as lines: `size | chest (cm, flat) | value for each column`. */
const toText = (c: Chart) => c.rows.map((r) => [r.size, r.chestCm, ...r.values].join(' | ')).join('\n');

function parse(name: string, columns: string, rows: string) {
  return sizeChartInputSchema.safeParse({
    name,
    columns: columns.split(',').map((c) => c.trim()).filter(Boolean),
    rows: rows.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
      const [size = '', chest = '', ...values] = line.split('|').map((p) => p.trim());
      return { size, chestCm: Number(chest), values };
    }),
  });
}

function ChartForm({ chart, onSaved, onCancel }: { chart: Chart | null; onSaved: () => void; onCancel: () => void }) {
  const org = useOrg();
  const [name, setName] = useState(chart?.name ?? '');
  const [columns, setColumns] = useState(chart?.columns.join(', ') ?? 'Chest, Length');
  const [rows, setRows] = useState(chart ? toText(chart) : 'S | 54 | 54 cm | 68 cm\nM | 57 | 57 cm | 70 cm');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const parsed = parse(name, columns, rows);
    if (!parsed.success) return setError(parsed.error.issues.map((i) => i.message).slice(0, 2).join(' · '));
    setBusy(true);
    setError(null);
    try {
      await api(chart ? `/organizations/${org.id}/size-charts/${chart.id}` : `/organizations/${org.id}/size-charts`, { method: chart ? 'PUT' : 'POST', body: parsed.data });
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Card title={chart ? 'Edit size chart' : 'New size chart'}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-3">
        <TextField label="Name" value={name} onChange={setName} maxLength={80} />
        <TextField label="Measurement columns" value={columns} onChange={setColumns} hint="Comma separated, e.g. Chest, Length, Sleeve" />
        <TextArea label="Sizes" rows={6} value={rows} onChange={setRows} hint="One line per size: size | chest width in cm (used by the size finder) | one value per column" />
        <ErrorLine error={error} />
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
      </form>
    </Card>
  );
}

export default function SizeChartsPage() {
  const org = useOrg();
  const list = useLoad<Chart[]>(`/organizations/${org.id}/size-charts`);
  const [editing, setEditing] = useState<Chart | 'new' | null>(null);
  const done = () => { setEditing(null); void list.reload(); };

  return (
    <>
      <PageHead title="Size charts" subtitle="Shown as the size guide on a product and used by the size finder." actions={<Button onClick={() => setEditing('new')}>New size chart</Button>} />
      {editing && <ChartForm chart={editing === 'new' ? null : editing} onSaved={done} onCancel={() => setEditing(null)} />}
      <Async state={list}>
        {(rows) => rows.length === 0 ? <p className="text-xs text-muted-foreground">No size charts yet.</p> : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                <span><b>{c.name}</b> <span className="text-muted-foreground">{c.rows.length} sizes · {c.columns.join(', ')}</span></span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(c)}>Edit</Button>
                  <ActionButton variant="outline" confirm="Delete this size chart? Products using it simply lose the guide." run={async () => { await api(`/organizations/${org.id}/size-charts/${c.id}`, { method: 'DELETE' }); await list.reload(); }}>Delete</ActionButton>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Async>
    </>
  );
}
