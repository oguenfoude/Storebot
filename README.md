# StoreBot — Telegram Digital Product Store

A Telegram bot + Express REST API for selling digital product keys (Netflix, Spotify, Xbox, etc.). Users browse categories, purchase keys via an in-bot balance system, and receive credentials instantly. Admins manage everything through the REST API and receive real-time Telegram notifications.

Built with grammY, Express, and the MongoDB native driver (not Mongoose). All user-facing bot text is in Arabic (RTL). Currency is points (نقاط).

## Features

- **Telegram Bot**: Native Reply Keyboard navigation mixed with Inline Keyboards — fast category browsing, direct product purchase, pre-orders, balance checks, and account info.
- **REST API**: Full CRUD for users, products, categories, notifications, pre-orders, and history.
- **User Approval**: New users must be approved by an admin before accessing the bot.
- **Purchase Flow**: Seamless flow from clicking a product directly to purchase confirmation. Balance deduction, email/key delivery, and a 5-minute confirmation timeout.
- **Pre-Orders**: Users can pre-order out-of-stock products when enabled.
- **History Tracking**: Dual tracking — embedded arrays in documents + global `history` collection.
- **Admin Notifications**: Real-time Telegram alerts for purchases, new users, pre-orders, and balance updates.

## Setup

### Prerequisites

- Node.js (v16+)
- MongoDB instance
- Telegram Bot Token (from [BotFather](https://core.telegram.org/bots#botfather))

### Installation

```bash
git clone <repo-url>
cd StoreBot
npm install
```

### Environment Variables

Create a `.env` file in the project root (you can copy `.env.example`):

```env
BOT_TOKEN=your_telegram_bot_token    # Required — bot won't start without it
MONGODB_URI=your_mongodb_uri         # Required — connection string
DBName=your_database_name            # Required — database name
PORT=3000                            # Express API port (default 3000)
ADMIN_TELEGRAM_ID=123456789          # Single admin Telegram ID (fallback)
TELEGRAM_ADMIN_IDS=111,222,333       # Comma-separated admin IDs (preferred)
SUPPORT_WHATSAPP_URL=https://wa.me/... # WhatsApp support link
SUPPORT_TELEGRAM_URL=https://t.me/...  # Telegram support link
```

### Running

```bash
npm run dev       # Development with hot reload (ts-node-dev)
npm run build     # Compile TypeScript to dist/
npm start         # Run production build (node dist/bot.js)
```

The entry point is `src/bot.ts`. It starts the Express server first, then the Telegram bot polling loop.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Register or log in. Collects full name and phone number if new user. |
| `/menu` | Show the main menu (Reply Keyboard) |
| `/help` | Show usage help |

### Navigation

The bot utilizes a hybrid navigation approach for maximum UX fluidity:
- **Main Menu**: Persistent native Reply Keyboard (الرصيد, المنتجات, حسابي, الدعم الفني).
- **Categories**: Reply Keyboard grid of available categories.
- **Products**: Inline Keyboard list displaying stock, name, and price.
- **Confirmations**: The bot temporarily swaps your Reply Keyboard for Confirm/Cancel buttons when initiating a purchase, and cleanly restores your state upon cancellation.

### User Flow

1. User sends `/start` → bot creates a user record with `isAccepted: false`.
2. Bot asks for full name → phone number → user is "pending review".
3. Admin approves via API: `PUT /users/:id` with `{ "isAccepted": true }`.
4. Only then can the user see balance, browse products, and make purchases.

Every bot action checks `isUserAccepted()` (requires `fullName`, `phoneNumber`, and `isAccepted: true`) before proceeding.

### Purchase Flow

1. User clicks "المنتجات" → selects a Category from the Reply Keyboard.
2. Bot shows an Inline Keyboard list of available products.
3. User clicks a Product → Bot deletes the list and directly presents a Purchase Confirmation message. The Reply Keyboard transforms into "✅ تأكيد الشراء" / "❌ إلغاء الشراء".
4. On confirm: one email is removed from `product.emails[]`, balance deducted, archive entry created, and the user's Main Menu is restored.
5. If cancelled: the bot automatically restores the Category grid and the Product list.
6. If stock is empty and `allowPreOrder: true`: The user is asked if they want to pre-order, and they can send a custom note.

## REST API

Base URL: `http://localhost:{PORT}` (default 3000)

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | Get all users |
| GET | `/users/:id` | Get a user by ID |
| PUT | `/users/:id` | Update user fields (`username`, `name`, `isAccepted`) |
| PUT | `/users/:id/balance` | Update user balance (body: `{ "amount": <number> }`) |
| DELETE | `/users/:id` | Delete a user |

### Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/products` | Get all products |
| GET | `/products/:id` | Get a product by ID |
| GET | `/products/archive` | Get archived (deleted) products |
| POST | `/products` | Create a new product |
| PUT | `/products/:id` | Update a product |
| DELETE | `/products/:id` | Delete a product (archives it) |

**POST /products body:**

```json
{
  "name": "Netflix 1 Month Personal",
  "description": "Account description",
  "price": 9,
  "emails": ["test1@gmail.com", "test2@gmail.com"],
  "categoryId": "CATEGORY_OBJECT_ID",
  "isAvailable": true,
  "allowPreOrder": false
}
```

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/categories` | Get all categories |
| GET | `/categories/:id` | Get a category by ID |
| POST | `/categories` | Create a new category |
| PUT | `/categories/:id` | Update a category |
| DELETE | `/categories/:id` | Delete a category |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/notifications` | Get all notifications |
| GET | `/notifications/:id` | Get a notification by ID |
| POST | `/notifications` | Create a notification |
| PUT | `/notifications/:id` | Update a notification |
| DELETE | `/notifications/:id` | Delete a notification |
| POST | `/notifications/:id/send` | Send a notification to all users |

### Pre-Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/preorders` | Get all pre-orders |
| GET | `/preorders/:id` | Get a pre-order by ID |
| PUT | `/preorders/:id/status` | Update pre-order status (e.g., cancel) |
| PUT | `/preorders/:id/fulfill` | Fulfill a pre-order |
| DELETE | `/preorders/:id` | Delete a pre-order |

### History

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/historic` | Get all history entries |
| GET | `/historic/:id` | Get a history entry by ID |

## Database

MongoDB with native driver (no Mongoose). Database name comes from `process.env.DBName`.

### Collections

| Collection | Purpose |
|------------|---------|
| `users` | Registered Telegram users with balance, approval status, embedded history |
| `products` | Digital products with email/key stock, price, category, archive |
| `categories` | Product categories |
| `history` | Global history log for all actions (purchases, updates, deletes, etc.) |
| `preorders` | Pending pre-orders with user/product references and status |
| `adminNotifications` | Log of all admin notification attempts (success/failure) |

## Project Structure

```
src/
  bot.ts                 # Entry point — handler attachment, text listeners, routing, server init
  botInstance.ts         # Bare Bot instance (no handlers) — breaks circular dependency
  server.ts              # Express app, middleware, route mounting, error handler
  db.ts                  # MongoDB connection (connectToDB only, no bare export)
  types.ts               # Shared SessionData + MyContext types
  commands/              # Bot command/callback handlers
    start.ts             # /start, /menu, registration, main menu reply keyboards
    balance.ts           # Balance viewing
    products.ts          # Category list, product list (inline mapping)
    buy.ts               # Purchase flows, reply keyboard confirmations, cancel routing
    preorder.ts          # Pre-order creation and notifications
    account.ts           # Account details
    support.ts           # Support contact links
  controllers/           # Express route handlers
  routes/                # Express routers
  models/                # TypeScript interfaces (User, Product, Category, etc.)
  helpers/               # Admin notifications, balance updater, history recorder
  utils/                 # asyncHandler wrapper, message formatters
```

## Known Gotchas

- **No circular dependency**: Controllers import `bot` from `botInstance.ts` (not `bot.ts`). `bot.ts` imports handlers and attaches them.
- **Session Types**: All session tracking for confirmations (e.g., `awaitingBuyConfirmationProductId`) is defined centrally in `src/types.ts`. 
- **Single DB connection**: Always use `connectToDB()` from `db.ts`. No bare `db` export exists.
- **Global error handling**: `bot.catch()` notifies admin on errors. Express has catch-all error middleware.

## License

MIT

## Author

Developed by [Guenfoude Oussama (Jeogo Oussama)](https://github.com/jeogo-oussama).
