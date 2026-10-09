import { connectToDB } from "../db";
import { User } from "../models/user";
import { InlineKeyboard } from "grammy";
import { MyContext } from "../types";
import { ObjectId } from "mongodb";
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "SupportCmd" });

const WHATSAPP_URL = process.env.SUPPORT_WHATSAPP_URL || "https://wa.me/213776863561";
const TELEGRAM_URL = process.env.SUPPORT_TELEGRAM_URL || "https://t.me/Jeogooussama";

export const handleSupportView = async (ctx: MyContext, sellerId?: ObjectId) => {
  try {
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;
    const db = await connectToDB();
    const user = ctx.from?.id ? await db.collection<User>("users").findOne({ telegramId: ctx.from.id.toString(), sellerId: sid }) : null;
    const dict = t(user?.language);
    const kb = new InlineKeyboard()
      .url("WhatsApp Support", WHATSAPP_URL)
      .url("Telegram Support", TELEGRAM_URL);
    const message = `${dict.support.title}\n\nWhatsApp: ${WHATSAPP_URL}\nTelegram: ${TELEGRAM_URL}`;
    await ctx.reply(message, { reply_markup: kb });
  } catch (error) {
    log.error({ err: error }, "Error in handleSupportView");
    await ctx.reply(t().support.errorLoading);
  }
};
