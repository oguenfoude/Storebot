import { connectToDB } from "../db";
import { Seller } from "../models/seller";
import { BotManager } from "../bot/manager";
import { ObjectId } from "mongodb";
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "Expiry" });

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startExpiryChecker(): void {
  log.info("Starting trial/plan expiry checker (every 1 hour)");

  // Run immediately on start
  checkExpirations().catch((err) => {
    log.error({ err }, "Error during initial expiry check");
  });

  // Then run every hour
  setInterval(() => {
    checkExpirations().catch((err) => {
      log.error({ err }, "Error during expiry check");
    });
  }, CHECK_INTERVAL_MS);
}

export async function checkExpirations(): Promise<number> {
  const db = await connectToDB();
  const sellersCollection = db.collection<Seller>("sellers");
  const now = new Date();
  let expiredCount = 0;

  // ─── Reconciliation safeguard ───────────────────────────────
  // Before scanning for expiries, run the IPN reactivation reconciliation:
  // catches the case where handleIPNCallback crashed between writing
  // payments.status = "completed" and reactivating the seller document.
  await reconcileCompletedPayments();

  // 1. Expire trials
  const expiredTrials = await sellersCollection
    .find({
      status: "trial",
      trialExpiresAt: { $lte: now },
    })
    .toArray();

  for (const seller of expiredTrials) {
    try {
      await sellersCollection.updateOne(
        { _id: seller._id },
        { $set: { status: "expired" } }
      );

      // Stop the bot
      if (seller._id) {
        await BotManager.stopSeller(seller._id.toString());
      }

      // Notify seller
      await notifySellerExpired(seller, "trial");

      expiredCount++;
      log.info({ seller: seller.botUsername || seller._id?.toString() }, "Trial expired");
    } catch (err) {
      log.error({ sellerId: seller._id?.toString(), err }, "Failed to expire trial seller");
    }
  }

  // 2. Expire paid plans
  const expiredPlans = await sellersCollection
    .find({
      status: "active",
      planExpiresAt: { $lte: now },
    })
    .toArray();

  for (const seller of expiredPlans) {
    try {
      await sellersCollection.updateOne(
        { _id: seller._id },
        { $set: { status: "expired" } }
      );

      // Stop the bot
      if (seller._id) {
        await BotManager.stopSeller(seller._id.toString());
      }

      // Notify seller
      await notifySellerExpired(seller, "plan");

      expiredCount++;
      log.info({ seller: seller.botUsername || seller._id?.toString() }, "Plan expired");
    } catch (err) {
      log.error({ sellerId: seller._id?.toString(), err }, "Failed to expire paid seller");
    }
  }

  if (expiredCount > 0) {
    log.info({ count: expiredCount }, "Expired sellers");
  }

  return expiredCount;
}

async function notifySellerExpired(seller: Seller, type: "trial" | "plan"): Promise<void> {
  try {
    const bot = BotManager.getPrimaryBot();
    if (!bot) return;

    const message = type === "trial" ? t().adminPanel.expiryTrialExpired : t().adminPanel.expiryPlanExpired;
    await bot.api.sendMessage(seller.telegramId, message);
  } catch (error) {
    log.error({ sellerId: seller._id?.toString(), err: error }, "Failed to notify seller");
  }
}

export async function reactivateSeller(sellerId: ObjectId, days: number): Promise<void> {
  const db = await connectToDB();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // Use $max instead of $set so admin renewal never shortens an existing subscription.
  // This is consistent with how handleIPNCallback() and reconcileCompletedPayments() work.
  await db.collection<Seller>("sellers").updateOne(
    { _id: sellerId },
    {
      $set: {
        status: "active",
        maxProducts: 9999,
      },
      $max: { planExpiresAt: expiresAt },
    }
  );

  // Restart the bot (best-effort)
  try {
    const seller = await db.collection<Seller>("sellers").findOne({ _id: sellerId });
    if (seller) {
      await BotManager.restartSeller(seller);
    }
  } catch (restartErr) {
    log.warn({ sellerId: sellerId.toString(), err: restartErr }, "Failed to restart seller bot after reactivation");
  }

  log.info({ sellerId: sellerId.toString(), days }, "Reactivated seller");
}

/**
 * Reconciliation safeguard for IPN reactivation crash recovery.
 *
 * Background: handleIPNCallback() in src/services/nowpayments.ts performs two
 * non-atomic writes:
 *   Step 1: payments.findOneAndUpdate({ status: { $ne: "completed" } }, { $set: { status: "completed", paidAt: new Date() } })
 *   Step 2: sellers.updateOne({ _id: sellerId }, { $set: { status, maxProducts }, $max: { planExpiresAt } })
 *
 * If the process crashes between Step 1 and Step 2, NOWPayments already
 * received a 200 OK response (server.ts:53) and will NOT retry the IPN.
 * The payment is irrevocably marked "completed" but the seller was never
 * reactivated — silent permanent loss of subscription.
 *
 * This function scans payments where status: "completed" but the linked
 * seller's planExpiresAt doesn't reflect the payment, and applies the same
 * atomic reactivation as Step 2. Recovery time is bounded by the
 * CHECK_INTERVAL_MS (1 hour worst case).
 *
 * Notification: a seller gets exactly ONE Telegram notification per
 * reconciliation event — gated by the `reconciledNotifiedAt` field on the
 * payment document. Replay runs (idempotent) stay silent.
 */
export async function reconcileCompletedPayments(): Promise<number> {
  const db = await connectToDB();
  const paymentsCollection = db.collection("payments");
  const sellersCollection = db.collection<Seller>("sellers");

  // Find all completed payments with a paidAt that we can use for deterministic
  // expiry recomputation. A payment without paidAt means it was never fully
  // Step-1'd, so we skip it (the live IPN handler will retry if appropriate).
  const completedPayments = await paymentsCollection
    .find({
      status: "completed",
      paidAt: { $exists: true },
      days: { $exists: true },
      sellerId: { $exists: true },
    })
    .toArray();

  let reconciledCount = 0;

  for (const payment of completedPayments) {
    const sellerId = payment.sellerId as ObjectId;
    const days = payment.days as number;
    const paidAt = payment.paidAt as Date;

    // Recompute the expected planExpiresAt deterministically from paidAt + days
    const expectedExpiresAt = new Date(paidAt.getTime() + days * 24 * 60 * 60 * 1000);

    const seller = await sellersCollection.findOne({ _id: sellerId });
    if (!seller) {
      // Orphaned payment (seller deleted). Leave it; nothing to reconcile to.
      continue;
    }

    // If the seller's planExpiresAt already covers the expected expiry, no
    // action needed — either Step 2 ran live, or a prior reconciliation already
    // fixed it. This is the key idempotency guard.
    const currentExpiry = seller.planExpiresAt ? seller.planExpiresAt.getTime() : 0;
    if (currentExpiry >= expectedExpiresAt.getTime()) {
      continue;
    }

    // Apply the same atomic reactivation as handleIPNCallback Step 2.
    // $max guarantees a replay can never shorten an existing subscription.
    await sellersCollection.updateOne(
      { _id: sellerId },
      {
        $set: {
          status: "active",
          maxProducts: 9999,
        },
        $max: { planExpiresAt: expectedExpiresAt },
      }
    );

    // Restart the seller's bot (best-effort; wrapped in try/catch)
    try {
      const refreshed = await sellersCollection.findOne({ _id: sellerId });
      if (refreshed) {
        await BotManager.restartSeller(refreshed);
      }
    } catch (restartErr) {
      log.warn({ sellerId: sellerId.toString(), err: restartErr }, "Reconcile: bot restart failed");
    }

    // Notify seller exactly once across all reconciliation runs.
    // The reconciledNotifiedAt flag on the payment document is the idempotency
    // guard: set atomically, only the first run that grabs it gets to send.
    const notifyFlip = await paymentsCollection.findOneAndUpdate(
      {
        _id: payment._id,
        reconciledNotifiedAt: { $exists: false },
      },
      {
        $set: { reconciledNotifiedAt: new Date() },
      },
      { returnDocument: "after" }
    );

    if (notifyFlip) {
      try {
        const bot = BotManager.getPrimaryBot();
        if (bot && seller.telegramId) {
          await bot.api.sendMessage(
            seller.telegramId,
            `Payment confirmed!\n\n` +
            `Your store @${seller.botUsername || "store"} has been reactivated ` +
            `for ${days} days. Expires: ${expectedExpiresAt.toLocaleDateString()}\n\n` +
            `Thank you for your payment!`
          );
        }
      } catch (notifyErr) {
        log.warn({ sellerId: sellerId.toString(), err: notifyErr }, "Reconcile: notification failed");
      }
    }

    // Write reconciliation row to global history (best-effort, silent on fail)
    try {
      await db.collection("history").insertOne({
        _id: new ObjectId(),
        sellerId,
        actionType: "ipn_reconcile",
        description: `Reconciled missed IPN reactivation for ${days} days`,
        date: new Date(),
        amount: payment.amount,
        paymentId: payment._id,
      });
    } catch (histErr) {
      log.warn({ sellerId: sellerId.toString(), err: histErr }, "Reconcile: history write failed");
    }

    reconciledCount++;
    log.info({ sellerId: sellerId.toString(), paymentId: payment._id?.toString(), days }, "Reconciled missed IPN reactivation");
  }

  if (reconciledCount > 0) {
    log.info({ count: reconciledCount }, "Reconciled missed payments");
  }

  return reconciledCount;
}
