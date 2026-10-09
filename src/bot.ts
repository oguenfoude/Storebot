import dotenv from "dotenv";
import { connectToDB, closeDB } from "./db";
import { BotManager } from "./bot/manager";
import { setLanguage } from "./languages";
import { startManagerBot, stopManagerBot } from "./manager/bot";
import { startExpiryChecker } from "./manager/expiry";
import { startWebhookServer, stopWebhookServer } from "./server";
import logger from "./helpers/logger";

dotenv.config({ quiet: true });

if (process.env.BOT_LANGUAGE) {
  setLanguage(process.env.BOT_LANGUAGE);
}

let shuttingDown = false;

async function bootstrap() {
  try {
    await connectToDB();

    // Boot all active seller bots
    await BotManager.bootAll();
    logger.info(
      { tag: "Bootstrap", botCount: BotManager.runningCount },
      `${BotManager.runningCount} seller bot(s) running`
    );

    // Start Manager Bot (owner's admin panel)
    await startManagerBot();

    // Start trial/plan expiry checker
    startExpiryChecker();

    // Start webhook server for NOWPayments
    startWebhookServer();
  } catch (err) {
    logger.fatal({ err, tag: "Bootstrap" }, "Bootstrap failed");
    throw err;
  }
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ tag: "Shutdown", signal }, `${signal} received, shutting down gracefully...`);

  try {
    await stopWebhookServer();
  } catch (e) {
    logger.warn({ err: e, tag: "Shutdown" }, "Webhook server stop failed");
  }

  try {
    await stopManagerBot();
  } catch (e) {
    logger.warn({ err: e, tag: "Shutdown" }, "Manager bot stop failed");
  }

  try {
    await BotManager.stopAll();
  } catch (e) {
    logger.warn({ err: e, tag: "Shutdown" }, "BotManager.stopAll failed");
  }

  try {
    await closeDB();
  } catch (e) {
    logger.warn({ err: e, tag: "Shutdown" }, "closeDB failed");
  }

  logger.info({ tag: "Shutdown" }, "Shutdown complete");
  process.exit(0);
}

bootstrap().catch((err) => {
  logger.fatal({ err, tag: "Bootstrap" }, "Failed to start server or bot");
  process.exit(1);
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((e) => {
    logger.fatal({ err: e, tag: "Shutdown" }, "Error during SIGINT cleanup");
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((e) => {
    logger.fatal({ err: e, tag: "Shutdown" }, "Error during SIGTERM cleanup");
    process.exit(1);
  });
});
