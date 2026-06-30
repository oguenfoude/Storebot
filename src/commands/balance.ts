import { connectToDB } from "../db";
import { User } from "../models/user";
import { InlineKeyboard } from "grammy";
import { MyContext } from "../types";

export const handleBalanceView = async (ctx: MyContext): Promise<void> => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const db = await connectToDB();
    const user = await db.collection<User>("users").findOne({ telegramId });

    if (!user) {
      if (ctx.callbackQuery) {
        await ctx.editMessageText("لم يتم العثور على المستخدم. يُرجى التسجيل أولاً.");
      } else {
        await ctx.reply("لم يتم العثور على المستخدم. يُرجى التسجيل أولاً.");
      }
      return;
    }

    const balance = user.balance || 0;
    const keyboard = new InlineKeyboard().text("رجوع", "menu:main");
    const messageText = `رصيدك الحالي\n\nالمبلغ المتاح: ${balance} نقطة`;

    if (ctx.callbackQuery) {
      await ctx.editMessageText(messageText, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(messageText, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  } catch (error) {
    console.error("Error in handleBalanceView:", error);
    await ctx.reply("حدث خطأ أثناء التحقق من رصيدك. الرجاء المحاولة مرة أخرى لاحقًا.");
  }
};
