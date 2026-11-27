'use client';

import { useState } from 'react';
import { SUPPORT_TOPIC_LABEL, type SupportTicketStatus } from '@repo/shared';
import { api } from '../../../../lib/api';
import { ActionButton, Async, PageHead, Select, dateTime, useLoad } from '../../kit';
import { useOrg } from '../../org-context';

interface Ticket {
  id: string;
  name: string;
  email: string;
  orderNumber: string | null;
  topic: keyof typeof SUPPORT_TOPIC_LABEL;
  message: string;
  status: SupportTicketStatus;
  assignee: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const STATUS: Record<SupportTicketStatus, string> = { NEW: 'Новое', IN_PROGRESS: 'В работе', RESOLVED: 'Решено' };
const NEXT: Record<SupportTicketStatus, [SupportTicketStatus, string][]> = {
  NEW: [['IN_PROGRESS', 'Взять в работу'], ['RESOLVED', 'Решено']],
  IN_PROGRESS: [['RESOLVED', 'Решено']],
  RESOLVED: [['NEW', 'Открыть снова']],
};

/** Buyer messages from the storefront support form. Status changes also update the Telegram group message. */
export default function SupportPage() {
  const org = useOrg();
  const [status, setStatus] = useState('');
  const query = new URLSearchParams({ pageSize: '100', ...(status ? { status } : {}) }).toString();
  const list = useLoad<{ items: Ticket[]; total: number; open: number }>(`/organizations/${org.id}/support/tickets?${query}`);

  const move = async (id: string, next: SupportTicketStatus) => {
    await api(`/organizations/${org.id}/support/tickets/${id}`, { method: 'PATCH', body: { status: next } });
    await list.reload();
  };

  return (
    <>
      <PageHead title="Обращения" subtitle="Сообщения покупателей из формы поддержки. Чтобы получать их в Telegram-группу, подключите бота поддержки в Настройках." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label="Статус" value={status} onChange={setStatus} options={[{ value: '', label: 'Все' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]} />
      </div>
      <Async state={list}>
        {({ items, total, open }) =>
          items.length === 0 ? (
            <p className="text-xs text-muted-foreground">Обращений пока нет.</p>
          ) : (
            <>
              <ul className="flex flex-col gap-3">
                {items.map((t) => (
                  <li key={t.id} className="rounded-md border border-border p-3 text-xs">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        <b>{SUPPORT_TOPIC_LABEL[t.topic] ?? t.topic}</b> · {t.name} &lt;<a href={`mailto:${t.email}`} className="underline">{t.email}</a>&gt;
                        {t.orderNumber && <> · заказ №{t.orderNumber.replace(/^#/, '')}</>}
                      </span>
                      <span className="text-muted-foreground">{dateTime(t.createdAt)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap">{t.message}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className={t.status === 'RESOLVED' ? 'text-muted-foreground' : 'font-bold'}>
                        {STATUS[t.status]}
                        {t.assignee && ` — ${t.assignee}`}
                      </span>
                      <span className="flex gap-2">
                        {NEXT[t.status].map(([next, label]) => (
                          <ActionButton key={next} variant={next === 'RESOLVED' ? 'default' : 'outline'} run={() => move(t.id, next)}>
                            {label}
                          </ActionButton>
                        ))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">Показано: {total} · открытых: {open}</p>
            </>
          )
        }
      </Async>
    </>
  );
}
