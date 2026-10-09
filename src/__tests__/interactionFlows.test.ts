process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-key-32-chars-long-env!";
process.env.TELEGRAM_ADMIN_IDS = "999999";

import { ObjectId } from "mongodb";
import { Bot } from "grammy";
import { MyContext } from "../types";
import { attachHandlers } from "../bot/handlers";
import { attachManagerHandlers, ManagerContext } from "../manager/handlers";
import { showMainMenu, getMainMenuKeyboard } from "../commands/start";

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
    getPrimaryBot: jest.fn().mockReturnValue({
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    }),
    getBotForMessage: jest.fn().mockReturnValue({
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    }),
    runningCount: 2,
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

describe("Store Bot — Customer Keyboard & Button Routing", () => {
  let storeBot: Bot<MyContext>;
  let mockDb: any;
  let lastStoreBotReply: string = "";
  const sellerId = new ObjectId();
  const userId = new ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();
    lastStoreBotReply = "";

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "users") {
          return {
            findOne: jest.fn().mockResolvedValue({
              _id: userId,
              telegramId: "12345",
              sellerId,
              fullName: "Test Customer",
              phoneNumber: "1234567890",
              isAccepted: true,
              balance: 50,
            }),
            updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
          };
        }
        if (name === "categories") {
          return {
            find: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([
                { _id: new ObjectId(), name: "Streaming", sellerId },
              ]),
            }),
            findOne: jest.fn().mockResolvedValue({
              _id: new ObjectId(),
              name: "Streaming",
              sellerId,
            }),
          };
        }
        if (name === "products") {
          return {
            find: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([
                {
                  _id: new ObjectId(),
                  name: "Netflix Premium",
                  price: 10,
                  emails: ["key1@test.com"],
                  sellerId,
                  isAvailable: true,
                },
              ]),
            }),
          };
        }
        return {
          findOne: jest.fn(),
          find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
        };
      }),
    };

    (connectToDB as jest.Mock).mockResolvedValue(mockDb);

    storeBot = new Bot<MyContext>("123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11");
    storeBot.botInfo = {
      id: 100,
      is_bot: true,
      first_name: "StoreBot",
      username: "my_store_bot",
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    } as any;

    storeBot.api.config.use(async (_prev, method, payload: any) => {
      if (method === "sendMessage") {
        lastStoreBotReply = payload.text;
        return {
          ok: true,
          result: { message_id: 1, date: Date.now(), chat: { id: payload.chat_id, type: "private" } },
        } as any;
      }
      return { ok: true, result: {} } as any;
    });

    attachHandlers(storeBot, sellerId);
  });

  it("getMainMenuKeyboard returns 4 primary navigation buttons", () => {
    const kb = getMainMenuKeyboard();
    expect(kb).toBeDefined();
    const json = JSON.stringify(kb);
    expect(json).toContain("Products");
    expect(json).toContain("Balance");
    expect(json).toContain("Account");
    expect(json).toContain("Support");
  });

  it("showMainMenu replies with welcome text and reply keyboard", async () => {
    const ctx = {
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await showMainMenu(ctx, "Alice");
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("Alice"),
      expect.objectContaining({
        reply_markup: expect.any(Object),
      })
    );
  });

  it("routes 'Balance' button text to balance display", async () => {
    await storeBot.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        date: Date.now(),
        chat: { id: 12345, type: "private", first_name: "Alice" },
        from: { id: 12345, is_bot: false, first_name: "Alice" },
        text: "Balance",
      },
    });

    expect(lastStoreBotReply).toContain("Balance");
  });

  it("routes 'Support' button text to support view", async () => {
    await storeBot.handleUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        date: Date.now(),
        chat: { id: 12345, type: "private", first_name: "Alice" },
        from: { id: 12345, is_bot: false, first_name: "Alice" },
        text: "Support",
      },
    });

    expect(lastStoreBotReply).toContain("Telegram");
  });
});

describe("Manager Bot — Admin & Seller Slash Commands", () => {
  let bot: Bot<ManagerContext>;
  let mockDb: any;
  let lastManagerBotReply: string = "";

  beforeEach(() => {
    jest.clearAllMocks();
    lastManagerBotReply = "";

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "sellers") {
          return {
            countDocuments: jest.fn().mockResolvedValue(5),
            find: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([
                {
                  _id: new ObjectId(),
                  telegramId: "111",
                  botUsername: "test_bot",
                  status: "active",
                },
              ]),
            }),
            findOne: jest.fn().mockResolvedValue({
              _id: new ObjectId(),
              telegramId: "111",
              botUsername: "test_bot",
              status: "active",
            }),
          };
        }
        if (name === "users") {
          return { countDocuments: jest.fn().mockResolvedValue(20) };
        }
        if (name === "products") {
          return {
            countDocuments: jest.fn().mockResolvedValue(15),
            find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
          };
        }
        if (name === "categories") {
          return {
            find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
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
        lastManagerBotReply = payload.text;
        return {
          ok: true,
          result: { message_id: 1, date: Date.now(), chat: { id: payload.chat_id, type: "private" } },
        } as any;
      }
      return { ok: true, result: {} } as any;
    });

    attachManagerHandlers(bot);
  });

  it("admin /stats command returns system statistics", async () => {
    await bot.handleUpdate({
      update_id: 101,
      message: {
        message_id: 20,
        date: Date.now(),
        chat: { id: 999999, type: "private", first_name: "Admin" },
        from: { id: 999999, is_bot: false, first_name: "Admin" },
        text: "/stats",
        entities: [{ offset: 0, length: 6, type: "bot_command" }],
      },
    });

    expect(lastManagerBotReply).toContain("Platform Stats");
  });

  it("seller /cancel resets active session and confirms cancellation", async () => {
    await bot.handleUpdate({
      update_id: 102,
      message: {
        message_id: 21,
        date: Date.now(),
        chat: { id: 111, type: "private", first_name: "Seller" },
        from: { id: 111, is_bot: false, first_name: "Seller" },
        text: "/cancel",
      },
    });

    expect(lastManagerBotReply).toContain("Cancelled");
  });

  it("seller /mystore displays store status", async () => {
    await bot.handleUpdate({
      update_id: 103,
      message: {
        message_id: 22,
        date: Date.now(),
        chat: { id: 111, type: "private", first_name: "Seller" },
        from: { id: 111, is_bot: false, first_name: "Seller" },
        text: "/mystore",
        entities: [{ offset: 0, length: 8, type: "bot_command" }],
      },
    });

    expect(lastManagerBotReply).toContain("Your Store");
    expect(lastManagerBotReply).toContain("test_bot");
  });
});
