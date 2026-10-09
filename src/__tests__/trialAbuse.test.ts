import { ObjectId } from "mongodb";

jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

jest.mock("../bot/manager", () => ({
  BotManager: {
    bootSeller: jest.fn().mockResolvedValue(undefined),
    stopSeller: jest.fn().mockResolvedValue(undefined),
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

import { connectToDB } from "../db";

describe("Trial Abuse Prevention — Trial bypass via expired-first-bot", () => {
  let mockDb: any;
  let mockSellers: any;
  let mockHandlers: any;
  let mockBot: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSellers = {
      findOne: jest.fn(),
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "sellers") return mockSellers;
        return { findOne: jest.fn(), updateOne: jest.fn() };
      }),
    };
    (connectToDB as jest.Mock).mockResolvedValue(mockDb);

    const handlerCalls: any[] = [];
    mockBot = {
      command: jest.fn((cmd: string, fn: any) => {
        handlerCalls.push({ cmd, fn });
      }),
      on: jest.fn(),
      callbackQuery: jest.fn(),
      use: jest.fn(),
      catch: jest.fn(),
    };
    mockHandlers = handlerCalls;
  });

  it("denies trial when caller has an EXPERIOR seller record (any status)", async () => {
    // Existing seller is "expired" — old logic used $in: ["trial","active"] which
    // would treat this as first-store and grant a new trial. New logic must reject.
    const existingExpired = {
      _id: new ObjectId(),
      telegramId: "123456789",
      botToken: "expired-token",
      botUsername: "OldBot",
      status: "expired" as const,
      maxProducts: 3,
    };
    mockSellers.findOne.mockResolvedValue(existingExpired);

    const { attachManagerHandlers } = await import("../manager/handlers");
    attachManagerHandlers(mockBot);

    const startHandler = mockHandlers.find((h: any) => h.cmd === "start");
    expect(startHandler).toBeDefined();

    const ctx = {
      from: { id: 123456789 },
      reply: jest.fn().mockResolvedValue(undefined),
      session: {} as any,
    } as any;

    await startHandler.fn(ctx);

    // Trial check must have queried WITHOUT status filter — so an "expired"
    // prior seller is found and isFirstStore remains false.
    expect(mockSellers.findOne).toHaveBeenCalledWith({
      telegramId: "123456789",
    });

    // And the user must be told to use the existing store buttons.
    // (sendSellerStatus path was taken, NOT the new-seller tutorial.)
  });

  it("grants trial for truly new telegramId", async () => {
    // No existing seller at all.
    mockSellers.findOne.mockResolvedValue(null);

    const { attachManagerHandlers } = await import("../manager/handlers");
    attachManagerHandlers(mockBot);

    const startHandler = mockHandlers.find((h: any) => h.cmd === "start");
    const ctx = {
      from: { id: 999999999 },
      reply: jest.fn().mockResolvedValue(undefined),
      session: {} as any,
    } as any;

    await startHandler.fn(ctx);

    expect(mockSellers.findOne).toHaveBeenCalledWith({
      telegramId: "999999999",
    });
  });
});
