import { ObjectId } from "mongodb";

process.env.API_KEY_ENCRYPTION_SECRET = "test-secret-for-encryption";

jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

jest.mock("../bot/manager", () => ({
  BotManager: {
    getPrimaryBot: jest.fn().mockReturnValue({
      api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
    }),
    restartSeller: jest.fn().mockResolvedValue(undefined),
  },
}));

import { handleIPNCallback } from "../services/nowpayments";
import { connectToDB } from "../db";

describe("IPN Payment History Write", () => {
  let mockDb: any;
  let mockPaymentsCollection: any;
  let mockSellersCollection: any;
  let mockHistoryCollection: any;

  const sellerId = new ObjectId();
  const invoiceId = 12345;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPaymentsCollection = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockSellersCollection = {
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      findOne: jest.fn().mockResolvedValue({
        _id: sellerId,
        telegramId: "111111111",
        botUsername: "TestBot",
      }),
    };
    mockHistoryCollection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "payments") return mockPaymentsCollection;
        if (name === "sellers") return mockSellersCollection;
        if (name === "history") return mockHistoryCollection;
        return { findOne: jest.fn(), updateOne: jest.fn(), insertOne: jest.fn() };
      }),
    };

    (connectToDB as jest.Mock).mockResolvedValue(mockDb);
  });

  it("writes history entry on successful IPN payment", async () => {
    mockPaymentsCollection.findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      sellerId,
      invoiceId,
      orderId: "sub_abc_12345",
      amount: 3,
      days: 30,
      status: "completed",
    });

    await handleIPNCallback({
      id: invoiceId,
      order_id: "sub_abc_12345",
      status: "finished",
      pay_address: "btc_address",
      price_amount: 3,
      price_currency: "usd",
      pay_amount: 0.0001,
      pay_currency: "btc",
      purchase_id: "purchase_123",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    expect(mockHistoryCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "ipn_payment",
        sellerId,
        amount: 3,
        orderId: "sub_abc_12345",
      })
    );
  });

  it("history entry includes date field", async () => {
    mockPaymentsCollection.findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      sellerId,
      invoiceId,
      orderId: "sub_def_67890",
      amount: 8,
      days: 90,
      status: "completed",
    });

    await handleIPNCallback({
      id: invoiceId,
      order_id: "sub_def_67890",
      status: "finished",
      pay_address: "btc_address",
      price_amount: 8,
      price_currency: "usd",
      pay_amount: 0.0003,
      pay_currency: "btc",
      purchase_id: "purchase_456",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    const historyCall = mockHistoryCollection.insertOne.mock.calls[0][0];
    expect(historyCall.date).toBeInstanceOf(Date);
  });

  it("does not write history when payment is not finished", async () => {
    await handleIPNCallback({
      id: invoiceId,
      order_id: "sub_abc",
      status: "pending",
      pay_address: "btc_address",
      price_amount: 3,
      price_currency: "usd",
      pay_amount: 0.0001,
      pay_currency: "btc",
      purchase_id: "purchase_789",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    expect(mockHistoryCollection.insertOne).not.toHaveBeenCalled();
  });

  it("bails when findOneAndUpdate returns null (already completed or unknown)", async () => {
    mockPaymentsCollection.findOneAndUpdate.mockResolvedValue(null);

    await handleIPNCallback({
      id: invoiceId,
      order_id: "sub_dup",
      status: "finished",
      pay_address: "btc_address",
      price_amount: 3,
      price_currency: "usd",
      pay_amount: 0.0001,
      pay_currency: "btc",
      purchase_id: "purchase_999",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    // No history written, no reactivation triggered
    expect(mockHistoryCollection.insertOne).not.toHaveBeenCalled();
    expect(mockSellersCollection.updateOne).not.toHaveBeenCalled();
  });

  it("uses $max on planExpiresAt so retries cannot shorten an existing subscription", async () => {
    mockPaymentsCollection.findOneAndUpdate.mockResolvedValue({
      _id: new ObjectId(),
      sellerId,
      invoiceId,
      orderId: "sub_idempotency",
      amount: 3,
      days: 30,
      status: "completed",
    });

    await handleIPNCallback({
      id: invoiceId,
      order_id: "sub_idempotency",
      status: "finished",
      pay_address: "btc_address",
      price_amount: 3,
      price_currency: "usd",
      pay_amount: 0.0001,
      pay_currency: "btc",
      purchase_id: "purchase_555",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as any);

    expect(mockSellersCollection.updateOne).toHaveBeenCalledWith(
      { _id: sellerId },
      expect.objectContaining({
        $max: expect.objectContaining({ planExpiresAt: expect.any(Date) }),
        $set: expect.objectContaining({ status: "active" }),
      })
    );
  });
});
