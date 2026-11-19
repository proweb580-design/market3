# Тарифы, подписки и платежи (этап 6)

Код: [`apps/api/src/modules/billing`](../apps/api/src/modules/billing). Платёжный провайдер — **Stripe в тестовом режиме**.

## Как устроено

| Часть | Что делает |
|---|---|
| **Тарифы** (`plans`, `plan_features`) | FREE / BASIC / PRO / BUSINESS / ENTERPRISE из сида, дальше редактируются в админке. Функции и лимиты — ключи `PLAN_FEATURES` из `@repo/shared` |
| **Подписка** | у организации ровно одна «живая» (TRIALING / ACTIVE / PAST_DUE). Новая организация сразу получает FREE |
| **Entitlements** | что разрешает текущий тариф и сколько использовано. Источник правды — только сервер |
| **SubscriptionGuard** | глобальная проверка после прав роли: `@RequireFeature('api_access')`, `@CheckLimit('members.max')` → **402** с `details.code = PLAN_RESTRICTION` |
| **PaymentProvider** | интерфейс провайдера; реализация — `StripeProvider` (Stripe Checkout). Новый провайдер = один класс |

### Жизненный цикл

```
FREE ──trial──▶ TRIALING ──(14 дн. без оплаты)──▶ EXPIRED → FREE
FREE ──оплата──▶ ACTIVE ──период кончился──▶ PAST_DUE (3 дня, функции сохраняются) ──▶ EXPIRED → FREE
ACTIVE ──cancel──▶ ACTIVE (cancelAtPeriodEnd) ──конец периода──▶ EXPIRED → FREE      (resume — отменяет отмену)
ACTIVE ──оплата того же тарифа──▶ ACTIVE, период продлён от его конца (ранняя оплата дни не теряет)
ACTIVE ──оплата другого тарифа──▶ сразу новый тариф (UPGRADED / DOWNGRADED), без пересчёта остатка
```

Переходы выполняет задача `runLifecycle` (раз в 10 минут; вручную — `POST /admin/subscriptions/run-lifecycle`).
Каждое изменение пишется в `subscription_events` — это история подписки.

**Лимиты «мягкие»:** после понижения тарифа ничего не удаляется; блокируется только создание нового сверх лимита
(приглашения участников, API-ключи, вызовы по ключам). Ключи организации работают только на тарифах с `api_access`
и в пределах `api.requests_per_day`.

### Оплата

1. `POST /organizations/:orgId/subscription/checkout { planCode }` (право `org.billing.manage`) → платёж `PENDING`
   + Stripe Checkout Session на **ровно цену тарифа**. Ответ: `checkoutUrl` — страница оплаты Stripe (карта не проходит через наш сервер).
2. Покупатель платит; Stripe присылает webhook → проверка подписи → платёж `SUCCEEDED`, транзакция `CHARGE`, тариф применяется.
3. Вернувшись на сайт, страница может вызвать `POST …/payments/:id/sync` — сервер спросит Stripe напрямую, не дожидаясь webhook.

Защиты:

| Риск | Защита |
|---|---|
| Поддельный webhook | подпись Stripe по сырому телу (`STRIPE_WEBHOOK_SECRET`), допуск по времени 5 минут → иначе 400 |
| Повторная доставка | `webhook_events (provider, event_id)` уникален; обработанное событие подтверждается без действий; упавшее — обрабатывается при повторе |
| Двойное применение | платёж блокируется (`FOR UPDATE`) и меняется только из `PENDING`; поздние события ничего не меняют |
| Подмена суммы | сумма и валюта из события сверяются с записью платежа; расхождение → `FAILED (amount_mismatch)` + запись в аудит |
| Двойной клик «Оплатить» | `Idempotency-Key` в заголовке → повтор возвращает первый ответ; тот же ключ с другим телом → 422. В Stripe уходит свой ключ идемпотентности |
| Двойной возврат | доступная к возврату сумма учитывает и ожидающие возвраты |
| Живые деньги на dev-машине | API не стартует с `sk_live_…`, если `NODE_ENV` не `production` |

Возвраты: `POST /admin/payments/:id/refund { amountMinor? }` (право `platform.payments.refund`, частичный или полный).
Статус уточняется событиями `refund.created/updated/failed` — в т.ч. для возвратов, сделанных в панели Stripe.

## Подключение Stripe (тестовый режим)

1. Stripe Dashboard → включите **Test mode** → Developers → API keys → **Secret key** (`sk_test_…`)
   → в корневой `.env`: `STRIPE_SECRET_KEY=`. В чат не присылать.
2. **Webhook локально** — Stripe CLI:
   ```bash
   stripe login
   stripe listen --forward-to localhost:4000/api/v1/payments/webhooks/stripe
   ```
   CLI напечатает `whsec_…` → в `.env`: `STRIPE_WEBHOOK_SECRET=`. Перезапустите API.
3. **Webhook на сервере** — Developers → Webhooks → Add endpoint: `https://<api-домен>/api/v1/payments/webhooks/stripe`,
   события: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
   `checkout.session.expired`, `refund.created`, `refund.updated`, `refund.failed`. Его Signing secret — в переменные хостинга.
4. Тестовая карта Stripe: `4242 4242 4242 4242`, любая будущая дата, любой CVC.

Без `STRIPE_SECRET_KEY` всё, кроме онлайн-оплаты, работает (Free, пробный период, выдача тарифа админом); checkout отвечает 503.

## Эндпоинты

| Маршрут | Доступ |
|---|---|
| `GET /plans` | публично (страница тарифов) |
| `GET /organizations/:orgId/subscription` — тариф, функции, использование | `org.billing.read` |
| `GET …/subscription/history`, `GET …/payments`, `GET …/payments/:id`, `POST …/payments/:id/sync`, `GET …/transactions` | `org.billing.read` |
| `POST …/subscription/trial`, `…/checkout`, `…/cancel`, `…/resume` | `org.billing.manage` (только пользователь) |
| `POST /payments/webhooks/stripe` | публично, только с подписью Stripe |
| `GET/POST /admin/plans`, `PATCH/DELETE /admin/plans/:id` | `platform.plans.manage` |
| `GET /admin/subscriptions` | `platform.subscriptions.read` |
| `POST /admin/organizations/:id/subscription` (выдать тариф на N дней), `POST /admin/subscriptions/:id/terminate`, `POST /admin/subscriptions/run-lifecycle` | `platform.subscriptions.manage` |
| `GET /admin/payments`, `POST /admin/payments/:id/refund` | `platform.payments.read` / `platform.payments.refund` |

## Осознанные ограничения

| Что | Почему / когда |
|---|---|
| Нет автосписания: каждый период оплачивается заново через Checkout | провайдер-независимо и просто; автопродление (Stripe Billing / сохранённая карта) — отдельной задачей |
| Смена тарифа без пересчёта остатка (proration) | новый тариф начинается сразу с полного периода |
| Возврат не отключает тариф автоматически | админ решает отдельно (`terminate`) |
| Задача истечения — таймер внутри процесса API | при нескольких инстансах безопасна (идемпотентна), но лучше BullMQ + Redis — этап 10 |
| Проверка лимита не атомарна с созданием | при двух одновременных запросах возможен перебор на 1 |
| Цены тарифов в сиде — заглушки | меняются в админке |
| **Деньги за заказы приходят на аккаунт Stripe платформы** | выплаты брендам (Stripe Connect или ручной расчёт) не реализованы — это бизнес-решение, без него реальные продажи запускать нельзя |
| Заказ, оплаченный после отмены/истечения, остаётся отменённым | платёж фиксируется (`SUCCEEDED`), в журнал пишется `order.paid_after_cancel` — админ делает возврат |

## Оплата заказов покупателей (этап 8.2)

Тот же `PaymentProvider` и тот же вебхук, `purpose = ORDER`. Подробности — в [api.md](api.md#заказы-и-оплата-этап-82).
Заказ создаётся до оплаты (`PENDING_PAYMENT`, остаток зарезервирован), вебхук лишь сообщает «оплачено / истекло» — сумма и валюта
сверяются с заказом, а не берутся из события. `checkout.session.expired` отменяет заказ и возвращает остаток;
полный возврат платежа переводит заказ в `REFUNDED`.
