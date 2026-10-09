import crypto from "crypto";
import { connectToDB } from "../db";
import { Seller } from "../models/seller";
import { ObjectId } from "mongodb";
import { BotManager } from "../bot/manager";
import { decryptApiKey } from "../helpers/encryption";
import { getAdminIds } from "../helpers/getAdminIds";
import { t, template } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "NOWPayments" });

const API_KEY = process.env.NOWPAYMENTS_API_KEY || "";
const IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || "";
const API_BASE = process.env.NOWPAYMENTS_API_URL || "https://api.nowpayments.io/v1";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const FRONTEND_URL = process.env.FRONTEND_URL || "";

interface NOWPaymentsInvoice {
  id: number;
  order_id: string;
  order_description: string;
  price_amount: number;
  price_currency: string;
  pay_currency: string;
  ipn_callback_url: string;
  success_url: string;
  cancel_url: string;
  created_at: string;
  status: string;
}

interface NOWPaymentsPayment {
  id: number;
  order_id: string;
  pay_address: string;
  price_amount: number;
  price_currency: string;
  pay_amount: number;
  pay_currency: string;
  purchase_id: string;
  created_at: string;
  status: string;
  updated_at: string;
}

// ─── Validate API Key ────────────────────────────────────
export async function validateNOWPaymentsKey(apiKey: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  timeout.unref?.();
  try {
    const response = await fetch(`${API_BASE}/currencies`, {
      method: "GET",
      headers: { "x-api-key": apiKey },
      signal: controller.signal,
    });
    return response.ok;
  } catch (error) {
    log.error({ err: error }, "API key validation error");
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Create Invoice ──────────────────────────────────────
export async function createSubscriptionInvoice(
  sellerId: ObjectId,
  sellerUsername: string,
  days: number,
  amountUsd: number,
  sellerApiKey?: string
): Promise<{ invoiceId: number; paymentUrl: string } | null> {
  let resolvedKey = sellerApiKey && sellerApiKey.length > 0 ? decryptApiKey(sellerApiKey) : API_KEY;
  if (!resolvedKey) {
    log.error("API key not set");
    return null;
  }

  const orderId = `sub_${sellerId.toString()}_${Date.now()}`;

  // Save payment record BEFORE creating invoice on NOWPayments.
  // This prevents orphaned invoices if the DB insert fails after invoice creation.
  const db = await connectToDB();
  const paymentRecordId = new ObjectId();
  try {
    await db.collection("payments").insertOne({
      _id: paymentRecordId,
      sellerId,
      orderId,
      invoiceId: 0, // placeholder — updated after API response
      amount: amountUsd,
      days,
      status: "pending",
      createdAt: new Date(),
    });
  } catch (insertErr) {
    log.error({ sellerId: sellerId.toString(), err: insertErr }, "Failed to pre-create payment record");
    return null;
  }

  const body = {
    price_amount: amountUsd,
    price_currency: "usd",
    pay_currency: "btc",
    order_id: orderId,
    order_description: `Subscription: ${days} days for @${sellerUsername}`,
    ipn_callback_url: `${WEBHOOK_URL}/api/webhook/nowpayments`,
    success_url: FRONTEND_URL ? `${FRONTEND_URL}/payment/success` : undefined,
    cancel_url: FRONTEND_URL ? `${FRONTEND_URL}/payment/cancel` : undefined,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  timeout.unref?.();
  try {
    const response = await fetch(`${API_BASE}/invoice`, {
      method: "POST",
      headers: {
        "x-api-key": resolvedKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await response.text();
      log.error({ body: err }, "Invoice creation failed");
      // Mark the pre-created payment record as failed
      await db.collection("payments").updateOne(
        { _id: paymentRecordId },
        { $set: { status: "failed" } }
      ).catch(() => {});
      return null;
    }

    const data = await response.json() as NOWPaymentsInvoice;

    // Update the pre-created record with the real invoice ID
    await db.collection("payments").updateOne(
      { _id: paymentRecordId },
      { $set: { invoiceId: data.id } }
    );

    const paymentUrl = `https://nowpayments.io/invoice?invoice_id=${data.id}`;

    log.info({ invoiceId: data.id, seller: sellerUsername }, "Invoice created");
    return { invoiceId: data.id, paymentUrl };
  } catch (error) {
    log.error({ err: error }, "Invoice creation error");
    // Mark the pre-created payment record as failed
    await db.collection("payments").updateOne(
      { _id: paymentRecordId },
      { $set: { status: "failed" } }
    ).catch(() => {});
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Verify IPN Signature ────────────────────────────────
export function verifyIPNSignature(body: string, signature: string): boolean {
  if (!IPN_SECRET) {
    log.error("IPN secret not configured — cannot verify signature");
    return false;
  }

  const hmac = crypto.createHmac("sha512", IPN_SECRET);
  hmac.update(body);
  const expectedSignature = hmac.digest("hex");

  if (signature.length !== expectedSignature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

// ─── Handle IPN Callback ─────────────────────────────────
export async function handleIPNCallback(
  paymentData: NOWPaymentsPayment
): Promise<void> {
  log.info({ paymentId: paymentData.id, status: paymentData.status }, "IPN received");

  // Only process finished payments
  if (paymentData.status !== "finished") {
    log.info({ paymentId: paymentData.id, status: paymentData.status }, "Payment not finished yet");
    return;
  }

  const db = await connectToDB();
  const paymentsCollection = db.collection("payments");

  // ─── Step 1: Atomic payment status flip (idempotency guard) ───
  // If another worker already flipped this to "completed", this returns null
  // and we bail — preventing duplicate reactivation from concurrent retries.
  const paymentUpdate = await paymentsCollection.findOneAndUpdate(
    {
      invoiceId: paymentData.id,
      status: { $ne: "completed" },
    },
    {
      $set: { status: "completed", paidAt: new Date() },
    },
    { returnDocument: "after" }
  );

  if (!paymentUpdate) {
    log.info({ paymentId: paymentData.id }, "Payment already processed or not found");
    return;
  }

  const payment = paymentUpdate;

  // Write global history (best-effort — must not block reactivation)
  try {
    await db.collection("history").insertOne({
      _id: new ObjectId(),
      sellerId: payment.sellerId,
      actionType: "ipn_payment",
      description: `IPN payment confirmed for ${payment.days} days`,
      date: new Date(),
      amount: payment.amount,
      orderId: paymentData.order_id,
    });
  } catch (histErr) {
    log.error({ sellerId: payment.sellerId?.toString(), err: histErr }, "Failed to write IPN history (continuing reactivation)");
  }

  // ─── Step 2: Idempotent seller reactivation ───
  // Use $max instead of $set so retries can never shorten an existing subscription.
  // If the process crashes between Step 1 and Step 2, a retry of step 2 (via
  // reconciliation or a re-delivered IPN) is safe: it always extends or equalizes.
  const sellerId = payment.sellerId as ObjectId;
  const days = payment.days as number;

  const sellersCollection = db.collection<Seller>("sellers");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  await sellersCollection.updateOne(
    { _id: sellerId },
    {
      $set: {
        status: "active",
        maxProducts: 9999,
      },
      $max: { planExpiresAt: expiresAt },
    }
  );

  // ─── Step 3: Re-fetch seller for notifications (best-effort, isolated) ───
  const seller = await sellersCollection.findOne({ _id: sellerId });
  if (seller) {
    // Restart bot (best-effort)
    try {
      await BotManager.restartSeller(seller);
    } catch (restartErr) {
      log.error({ sellerId: sellerId.toString(), err: restartErr }, "Failed to restart seller bot");
    }

    // Notify seller
    try {
      const bot = BotManager.getPrimaryBot();
      if (bot) {
        await bot.api.sendMessage(
          seller.telegramId,
          template(t().adminPanel.paymentConfirmed, {
            username: seller.botUsername || "unknown",
            days: days.toString(),
            date: expiresAt.toLocaleDateString(),
          })
        );
      }
    } catch (err) {
      log.error({ sellerId: sellerId.toString(), err }, "Failed to notify seller");
    }
  }

  // Notify admin
  try {
    const bot = BotManager.getPrimaryBot();
    if (bot) {
      const valid = getAdminIds();

      for (const adminId of valid) {
        try {
          await bot.api.sendMessage(
            adminId,
            template(t().adminPanel.paymentReceived, {
              username: seller?.botUsername || "unknown",
              amount: payment.amount?.toString() || "0",
              days: days.toString(),
              date: expiresAt.toLocaleDateString(),
            })
          );
        } catch (e) {
          log.warn({ adminId, err: e }, "Admin notification failed");
        }
      }
    }
  } catch (err) {
    log.error({ err }, "Failed to notify admin");
  }

  log.info({ sellerId: sellerId.toString(), days, paymentId: paymentData.id }, "IPN: Seller reactivated successfully");
}
