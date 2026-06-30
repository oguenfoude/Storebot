import { MyContext } from "../types";
import { connectToDB } from "../db";
import { User } from "../models/user";
import { InlineKeyboard, Keyboard } from "grammy";
import { sendToAdmin } from "../helpers/adminNotificationHelper";

export const getMainMenuKeyboard = () =>
  new Keyboard()
    .text("الرصيد")
    .text("المنتجات")
    .row()
    .text("حسابي")
    .text("الدعم الفني")
    .resized();

export const showMainMenu = async (ctx: MyContext, name: string) => {
  await ctx.reply(`أهلاً بك يا ${name} في القائمة الرئيسية:`, {
    reply_markup: getMainMenuKeyboard(),
  });
};

export const handleStartCommand = async (ctx: MyContext) => {
  try {
    const telegramId = ctx.from?.id.toString();
    const chatId = ctx.chat?.id.toString();
    const username = ctx.from?.username || "مستخدم غير معروف";
    const name = ctx.from?.first_name || "مستخدم";

    if (!telegramId || !chatId) {
      console.warn("Missing telegramId or chatId.");
      return ctx.reply("حدث خطأ في التعرف على المستخدم.");
    }

    const db = await connectToDB();
    const userCollection = db.collection<User>("users");

    let user = await userCollection.findOne({ telegramId });

    if (!user) {
      const newUser: User = {
        telegramId,
        chatId,
        username,
        name,
        balance: 0,
        registerDate: new Date(),
        isAccepted: false,
        fullName: "",
        phoneNumber: "",
      };

      await userCollection.insertOne(newUser);
      ctx.session.awaitingFullName = true;
      await ctx.reply("يرجى إدخال اسمك الكامل:", {
        reply_markup: { remove_keyboard: true }
      });
      return;
    }

    if (!user.fullName) {
      ctx.session.awaitingFullName = true;
      await ctx.reply("يرجى إدخال اسمك الكامل:", {
        reply_markup: { remove_keyboard: true }
      });
    } else if (!user.phoneNumber) {
      ctx.session.awaitingPhoneNumber = true;
      await ctx.reply("يرجى إدخال رقم هاتفك:", {
        reply_markup: { remove_keyboard: true }
      });
    } else {
      if (!user.isAccepted) {
        await ctx.reply("حسابك قيد المراجعة حاليًا من قبل الإدارة. يرجى الانتظار حتى يتم تفعيله.");
        return;
      }
      await showMainMenu(ctx, user.fullName || "مستخدم");
    }
  } catch (error) {
    console.error("Error in handleStartCommand:", error);
    await ctx.reply("حدث خطأ أثناء التسجيل. يرجى المحاولة لاحقًا.");
  }
};

export const handleFullNameInput = async (ctx: MyContext): Promise<void> => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const fullName = ctx.message?.text;
    if (!fullName || fullName.trim().length < 3) {
      await ctx.reply("يرجى إدخال اسم كامل صالح (على الأقل 3 أحرف).");
      ctx.session.awaitingFullName = true;
      await ctx.reply("يرجى إدخال اسمك الكامل:");
      return;
    }

    const db = await connectToDB();
    await db
      .collection<User>("users")
      .updateOne({ telegramId }, { $set: { fullName } });

    ctx.session.awaitingFullName = false;
    ctx.session.awaitingPhoneNumber = true;

    const keyboard = new Keyboard()
      .requestContact("مشاركة رقم الهاتف")
      .oneTime()
      .resized();

    await ctx.reply(
      "تم حفظ اسمك الكامل بنجاح. يرجى مشاركة رقم هاتفك باستخدام الزر أدناه:",
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error("Error in handleFullNameInput:", error);
    await ctx.reply("حدث خطأ أثناء حفظ اسمك الكامل. يرجى المحاولة لاحقًا.");
  }
};

export const handlePhoneNumberInput = async (ctx: MyContext): Promise<void> => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    let phoneNumber = ctx.message?.contact?.phone_number || ctx.message?.text;
    if (phoneNumber) {
      phoneNumber = phoneNumber.replace(/\+/g, "").trim();
    }

    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
      await ctx.reply("يرجى إدخال رقم هاتف صالح أو مشاركة رقم هاتفك بالضغط على الزر.");
      return;
    }

    const db = await connectToDB();
    await db
      .collection<User>("users")
      .updateOne({ telegramId }, { $set: { phoneNumber } });

    ctx.session.awaitingPhoneNumber = false;

    const updatedUser = await db.collection<User>("users").findOne({ telegramId });
    if (updatedUser) {
      await sendAdminNotification(ctx, updatedUser);
    }

    await ctx.reply(
      "تم حفظ رقم هاتفك بنجاح. حسابك قيد المراجعة حاليًا من قبل الإدارة. سنقوم بإشعارك فور تفعيله.",
      { reply_markup: { remove_keyboard: true } }
    );
  } catch (error) {
    console.error("Error in handlePhoneNumberInput:", error);
    await ctx.reply("حدث خطأ أثناء حفظ رقم هاتفك. يرجى المحاولة لاحقًا.");
  }
};

export const sendAdminNotification = async (ctx: MyContext, user: User) => {
  try {
    const message = `مستخدم جديد مسجل
    
الاسم: ${user.fullName || "غير محدد"}
اسم المستخدم: ${user.username || "غير محدد"}
معرف التليجرام: \`${user.telegramId}\`
رقم الهاتف: ${user.phoneNumber || "غير محدد"}
تاريخ التسجيل: ${user.registerDate ? user.registerDate.toLocaleDateString() : "غير محدد"}

بانتظار موافقة المسؤول لتفعيل الحساب.`;

    await sendToAdmin(message, {
      parse_mode: "Markdown",
      callback_data: `verify_user_${user.telegramId}`
    });

    console.log(`Admin notification sent for user: ${user.telegramId}`);
  } catch (error) {
    console.error("Error sending admin notification:", error);
  }
};
