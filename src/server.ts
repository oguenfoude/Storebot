import express from "express";
import dotenv from "dotenv";
import type { Server } from "http";
import { randomUUID } from "crypto";
import { verifyIPNSignature, handleIPNCallback } from "./services/nowpayments";
import logger from "./helpers/logger";

dotenv.config({ quiet: true });

let httpServer: Server | null = null;

export function startWebhookServer(): void {
  const port = parseInt(process.env.WEBHOOK_PORT || "3000", 10);
  const app = express();

  // Parse raw body for signature verification
  app.use("/api/webhook/nowpayments", express.raw({ type: "application/json" }));
  app.use(express.json());

  // Health check
  app.get("/health", async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    // MongoDB
    try {
      const dbModule = await import("./db");
      const db = await dbModule.connectToDB();
      await db.command({ ping: 1 });
      checks.mongodb = { ok: true };
    } catch (e) {
      checks.mongodb = { ok: false, detail: String((e as Error).message) };
    }

    // BotManager
    try {
      const botManagerModule = await import("./bot/manager");
      checks.botManager = { ok: true, detail: `runningCount=${botManagerModule.BotManager.runningCount}` };
    } catch (e) {
      checks.botManager = { ok: false, detail: String((e as Error).message) };
    }

    // IPN secret
    checks.ipnSecret = {
      ok: !!process.env.NOWPAYMENTS_IPN_SECRET,
      detail: process.env.NOWPAYMENTS_IPN_SECRET ? "configured" : "missing — webhook rejects all IPNs with 501",
    };

    const allOk = Object.values(checks).every((c) => c.ok);
    res.status(allOk ? 200 : 503).json({
      status: allOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || "unknown",
      checks,
    });
  });

  // NOWPayments IPN webhook
  app.post("/api/webhook/nowpayments", async (req, res) => {
    const requestId = randomUUID();
    const childLogger = logger.child({ tag: "Webhook", requestId });

    try {
      const rawBody = req.body.toString("utf8");
      const signature = req.headers["x-nowpayments-sig"] as string;

      childLogger.info({ invoiceId: "(parsing)" }, "IPN webhook received");

      const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
      if (!ipnSecret) {
        childLogger.warn("IPN secret not configured — rejecting with 501");
        res.status(501).json({ error: "IPN not configured" });
        return;
      }

      if (!signature) {
        childLogger.warn("Missing IPN signature — rejecting with 401");
        res.status(401).json({ error: "Missing signature" });
        return;
      }

      if (!verifyIPNSignature(rawBody, signature)) {
        childLogger.warn("Invalid IPN signature — rejecting with 401");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      const paymentData = JSON.parse(rawBody);

      res.status(200).json({ status: "ok" });
      childLogger.info(
        { paymentId: paymentData.id, status: paymentData.status },
        "IPN accepted — processing in background"
      );
      await handleIPNCallback(paymentData);
    } catch (error) {
      childLogger.error({ err: error }, "Error processing IPN");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal error" });
      }
    }
  });

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  httpServer = app.listen(port, () => {
    logger.info({ tag: "Webhook", port }, `Webhook server listening on port ${port}`);
  });
}

export async function stopWebhookServer(): Promise<void> {
  if (!httpServer) return;
  await new Promise<void>((resolve) => {
    (httpServer as any).closeAllConnections?.();
    httpServer!.close(() => resolve());
  });
  httpServer = null;
  logger.info({ tag: "Webhook" }, "Webhook server closed");
}
