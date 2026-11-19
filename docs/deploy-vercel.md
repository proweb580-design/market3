# Размещение целиком на Vercel

Три проекта Vercel из одного репозитория (`market3`), база и вход — Supabase.

| Проект | Root Directory | Что это |
|---|---|---|
| `market3-web` | `apps/web` | сайт-витрина |
| `market3-mini-app` | `apps/mini-app` | Telegram Mini App |
| `market3-api` | `apps/api` | API (NestJS как Vercel Function) |

В каждом проекте `vercel.json` уже лежит в своей папке (install и build команды собирают `@repo/shared` первым).
Переменные задаются в Vercel: Project → Settings → Environment Variables. **После изменения значения делайте Redeploy** —
значения `NEXT_PUBLIC_*` вшиваются в сборку.

## 1. База (один раз, с вашего компьютера)

Миграции Vercel не запускает. В локальном `.env` временно укажите **Supabase** в `DIRECT_URL` и `DATABASE_URL`
(Supabase → Settings → Database → Connection string) и выполните:

```powershell
pnpm --filter @repo/api db:deploy
pnpm --filter @repo/api db:seed
pnpm --filter @repo/api db:seed-demo
```

`db:seed` создаёт права, роли и тарифы; `db:seed-demo` — демо-магазин `ashen` (нужен, чтобы Mini App было что показывать).
Верните локальные адреса обратно, если продолжаете разработку на своей базе.

## 2. Проект `market3-api`

| Переменная | Значение | Секрет |
|---|---|---|
| `NODE_ENV` | `production` | нет |
| `DATABASE_URL` | Supabase → Database → Connection string → **Transaction pooler** (порт 6543) | да |
| `SUPABASE_URL` | `https://<ref>.supabase.co` | нет |
| `JWT_SECRET` | 32+ случайных символа (`openssl rand -base64 32`) | да |
| `ENCRYPTION_KEY` | 32 байта base64 (`openssl rand -base64 32`) | да |
| `CRON_SECRET` | 16+ случайных символов; Vercel сам шлёт его планировщику | да |
| `CORS_ORIGINS` | `https://market3-web.vercel.app,https://market3-mini-app.vercel.app` | нет |
| `TRUST_PROXY` | `true` | нет |
| `SWAGGER_ENABLED` | `false` | нет |
| `PUBLIC_WEB_URL` | `https://market3-web.vercel.app` | нет |
| `PUBLIC_MINI_APP_URL` | `https://market3-mini-app.vercel.app` | нет |
| `PUBLIC_API_URL` | адрес самого API (`https://market3-api.vercel.app`) | нет |
| `TELEGRAM_BOT_TOKEN` | токен бота из @BotFather | да |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` / secret key. **Только здесь**, для загрузки фото в кабинете бренда | да |
| `STRIPE_SECRET_KEY` | `sk_test_…` | да |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` из Stripe → Webhooks (шаг 5) | да |

Адрес проекта API (`https://<имя>.vercel.app`) и есть значение для `NEXT_PUBLIC_API_URL` ниже. Проверка: открыть
`https://<api>/api/v1/health` — должно вернуть `{"status":"ok"}`, а `/api/v1/health/ready` — `database: up`.

## 3. Проект `market3-web`

| Переменная | Значение |
|---|---|
| `NEXT_PUBLIC_API_URL` | адрес API (без `/` и без `/api/v1`) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publishable (anon) ключ Supabase |
| `NEXT_PUBLIC_SITE_URL` | `https://market3-web.vercel.app` |

## 4. Проект `market3-mini-app`

| Переменная | Значение |
|---|---|
| `NEXT_PUBLIC_API_URL` | адрес API |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | `Ashennew_bot` (без `@`) |
| `NEXT_PUBLIC_MINI_APP_URL` | `https://market3-mini-app.vercel.app` |

## 4a. Supabase Authentication (вход на сайте)

Supabase → Authentication → **URL Configuration**:
- Site URL: `https://market3-web.vercel.app`
- Redirect URLs: `https://market3-web.vercel.app/auth/callback` (и `http://localhost:3000/auth/callback` для разработки).
Без этого ссылки из писем (подтверждение, сброс пароля) не откроются. Встроенная почта Supabase ограничена несколькими письмами в час — для реального запуска нужен свой SMTP
(Authentication → Emails → SMTP Settings).

## 5. Stripe

Stripe (Test mode) → Developers → Webhooks → Add endpoint:
`https://<api>/api/v1/payments/webhooks/stripe`, события `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`,
`refund.created`, `refund.updated`, `refund.failed`. Его Signing secret → `STRIPE_WEBHOOK_SECRET` в проекте API (и Redeploy).
Тестовая карта: `4242 4242 4242 4242`, любая будущая дата, любой CVC.

## 6. Telegram (@BotFather)

`/mybots` → бот → Bot Settings → **Configure Mini App → Main App**: `https://market3-mini-app.vercel.app/ashen`,
Launch Mode — Fullsize.

## Что нужно знать (ограничения Vercel-варианта)

| Что | Последствие |
|---|---|
| Планировщик Vercel Cron на тарифе Hobby срабатывает **раз в сутки** | подписки и неоплаченные заказы обрабатываются раз в день. Заказ при этом отменяется и раньше: Stripe шлёт `checkout.session.expired` через 30 минут. На тарифе Pro расписание в `apps/api/vercel.json` можно сделать чаще |
| Лимиты запросов (`THROTTLE_LIMIT`, ключи API) считаются **в памяти одного экземпляра** | у функций много экземпляров, поэтому защита от перебора ослаблена. Нужен Redis (Upstash) — этап 10 |
| Холодный старт функции 1–3 секунды | первый запрос после простоя медленнее |
| Размер функции и время ответа ограничены тарифом (`maxDuration` = 30 с) | для обычных запросов достаточно |
| Подключения к базе | только через пулер Supabase (порт 6543); пул на функцию — 3 соединения (`DB_POOL_MAX`) |
| Деньги за заказы приходят на Stripe платформы | выплат брендам нет, см. [billing.md](billing.md) |

Это годится для демонстрации и тестирования. Для реальных продаж лучше постоянно запущенный сервер (Docker-образ API) и Redis.
