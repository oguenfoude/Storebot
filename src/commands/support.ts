import { InlineKeyboard } from "grammy";
import { MyContext } from "../types";

const WHATSAPP_URL = process.env.SUPPORT_WHATSAPP_URL || "https://wa.me/213776863561";
const TELEGRAM_URL = process.env.SUPPORT_TELEGRAM_URL || "https://t.me/Jeogooussama";

export const handleSupportView = async (ctx: MyContext) => {
  try {
    const keyboard = new InlineKeyboard()
      .url("تواصل عبر WhatsApp", WHATSAPP_URL)
      .url("تواصل عبر Telegram", TELEGRAM_URL)
      .row()
      .text("رجوع", "menu:main");

    const message = "الدعم الفني لشحن الرصيد الرجاء التواصل معنا عبر الروابط التالية:";

    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, { reply_markup: keyboard });
    } else {
      await ctx.reply(message, { reply_markup: keyboard });
    }
  } catch (error) {
    console.error("Error in handleSupportView:", error);
    await ctx.reply("حدث خطأ أثناء تحميل معلومات الدعم. الرجاء المحاولة مرة أخرى لاحقًا.");
  }
};
