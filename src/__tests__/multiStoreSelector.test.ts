import { ObjectId } from "mongodb";

process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";

jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

jest.mock("../bot/manager", () => ({
  BotManager: {
    bootSeller: jest.fn().mockResolvedValue(undefined),
    stopSeller: jest.fn().mockResolvedValue(undefined),
    getPrimaryBot: jest.fn(),
    restartSeller: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../services/nowpayments", () => ({
  validateNOWPaymentsKey: jest.fn().mockResolvedValue(true),
}));

jest.mock("../helpers/encryption", () => ({
  encryptApiKey: jest.fn((k: string) => `encrypted:${k}`),
  decryptApiKey: jest.fn((k: string) => k.replace("encrypted:", "")),
}));

jest.mock("../helpers/adminNotificationHelper", () => ({
  sendToAdmin: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../commands/start", () => ({
  showMainMenu: jest.fn().mockResolvedValue(undefined),
}));

import { connectToDB } from "../db";

describe("Multi-Store Active Seller Resolution", () => {
  let mockDb: any;
  let mockSellers: any;
  let mockProducts: any;
  let mockCategories: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSellers = {
      findOne: jest.fn(),
      find: jest.fn(),
      findOneAndUpdate: jest.fn(),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockProducts = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };
    mockCategories = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "sellers") return mockSellers;
        if (name === "products") return mockProducts;
        if (name === "categories") return mockCategories;
        return { findOne: jest.fn(), updateOne: jest.fn(), insertOne: jest.fn() };
      }),
    };
    (connectToDB as jest.Mock).mockResolvedValue(mockDb);
  });

  it("returns the single seller when caller has only one store", async () => {
    const sellerId = new ObjectId();
    const single = {
      _id: sellerId,
      telegramId: "111111111",
      botToken: "tok",
      botUsername: "StoreA",
      status: "active" as const,
      maxProducts: 100,
    };
    mockSellers.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([single]) });
    mockSellers.findOne.mockResolvedValue(single);

    // Re-import to pick up fresh mocks
    const { resolveSellerFromSession, getActiveSeller } = await import("../manager/handlers");

    const ctx = {
      from: { id: 111111111 },
      reply: jest.fn().mockResolvedValue(undefined),
      session: {} as any,
    } as any;

    const resolution = await resolveSellerFromSession(ctx);
    expect(resolution.kind).toBe("single");
    if (resolution.kind === "single") {
      expect(resolution.seller.botUsername).toBe("StoreA");
    }
  });

  it("shows selector when caller has multiple stores and no active pinned", async () => {
    const storeA = {
      _id: new ObjectId(),
      telegramId: "222222222",
      botUsername: "StoreA",
      status: "active" as const,
      maxProducts: 100,
    };
    const storeB = {
      _id: new ObjectId(),
      telegramId: "222222222",
      botUsername: "StoreB",
      status: "active" as const,
      maxProducts: 100,
    };
    mockSellers.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([storeA, storeB]) });

    const { resolveSellerFromSession } = await import("../manager/handlers");

    const ctx = {
      from: { id: 222222222 },
      reply: jest.fn().mockResolvedValue(undefined),
      session: {} as any,
    } as any;

    const resolution = await resolveSellerFromSession(ctx);
    expect(resolution.kind).toBe("multiple");
    if (resolution.kind === "multiple") {
      expect(resolution.sellers).toHaveLength(2);
    }
  });

  it("uses pinned store when activeStoreId is set on session", async () => {
    const storeA = {
      _id: new ObjectId(),
      telegramId: "333333333",
      botUsername: "StoreA",
      status: "active" as const,
      maxProducts: 100,
    };
    const storeB = {
      _id: new ObjectId(),
      telegramId: "333333333",
      botUsername: "StoreB",
      status: "expired" as const,
      maxProducts: 100,
    };
    mockSellers.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([storeA, storeB]) });

    const { resolveSellerFromSession } = await import("../manager/handlers");

    const ctx = {
      from: { id: 333333333 },
      reply: jest.fn().mockResolvedValue(undefined),
      session: { activeStoreId: storeB._id!.toString() } as any,
    } as any;

    const resolution = await resolveSellerFromSession(ctx);
    expect(resolution.kind).toBe("single");
    if (resolution.kind === "single") {
      expect(resolution.seller.botUsername).toBe("StoreB");
    }
  });

  it("shows selector reply (not a duplicate mystore-not-registered) when multiple stores", async () => {
    const storeA = {
      _id: new ObjectId(),
      telegramId: "444444444",
      botUsername: "StoreA",
      status: "active" as const,
      maxProducts: 100,
    };
    const storeB = {
      _id: new ObjectId(),
      telegramId: "444444444",
      botUsername: "StoreB",
      status: "active" as const,
      maxProducts: 100,
    };
    mockSellers.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([storeA, storeB]) });

    const { getActiveSeller } = await import("../manager/handlers");

    const ctx = {
      from: { id: 444444444 },
      reply: jest.fn().mockResolvedValue(undefined),
      session: {} as any,
    } as any;

    const result = await getActiveSeller(ctx);
    expect(result.kind).toBe("selector");

    // Selector message was sent
    expect(ctx.reply).toHaveBeenCalled();

    // And the caller's "mystoreNotRegistered" message was NOT sent on top.
    const replyTexts = ctx.reply.mock.calls.map((c: any) => c[0] as string);
    expect(replyTexts.some((t: string) => t.includes("not registered"))).toBe(false);
  });
});
