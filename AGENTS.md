# AGENTS.md

## What this is
Multi-tenant Telegram bot for selling digital product keys. Each seller gets an isolated store bot managed by `BotManager`. Owner controls everything via a separate Manager Bot. Built with grammY + MongoDB native driver. Trilingual (en/ar/fr). Currency: points.

## Commands
```bash
npm install
npm run dev       # ts-node-dev hot reload (src/bot.ts)
npm run build     # tsc → dist/
npm start         # node dist/bot.js
npm test          # jest (189 tests)
npm run test:watch
npm run test:coverage
```
No linter or formatter configured.

## Entrypoints
- **`src/bot.ts`** — Bootstrap: loads env, sets language, connects DB, boots seller bots, starts Manager Bot, expiry checker, and webhook server. Handles `SIGINT`/`SIGTERM` graceful shutdown.
- **`src/manager/bot.ts`** — `createManagerBot()` returns `null` if `MANAGER_BOT_TOKEN` is unset (Manager Bot disabled, no crash). `startManagerBot()` is idempotent.
- **`src/bot/manager.ts`** — `BotManager` singleton. `bootAll()` loads sellers with `status: active|trial`. `bootSeller()` pre-validates token via `getMe()` before polling.

## Database
- Only use `connectToDB()` from `src/db.ts`. No bare `db` export.
- `MONGODB_URI` and `DBName` required at startup.
- `DEFAULT_SELLER_ID` (`src/config/seller.ts`) is **not auto-seeded**. Pre-migration users/products referencing it are orphaned.

## Environment variables
Required:
- `MONGODB_URI`, `DBName`
- `TELEGRAM_ADMIN_IDS` (preferred) or `TELEGRAM_ADMIN_ID` (fallback). Bot crashes at startup if neither is set.
- `API_KEY_ENCRYPTION_SECRET` — 32+ char secret. Bot crashes at startup if missing.

Optional:
- `MANAGER_BOT_TOKEN` — Manager Bot disabled if unset (no crash).
- `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`, `WEBHOOK_URL`, `WEBHOOK_PORT`, `FRONTEND_URL`
- `SUPPORT_WHATSAPP_URL`, `SUPPORT_TELEGRAM_URL`
- `BOT_LANGUAGE` — `en` (default), `ar`, or `fr`

## Critical gotchas
- **`src/botInstance.ts` does not exist.** Use `BotManager` from `src/bot/manager.ts`.
- **No circular dependencies:** Handlers (`src/manager/handlers.ts`) import from `src/bot/manager.ts`, never from `src/bot.ts`. Store bot handlers never import from manager modules. Import direction: `src/bot.ts` → `src/bot/manager.ts` → `src/manager/handlers.ts`. Never reverse this.
- **`telegramId` is `string`** in all models. Compare with `ctx.from?.id.toString()`.
- **Language is global mutable state:** `setLanguage()` + `t()` from `src/languages/`. Set once at module load. Store bot `hears()` handlers capture text at attachment time.
- **Manager session type:** Use `(ctx.session as any)` in `src/manager/handlers.ts` — `ManagerContext` session type differs from grammY's default middleware type.
- **Atomic purchase flow:** Stock is popped via `findOneAndUpdate` with `$pop`. On insufficient balance, email is pushed back with `$push` + `$position: 0`. Concurrent same-user purchases cannot double-deliver.
- **IPN crash recovery:** `handleIPNCallback()` performs two non-atomic writes. `reconcileCompletedPayments()` in `src/manager/expiry.ts` runs hourly to recover missed reactivations. Uses `reconciledNotifiedAt` for single-notification idempotency.
- **Trial:** 14-day trial only on first-ever store per `telegramId`. Additional stores start as `active` requiring immediate `/pay`.
- **Token revocation isolation:** 3-layer protection — pre-validation, per-bot `.catch()` on `bot.start()`, and manager `bot.catch()`. One seller's revoked token cannot crash other bots.
- **Graceful shutdown order:** `stopWebhookServer` → `stopManagerBot` → `BotManager.stopAll` → `closeDB`. Each step wrapped in its own try/catch.
- **No DB indexes defined in code.** High-traffic queries rely on MongoDB's default `_id` index.
- **`pay_currency` is hardcoded to `"btc"`** in NOWPayments invoices.
- **No emojis in codebase.** Status labels: `[Active]`, `[Trial]`, `[Expired]`, `[Token Invalid]`.

## Testing
```bash
npm test                          # all 189 tests
npx jest src/__tests__/file.test.ts  # single file
```
Coverage only includes `src/languages/**`, `src/bot/manager.ts`, and `src/manager/handlers.ts`.
