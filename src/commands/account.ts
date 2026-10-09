import { connectToDB } from "../db";
import { User } from "../models/user";
import { MyContext } from "../types";
import { ObjectId } from "mongodb";
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "AccountCmd" });

export const handleAccountView = async (ctx: MyContext, sellerId?: ObjectId) => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      return ctx.reply(t().account.errorChecking);
    }
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;

    const db = await connectToDB();
    const user = await db.collection<User>("users").findOne({ telegramId, sellerId: sid });

    if (!user) {
      return ctx.reply(t().general.userNotFound);
    }

    const dict = t(user.language);
    const message =
      `${dict.account.title}\n\n` +
      `${dict.account.fullName.replace("${name}", user.fullName || "N/A")}\n` +
      `${dict.account.accountId.replace("${id}", user.telegramId)}\n` +
      `${dict.account.currentBalance.replace("${balance}", (user.balance || 0).toString())}\n\n` +
      `${dict.account.thankYou}`;

    await ctx.reply(message);
  } catch (error) {
    log.error({ err: error }, "Error handling account command");
    await ctx.reply(t().account.errorLoading);
  }
};
