import { ObjectId } from "mongodb";

process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";
process.env.TELEGRAM_ADMIN_IDS = "999999";
process.env.MONGODB_URI = "mongodb://localhost:27017";
process.env.DBName = "testdb";

jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

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
    session: jest.fn(() => (m: any, n: any) => n ? 0 : undefined),
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

jest.mock("../bot/manager", () => ({
  BotManager: {
    bootSeller: jest.fn(),
    stopSeller: jest.fn(),
  },
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

import { connectToDB } from "../db";
import { handleConfirmRecharge } from "../manager/handlers";

describe("Recharge Command — Real handleConfirmRecharge", () => {
  let mockDb: any;
  let mockUsersCollection: any;
  let mockHistoryCollection: any;
  let ctx: any;

  const userId = new ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();

    mockUsersCollection = {
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockHistoryCollection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "users") return mockUsersCollection;
        if (name === "history") return mockHistoryCollection;
        return { findOne: jest.fn(), updateOne: jest.fn(), insertOne: jest.fn() };
      }),
    };

    (connectToDB as jest.Mock).mockResolvedValue(mockDb);

    ctx = {
      from: { id: 999999 },
      reply: jest.fn().mockResolvedValue(undefined),
      session: {},
    };
  });

  it("credits balance and writes global history on successful recharge", async () => {
    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "111111111",
      sellerId: new ObjectId("aabbccddeeff001122334455"),
      balance: 50,
    });

    await handleConfirmRecharge(ctx, userId.toString(), 100);

    // $inc on balance
    expect(mockUsersCollection.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      { $inc: { balance: 100 } }
    );
    // Global history insert
    expect(mockHistoryCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        actionType: "recharge",
        amount: 100,
        description: "Admin recharge: 100 pts",
      })
    );
    // Reply with success including amount and userId
    expect(ctx.reply).toHaveBeenCalledWith(
      "Recharged 100 points to user " + userId.toString() + ".",
      expect.anything()
    );
  });

  it("reply contains the correct amount and user id", async () => {
    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "111111111",
      balance: 50,
    });

    await handleConfirmRecharge(ctx, userId.toString(), 250);

    expect(ctx.reply).toHaveBeenCalledWith(
      "Recharged 250 points to user " + userId.toString() + ".",
      expect.anything()
    );
  });

  it("forwards the sellerId into the global history entry", async () => {
    const sellerId = new ObjectId("11223344556677889900aabb");
    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "111111111",
      sellerId,
      balance: 50,
    });

    await handleConfirmRecharge(ctx, userId.toString(), 50);

    expect(mockHistoryCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ sellerId, actionType: "recharge" })
    );
  });

  it("does nothing when user is not found", async () => {
    mockUsersCollection.findOne.mockResolvedValue(null);

    await handleConfirmRecharge(ctx, userId.toString(), 100);

    expect(ctx.reply).toHaveBeenCalledWith("User not found.");
    expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    expect(mockHistoryCollection.insertOne).not.toHaveBeenCalled();
  });

  it("returns early for non-admin caller", async () => {
    ctx.from = { id: 123456 }; // not an admin
    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "111111111",
      balance: 50,
    });

    await handleConfirmRecharge(ctx, userId.toString(), 100);

    expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    expect(mockHistoryCollection.insertOne).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("returns early for invalid amount", async () => {
    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "111111111",
      balance: 50,
    });

    await handleConfirmRecharge(ctx, userId.toString(), 0);
    await handleConfirmRecharge(ctx, userId.toString(), -5);

    expect(mockUsersCollection.updateOne).not.toHaveBeenCalled();
    expect(mockHistoryCollection.insertOne).not.toHaveBeenCalled();
  });

  it("does not write history when updateOne throws", async () => {
    mockUsersCollection.findOne.mockResolvedValue({
      _id: userId,
      telegramId: "111111111",
      balance: 50,
    });
    mockUsersCollection.updateOne.mockRejectedValueOnce(new Error("DB connection lost"));

    await expect(handleConfirmRecharge(ctx, userId.toString(), 100)).rejects.toThrow("DB connection lost");
    expect(mockHistoryCollection.insertOne).not.toHaveBeenCalled();
  });
});
