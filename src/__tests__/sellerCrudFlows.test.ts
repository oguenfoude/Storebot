process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-key-32-chars-long-env!";
process.env.TELEGRAM_ADMIN_IDS = "999999";

import { ObjectId } from "mongodb";
import { Bot } from "grammy";
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
    runningCount: 2,
  },
}));

// Mock admin notification helper
jest.mock("../helpers/adminNotificationHelper", () => ({
  sendToAdmin: jest.fn().mockResolvedValue(undefined),
}));

// Mock getAdminIds (seller is NOT admin)
jest.mock("../helpers/getAdminIds", () => ({
  getAdminIds: jest.fn().mockReturnValue(["999999"]),
}));

import { connectToDB } from "../db";

describe("Manager Bot — Seller Pure Inline CRUD Workflows", () => {
  let bot: Bot<ManagerContext>;
  let mockDb: any;
  let lastRepliedText = "";
  let lastEditMessageText = "";
  let lastKeyboard: any = null;

  const sellerTelegramId = 777777; // Regular seller, not admin
  const sellerId = new ObjectId();
  const categoryId = new ObjectId();
  const productId = new ObjectId();

  let mockSellers: any[];
  let mockProducts: any[];
  let mockCategories: any[];

  beforeEach(() => {
    jest.clearAllMocks();
    lastRepliedText = "";
    lastEditMessageText = "";
    lastKeyboard = null;

    mockSellers = [
      {
        _id: sellerId,
        telegramId: sellerTelegramId.toString(),
        botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        botUsername: "my_cool_store_bot",
        status: "active",
        planExpiresAt: new Date(Date.now() + 86400000 * 30),
      },
    ];

    mockCategories = [
      {
        _id: categoryId,
        sellerId,
        name: "Software Licenses",
      },
    ];

    mockProducts = [
      {
        _id: productId,
        sellerId,
        categoryId,
        name: "Windows 11 Pro Key",
        price: 12.5,
        emails: ["key123-abc", "key456-def"],
        isAvailable: true,
        allowPreOrder: false,
      },
    ];

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "sellers") {
          return {
            find: jest.fn().mockImplementation(() => ({
              toArray: jest.fn().mockResolvedValue(mockSellers),
            })),
            findOne: jest.fn().mockImplementation((query: any) => {
              const match = mockSellers.find((s) => s.telegramId === query.telegramId || s._id.toString() === query._id?.toString());
              return Promise.resolve(match || null);
            }),
          };
        }
        if (name === "products") {
          return {
            countDocuments: jest.fn().mockImplementation(() => Promise.resolve(mockProducts.length)),
            find: jest.fn().mockImplementation(() => ({
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
          };
        }
        if (name === "categories") {
          return {
            countDocuments: jest.fn().mockImplementation(() => Promise.resolve(mockCategories.length)),
            find: jest.fn().mockImplementation(() => ({
              toArray: jest.fn().mockResolvedValue(mockCategories),
            })),
            findOne: jest.fn().mockImplementation((query: any) => {
              const match = mockCategories.find((c) => c._id.toString() === query._id?.toString());
              return Promise.resolve(match || null);
            }),
            deleteOne: jest.fn().mockImplementation((query: any) => {
              const idx = mockCategories.findIndex((c) => c._id.toString() === query._id?.toString());
              if (idx !== -1) mockCategories.splice(idx, 1);
              return Promise.resolve({ deletedCount: 1 });
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

  async function dispatchCallback(data: string, messageId = 1) {
    return bot.handleUpdate({
      update_id: Math.floor(Math.random() * 10000),
      callback_query: {
        id: "cb_1",
        from: { id: sellerTelegramId, is_bot: false, first_name: "SellerUser" },
        message: {
          message_id: messageId,
          date: Date.now(),
          chat: { id: sellerTelegramId, type: "private", first_name: "SellerUser" },
          text: "Previous Screen",
        },
        chat_instance: "1",
        data,
      },
    });
  }

  it("1. [Read] Seller views store status in-place with seller menu keyboard", async () => {
    await dispatchCallback("mgr:menu:mystore");

    expect(lastEditMessageText).toContain("my_cool_store_bot");
    expect(lastEditMessageText).toContain("[Active]");
    expect(lastKeyboard).toBeDefined();
    const kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain("mgr:menu:myproducts");
    expect(kbStr).toContain("mgr:menu:mycategories");
    expect(kbStr).toContain("mgr:menu:subscription");
  });

  it("2. [Products CRUD] Seller lists products and views item details", async () => {
    // Click My Products
    await dispatchCallback("mgr:menu:myproducts");
    expect(lastEditMessageText).toContain("Products");
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(productId.toString());
    expect(kbStr).toContain("mgr:menu:addproduct");
    expect(kbStr).toContain("mgr:menu:home");

    // Click product detail
    await dispatchCallback(`mgr:prod_detail:${productId.toString()}`);
    expect(lastEditMessageText).toContain("Windows 11 Pro Key");
    expect(lastEditMessageText).toContain("12.5");
    kbStr = JSON.stringify(lastKeyboard);
    // Contains Edit Name, Edit Price, Delete, and Back to Products
    expect(kbStr).toContain(`mgr:eprod:${productId.toString()}`);
    expect(kbStr).toContain(`mgr:epprod:${productId.toString()}`);
    expect(kbStr).toContain(`mgr:dprod:${productId.toString()}`);
    expect(kbStr).toContain("mgr:menu:myproducts");
  });

  it("3. [Products CRUD] Seller deletes product with confirmation prompt and returns to list", async () => {
    // Click Delete Product
    await dispatchCallback(`mgr:dprod:${productId.toString()}`);
    expect(lastEditMessageText).toContain("Windows 11 Pro Key");
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain("mgr:confirm_delete");
    expect(kbStr).toContain(`mgr:prod_detail:${productId.toString()}`);

    // Confirm Delete
    await dispatchCallback("mgr:confirm_delete");
    expect(mockProducts.length).toBe(0);
    // Reloads product list in-place
    expect(lastEditMessageText).toContain("No products");
  });

  it("4. [Categories CRUD] Seller lists categories and views category details", async () => {
    // Click My Categories
    await dispatchCallback("mgr:menu:mycategories");
    expect(lastEditMessageText).toContain("Categories");
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(categoryId.toString());
    expect(kbStr).toContain("mgr:menu:addcategory");
    expect(kbStr).toContain("mgr:menu:home");

    // Click category detail
    await dispatchCallback(`mgr:cat_detail:${categoryId.toString()}`);
    expect(lastEditMessageText).toContain("Software Licenses");
    kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain(`mgr:ecat:${categoryId.toString()}`);
    expect(kbStr).toContain(`mgr:dcat:${categoryId.toString()}`);
    expect(kbStr).toContain("mgr:menu:mycategories");
  });

  it("5. [Categories CRUD] Seller deletes category with confirmation and reloads list", async () => {
    // Click Delete Category
    await dispatchCallback(`mgr:dcat:${categoryId.toString()}`);
    expect(lastEditMessageText).toContain("Software Licenses");
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain("mgr:confirm_delete");
    expect(kbStr).toContain(`mgr:cat_detail:${categoryId.toString()}`);

    // Confirm Delete
    await dispatchCallback("mgr:confirm_delete");
    expect(mockCategories.length).toBe(0);
    // Reloads category list in-place
    expect(lastEditMessageText).toContain("No categories");
  });

  it("6. [Payment & Help] Seller accesses subscription plans, payment setup, and help with back navigation", async () => {
    // Subscription plans
    await dispatchCallback("mgr:menu:subscription");
    expect(lastEditMessageText).toContain("active");
    let kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain("mgr:menu:home");

    // Payment setup
    await dispatchCallback("mgr:menu:setpayment");
    expect(lastEditMessageText).toContain("Payment");
    kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain("mgr:menu:home");

    // Help
    await dispatchCallback("mgr:menu:help");
    expect(lastEditMessageText).toBeDefined();
    kbStr = JSON.stringify(lastKeyboard);
    expect(kbStr).toContain("mgr:menu:home");
  });
});
