# Telegram Mini App (этап 7)

Код: API — [`apps/api/src/modules/telegram`](../apps/api/src/modules/telegram),
Mini App — [`apps/mini-app/app/telegram-bridge.tsx`](../apps/mini-app/app/telegram-bridge.tsx), [`telegram.ts`](../apps/mini-app/app/telegram.ts).

## Как это работает

```
Telegram ──открывает──▶ https://<mini-app>/<store>
  telegram-web-app.js кладёт initData (подписан Telegram) в window.Telegram.WebApp
Mini App ──POST /api/v1/telegram/auth { initData, store }──▶ API
  1. магазин по slug (существует, активен)
  2. токен бота: свой бот бренда (если подключён) иначе платформенный TELEGRAM_BOT_TOKEN
  3. проверка подписи: secret = HMAC_SHA256("WebAppData", bot_token);
     hash = HMAC_SHA256(secret, все поля кроме hash, key=value, сортировка, "\n")
  4. auth_date не старше TELEGRAM_INITDATA_MAX_AGE_SEC (600 с) и не из будущего
  5. тариф магазина включает telegram_mini_app (иначе 402)
  6. hash записывается в telegram_init_data_uses — те же данные второй раз → 401
  7. пользователь находится/создаётся по Telegram ID ИЗ ПРОВЕРЕННЫХ данных; профиль дополняется
  8. сессия TELEGRAM в sessions + наш access JWT (15 мин) + refresh (хеш в БД, ротация)
◀── { accessToken, refreshToken, user, store }
```

- Telegram ID, имя и т.п. **никогда не берутся из тела запроса** — схема строгая, лишние поля = 400.
- Токен бота есть только на сервере. Токены ботов брендов хранятся зашифрованными (AES-256-GCM, `ENCRYPTION_KEY`).
- Наш access-токен отличается от токена Supabase по `kid`; `AuthGuard` принимает оба. Отзыв/блокировка действуют сразу.
- Mini App хранит сессию в `sessionStorage` на время запуска (initData одноразовая) и обновляет её refresh-токеном.

**Привязка к веб-аккаунту.** Вошедший на сайте вызывает `POST /telegram/link-code` → получает `link_<код>` (10 минут, одноразовый)
→ открывает `t.me/<бот>?startapp=link_<код>` → при входе Telegram-аккаунт привязывается к его аккаунту.
Отвязать: `DELETE /users/me/telegram` (нельзя, если Telegram — единственный способ входа).

**Интерфейс в Telegram** (`TelegramBridge`): `ready()`, `expand()`, цвета из `themeParams` → CSS-токены (и при смене темы),
`BackButton` (кроме главной магазина) → «назад», `MainButton` ← главное действие страницы («Add to cart · $300»).
В обычном браузере мост ничего не делает — витрина работает как веб-версия.

**Бот бренда** (кабинет, право `org.integrations.manage`, тариф с `telegram_mini_app`):
`PUT /organizations/:orgId/integrations/telegram { botToken }` → проверка токена через `getMe` → шифрованное хранение →
`setWebhook` (если задан HTTPS `PUBLIC_API_URL`) и кнопка меню «🛍 Магазин» (если HTTPS `PUBLIC_MINI_APP_URL`).
Webhook бота `/telegram/webhook/:id` принимает обновления только с секретным заголовком `X-Telegram-Bot-Api-Secret-Token`;
на `/start` бот здоровается по имени и присылает первое фото из hero-блока витрины с кнопками «Открыть магазин» и «Избранное»
(нет фото или Telegram его не принял — тот же текст с кнопкой магазина). Токен из API никогда не возвращается.

## Настройка

1. **Бот**: @BotFather → `/newbot` → токен в корневой `.env`: `TELEGRAM_BOT_TOKEN=`; имя бота без `@` → `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=`.
2. **Секреты** (уже сгенерированы в вашем локальном `.env`): `JWT_SECRET`, `ENCRYPTION_KEY`. На сервере — свои, другие.
3. **Демо-магазин в БД** (для витрины `ashen`): `pnpm --filter @repo/api db:seed-demo` (только для разработки).
4. **HTTPS**. Telegram открывает только HTTPS. Локально — туннель к Mini App, например:
   ```bash
   cloudflared tunnel --url http://localhost:3001
   ```
   Полученный `https://…` → `PUBLIC_MINI_APP_URL` в `.env` и в `CORS_ORIGINS`. API тоже должен быть доступен Mini App
   по адресу из `NEXT_PUBLIC_API_URL` (второй туннель на 4000 или деплой).
5. **Кнопка в боте** (платформенный бот): @BotFather → `/mybots` → бот → Bot Settings → Menu Button →
   URL `https://<mini-app>/ashen`. Для бота бренда кнопка ставится автоматически при подключении.

## Эндпоинты

| Маршрут | Доступ |
|---|---|
| `POST /telegram/auth`, `POST /telegram/refresh` | публично (подпись Telegram / refresh-токен) |
| `POST /telegram/link-code` | веб-пользователь |
| `DELETE /users/me/telegram` | пользователь |
| `GET/PUT/DELETE /organizations/:orgId/integrations/telegram` | `org.integrations.manage` (+ тариф для PUT) |
| `POST /telegram/webhook/:integrationId` | только с секретом webhook |

## Проверено

- 23 автотеста: подпись (через **независимую** эталонную библиотеку `@telegram-apps/init-data-node`), подделка, чужой бот,
  просрочка, повтор, блокировка, тариф, ротация refresh, выход, поддельный наш токен, привязка/отвязка, шифрование токена бота,
  webhook-секрет, `/start`.
- Сквозной запуск в браузере как из Telegram (initData и тема во фрагменте `#tgWebAppData`, официальный `telegram-web-app.js`):
  вход, тема, сессия, MainButton вместо нижней панели.
- **Не проверено** в настоящем клиенте Telegram — нужен ваш бот и HTTPS-адрес.

## Ограничения

| Что | Почему / когда |
|---|---|
| Оплата заказа открывается в системном браузере (`openLink`) и возвращает покупателя на страницу заказа **сайта** (`PUBLIC_WEB_URL`) | оплата прямо внутри Telegram (Telegram Payments) — отдельный провайдер |
| Webhook для платформенного бота не регистрируется автоматически | кнопка меню ставится в BotFather; для ботов брендов — автоматически |
| Повтор `initData` в пределах запуска отклоняется | поэтому Mini App держит сессию в `sessionStorage`; при её потере — переоткрыть Mini App |
