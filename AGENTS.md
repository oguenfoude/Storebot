# AGENTS.md

## What this is

Telegram bot + Express REST API for selling digital product keys (Netflix, Spotify, etc.). Built with grammY, Express, and the MongoDB native driver (not Mongoose). All user-facing bot text is in Arabic (RTL). Currency is ₪.

## Commands

```bash
npm install        # install deps
npm run dev        # dev mode (ts-node-dev, hot reload)
npm run build      # tsc → dist/
npm start          # run production build (dist/bot.js)
```

There is no lint, typecheck, or test command configured. No eslint/prettier config exists. Jest is a devDependency but there are no test files.

## Architecture

Single-package TypeScript app. Two entrypoints share one process:

- **`src/bot.ts`** — Main entry. Attaches all handlers to the bot instance, starts the Express server, then starts the bot polling loop.
- **`src/server.ts`** — Express REST API on `PORT` (default 3000).
- **`src/botInstance.ts`** — Bare `Bot` instance with no handlers (breaks circular dependency).

Directory layout:

```
src/
  bot.ts              # Handler attachment, callback router, session, starts server
  botInstance.ts       # Bare Bot instance (no handlers) — controllers import this
  server.ts            # Express app, mounts all route groups
  db.ts                # MongoDB connection (connectToDB only, no bare export)
  types.ts             # Shared SessionData + MyContext types
  models/              # TypeScript interfaces (no Mongoose schemas)
  routes/              # Express routers
  controllers/         # Express request handlers
  commands/            # Bot command/callback handlers
  helpers/             # Admin notifications, balance updater, history recorder
  utils/               # asyncHandler, message formatters
```

## Database

- **Name**: From `process.env.DBName` (required — fails fast if missing).
- **Connection string**: `process.env.MONGODB_URI` (required — fails fast if missing).
- **Key collections**: `users`, `products`, `categories`, `history`, `preorders`, `adminNotifications`.
- **Single connection pattern**: Always use `connectToDB()` from `src/db.ts`.

## Environment variables

Required in `.env`:

```
BOT_TOKEN           # Telegram bot token (required)
MONGODB_URI         # MongoDB connection string (required)
DBName              # Database name (required)
PORT                # Express port (default 3000)
ADMIN_TELEGRAM_ID   # Single admin ID (fallback)
TELEGRAM_ADMIN_IDS  # Comma-separated admin IDs (preferred)
SUPPORT_WHATSAPP_URL  # WhatsApp support link (fallback: wa.me/213557349101)
SUPPORT_TELEGRAM_URL  # Telegram support link (fallback: t.me/Shams0628)
```

## User flow

1. User sends `/start` → bot creates user record with `isAccepted: false`
2. Bot asks for full name → phone number → user is "pending review"
3. Admin approves via REST API (`PUT /users/:id` with `isAccepted: true`)
4. Only then can user see balance, products, make purchases

Every bot callback checks `isUserAccepted()` before proceeding.

## Bot UX — Inline Keyboard Navigation

All navigation uses `InlineKeyboard` + `ctx.editMessageText()` (edit-in-place, no new messages).

### Callback data scheme

| Pattern | Action |
|---|---|
| `menu:main` | Main menu |
| `menu:balance` | Balance view |
| `menu:products` | Category list |
| `category:<categoryId>` | Products in category |
| `product:<productId>` | Product detail |
| `buy:confirm:<productId>` | Confirm purchase |
| `buy:cancel:<productId>` | Cancel purchase |
| `preorder:<productId>` | Initiate pre-order |
| `account:view` | Account details |
| `support:view` | Support links |
| `back:main` / `back:products` / `back:category:<id>` | Back navigation |

All callbacks include `ctx.answerCallbackQuery()` to clear loading spinners.

## Purchase flow

- Products have an `emails[]` array (the sellable keys).
- On purchase, one email is `shift()`ed from the array, balance deducted, archive entry created.
- `product.isAvailable` is set to `false` when `emails.length === 0`.
- Pre-orders are supported when `allowPreOrder: true` and stock is empty.
- A 5-minute confirmation timeout auto-cancels pending purchases.

## History tracking

Dual tracking via `recordHistoryEvent()` helper: writes to BOTH the global `history` collection AND the embedded `history[]` array on user/product documents in one call.

## Gotchas

- **No circular dependency**: Controllers import `bot` from `botInstance.ts` (not `bot.ts`). `bot.ts` imports handlers and attaches them.
- **Single DB connection**: Always use `connectToDB()` from `db.ts`. No bare `db` export exists.
- **TypeScript types**: Single source of truth in `src/types.ts`. No duplicate `SessionData`/`MyContext` definitions.
- **Support links**: Configurable via env vars (`SUPPORT_WHATSAPP_URL`, `SUPPORT_TELEGRAM_URL`).
- **Global error handling**: `bot.catch()` notifies admin on errors. Express has catch-all error middleware.
