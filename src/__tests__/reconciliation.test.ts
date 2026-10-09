import { ObjectId } from "mongodb";

// Mock dependencies before importing the module under test.
jest.mock("../db", () => ({
  connectToDB: jest.fn(),
}));

// BotManager mock: capture sendMessage + restartSeller calls
const stopSellerMock = jest.fn().mockResolvedValue(undefined);
const getPrimaryBotMock = jest.fn().mockReturnValue({
  api: { sendMessage: jest.fn().mockResolvedValue(undefined) },
});
const restartSellerMock = jest.fn().mockResolvedValue(undefined);

jest.mock("../bot/manager", () => ({
  BotManager: {
    stopSeller: stopSellerMock,
    getPrimaryBot: getPrimaryBotMock,
    restartSeller: restartSellerMock,
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

import { reconcileCompletedPayments } from "../manager/expiry";
import { connectToDB } from "../db";
import { BotManager } from "../bot/manager";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("IPN Reconciliation Safeguard", () => {
  let mockPayments: any;
  let mockSellers: any;
  let mockHistory: any;
  let mockDb: any;

  const sellerId = new ObjectId();
  const paymentId = new ObjectId();

  beforeEach(() => {
    jest.clearAllMocks();

    // payments collection: find returns whatever the test sets as the fixture.
    // findOneAndUpdate is used for the notify-idempotency flip — returns the
    // updated document on the first call (when the filter matches) and null on
    // subsequent calls (when reconciledNotifiedAt is already set).
    mockPayments = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn() }),
      findOneAndUpdate: jest.fn(),
    };

    // sellers collection: findOne returns the fixture, updateOne records state.
    mockSellers = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn() }),
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    mockHistory = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    };

    mockDb = {
      collection: jest.fn().mockImplementation((name: string) => {
        if (name === "payments") return mockPayments;
        if (name === "sellers") return mockSellers;
        if (name === "history") return mockHistory;
        return { findOne: jest.fn(), updateOne: jest.fn(), insertOne: jest.fn() };
      }),
    };

    (connectToDB as jest.Mock).mockResolvedValue(mockDb);
  });

  // ─── Scenario 1: Crash gap — payment completed, seller not reactivated ───
  it("reactivates seller when payments.status is completed but seller.planExpiresAt is missing", async () => {
    // Simulate the crash window: payment was marked completed yesterday for a
    // 30-day plan, but the seller's planExpiresAt was never set (process
    // crashed between Step 1 and Step 2 of handleIPNCallback).
    const paidAt = new Date(Date.now() - DAY); // paid yesterday
    const sellerFixture = {
      _id: sellerId,
      telegramId: "111222333",
      botUsername: "CrashGapBot",
      status: "expired",
      // planExpiresAt intentionally missing — orphaned by crash
    };

    mockPayments.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: paymentId,
          sellerId,
          days: 30,
          paidAt,
          status: "completed",
          amount: 3,
        },
      ]),
    });

    // Seller always resolves to the same fixture on this test
    mockSellers.findOne.mockResolvedValue(sellerFixture);

    // findOneAndUpdate for the notify flag SUCCEEDS — first reconciliation run
    mockPayments.findOneAndUpdate.mockResolvedValue({
      _id: paymentId,
      reconciledNotifiedAt: new Date(),
    });

    const count = await reconcileCompletedPayments();

    // Seller must have been updated to active with $max on planExpiresAt
    expect(mockSellers.updateOne).toHaveBeenCalledWith(
      { _id: sellerId },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "active", maxProducts: 9999 }),
        $max: expect.objectContaining({ planExpiresAt: expect.any(Date) }),
      })
    );

    // The expected expiresAt should be paidAt + 30 days
    const updateCallArg = mockSellers.updateOne.mock.calls[0][1] as any;
    const expectedExpiry = updateCallArg.$max.planExpiresAt as Date;
    expect(expectedExpiry.getTime()).toBeCloseTo(paidAt.getTime() + 30 * DAY, -3);

    // Notification flag set exactly once
    expect(mockPayments.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockPayments.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: paymentId,
        reconciledNotifiedAt: { $exists: false },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ reconciledNotifiedAt: expect.any(Date) }),
      }),
      { returnDocument: "after" }
    );

    // Telegram notification sent (via BotManager.getPrimaryBot's api.sendMessage)
    const bot = BotManager.getPrimaryBot();
    expect(bot?.api.sendMessage).toHaveBeenCalledWith(
      "111222333",
      expect.stringContaining("30 days")
    );

    // History row written for the reconciliation
    expect(mockHistory.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "ipn_reconcile",
        sellerId,
        paymentId,
      })
    );

    // Counter incremented
    expect(count).toBe(1);
  });

  // ─── Scenario 2: No-op when the seller is already reactivated ───
  it("skips reconciliation when seller.planExpiresAt already covers the expected expiry", async () => {
    const paidAt = new Date(Date.now() - DAY);
    // Seller already has planExpiresAt 60 days out — well past the 30-day plan
    // the payment would extend to.
    const sellerFixture = {
      _id: sellerId,
      telegramId: "111222333",
      botUsername: "AlreadyReactivated",
      status: "active",
      planExpiresAt: new Date(Date.now() + 60 * DAY), // 60 days out
    };

    mockPayments.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: paymentId,
          sellerId,
          days: 30,
          paidAt,
          status: "completed",
          amount: 3,
        },
      ]),
    });

    mockSellers.findOne.mockResolvedValue(sellerFixture);

    const count = await reconcileCompletedPayments();

    // No seller update — already covered
    expect(mockSellers.updateOne).not.toHaveBeenCalled();

    // No notification flip (no need)
    expect(mockPayments.findOneAndUpdate).not.toHaveBeenCalled();

    // No history row
    expect(mockHistory.insertOne).not.toHaveBeenCalled();

    // Counter reports zero
    expect(count).toBe(0);
  });

  // ─── Scenario 3: Pending payments are ignored ───
  it("does not reconcile payments that are not 'completed'", async () => {
    // Only "pending" payments exist — they should never be touched
    mockPayments.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: paymentId,
          sellerId,
          days: 30,
          paidAt: new Date(),
          status: "pending", // not completed — shouldn't be touched
          amount: 3,
        },
      ]),
    });

    const count = await reconcileCompletedPayments();

    // The find query itself must filter by status: "completed"
    expect(mockPayments.find).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );

    // Since the only payment is "pending", reconciliation should find 0 entries
    // matching the actual find result. (Note: our mock returns the fixture
    // unconditionally, but the real query filters — this test ensures the find
    // shape matches expectations. We can also assert that findOne returns null
    // for sellers paired with pending payments, confirming no action.)
    expect(mockSellers.updateOne).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  // ─── Scenario 4: Notification fires exactly once across two runs ───
  it("sends Telegram notification exactly once across two consecutive reconciliation runs", async () => {
    // Simulate a payment that crashed mid-way and was never notified.
    const paidAt = new Date(Date.now() - DAY);
    const sellerFixture = {
      _id: sellerId,
      telegramId: "111222333",
      botUsername: "IdempotentBot",
      status: "expired",
    };

    mockPayments.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: paymentId,
          sellerId,
          days: 30,
          paidAt,
          status: "completed",
          amount: 3,
        },
      ]),
    });

    mockSellers.findOne.mockResolvedValue(sellerFixture);

    // CRITICAL: First run's findOneAndUpdate SUCCEEDS (notifyFlip set).
    // Second run's findOneAndUpdate RETURNS NULL (flag already set, second run
    // sees the filter doesn't match). Real MongoDB would behave this way.
    mockPayments.findOneAndUpdate
      .mockResolvedValueOnce({
        _id: paymentId,
        reconciledNotifiedAt: new Date(),
      })
      .mockResolvedValueOnce(null);

    // ── First run ──
    const count1 = await reconcileCompletedPayments();
    expect(count1).toBe(1);
    // After first run, the seller is "active" — so the seller fixture for the
    // second run reflects the updated state (planExpiresAt already set).
    const reactivatedSeller = {
      ...sellerFixture,
      status: "active" as const,
      planExpiresAt: new Date(paidAt.getTime() + 30 * DAY),
    };
    mockSellers.findOne.mockResolvedValue(reactivatedSeller);

    // ── Second run (replay) ──
    const count2 = await reconcileCompletedPayments();
    // count is 0 because the seller's planExpiresAt already covers — updateOne
    // is skipped entirely. The notify flip is never even attempted.
    expect(count2).toBe(0);

    // ── Total: Telegram notification sent EXACTLY once ──
    const bot = BotManager.getPrimaryBot();
    expect(bot?.api.sendMessage).toHaveBeenCalledTimes(1);

    // ── Total: payments.findOneAndUpdate called exactly once (not twice) ──
    // Because the second run's seller.planExpiresAt check already covers the
    // expected expiry, the reconcile loop skips the entire per-payment block —
    // including the notify flip. So findOneAndUpdate is called ONCE over both
    // runs.
    expect(mockPayments.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
