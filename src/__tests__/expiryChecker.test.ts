import { ObjectId } from "mongodb";

// Mock dependencies before importing the module under test
jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

jest.mock("../bot/manager", () => ({
  BotManager: {
    stopSeller: jest.fn().mockResolvedValue(undefined),
    getPrimaryBot: jest.fn().mockReturnValue({
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    }),
  },
}));

jest.mock("../languages", () => ({
  t: jest.fn().mockReturnValue({
    adminPanel: {
      expiryTrialExpired: "Your trial has expired.",
      expiryPlanExpired: "Your subscription has expired.",
    },
  }),
}));

import { checkExpirations } from "../manager/expiry";
import { connectToDB } from "../db";
import { BotManager } from "../bot/manager";

function makeMockCollection() {
  const store: any[] = [];
  return {
    _store: store,
    find: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this._store);
    }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    _setQuery: function (q: any) {
      // Filter store based on query for find
      this._store = [];
      return this;
    },
  };
}

describe("Expiry Checker", () => {
  let mockCollection: ReturnType<typeof makeMockCollection>;
  let mockPayments: any;
  let mockHistory: any;
  const now = new Date();

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection = makeMockCollection();
    // Reconciliation safeguard calls `payments.find(...).toArray()` first.
    // Default: no payments to reconcile.
    mockPayments = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    };
    mockHistory = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };
    (connectToDB as jest.Mock).mockResolvedValue({
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "payments") return mockPayments;
        if (name === "history") return mockHistory;
        return mockCollection;
      }),
    });
  });

  it("returns 0 when no sellers need expiring", async () => {
    mockCollection._store = [];
    const count = await checkExpirations();
    expect(count).toBe(0);
  });

  it("expires trial sellers with past trialExpiresAt", async () => {
    const expiredSeller = {
      _id: new ObjectId(),
      status: "trial",
      trialExpiresAt: new Date(now.getTime() - 86400000), // yesterday
      botUsername: "TestBot",
      telegramId: "12345",
    };

    // First call: expired trials, second call: expired plans (empty)
    mockCollection.find
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([expiredSeller]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]),
      });

    const count = await checkExpirations();
    expect(count).toBe(1);
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: expiredSeller._id },
      { $set: { status: "expired" } }
    );
  });

  it("expires active sellers with past planExpiresAt", async () => {
    const expiredPlan = {
      _id: new ObjectId(),
      status: "active",
      planExpiresAt: new Date(now.getTime() - 86400000),
      botUsername: "PaidBot",
      telegramId: "99999",
    };

    mockCollection.find
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]), // no expired trials
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([expiredPlan]),
      });

    const count = await checkExpirations();
    expect(count).toBe(1);
    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: expiredPlan._id },
      { $set: { status: "expired" } }
    );
  });

  it("does not touch sellers with future expiry dates", async () => {
    const futureSeller = {
      _id: new ObjectId(),
      status: "trial",
      trialExpiresAt: new Date(now.getTime() + 86400000), // tomorrow
      botUsername: "FutureBot",
      telegramId: "11111",
    };

    mockCollection.find
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]), // no expired trials
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]), // no expired plans
      });

    const count = await checkExpirations();
    expect(count).toBe(0);
    expect(mockCollection.updateOne).not.toHaveBeenCalled();
  });

  it("counts multiple expirations", async () => {
    const expired1 = { _id: new ObjectId(), status: "trial", trialExpiresAt: new Date(0), botUsername: "A", telegramId: "1" };
    const expired2 = { _id: new ObjectId(), status: "trial", trialExpiresAt: new Date(0), botUsername: "B", telegramId: "2" };

    mockCollection.find
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([expired1, expired2]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]),
      });

    const count = await checkExpirations();
    expect(count).toBe(2);
    expect(mockCollection.updateOne).toHaveBeenCalledTimes(2);
  });

  it("calls BotManager.stopSeller for each expired seller", async () => {
    const expired = {
      _id: new ObjectId(),
      status: "active",
      planExpiresAt: new Date(0),
      botUsername: "StopMe",
      telegramId: "33333",
    };

    mockCollection.find
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([expired]),
      });

    await checkExpirations();
    expect(BotManager.stopSeller).toHaveBeenCalledWith(expired._id.toString());
  });

  it("sends notification to seller on expiry", async () => {
    const expired = {
      _id: new ObjectId(),
      status: "trial",
      trialExpiresAt: new Date(0),
      botUsername: "NotifyMe",
      telegramId: "44444",
    };

    mockCollection.find
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([expired]),
      })
      .mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]),
      });

    const mockBot = { api: { sendMessage: jest.fn().mockResolvedValue(undefined) } };
    (BotManager.getPrimaryBot as jest.Mock).mockReturnValue(mockBot);

    await checkExpirations();
    expect(mockBot.api.sendMessage).toHaveBeenCalledWith(
      "44444",
      "Your trial has expired."
    );
  });
});
