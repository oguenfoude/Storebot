# StoreBot — Multi-Tenant Telegram Digital Product Store

A multi-tenant Telegram bot platform for selling digital product keys (Netflix, Spotify, Xbox, etc.). Sellers register with their own bot token, get an isolated store with categories and products, and sell to users via in-bot balance. The platform owner manages everything through a **Manager Bot**.

Built with grammY and the MongoDB native driver (not Mongoose). Trilingual (English/Arabic/French). Currency is points (نقاط).

## Features

- **Multi-Tenant**: Each seller gets their own bot instance. All data scoped by `sellerId`.
- **Manager Bot**: Owner-only admin panel with drill-down navigation — view all sellers, users, products, and purchases.
- **Seller Self-Service**: Sellers manage products and categories via their Manager Bot account.
- **Subscription Billing**: 7-day free trial, then $3-30 via NOWPayments.
- **Store Bot**: Hybrid navigation — Reply Keyboards for menus, Inline Keyboards for product lists.
- **Pre-Orders**: Out-of-stock products can be pre-ordered when enabled.
- **Atomic Purchases**: Race-condition-safe stock deduction using MongoDB `findOneAndUpdate` with `$pop`.
- **Bilingual**: All text configurable via language system (English default, Arabic available).
- **Token Revocation Handling**: If a seller revokes their bot token, BotManager detects the401, stops the bot, marks it `token_invalid`, and notifies the seller. Other sellers' bots are unaffected.
- **Trial Abuse Prevention**: Only the first-ever store per Telegram account gets the 7-day trial. Additional stores require immediate payment.
- **Multi-Store Support**: A single owner can register multiple bots. `/mystack` lists all stores, `/pay` lets you select which to pay for.
- **IPN Security**: Webhook rejects requests when `NOWPAYMENTS_IPN_SECRET` is not configured (HTTP 501) or when signature is invalid (HTTP 401).
- **Per-Seller Payments**: Sellers can configure their own NOWPayments API key so subscription payments go directly to their wallet. Key is AES-256-GCM encrypted at rest. Platform key is used as fallback.
- **Trilingual**: All text configurable via language system (English, Arabic, French).

## Setup

### Prerequisites

- Node.js (v16+)
- MongoDB instance
- Telegram Bot Token for Manager Bot (from [BotFather](https://core.telegram.org/bots#botfather))
- Your personal Telegram user ID (get it from [@userinfobot](https://t.me/userinfobot))

### Installation

```bash
git clone <repo-url>
cd StoreBot
npm install
```

### Environment Variables

Create a `.env` file in the project root:

**Required:**

```env
MONGODB_URI=your_mongodb_uri
DBName=your_database_name
MANAGER_BOT_TOKEN=your_manager_bot_token
TELEGRAM_ADMIN_IDS=111,222,333   # Comma-separated admin Telegram IDs (preferred)
TELEGRAM_ADMIN_ID=123456789      # Single admin ID (fallback)
BOT_LANGUAGE=en                  # en, ar, or fr (default: en)
API_KEY_ENCRYPTION_SECRET=your_32plus_char_secret   # AES-256-GCM key for encrypting seller API keys
```

**Fail-fast:** If neither `TELEGRAM_ADMIN_IDS` nor `TELEGRAM_ADMIN_ID` is set, the bot crashes at startup. No hardcoded fallback. Same for `API_KEY_ENCRYPTION_SECRET`.

**Optional:**

```env
NOWPAYMENTS_API_KEY=your_key          # For subscription payments
NOWPAYMENTS_IPN_SECRET=your_secret    # IPN signature verification (required when using NOWPayments)
NOWPAYMENTS_API_URL=https://api.nowpayments.io/v1
WEBHOOK_URL=https://your-domain.com
WEBHOOK_PORT=3000
FRONTEND_URL=https://your-store.com
SUPPORT_WHATSAPP_URL=https://wa.me/213776863561
SUPPORT_TELEGRAM_URL=https://t.me/Jeogooussama
```

### Running

```bash
npm run dev       # Development with hot reload (ts-node-dev)
npm run build     # Compile TypeScript to dist/
npm start         # Run production build (node dist/bot.js)
npm test          # Run all tests (jest)
```

The entry point is `src/bot.ts`. It connects to MongoDB, boots all active seller bots via BotManager, starts the Manager Bot, expiry checker, and webhook server.

## Manual Test Steps (End-to-End)

This section covers the exact steps to verify the full flow works, from registering a seller to a user buying a product.

### Step 1 — Start the bot

```bash
npm run dev
```

Wait for these log lines:
```
[Bootstrap] X seller bot(s) running
[Manager Bot] Started successfully
```

If `MANAGER_BOT_TOKEN` is not set, the Manager Bot will be disabled and you'll see a log saying so.

### Step 2 — Register as a seller (via Manager Bot)

1. Open your **Manager Bot** in Telegram (the bot you created with BotFather for the MANAGER_BOT_TOKEN)
2. Send `/start`
3. Bot asks you to provide a bot token — go to [@BotFather](https://t.me/BotFather), create a new bot (or reuse an existing token), copy the token
4. Paste the token into the Manager Bot chat (e.g. `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)
5. Bot validates the token with Telegram's API, creates a seller record in MongoDB, and boots your store bot
6. You see a confirmation message with your seller ID

### Step 3 — Add a category (via Manager Bot)

1. Send `/mycategories` — bot says "No categories yet"
2. Send `/addcategory`
3. Bot asks for category name — type e.g. `Netflix`
4. Bot confirms: "Category created: Netflix"

### Step 4 — Add a product (via Manager Bot)

1. Send `/addproduct`
2. Bot asks for product name — type e.g. `Netflix 1 Month`
3. Bot asks for price (in USD) — type e.g. `9`
4. Bot asks for stock (one key per line, or comma-separated) — type e.g. `test@email.com:pass123`
5. Bot asks for category name — type `Netflix` (exactly as you named it)
6. Bot asks "Allow pre-order when out of stock? (yes/no)" — type `no`
7. Bot confirms: "Product created: Netflix 1 Month"

You can verify with `/myproducts` — it should list the product.

### Step 5 — Test user buys it (via Store Bot)

1. Open your **store bot** (the bot you registered in Step 2) in Telegram
2. Send `/start`
3. Bot asks for full name — type anything (e.g. `Test User`)
4. Bot asks for phone number — type anything (e.g. `0555123456`)
5. Bot shows the main menu (Reply Keyboard with 4 buttons): Balance, Products, Account, Support
6. Click **Products**
7. Bot shows category list — click `Netflix`
8. Bot shows product list — click `Netflix 1 Month`
9. Bot shows product detail with a **Buy** button — click **Buy**
10. Bot shows purchase confirmation with Confirm/Cancel buttons — click **Confirm**
11. Since user has 0 balance, bot says "insufficient balance"
12. To complete the purchase: go back to **Manager Bot**, get the user's ID from the seller detail drill-down (Sellers → your seller → Users → the test user), then send `/recharge <userId> 100`
13. Go back to **Store Bot**, repeat steps 6-10 — purchase succeeds, you receive the email/key

### Step 6 — Verify in Manager Bot

1. Open Manager Bot
2. Click the "Sellers" button (Reply Keyboard) or send `/stats`
3. Click your seller name — see seller detail (status, products, users)
4. Click "Products" — see the product you added
5. Click "Users" — see the test user that registered
6. Click a user — see their balance and purchase history

## Architecture

Single-package TypeScript app. Two bot entrypoints:

- **`src/bot.ts`** — Bootstrap entry. Loads env, sets language, connects DB, boots seller bots, starts Manager Bot, expiry checker, webhook server.
- **`src/bot/manager.ts`** — `BotManager` singleton. Manages all per-seller Bot instances.

### Project Structure

```
src/
  bot.ts                 # Bootstrap entry + graceful shutdown
  db.ts                  # MongoDB connection (connectToDB only)
  types.ts               # Shared SessionData + MyContext types
  server.ts              # Express webhook server for NOWPayments IPN
  bot/
    manager.ts           # BotManagerClass singleton (Map<sellerId, Bot>)
    handlers.ts          # Store bot logic (all user-facing handlers)
  manager/
    bot.ts               # Manager Bot creation + startManagerBot()
    handlers.ts          # Admin panel + seller/product/category CRUD
    expiry.ts            # Trial/plan expiry checker (hourly)
    callbackParser.ts    # Callback data parser (testable module)
  commands/              # Bot command handlers (start, buy, products, etc.)
  helpers/               # Admin notifications + encryption utility
  models/                # TypeScript interfaces (Seller, User, Product, Category, History)
  languages/
    index.ts             # Language system: t(), setLanguage(), template()
    en.ts                # English translations
    ar.ts                # Arabic translations
    fr.ts                # French translations
  config/
    seller.ts            # DEFAULT_SELLER_ID constant (fallback only)
  __tests__/             # Jest unit tests
```

## User Flow

1. User sends `/start` → bot creates user record with `isAccepted: true`
2. Bot asks for full name → phone number → user is auto-accepted
3. Admin receives notification about new user registration
4. User can immediately see balance, browse products, and make purchases

Every bot callback checks `isUserAccepted()` before proceeding.

**Note:** Users are auto-accepted on registration — no admin approval step. This was a deliberate decision during the multi-tenant migration. In the original single-tenant design, the admin could approve users via a REST API. In the multi-tenant model, there is no REST API, and the Manager Bot is focused on managing sellers (not approving individual end-users of each seller's store). There is no reasonable workflow where the platform owner manually approves every user across every seller's store. The seller could theoretically approve their own users, but that interface was not built. Auto-accept was the only practical default.

## Seller Flow

1. Seller sends `/start` to Manager Bot → registration prompt
2. Seller provides Bot Token from @BotFather → bot validates and creates account
3. **First-ever store** gets 7-day free trial (max 3 products). Additional stores from the same person start as active and require immediate `/pay`.
4. After trial: `/pay` to choose subscription plan (30/90/365 days)
5. Seller's bot runs independently via BotManager
6. **Multi-store**: A single owner can register multiple bots. `/mystack` lists all stores if more than one exists.
7. **Token revocation**: If a seller revokes their bot token in BotFather, BotManager detects the401, stops the bot, marks it `token_invalid`, and notifies the seller.
8. **Payment setup**: `/setpayment` lets sellers configure their own NOWPayments API key so subscription payments go directly to their wallet. `/paymentstatus` checks configuration. Key is AES-256-GCM encrypted at rest.

## Manager Bot Commands

### Admin Commands (require your Telegram ID in `TELEGRAM_ADMIN_IDS`)

| Command | Description |
|---------|-------------|
| `/stats` | Show platform statistics (seller counts, user counts, product counts) |
| `/addseller` | Register new seller (provides bot token in next message) |
| `/renew <sellerId>` | Renew seller subscription (opens payment plan selection) |
| `/recharge <userId> <amount>` | Top up any user's balance by amount (in points) |
| `/deleteseller <sellerId>` | Permanently delete seller and all their users, products, categories |
| `/banseller <sellerId>` | Ban seller — sets status to expired, stops their bot |
| `/unbanseller <sellerId>` | Unban seller — sets status to active, reboots their bot |

### Seller Commands (for sellers registered via Manager Bot)

| Command | Description |
|---------|-------------|
| `/mystack` | View your store status (active/trial/expired, expiry date, store link). Lists all stores if multiple. |
| `/pay` | Choose a subscription plan (30 days/$3, 90 days/$8, 365 days/$30). Selects store if multiple. |
| `/myproducts` | List all your products with name, price, and stock count |
| `/addproduct` | Add product — 5-step flow: name → price → stock → category → pre-order |
| `/editproduct` | Select a product to edit (name or price) |
| `/deleteproduct` | Select a product to delete (with confirmation) |
| `/mycategories` | List all your categories |
| `/addcategory` | Add a category by name |
| `/editcategory` | Select a category to rename |
| `/deletecategory` | Select a category to delete (products in it are NOT deleted) |
| `/cancel` | Cancel any in-progress operation |
| `/setpayment` | Set up your NOWPayments API key for direct subscription payments |
| `/paymentstatus` | Check if your payment key is configured |
| `/clearpayment` | Remove saved payment key (revert to platform default) |

### Seller Reply Keyboard (Manager Bot)

Registered sellers get a persistent Reply Keyboard with 8 buttons:

| Row | Buttons |
|-----|---------|
| 1 | `My Store` — View store status |
| 2 | `My Products` — List products (with edit/delete inline) |
| 3 | `My Categories` — List categories (with edit/delete inline) |
| 4 | `Add Product` — Start 5-step add flow |
| 5 | `Add Category` — Start add category flow |
| 6 | `Subscription` — Choose payment plan |
| 7 | `Payment Setup` — Set your NOWPayments API key |
| 8 | `Help` — Usage instructions |

All slash commands are preserved as fallback. Keyboard buttons are handled via `bot.hears()` text-matching in `src/manager/handlers.ts`. After completing any operation (add, edit, delete), the seller keyboard is re-shown automatically.

### Store Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Register or log in (collects full name and phone number for new users) |
| `/menu` | Show the main menu (Reply Keyboard) |
| `/help` | Show usage help |

## Callback Data Scheme

### Store Bot

| Pattern | Action |
|---------|--------|
| `menu:main` | Main menu |
| `menu:balance` | Balance view |
| `menu:products` | Category list |
| `category:<categoryId>` | Products in category |
| `product:<productId>` | Product detail |
| `buy:confirm:<productId>` | Confirm purchase |
| `buy:cancel:<productId>` | Cancel purchase |
| `buy:initiate:<productId>` | Initiate purchase |
| `preorder:<productId>` | Confirm pre-order |
| `account:view` | Account details |
| `support:view` | Support links |

### Manager Bot (mgr: namespace)

| Pattern | Action |
|---------|--------|
| `mgr:sellers` | Seller list |
| `mgr:seller:<sellerId>` | Seller detail (shows Users + Products buttons) |
| `mgr:users:<sellerId>[:page]` | Paginated user list (8 per page) |
| `mgr:user:<userId>` | User detail (balance, purchase history) |
| `mgr:products:<sellerId>[:page]` | Paginated product list (8 per page) |
| `mgr:product:<productId>` | Product detail |
| `mgr:back:seller:<sellerId>` | Back to seller detail |
| `mgr:back:users:<sellerId>` | Back to user list |
| `mgr:back:products:<sellerId>` | Back to product list |
| `mgr:eprod:<productId>` | Edit product name |
| `mgr:dprod:<productId>` | Delete product (shows confirmation) |
| `mgr:ecat:<categoryId>` | Edit category name |
| `mgr:dcat:<categoryId>` | Delete category (shows confirmation) |
| `mgr:confirm_delete` | Confirm deletion |
| `mgr:cancel_delete` | Cancel deletion |
| `mgr:pay:<sellerId>` | Select store for payment |
| `mgr:seller_back` | Back to seller main keyboard (Reply Keyboard) |

Callback parsing is handled by `src/manager/callbackParser.ts` — a testable module with no DB dependency.

## Purchase Flow

1. User clicks "Products" → selects a category from the Reply Keyboard
2. Bot shows an Inline Keyboard list of available products in that category
3. User clicks a product → bot shows product detail with Buy button
4. User clicks Buy → bot presents purchase confirmation with Confirm/Cancel buttons
5. On confirm: one email is atomically popped from `product.emails[]` using `findOneAndUpdate` with `$pop`, balance is deducted, and the email/key is delivered to the user
6. If user has insufficient balance after atomic pop, the email is pushed back via `$push` with `$position: 0`
7. If stock is empty and `allowPreOrder: true`: user is asked if they want to pre-order by sending a custom note

## Database

MongoDB with native driver (no Mongoose). All collections scoped by `sellerId`.

| Collection | Purpose |
|------------|---------|
| `sellers` | Seller/bot records (tenant registry). Fields: `telegramId`, `botToken`, `botUsername`, `status` (active/trial/expired/token_invalid), `maxProducts`, `trialExpiresAt`, `planExpiresAt`, `nowpaymentsApiKey` (encrypted), `createdAt` |
| `users` | Telegram users. Fields: `telegramId`, `chatId`, `username`, `name`, `fullName`, `phoneNumber`, `balance`, `registerDate`, `isAccepted`, `history[]` (inline purchase/recharge log) |
| `products` | Digital products. Fields: `sellerId`, `name`, `description`, `price`, `emails[]` (the sellable keys), `categoryId`, `isAvailable`, `allowPreOrder`, `createdDate`, `archive[]` (sales log) |
| `categories` | Product categories. Fields: `sellerId`, `name`, `createdDate`, `isActive` |
| `history` | Global history log — written on purchase, pre-order creation, pre-order fulfillment, and balance recharge. Fields: `sellerId`, `userId`, `actionType`, `date`, `description`, `productId`, `productName`, `price` |
| `preorders` | Pending pre-orders with user/product references and status |
| `adminNotifications` | Log of admin notification attempts |

### Important: Legacy Data

`DEFAULT_SELLER_ID` exists as a constant in `src/config/seller.ts` but is **not auto-seeded**. No seller document is created for it on startup. Any pre-existing users/products that referenced a `sellerId` before the multi-tenant migration are **orphaned** unless you manually insert a matching seller document into the `sellers` collection with the correct `_id`.

## Language System

All user-facing text is in `src/languages/en.ts`, `src/languages/ar.ts`, and `src/languages/fr.ts`. Use `t()` to access translations, `template()` for variable interpolation:

```typescript
import { t, template } from "./languages";
// Simple usage — access any translation key:
ctx.reply(t().menu.buttonBalance);
// With variables — replace ${variable} placeholders:
ctx.reply(template(t().adminPanel.sellerTitle, { username: "MyBot" }));
```

The `adminPanel` section contains all Manager Bot strings. The `sellerKeyboard` section contains button labels for the seller's Reply Keyboard. Store bot strings are in `menu`, `balance`, `products`, `buy`, `support`, `account`, etc.

All emojis have been removed from the codebase. Status indicators use text labels like `[Active]`, `[Trial]`, `[Expired]`.

## Testing

```bash
npm test               # Run all tests (165 tests across 19 files)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report
```

Test files in `src/__tests__/`:

| Test File | What It Tests | Test Count |
|-----------|---------------|------------|
| `languages.test.ts` | Language system: t(), setLanguage(), getLanguage(), template(), en/ar/fr structure parity, sellerKeyboard section | 28 |
| `callbackParser.test.ts` | Manager callback parsing: all mgr:* patterns, pagination, back navigation, seller_back, unknown callbacks | 24 |
| `managerHelpers.test.ts` | Helper functions: statusEmoji text labels, sellerButtonLabel formatting, fallback behavior | 12 |
| `purchaseFlow.test.ts` | Atomic $pop purchase flow: successful delivery, insufficient balance rollback, out-of-stock, product archive | 7 |
| `expiryChecker.test.ts` | Trial/plan expiry: expired sellers get status set to expired, active sellers untouched, bot stopped, notifications sent | 7 |
| `ipnVerification.test.ts` | NOWPayments IPN: valid signature, invalid signature, tampered body, missing secret, empty signature | 8 |
| `tokenValidation.test.ts` | Token401 detection: isTokenFatal checks, GrammyError properties, pre-validation simulation, runtime401 catch | 12 |
| `restartResilience.test.ts` | Boot/stop/restart simulation: isolation, primary bot transfer, empty seller list | 9 |
| `rechargeHistory.test.ts` | /recharge: success history write, DB failure error handling, entry field validation | 3 |
| `ipnHistory.test.ts` | IPN payment: history entry on successful payment, date field present, no write for pending | 3 |
| `ipnRejection.test.ts` | IPN webhook: rejection when secret missing (501), missing signature (401), invalid signature (401) | 4 |
| `adminIdValidation.test.ts` | Admin ID fail-fast: throws without env vars, works with TELEGRAM_ADMIN_IDS, works with TELEGRAM_ADMIN_ID | 5 |
| `paymentKey.test.ts` | API key encryption: AES-256-GCM round-trip, missing secret fail-fast, NOWPayments validation, per-seller invoice creation | 12 |
| `e2e.test.ts` | Full lifecycle: seller registration, category/product creation, user registration, purchase flow (insufficient + success), recharge, manager views | 8 |

To add new tests: create `src/__tests__/yourModule.test.ts`.

## Key Design Decisions

1. **Auto-accept users**: No admin approval step. See User Flow section for rationale.
2. **No REST API**: The original single-tenant version had Express REST routes for CRUD. The multi-tenant version uses the Manager Bot and seller commands instead.
3. **No emojis in codebase**: All bot text uses clean text labels. Status is shown as `[Active]`, `[Trial]`, `[Expired]`, `[Token Invalid]`.
4. **IPN signature required**: `verifyIPNSignature()` returns false when `NOWPAYMENTS_IPN_SECRET` is not set. Webhook rejects with HTTP 501 when secret is missing entirely, HTTP 401 when signature is missing or invalid. Uses `crypto.timingSafeEqual()` to prevent timing attacks.
5. **Admin ID fail-fast**: Bot crashes at startup if neither `TELEGRAM_ADMIN_IDS` nor `TELEGRAM_ADMIN_ID` is set. No hardcoded fallback.
6. **Graceful shutdown**: `SIGINT`/`SIGTERM` handlers in `bot.ts` for clean exit.
7. **Stats deduplication**: Platform stats use a shared `getStatsMessage()` helper to avoid code duplication.
8. **History tracking**: Three-layer tracking: user inline `history[]`, product `archive[]`, and global `history` collection. Written on every purchase, pre-order, recharge, and IPN payment confirmation.
9. **Token isolation**: Each seller's bot is isolated — a401 (revoked token) in one seller's bot cannot crash other sellers' bots. 3-layer protection: pre-validation, per-bot `.catch()`, and `bot.catch()` for middleware errors. Manager Bot also has `.catch()` on `bot.start()`.
10. **Trial abuse prevention**: Only the first-ever store per Telegram account gets the 7-day trial. Additional stores start as `active` requiring immediate `/pay`.
11. **Multi-store**: Single owner can register multiple bots. `/mystack` lists all stores, `/pay` selects which to pay for.
12. **Seller Reply Keyboard**: Registered sellers get a persistent keyboard with My Store, Subscription, My Products, My Categories, Add Product, Add Category, Payment Setup, Help. All slash commands are preserved as fallback. Keyboard buttons are handled via `bot.hears()` text-matching in `src/manager/handlers.ts`.
13. **API key encryption**: Seller NOWPayments API keys are encrypted at rest using AES-256-GCM with a random IV per encryption. The encryption secret (`API_KEY_ENCRYPTION_SECRET`) is required at startup — bot crashes if missing.

## License

MIT

## Author

Developed by [Guenfoude Oussama (Jeogo Oussama)](https://github.com/jeogo-oussama).
