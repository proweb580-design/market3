'use client';

import { useState } from 'react';
import { Button } from '@repo/ui/components/ui/button';
import { api } from '../../../../lib/api';
import { ActionButton, Async, Card, ErrorLine, PageHead, TextField, errText, useLoad } from '../../kit';
import { useOrg } from '../../org-context';

function General() {
  const org = useOrg();
  const [name, setName] = useState(org.name);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api(`/organizations/${org.id}`, { method: 'PATCH', body: { name: name.trim() } });
      setMessage({ ok: true, text: 'Сохранено. Обновите страницу, чтобы новое название появилось везде.' });
    } catch (e) {
      setMessage({ ok: false, text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Магазин">
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex max-w-sm flex-col gap-3">
        <TextField label="Название" value={name} onChange={setName} maxLength={80} />
        <p className="text-[11px] text-muted-foreground">Адрес: <b>/s/{org.slug}</b> · Валюта: <b>{org.currency}</b> (после первых заказов их не изменить).</p>
        {message && <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'text-xs' : 'text-xs text-destructive'}>{message.text}</p>}
        <Button type="submit" disabled={busy || name.trim().length < 2} className="self-start">{busy ? 'Сохраняем…' : 'Сохранить'}</Button>
      </form>
    </Card>
  );
}

function TelegramBot() {
  const org = useOrg();
  const status = useLoad<{ connected: boolean; bot: { username?: string } | null; usingPlatformBot: boolean }>(`/organizations/${org.id}/integrations/telegram`);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api(`/organizations/${org.id}/integrations/telegram`, { method: 'PUT', body: { botToken: token.trim() } });
      setToken('');
      await status.reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Telegram-бот магазина">
      <Async state={status}>
        {(s) => (
          <div className="flex flex-col items-start gap-3 text-xs">
            {s.connected ? (
              <>
                <p>Подключён{s.bot?.username ? <> — <b>@{s.bot.username}</b></> : ''}. Покупатели открывают магазин прямо из этого бота.</p>
                <ActionButton variant="outline" confirm="Отключить бота? Магазин будет открываться через бота платформы." run={async () => { await api(`/organizations/${org.id}/integrations/telegram`, { method: 'DELETE' }); await status.reload(); }}>Отключить</ActionButton>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">{s.usingPlatformBot ? 'Сейчас магазин открывается через бота платформы.' : 'Бот не подключён.'} Чтобы подключить свой: создайте бота в @BotFather (/newbot), скопируйте токен и вставьте его сюда. Токен хранится в зашифрованном виде (нужен тариф с Telegram-магазином).</p>
                <form onSubmit={(e) => { e.preventDefault(); void connect(); }} className="flex w-full max-w-md items-end gap-2">
                  <div className="flex-1"><TextField label="Токен бота" value={token} onChange={setToken} type="password" /></div>
                  <Button type="submit" disabled={busy || !token}>{busy ? 'Подключаем…' : 'Подключить'}</Button>
                </form>
                <ErrorLine error={error} />
              </>
            )}
          </div>
        )}
      </Async>
    </Card>
  );
}

interface SupportBot {
  connected: boolean;
  bot: { username: string; webhook: boolean; bindCode: string | null; chatId: number | null; chatTitle: string | null } | null;
}

/** The second bot: buyer messages go to the team's Telegram group with Take / Resolved buttons. */
function SupportBotCard() {
  const org = useOrg();
  const path = `/organizations/${org.id}/integrations/telegram-support`;
  const status = useLoad<SupportBot>(path);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'PUT', body: { botToken: token.trim() } });
      setToken('');
      await status.reload();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Бот поддержки">
      <Async state={status}>
        {(s) => (
          <div className="flex flex-col items-start gap-3 text-xs">
            {s.connected && s.bot ? (
              <>
                {s.bot.chatId != null ? (
                  <p>@{s.bot.username} присылает обращения покупателей в группу <b>{s.bot.chatTitle ?? 'вашей команды'}</b>. Там можно нажать «Взять» или «Решено» — статус совпадает с разделом «Обращения».</p>
                ) : (
                  <>
                    <p>@{s.bot.username} подключён. Теперь добавьте его в Telegram-группу команды и отправьте туда это сообщение:</p>
                    <code className="select-all rounded bg-muted px-2 py-1">/bind@{s.bot.username} {s.bot.bindCode}</code>
                    <Button variant="outline" onClick={() => void status.reload()}>Отправил — проверить</Button>
                  </>
                )}
                {!s.bot.webhook && <p className="text-muted-foreground">Telegram не может достучаться до сервера (нужен публичный HTTPS-адрес), поэтому бот пока не получает команды.</p>}
                <ActionButton variant="outline" confirm="Отключить бота поддержки? Обращения останутся в разделе «Обращения»." run={async () => { await api(path, { method: 'DELETE' }); await status.reload(); }}>Отключить</ActionButton>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">Создайте в @BotFather отдельного бота для поддержки (не бота магазина) и вставьте его токен. Обращения покупателей будут приходить в Telegram-группу команды. Пока бот не подключён, они видны в разделе «Обращения».</p>
                <form onSubmit={(e) => { e.preventDefault(); void connect(); }} className="flex w-full max-w-md items-end gap-2">
                  <div className="flex-1"><TextField label="Токен бота поддержки" value={token} onChange={setToken} type="password" /></div>
                  <Button type="submit" disabled={busy || !token}>{busy ? 'Подключаем…' : 'Подключить'}</Button>
                </form>
                <ErrorLine error={error} />
              </>
            )}
          </div>
        )}
      </Async>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHead title="Настройки" />
      <General />
      <TelegramBot />
      <SupportBotCard />
    </>
  );
}
