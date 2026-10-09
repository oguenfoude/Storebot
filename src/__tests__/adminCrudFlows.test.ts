process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-key-32-chars-long-env!";
process.env.TELEGRAM_ADMIN_IDS = "999999";

import { ObjectId } from "mongodb";
import { Bot, InlineKeyboard } from "grammy";
import { attachManagerHandlers, ManagerContext } from "../manager/handlers";

// Mock DB
jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

// Mock logger
jest.mock("../helpers/logger", () => {
  const mkLogger: any = () => {
    const logger: any = jest.fn();
    logger.child = jest.fn().mockImplementation(() => mkLogger());
    logger.info = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();
    logger.fatal = jest.fn();
    return logger;
  };
  return { __esModule: true, default: mkLogger() };
});

// Mock BotManager
jest.mock("../bot/manager", () => ({
  BotManager: {
    bootSeller: jest.fn().mockResolvedValue(true),
    stopSeller: jest.fn().mockResolvedValue(undefined),
    getPrimaryBot: jest.fn().mockReturnValue({
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    }),
    runningCount: 3,
  },
}));

// Mock admin notification helper
jest.mock("../helpers/adminNotificationHelper", () => ({
  sendToAdmin: jest.fn().mockResolvedValue(undefined),
}));

// Mock getAdminIds
jest.mock("../helpers/getAdminIds", () => ({
  getAdminIds: jest.fn().mockReturnValue(["999999"]),
}));

import { connectToDB } from "../db";
import { BotManager } from "../bot/manager";

describe("Manager Bot — Admin Pure Inline CRUD Workflows", () => {
  let bot: Bot<ManagerContext>;
  let mockDb: any;
  let lastRepliedText = "";
  let lastEditMessageText = "";
  let lastKeyboard: any = null;

  const adminTelegramId = 999999;
  const sellerId1 = new ObjectId();
  const sellerId2 = new ObjectId();
  const userId1 = new ObjectId();
  const productId1 = new ObjectId();

  let mockSellers: any[];
  let mockUsers: any[];
  let mockProducts: any[];
  let mockCategories: any[];
  let mockHistory: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    lastRepliedText = "";
    lastEditMessageText = "";
    lastKeyboard = null;

    mockSellers = [
      {
        _id: sellerId1,
        telegramId: "1001",
        botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        botUsername: "seller1_bot",
        status: "active",
        planExpiresAt: new Date(Date.now() + 86400000 * 30),
      },
      {
        _id: sellerId2,
        telegramId: "1002",
        botToken: "234567:ABC-DEF1234ghIkl-zyx57W2v1u123ew22",
        botUsername: "seller2_bot",
        status: "expired",
        planExpiresAt: new Date(Date.now() - 86400000),
      },
    ];

    mockUsers = [
      {
        _id: userId1,
        telegramId: "55555",
        sellerId: sellerId1,
        fullName: "Customer One",
        phoneNumber: "+1234567890",
        balance: 100,
        registerDate: new Date(),
      },
    ];

    mockProducts = [
      {
        _id: productId1,
        sellerId: sellerId1,
        name: "Netflix UHD 4K",
        price: 15,
        emails: ["key1@test.com", "key2@test.com"],
        isAvailable: true,
        allowPreOrder: false,
      },
    ];

    mockCategories = [];
    mockHistory = [];

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "sellers") {
          return {
            countDocuments: jest.fn().mockImplementation((filter?: any) => {
              if (!filter || Object.keys(filter).length === 0) return Promise.resolve(mockSellers.length);
              if (filter.status) return Promise.resolve(mockSellers.filter((s) => s.status === filter.status).length);
              return Promise.resolve(0);
            }),
            find: jest.fn().mockImplementation(() => ({
              sort: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue(mockSellers),
            })),
            findOne: jest.fn().mockImplementation((query: any) => {
              const match = mockSellers.find((s) => s._id.toString() === query._id?.toString());
              return Promise.resolve(match || null);
            }),
            updateOne: jest.fn().mockImplementation((query: any, update: any) => {
              const seller = mockSellers.find((s) => s._id.toString() === query._id?.toString());
              if (seller && update.$set) {
                Object.assign(seller, update.$set);
              }
              return Promise.resolve({ modifiedCount: 1 });
            }),
            deleteOne: jest.fn().mockImplementation((query: any) => {
              const idx = mockSellers.findIndex((s) => s._id.toString() === query._id?.toString());
              if (idx !== -1) mockSellers.splice(idx, 1);
              return Promise.resolve({ deletedCount: 1 });
            }),
          };
        }
        if (name === "users") {
          return {
            countDocuments: jest.fn().mockImplementation(() => Promise.resolve(mockUsers.length)),
            find: jest.fn().mockImplementation(() => ({
              sort: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue(mockUsers),
            })),
            findOne: jest.fn().mockImplementation((query: any) => {
              const match = mockUsers.find((u) => u._id.toString() === query._id?.toString());
              return Promise.resolve(match || null);
            }),
            updateOne: jest.fn().mockImplementation((query: any, update: any) => {
              const user = mockUsers.find((u) => u._id.toString() === query._id?.toString());
              if (user && update.$inc) {
                user.balance = (user.balance || 0) + update.$inc.balance;
              }
              return Promise.resolve({ modifiedCount: 1 });
            }),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
          };
        }
        if (name === "products") {
          return {
            countDocuments: jest.fn().mockImplementation(() => Promise.resolve(mockProducts.length)),
            find: jest.fn().mockImplementation(() => ({
              sort: jest.fn().mockReturnThis(),
              skip: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue(mockProducts),
            })),
            findOne: jest.fn().mockImplementation((query: any) => {
              const match = mockProducts.find((p) => p._id.toString() === query._id?.toString());
              return Promise.resolve(match || null);
            }),
            deleteOne: jest.fn().mockImplementation((query: any) => {
              const idx = mockProducts.findIndex((p) => p._id.toString() === query._id?.toString());
              if (idx !== -1) mockProducts.splice(idx, 1);
              return Promise.resolve({ deletedCount: 1 });
            }),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
          };
        }
        if (name === "categories") {
          return {
            find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
            findOne: jest.fn().mockResolvedValue(null),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
          };
        }
        if (name === "history") {
          return {
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue([]),
            }),
            insertOne: jest.fn().mockImplementation((doc: any) => {
              mockHistory.push(doc);
              return Promise.resolve({ insertedId: new ObjectId() });
            }),
          };
        }
        return {
          countDocuments: jest.fn().mockResolvedValue(0),
          find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
          findOne: jest.fn().mockResolvedValue(null),
        };
      }),
    };

    (connectToDB as jest.Mock).mockResolvedValue(mockDb);

    bot = new Bot<ManagerContext>("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");
    bot.botInfo = {
      id: 999,
      is_bot: true,
      first_name: "ManagerBot",
      username: "manager_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    } as any;

    bot.api.config.use(async (_prev, method, payload: any) => {
      if (method === "sendMessage") {
        lastRepliedText = payload.text;
        lastKeyboard = payload.reply_markup;
        return {
          ok: true,
          result: { message_id: 1, date: Date.now(), chat: { id: payload.chat_id, type: "private" } },
        } as any;
      }
      if (method === "editMessageText") {
        lastEditMessageText = payload.text;
        lastKeyboard = payload.reply_markup;
        return {
          ok: true,
          result: { message_id: payload.message_id, date: Date.now(), chat: { id: payload.chat_id, type: "private" } },
        } as any;
      }
      if (method === "answerCallbackQuery") {
        return { ok: true, result: true } as any;
      }
      return { ok: true, result: {} } as any;
    });

    attachManagerHandlers(bot);
  });

  // Helper to dispatch callback query
  async function dispatchCallback(data: string, messageId = 1) {
    return bot.handleUpdate({
      update_id: Math.floor(Math.random() * 10000),
      callback_query: {
        id: "cb_1",
        from: { id: adminTelegramId, is_bot: false, first_name: "Admin" },
        message: {
          message_id: messageId,
          date: Date.now(),
          chat: { id: adminTelegramId, type: "private", first_name: "Admin" },
          text: "Previous Text",
        },
        chat_instance: "1",
        data,
      },
    });
  }

  it("1. [Read] Admin lists stores with in-place pagination and navigation buttons", async () => {
    await dispatchCallback("mgr:menu:sellers");

    expect(lastEditMessageText).toContain("Sellers");
    expect(lastKeyboard).toBeDefined();
    const kbStr = JSON.stringify(lastKeyboard);
    // Contains both sellers
    expect(kbStr).toContain(sellerId1.toString());
    expect(kbStr).toContain(sellerId2.toString());
    // Contains Add Store and Back to Main Menu buttons
    expect(kbStr).toContain("mgr:menu:add_seller");
    expect(kbStr).toContain("mgr:menu:home");
  });

  it("2. [Read] Admin inspects a store's details and views CRUD action buttons", async () => {
    await dispatchCallback(`mgr:seller:${sellerId1.toString()}`);

    expect(lastEditMessageText).toContain("seller1_bot");
    expect(lastEditMessageText).toContain("[Active]");
    const kbStr = JSON.stringify(lastKeyboard);
    // Users & Products counts
    expect(kbStr).toContain(`mgr:users:${sellerId1.toString()}`);
    expect(kbStr).toContain(`mgr:products:${sellerId1.toString()}`);
    // Action buttons: Renew, Ban, Delete, Back
    expect(kbStr).toContain(`mgr:renew:${sellerId1.toString()}`);
    expect(kbStr).toContain(`mgr:ban:${sellerId1.toString()}`);
    expect(kbStr).toContain(`mgr:delete_seller:${sellerId1.toString()}`);
    expect(kbStr).toContain("mgr:sellers");
  });

  it("3. [Update] Admin extends store subscription via inline duration preset", async () => {
    // Click renew
    await dispatchCallback(`mgr:renew:${sellerId1.toString()}`);
    expect(lastEditMessageText).toBeDefined();
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:renew:${sellerId1.toString()}:30`);

    // Click 30 days
    await dispatchCallback(`mgr:renew:${sellerId1.toString()}:30`);
    // After extending, re-renders store detail with updated status
    expect(lastEditMessageText).toContain("seller1_bot");
    expect(lastEditMessageText).toContain("[Active]");
  });

  it("4. [Update] Admin bans active store and unbans expired store seamlessly", async () => {
    // Click Ban
    await dispatchCallback(`mgr:ban:${sellerId1.toString()}`);
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:confirm_ban:${sellerId1.toString()}`);

    // Confirm Ban
    await dispatchCallback(`mgr:confirm_ban:${sellerId1.toString()}`);
    expect(BotManager.stopSeller).toHaveBeenCalledWith(sellerId1.toString());
    // Store is now expired/banned and detail view now shows Unban button
    kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:unban:${sellerId1.toString()}`);

    // Click Unban
    await dispatchCallback(`mgr:unban:${sellerId1.toString()}`);
    kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:confirm_unban:${sellerId1.toString()}`);

    // Confirm Unban
    await dispatchCallback(`mgr:confirm_unban:${sellerId1.toString()}`);
    expect(BotManager.bootSeller).toHaveBeenCalled();
  });

  it("5. [Delete] Admin deletes a store with confirmation prompt", async () => {
    // Click Delete Store
    await dispatchCallback(`mgr:delete_seller:${sellerId2.toString()}`);
    expect(lastEditMessageText).toContain("seller2_bot");
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:confirm_delete_seller:${sellerId2.toString()}`);

    // Confirm Delete
    await dispatchCallback(`mgr:confirm_delete_seller:${sellerId2.toString()}`);
    expect(BotManager.stopSeller).toHaveBeenCalledWith(sellerId2.toString());
    // Removed from sellers list
    expect(mockSellers.some((s) => s._id.toString() === sellerId2.toString())).toBe(false);
    // Returns to sellers list
    expect(lastEditMessageText).toContain("Sellers");
  });

  it("6. [Users CRUD] Admin views users and recharges customer balance with audit logging", async () => {
    // View users
    await dispatchCallback(`mgr:users:${sellerId1.toString()}:0`);
    expect(lastEditMessageText).toContain("seller1_bot");
    expect(JSON.stringify(lastKeyboard)).toContain("Customer One");

    // View user detail
    await dispatchCallback(`mgr:user:${userId1.toString()}`);
    expect(lastEditMessageText).toContain("100");
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:recharge:${userId1.toString()}`);

    // Click Recharge
    await dispatchCallback(`mgr:recharge:${userId1.toString()}`);
    kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:confirm_recharge:${userId1.toString()}:50`);

    // Click +50 recharge preset
    await dispatchCallback(`mgr:confirm_recharge:${userId1.toString()}:50`);
    // Verify user balance incremented
    const user = mockUsers.find((u) => u._id.toString() === userId1.toString());
    expect(user.balance).toBe(150);
    // Verify history audit record inserted
    expect(mockHistory.length).toBe(1);
    expect(mockHistory[0].amount).toBe(50);
    expect(mockHistory[0].actionType).toBe("recharge");
  });

  it("7. [Products CRUD] Admin views product catalog and deletes product with confirmation", async () => {
    // View products
    await dispatchCallback(`mgr:products:${sellerId1.toString()}:0`);
    expect(lastEditMessageText).toContain("seller1_bot");
    expect(JSON.stringify(lastKeyboard)).toContain("Netflix UHD 4K");

    // View product detail
    await dispatchCallback(`mgr:product:${productId1.toString()}`);
    expect(lastEditMessageText).toContain("Netflix UHD 4K");
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:admin_del_prod:${productId1.toString()}`);

    // Click Delete Product
    await dispatchCallback(`mgr:admin_del_prod:${productId1.toString()}`);
    kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:confirm_del_prod:${productId1.toString()}`);

    // Confirm Delete Product
    await dispatchCallback(`mgr:confirm_del_prod:${productId1.toString()}`);
    // Product deleted from database
    expect(mockProducts.length).toBe(0);
    // Returns to product list showing empty notice
    expect(lastEditMessageText).toContain("No products");
  });
});
