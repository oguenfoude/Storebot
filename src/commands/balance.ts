import { connectToDB } from "../db";
import { User } from "../models/user";
import { MyContext } from "../types";
import { ObjectId } from "mongodb";
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "BalanceCmd" });

export const handleBalanceView = async (ctx: MyContext, sellerId?: ObjectId): Promise<void> => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;
    log.info({ telegramId: ctx.from?.id, sellerId: sid.toString() }, "Balance viewed");

    const db = await connectToDB();
    const user = await db.collection<User>("users").findOne({ telegramId, sellerId: sid });

    if (!user) {
      await ctx.reply(t().general.userNotFound);
      return;
    }

    const dict = t(user.language);
    const balance = user.balance || 0;
    const messageText = `${dict.balance.title}\n\n${dict.balance.amount.replace("${balance}", balance.toString())}`;
    await ctx.reply(messageText);
  } catch (error) {
    log.error({ err: error }, "Error in handleBalanceView");
    await ctx.reply(t().balance.errorLoading);
  }
};
