import { connectToDB } from "../db";
import { User } from "../models/user";
import { InlineKeyboard } from "grammy";
import { MyContext } from "../types";

export const handleAccountView = async (ctx: MyContext) => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) {
      return ctx.reply("حدث خطأ أثناء التحقق من المستخدم.");
    }

    const db = await connectToDB();
    const user = await db.collection<User>("users").findOne({ telegramId });

    if (!user) {
      return ctx.reply("المستخدم غير موجود.");
    }

    const keyboard = new InlineKeyboard().text("رجوع", "menu:main");
    const message =
      `تفاصيل الحساب\n\n` +
      `الاسم الكامل: ${user.fullName || "غير متوفر"}\n` +
      `معرف الحساب: ${user.telegramId}\n` +
      `الرصيد الحالي: ${user.balance || 0} نقطة\n\n` +
      `شكرًا لاستخدامك خدماتنا!`;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(message, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  } catch (error) {
    console.error("Error handling account command:", error);
    await ctx.reply("حدث خطأ أثناء جلب تفاصيل الحساب.");
  }
};
