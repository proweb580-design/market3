'use client';

import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../lib/api';
import { Async, Card, ErrorLine, PageHead, TextArea, TextField, errText, useLoad } from '../../dashboard/kit';
import { when } from '../admin-kit';

interface Setting { key: string; value: unknown; updatedAt: string }

function Editor({ setting, onSaved }: { setting: Setting | null; onSaved: () => void }) {
  const [key, setKey] = useState(setting?.key ?? '');
  const [text, setText] = useState(setting ? JSON.stringify(setting.value, null, 2) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return setError('The value must be valid JSON, e.g. true, 10, "text" or {"a": 1}.');
    }
    setBusy(true);
    try {
      await api(`/admin/settings/${encodeURIComponent(key.trim())}`, { method: 'PUT', body: { value } });
      if (!setting) { setKey(''); setText(''); }
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-2">
      {!setting && <TextField label="Key" value={key} onChange={setKey} maxLength={80} hint="e.g. maintenance.banner" />}
      <TextArea label={setting ? setting.key : 'Value (JSON)'} rows={setting ? 3 : 4} value={text} onChange={setText} />
      <ErrorLine error={error} />
      <Button type="submit" size="sm" disabled={busy || (!setting && !key.trim())} className="self-start">{busy ? 'Saving…' : 'Save'}</Button>
    </form>
  );
}

export default function SettingsPage() {
  const list = useLoad<Setting[]>('/admin/settings');
  return (
    <>
      <PageHead title="Platform settings" subtitle="Key–value settings (JSON). Changes are written to the audit log." />
      <Card title="Add a setting"><Editor setting={null} onSaved={() => void list.reload()} /></Card>
      <Async state={list}>
        {(rows) => rows.length === 0 ? <p className="text-xs text-muted-foreground">No settings yet.</p> : rows.map((s) => <Card key={s.key} title={`${s.key} · updated ${when(s.updatedAt)}`}><Editor setting={s} onSaved={() => void list.reload()} /></Card>)}
      </Async>
    </>
  );
}
