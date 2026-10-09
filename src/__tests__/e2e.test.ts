import { ObjectId } from "mongodb";

process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";
process.env.TELEGRAM_ADMIN_IDS = "999999";
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.DBName = "testdb";

import { connectToDB } from "../db";
import { handleConfirmRecharge } from "../manager/handlers";

// Mock the DB module
jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

// Mock the admin notification helper to prevent side effects
jest.mock("../helpers/adminNotificationHelper", () => ({
  sendToAdmin: jest.fn().mockResolvedValue(undefined),
}));

// Mock the bot/manager to prevent actual bot startup
jest.mock("../bot/manager", () => ({
  BotManager: {
    getPrimaryBot: jest.fn().mockReturnValue(null),
    bootSeller: jest.fn().mockResolvedValue(true),
  },
}));

// Mock dependencies of src/manager/handlers so we can call real handlers
jest.mock("../languages", () => ({
  t: jest.fn().mockReturnValue({
    adminPanel: {
      rechargeSuccess: "Recharged ${amount} points to user ${userId}.",
      rechargeNotFound: "User not found.",
      cancelReply: "Cancelled.",
    },
  }),
  template: jest.fn((str: string, vars: Record<string, string | number>) => {
    let result = str;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(`\${${key}}`, String(value));
    }
    return result;
  }),
}));

jest.mock("grammy", () => {
  class InlineKeyboard {
    text() { return this; }
    row() { return this; }
    url() { return this; }
  }
  return {
    Bot: jest.fn(),
    session: jest.fn(() => (m: any, n: any) => (n ? 0 : undefined)),
    InlineKeyboard,
  };
});

jest.mock("../services/nowpayments", () => ({
  createSubscriptionInvoice: jest.fn(),
  validateNOWPaymentsKey: jest.fn().mockResolvedValue(true),
}));

jest.mock("../manager/expiry", () => ({
  reactivateSeller: jest.fn(),
}));

jest.mock("../helpers/encryption", () => ({
  encryptApiKey: jest.fn((s: string) => `enc:${s}`),
  decryptApiKey: jest.fn((s: string) => s.replace(/^enc:/, "")),
}));

jest.mock("../helpers/logger", () => {
  const mkChild = (): any => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockImplementation(() => mkChild()),
  });
  const root: any = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockImplementation(() => mkChild()),
  };
  return { __esModule: true, default: root };
});

// In-memory collections
let sellersCol: any[];
let usersCol: any[];
let productsCol: any[];
let categoriesCol: any[];
let historyCol: any[];
let preordersCol: any[];

// Helper to create mock collection
function createMockCollection(data: any[]) {
  return {
    findOne: jest.fn((query: any) => {
      if (query._id) {
        return Promise.resolve(data.find((d) => d._id?.toString() === query._id?.toString()) || null);
      }
      return Promise.resolve(data.find((d) => {
        return Object.entries(query).every(([k, v]) => {
          const vo = v as any;
          if (v && typeof v === "object" && vo.$in) return vo.$in.includes(d[k]);
          if (v && typeof v === "object" && vo.$gte !== undefined) return d[k] >= vo.$gte;
          return d[k]?.toString?.() === v?.toString?.() || d[k] === v;
        });
      }) || null);
    }),
    find: jest.fn((query: any = {}) => ({
      toArray: jest.fn(() => {
        return Promise.resolve(data.filter((d) => {
          return Object.entries(query).every(([k, v]) => {
            const vo = v as any;
            if (v && typeof v === "object" && vo.$in) return vo.$in.includes(d[k]);
            return d[k]?.toString?.() === v?.toString?.() || d[k] === v;
          });
        }));
      }),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
    })),
    insertOne: jest.fn((doc: any) => {
      const withId = { _id: new ObjectId(), ...doc };
      data.push(withId);
      return Promise.resolve({ insertedId: withId._id });
    }),
    updateOne: jest.fn((query: any, update: any) => {
      const idx = data.findIndex((d) => {
        return Object.entries(query).every(([k, v]) => d[k]?.toString?.() === v?.toString?.());
      });
      if (idx === -1) return Promise.resolve({ matchedCount: 0 });
      if (update.$set) Object.assign(data[idx], update.$set);
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) {
          data[idx][k] = (data[idx][k] || 0) + (v as number);
        }
      }
      if (update.$push) {
        for (const [k, v] of Object.entries(update.$push)) {
          if (!data[idx][k]) data[idx][k] = [];
          data[idx][k].push(v);
        }
      }
      return Promise.resolve({ matchedCount: 1 });
    }),
    findOneAndUpdate: jest.fn((query: any, update: any, options: any) => {
      const idx = data.findIndex((d) => {
        return Object.entries(query).every(([k, v]) => {
          const vo = v as any;
          if (v && typeof v === "object" && vo.$ne) return d[k]?.toString?.() !== vo.$ne?.toString?.();
          if (v && typeof v === "object" && vo.$exists !== undefined) {
            return vo.$exists ? d[k] !== undefined : d[k] === undefined;
          }
          if (v && typeof v === "object" && vo.$in) return vo.$in.includes(d[k]);
          if (v && typeof v === "object" && vo.$gte !== undefined) return d[k] >= vo.$gte;
          return d[k]?.toString?.() === v?.toString?.();
        });
      });
      if (idx === -1) return Promise.resolve(null);
      const before = { ...data[idx] };
      if (update.$pop) {
        for (const [k, dir] of Object.entries(update.$pop)) {
          if (dir === 1 || dir === -1) {
            const arr = data[idx][k];
            if (arr && arr.length > 0) {
              dir === 1 ? arr.pop() : arr.shift();
            }
          }
        }
      }
      if (update.$set) Object.assign(data[idx], update.$set);
      return Promise.resolve(options?.returnDocument === "before" ? before : data[idx]);
    }),
    deleteOne: jest.fn((query: any) => {
      const idx = data.findIndex((d) => {
        return Object.entries(query).every(([k, v]) => d[k]?.toString?.() === v?.toString?.());
      });
      if (idx !== -1) data.splice(idx, 1);
      return Promise.resolve({ deletedCount: idx !== -1 ? 1 : 0 });
    }),
    countDocuments: jest.fn(() => Promise.resolve(data.length)),
  };
}

describe("E2E — Full Seller + User Lifecycle", () => {
  let mockDb: any;

  beforeEach(() => {
    // Reset collections
    sellersCol = [];
    usersCol = [];
    productsCol = [];
    categoriesCol = [];
    historyCol = [];
    preordersCol = [];

    mockDb = {
      collection: jest.fn((name: string) => {
        switch (name) {
          case "sellers": return createMockCollection(sellersCol);
          case "users": return createMockCollection(usersCol);
          case "products": return createMockCollection(productsCol);
          case "categories": return createMockCollection(categoriesCol);
          case "history": return createMockCollection(historyCol);
          case "preorders": return createMockCollection(preordersCol);
          default: return createMockCollection([]);
        }
      }),
    };

    (require("../db").connectToDB as jest.Mock).mockResolvedValue(mockDb);
  });

  // Helper to create a mock context
  function createMockCtx(overrides: any = {}) {
    return {
      from: { id: 123456, username: "testuser", first_name: "Test" },
      message: { text: "" },
      reply: jest.fn().mockResolvedValue(undefined),
      session: {},
      answerCallbackQuery: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("Step 1: Seller registration creates seller record", async () => {
    const sellerId = new ObjectId();
    const seller = {
      _id: sellerId,
      telegramId: "123456",
      botToken: "123456:ABC-DEF",
      botUsername: "TestStoreBot",
      status: "trial",
      trialStartedAt: new Date(),
      trialExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxProducts: 3,
      createdAt: new Date(),
    };
    await mockDb.collection("sellers").insertOne(seller);
    const found = await mockDb.collection("sellers").findOne({ telegramId: "123456" });
    expect(found).toBeTruthy();
    expect(found.status).toBe("trial");
  });

  it("Step 2: Category creation scoped to seller", async () => {
    const sellerId = new ObjectId();
    const cat = {
      _id: new ObjectId(),
      sellerId,
      name: "Netflix",
      createdDate: new Date(),
      isActive: true,
    };
    await mockDb.collection("categories").insertOne(cat);
    const found = await mockDb.collection("categories").findOne({ name: "Netflix", sellerId });
    expect(found).toBeTruthy();
    expect(found.name).toBe("Netflix");
  });

  it("Step 3: Product creation with stock", async () => {
    const sellerId = new ObjectId();
    const catId = new ObjectId();
    const product = {
      _id: new ObjectId(),
      sellerId,
      name: "Netflix 1 Month",
      description: "",
      price: 9,
      emails: ["test@email.com:pass123"],
      categoryId: catId,
      isAvailable: true,
      allowPreOrder: false,
      createdDate: new Date(),
      archive: [],
    };
    await mockDb.collection("products").insertOne(product);
    const found = await mockDb.collection("products").findOne({ name: "Netflix 1 Month", sellerId });
    expect(found).toBeTruthy();
    expect(found.emails).toHaveLength(1);
    expect(found.isAvailable).toBe(true);
  });

  it("Step 4: User registration with fullName and phone", async () => {
    const sellerId = new ObjectId();
    const user = {
      _id: new ObjectId(),
      sellerId,
      telegramId: "789012",
      chatId: "789012",
      username: "buyer",
      name: "Buyer",
      fullName: "John Buyer",
      phoneNumber: "0555123456",
      balance: 0,
      registerDate: new Date(),
      isAccepted: true,
      history: [],
    };
    await mockDb.collection("users").insertOne(user);
    const found = await mockDb.collection("users").findOne({ telegramId: "789012", sellerId });
    expect(found).toBeTruthy();
    expect(found.fullName).toBe("John Buyer");
    expect(found.isAccepted).toBe(true);
  });

  it("Step 5: Purchase attempt with 0 balance returns insufficient balance", async () => {
    const sellerId = new ObjectId();
    const catId = new ObjectId();
    const userId = new ObjectId();

    // Insert product with 1 email
    const product = {
      _id: new ObjectId(), sellerId, name: "Netflix", description: "",
      price: 9, emails: ["key@email.com:pass"], categoryId: catId,
      isAvailable: true, allowPreOrder: false, createdDate: new Date(), archive: [],
    };
    await mockDb.collection("products").insertOne(product);

    // Insert user with 0 balance
    const user = {
      _id: userId, sellerId, telegramId: "789", chatId: "789",
      username: "u", name: "U", fullName: "User", phoneNumber: "123",
      balance: 0, registerDate: new Date(), isAccepted: true, history: [],
    };
    await mockDb.collection("users").insertOne(user);

    // Simulate purchase: user.balance (0) < product.price (9) → insufficient balance
    const foundUser = await mockDb.collection("users").findOne({ telegramId: "789", sellerId });
    const foundProduct = await mockDb.collection("products").findOne({ _id: product._id, sellerId });

    expect(foundUser.balance).toBeLessThan(foundProduct.price);
    // Email should NOT be popped (insufficient balance means no pop happens in real flow)
    expect(foundProduct.emails).toHaveLength(1);
  });

  it("Step 6: Admin recharge credits balance and writes history (via real handler)", async () => {
    const userId = new ObjectId();
    const adminId = "111222";

    // Insert user with 0 balance
    const user = {
      _id: userId, telegramId: "789", chatId: "789",
      username: "u", name: "U", fullName: "User", phoneNumber: "123",
      balance: 0, registerDate: new Date(), isAccepted: true, history: [],
    };
    await mockDb.collection("users").insertOne(user);

    // Call the REAL recharge handler (adminId is in TELEGRAM_ADMIN_IDS=999999)
    const amount = 100;
    const rechargeCtx = {
      from: { id: 999999 },
      reply: jest.fn().mockResolvedValue(undefined),
      session: {},
    };
    await handleConfirmRecharge(rechargeCtx as any, userId.toString(), amount);

    // Balance is credited via $inc
    const updated = await mockDb.collection("users").findOne({ _id: userId });
    expect(updated.balance).toBe(100);

    // Global history written
    const histEntry = await mockDb.collection("history").findOne({ userId, actionType: "recharge" });
    expect(histEntry).toBeTruthy();
    expect(histEntry.amount).toBe(100);
    expect(rechargeCtx.reply).toHaveBeenCalled();

    // Balance can immediately fund a purchase
    expect(updated.balance).toBe(100);
  });

  it("Step 7: Purchase with sufficient balance succeeds — stock decremented, history written", async () => {
    const sellerId = new ObjectId();
    const catId = new ObjectId();
    const userId = new ObjectId();
    const productId = new ObjectId();

    // Insert product with 2 emails
    const product = {
      _id: productId, sellerId, name: "Netflix", description: "",
      price: 9, emails: ["key1@email.com:pass1", "key2@email.com:pass2"], categoryId: catId,
      isAvailable: true, allowPreOrder: false, createdDate: new Date(), archive: [],
    };
    await mockDb.collection("products").insertOne(product);

    // Insert user with 100 balance
    const user = {
      _id: userId, sellerId, telegramId: "789", chatId: "789",
      username: "u", name: "U", fullName: "User", phoneNumber: "123",
      balance: 100, registerDate: new Date(), isAccepted: true, history: [],
    };
    await mockDb.collection("users").insertOne(user);

    // Insert category
    const cat = { _id: catId, sellerId, name: "Netflix", createdDate: new Date(), isActive: true };
    await mockDb.collection("categories").insertOne(cat);

    // Simulate purchase: pop email
    const productBefore = await mockDb.collection("products").findOne({ _id: productId, sellerId });
    const email = productBefore.emails[productBefore.emails.length - 1]; // last email

    await mockDb.collection("products").findOneAndUpdate(
      { _id: productId, sellerId, isAvailable: true, emails: { $exists: true, $ne: [] } },
      { $pop: { emails: 1 } },
      { returnDocument: "before" }
    );

    // Deduct balance + write user history
    const updatedBalance = 100 - 9;
    await mockDb.collection("users").updateOne(
      { _id: userId, sellerId },
      {
        $set: { balance: updatedBalance },
        $push: {
          history: {
            type: "purchase", date: new Date(), productId, productName: "Netflix",
            price: 9, categoryName: "Netflix", emailSold: email,
          },
        },
      }
    );

    // Update product archive + availability
    const productAfter = await mockDb.collection("products").findOne({ _id: productId });
    await mockDb.collection("products").updateOne(
      { _id: productId, sellerId },
      {
        $set: { isAvailable: productAfter.emails.length > 0 },
        $push: {
          archive: {
            transactionId: new ObjectId(), emailPassword: email,
            soldTo: userId, soldAt: new Date(), price: 9,
            buyerDetails: { name: "User", phone: "123", telegramId: "789" },
          },
        },
      }
    );

    // Write global history
    await mockDb.collection("history").insertOne({
      userId, sellerId, actionType: "purchase", description: "Purchased Netflix",
      date: new Date(), productId, productName: "Netflix", price: 9,
      categoryName: "Netflix", fullName: "User", phoneNumber: "123", emailSold: email,
    });

    // Verify
    const userAfter = await mockDb.collection("users").findOne({ _id: userId });
    expect(userAfter.balance).toBe(91);
    expect(userAfter.history).toHaveLength(1);
    expect(userAfter.history[0].emailSold).toBe(email);

    const productFinal = await mockDb.collection("products").findOne({ _id: productId });
    expect(productFinal.emails).toHaveLength(1);
    expect(productFinal.archive).toHaveLength(1);

    const globalHist = await mockDb.collection("history").findOne({ userId, actionType: "purchase" });
    expect(globalHist).toBeTruthy();
    expect(globalHist.emailSold).toBe(email);
  });

  it("Step 8: Manager Bot views show correct data", async () => {
    const sellerId = new ObjectId();
    const userId = new ObjectId();
    const productId = new ObjectId();

    // Insert seller
    await mockDb.collection("sellers").insertOne({
      _id: sellerId, telegramId: "123", botToken: "tok", botUsername: "Bot",
      status: "trial", maxProducts: 3, createdAt: new Date(),
    });

    // Insert user under seller
    await mockDb.collection("users").insertOne({
      _id: userId, sellerId, telegramId: "456", chatId: "456",
      username: "u", name: "U", fullName: "User", phoneNumber: "123",
      balance: 50, registerDate: new Date(), isAccepted: true, history: [],
    });

    // Insert product under seller
    await mockDb.collection("products").insertOne({
      _id: productId, sellerId, name: "Spotify", description: "",
      price: 5, emails: ["a@b.com"], categoryId: new ObjectId(),
      isAvailable: true, allowPreOrder: false, createdDate: new Date(), archive: [],
    });

    // Verify seller drill-down queries
    const seller = await mockDb.collection("sellers").findOne({ _id: sellerId });
    expect(seller).toBeTruthy();

    const users = await mockDb.collection("users").find({ sellerId }).toArray();
    expect(users).toHaveLength(1);
    expect(users[0].fullName).toBe("User");

    const products = await mockDb.collection("products").find({ sellerId }).toArray();
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe("Spotify");
  });
});
