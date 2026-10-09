import { Bot } from "grammy";
import dotenv from "dotenv";
import fs from "fs";
import { attachManagerHandlers, ManagerContext } from "./handlers";
import { MyContext } from "../types";
import { getAdminIds } from "../helpers/getAdminIds";
import logger from "../helpers/logger";

dotenv.config({ quiet: true });

const logDir = "logs";
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

export function createManagerBot(): Bot<ManagerContext> | null {
  const rawToken = process.env.MANAGER_BOT_TOKEN?.trim();
  const token = rawToken ? rawToken.replace(/^["']|["']$/g, "") : undefined;
  if (!token) {
    logger.info({ tag: "ManagerBot" }, "MANAGER_BOT_TOKEN not set — manager bot disabled");
    return null;
  }

  const bot = new Bot<ManagerContext>(token);
  attachManagerHandlers(bot);

  bot.catch(async (err) => {
    const ctx = err.ctx as MyContext | undefined;
    const errObj: any = err.error;
    const fromId = ctx?.from?.id?.toString() || "unknown";
    logger.error(
      { err: errObj, fromId, tag: "ManagerBot" },
      `Unhandled error from ${fromId}: ${errObj?.message || "unknown"}`
    );
    try {
      const ts = new Date().toISOString();
      const logMsg = `[${ts}] ${errObj?.stack || errObj}\nUpdate from: ${fromId}\n\n`;
      fs.appendFileSync(`logs/manager-errors.log`, logMsg);
    } catch (fsErr) {
      logger.warn({ err: fsErr, tag: "ManagerBot" }, "Failed to write manager error log");
    }
    try {
      if (ctx) {
        await ctx.reply("An unexpected error occurred. The admin has been notified.");
      }
    } catch (replyErr) {
      logger.warn({ err: replyErr, tag: "ManagerBot" }, "Failed to inform user of error");
    }
    try {
      const valid = getAdminIds();
      for (const adminId of valid) {
        try {
          await bot.api.sendMessage(
            adminId,
            `[Manager Bot Error]\n${errObj?.message || "Unknown"}`
          );
        } catch (notifyErr) {
          logger.warn({ err: notifyErr, tag: "ManagerBot", adminId }, "Admin notification failed");
        }
      }
    } catch (notifyTopErr) {
      logger.warn({ err: notifyTopErr, tag: "ManagerBot" }, "Notification sweep error");
    }
  });

  return bot;
}

let runningManagerBot: Bot<ManagerContext> | null = null;

export async function stopManagerBot(): Promise<void> {
  if (runningManagerBot) {
    await runningManagerBot.stop();
    runningManagerBot = null;
    logger.info({ tag: "ManagerBot" }, "Stopped");
  }
}

export async function startManagerBot(): Promise<void> {
  const bot = createManagerBot();
  if (!bot) return;

  runningManagerBot = bot;

  bot.start({
    onStart: () => {
      logger.info({ tag: "ManagerBot" }, "Started successfully");
    },
  }).catch((error) => {
    logger.fatal({ err: error, tag: "ManagerBot" }, "Fatal error during polling");
  });
}
