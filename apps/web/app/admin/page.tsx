'use client';

import { Async, Card, PageHead, useLoad } from '../dashboard/kit';
import { useCan } from './admin-kit';

interface Stats {
  users: { active: number; blocked: number };
  organizations: { total: number; suspended: number };
  apiKeys: number;
  subscriptions: number;
  successfulPayments: number;
}

export default function AdminOverview() {
  const can = useCan();
  const stats = useLoad<Stats>(can('platform.stats.read') ? '/admin/stats' : null);
  if (!can('platform.stats.read')) return <PageHead title="Platform admin" subtitle="Choose a section on the left." />;
  return (
    <>
      <PageHead title="Overview" />
      <Async state={stats}>
        {(s) => (
          <div className="grid gap-4 sm:grid-cols-3">
            <Card title="Users"><p className="title-xl text-4xl">{s.users.active}</p><p className="text-xs text-muted-foreground">{s.users.blocked} blocked</p></Card>
            <Card title="Stores"><p className="title-xl text-4xl">{s.organizations.total}</p><p className="text-xs text-muted-foreground">{s.organizations.suspended} suspended</p></Card>
            <Card title="Live subscriptions"><p className="title-xl text-4xl">{s.subscriptions}</p></Card>
            <Card title="Successful payments"><p className="title-xl text-4xl">{s.successfulPayments}</p></Card>
            <Card title="API keys"><p className="title-xl text-4xl">{s.apiKeys}</p></Card>
          </div>
        )}
      </Async>
    </>
  );
}
