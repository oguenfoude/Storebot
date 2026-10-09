import { Bot, GrammyError } from "grammy";
import { ObjectId } from "mongodb";
import { MyContext } from "../types";
import { connectToDB } from "../db";
import { Seller } from "../models/seller";
import { attachHandlers } from "./handlers";
import { t, template } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "BotManager" });

export function isTokenFatal(error: unknown): boolean {
  return error instanceof GrammyError && error.error_code === 401;
}

class BotManagerClass {
  private bots: Map<string, Bot<MyContext>> = new Map();
  private primaryBot: Bot<MyContext> | null = null;

  async bootAll(): Promise<void> {
    const db = await connectToDB();
    const sellers = await db
      .collection<Seller>("sellers")
      .find({ status: { $in: ["active", "trial"] } })
      .toArray();

    log.info({ count: sellers.length }, "Found active sellers");

    for (const seller of sellers) {
      await this.bootSeller(seller);
    }

    if (!this.primaryBot && this.bots.size > 0) {
      this.primaryBot = this.bots.values().next().value!;
    }
  }

  async bootSeller(seller: Seller): Promise<boolean> {
    const sellerId = seller._id?.toString();
    if (!sellerId || !seller.botToken) return false;

    if (this.bots.has(sellerId)) {
      log.info({ sellerId }, "Bot already running");
      return true;
    }

    const bot = new Bot<MyContext>(seller.botToken);

    // Layer 1: Pre-validate token before starting polling.
    // If the token is revoked, getMe() throws a GrammyError with error_code 401.
    // We catch it here and mark the seller as token_invalid — never starting polling.
    let me: any;
    try {
      me = await bot.api.getMe();
    } catch (error) {
      if (this.isTokenFatal(error)) {
        log.error({ sellerId, username: seller.botUsername || "unknown" }, "Token invalid —401 Unauthorized");
        await this.handleInvalidToken(sellerId, seller);
        return false;
      }
      // Network error or transient issue — log and fail the boot, don't mark invalid
      log.error({ sellerId, err: error }, "Failed to validate token");
      return false;
    }

    // Cache botInfo so start() skips the redundant getMe() call in init()
    bot.botInfo = me;

    attachHandlers(bot, new ObjectId(sellerId));
    this.bots.set(sellerId, bot);

    if (!this.primaryBot) {
      this.primaryBot = bot;
    }

    // bot.catch() is installed by attachHandlers() in handlers.ts
    // which provides user error replies + admin notifications.
    // Do NOT install another bot.catch() here — it would overwrite the better one.

    // Layer 2: Catch polling fatal errors.
    // If the token is revoked WHILE the bot is running, getUpdates returns 401.
    // grammY's handlePollingError rethrows 401, which propagates out of start().
    // Without .catch(), this becomes an unhandled rejection that crashes the process.
    // With .catch(), we handle it gracefully: stop the bot, mark invalid, notify seller.
    bot.start({
      onStart: () => {
        log.info({ sellerId, username: seller.botUsername || "unknown", status: seller.status }, "Seller bot started");
      },
    }).catch(async (error) => {
      log.error({ sellerId, username: seller.botUsername || "unknown", message: error?.message || error }, "Bot polling crashed");
      if (this.isTokenFatal(error)) {
        await this.handleInvalidToken(sellerId, seller);
      } else {
        // Non-fatal polling error (e.g. 409 conflict, network issue) — remove from map
        // but don't mark token_invalid. Seller can try /pay to re-activate.
        log.error({ sellerId }, "Bot stopped due to non-token error. Removing from active map.");
        this.bots.delete(sellerId);
      }
    });

    return true;
  }

  async stopSeller(sellerId: string): Promise<void> {
    const bot = this.bots.get(sellerId);
    if (bot) {
      await bot.stop();
      this.bots.delete(sellerId);
      log.info({ sellerId }, "Stopped bot");
    }
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.bots.keys());
    for (const id of ids) {
      await this.stopSeller(id);
    }
    this.primaryBot = null;
    log.info({ count: ids.length }, "All bots stopped");
  }

  async restartSeller(seller: Seller): Promise<void> {
    const sellerId = seller._id?.toString();
    if (!sellerId) return;
    await this.stopSeller(sellerId);
    await this.bootSeller(seller);
  }

  getBot(sellerId: string): Bot<MyContext> | undefined {
    return this.bots.get(sellerId);
  }

  getPrimaryBot(): Bot<MyContext> | null {
    return this.primaryBot;
  }

  getBotForMessage(sellerId: ObjectId): Bot<MyContext> {
    const id = sellerId.toString();
    const bot = this.bots.get(id);
    if (!bot) {
      if (this.primaryBot) return this.primaryBot;
      throw new Error(`No bot found for seller ${id}`);
    }
    return bot;
  }

  getAllBots(): Map<string, Bot<MyContext>> {
    return this.bots;
  }

  get runningCount(): number {
    return this.bots.size;
  }

  private isTokenFatal(error: unknown): boolean {
    return isTokenFatal(error);
  }

  private async handleInvalidToken(sellerId: string, seller: Seller): Promise<void> {
    await this.stopSeller(sellerId);

    const db = await connectToDB();
    await db.collection<Seller>("sellers").updateOne(
      { _id: new ObjectId(sellerId) },
      { $set: { status: "token_invalid" } }
    );
    log.info({ sellerId, username: seller.botUsername || "unknown" }, "Marked seller as token_invalid");

    const managerBot = this.getPrimaryBot();
    if (managerBot && seller.telegramId) {
      try {
        await managerBot.api.sendMessage(
          seller.telegramId,
          template(t().adminPanel.tokenInvalidNotify, {
            username: seller.botUsername || "your bot",
          })
        );
      } catch {
        // Seller may have blocked the Manager Bot — nothing we can do
      }
    }
  }
}

export const BotManager = new BotManagerClass();
