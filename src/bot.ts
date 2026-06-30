import { session } from "grammy";
import dotenv from "dotenv";
import { connectToDB } from "./db";
import { User } from "./models/user";
import { MyContext } from "./types";
import { bot } from "./botInstance";
import {
  handleStartCommand,
  handleFullNameInput,
  handlePhoneNumberInput,
  showMainMenu,
  getMainMenuKeyboard,
} from "./commands/start";
import { handleBalanceView } from "./commands/balance";
import {
  handleProductsCommand,
  handleCategorySelection,
} from "./commands/products";
import {
  initiateBuyCommand,
  handleBuyConfirmation,
  handlePreOrderMessage,
  handleCancelPurchase,
  handlePreOrderConfirmation,
} from "./commands/buy";
import { handleAccountView } from "./commands/account";
import { handleSupportView } from "./commands/support";
import { startServer } from "./server";
import { sendToAdmin } from "./helpers/adminNotificationHelper";
import { safeSendMessage } from "./utils/messages";

dotenv.config();

bot.use(
  session({
    initial: (): MyContext["session"] => ({
      awaitingPreOrderMessage: false,
      preOrderProductId: null,
      awaitingFullName: false,
      awaitingPhoneNumber: false,
    }),
  })
);

async function isUserAccepted(telegramId: number): Promise<boolean> {
  try {
    const db = await connectToDB();
    const user = await db.collection<User>("users").findOne({
      telegramId: telegramId.toString(),
    });

    if (!user) return false;
    if (!user.fullName || !user.phoneNumber) return false;
    return user.isAccepted === true;
  } catch (error) {
    console.error("Error checking user acceptance:", error);
    return false;
  }
}

bot.command("start", async (ctx) => {
  await handleStartCommand(ctx);
});

bot.command("menu", async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;
  const accepted = await isUserAccepted(telegramId);
  if (!accepted) {
    return ctx.reply("لم تتم الموافقة على استخدامك للبوت.");
  }
  const db = await connectToDB();
  const user = await db.collection<User>("users").findOne({
    telegramId: telegramId.toString(),
  });
  await showMainMenu(ctx, user?.fullName || "مستخدم");
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    "*دليل استخدام البوت*\n\n" +
    "/start - بدء استخدام البوت أو التسجيل\n" +
    "/menu - القائمة الرئيسية\n" +
    "/help - عرض هذه المساعدة\n\n" +
    "يمكنك استخدام الأزرار للتنقل بين القوائم.",
    { parse_mode: "Markdown" }
  );
});

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data) return;

  await ctx.answerCallbackQuery();

  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  if (data.startsWith("verify_user_")) {
    const targetTelegramId = data.split("_")[2]; // verify_user_${telegramId}_${adminId}
    const db = await connectToDB();
    const result = await db.collection<User>("users").updateOne(
      { telegramId: targetTelegramId },
      { $set: { isAccepted: true } }
    );
    if (result.modifiedCount > 0) {
      await ctx.editMessageText("تم قبول الحساب وتفعيله بنجاح.");
      try {
        await safeSendMessage(targetTelegramId, "تم قبول حسابك! يمكنك الآن استخدام البوت.", { reply_markup: getMainMenuKeyboard() });
      } catch (err) {
        console.error("Failed to notify user:", err);
      }
    } else {
      await ctx.editMessageText("الحساب مقبول بالفعل أو غير موجود.");
    }
    return;
  }

  if (data.startsWith("preorder_confirm_")) {
    await ctx.editMessageText("تم تأكيد استلام الطلب المسبق.");
    return;
  }

  const parts = data.split(":");
  const namespace = parts[0];
  const action = parts[1];
  const id = parts[2];

  if (namespace === "menu" && action === "main") {
    const db = await connectToDB();
    const user = await db.collection<User>("users").findOne({
      telegramId: telegramId.toString(),
    });
    if (!user?.isAccepted) {
      return ctx.reply("لم تتم الموافقة على استخدامك للبوت.");
    }
    try { await ctx.deleteMessage(); } catch (e) {}
    await showMainMenu(ctx, user?.fullName || "مستخدم");
    return;
  }

  const accepted = await isUserAccepted(telegramId);
  if (!accepted) {
    return ctx.reply("لم تتم الموافقة على استخدامك للبوت.");
  }

  switch (namespace) {
    case "menu":
      if (action === "balance") {
        await handleBalanceView(ctx);
      } else if (action === "products") {
        await handleProductsCommand(ctx);
      }
      break;

    case "category":
      await handleCategorySelection(ctx, action);
      break;

    case "product":
      await initiateBuyCommand(ctx, action);
      break;

    case "buy":
      if (action === "initiate" && id) {
        await initiateBuyCommand(ctx, id);
      } else if (action === "confirm" && id) {
        await handleBuyConfirmation(ctx, id);
      } else if (action === "cancel" && id) {
        await handleCancelPurchase(ctx, id);
      }
      break;

    case "preorder":
      if (action) {
        await handlePreOrderConfirmation(ctx, action);
      }
      break;

    case "account":
      if (action === "view") {
        await handleAccountView(ctx);
      }
      break;

    case "support":
      if (action === "view") {
        await handleSupportView(ctx);
      }
      break;

    default:
      break;
  }
});

bot.hears("الرصيد", async (ctx) => {
  if (!ctx.from?.id) return;
  const accepted = await isUserAccepted(ctx.from.id);
  if (!accepted) return ctx.reply("لم تتم الموافقة على استخدامك للبوت.");
  await handleBalanceView(ctx);
});

bot.hears("المنتجات", async (ctx) => {
  if (!ctx.from?.id) return;
  const accepted = await isUserAccepted(ctx.from.id);
  if (!accepted) return ctx.reply("لم تتم الموافقة على استخدامك للبوت.");
  await handleProductsCommand(ctx);
});

bot.hears("حسابي", async (ctx) => {
  if (!ctx.from?.id) return;
  const accepted = await isUserAccepted(ctx.from.id);
  if (!accepted) return ctx.reply("لم تتم الموافقة على استخدامك للبوت.");
  await handleAccountView(ctx);
});

bot.hears("الدعم الفني", async (ctx) => {
  if (!ctx.from?.id) return;
  const accepted = await isUserAccepted(ctx.from.id);
  if (!accepted) return ctx.reply("لم تتم الموافقة على استخدامك للبوت.");
  await handleSupportView(ctx);
});

bot.on("message", async (ctx, next) => {
  try {
    const text = ctx.message?.text;
    
    if (ctx.session.awaitingFullName && text) {
      await handleFullNameInput(ctx);
      return;
    } 
    if (ctx.session.awaitingPhoneNumber && (text || ctx.message?.contact)) {
      await handlePhoneNumberInput(ctx);
      return;
    } 
    if (ctx.session.awaitingPreOrderMessage && text) {
      await handlePreOrderMessage(ctx);
      return;
    }
    
    if (text) {
      if (text === "تأكيد الشراء" && ctx.session.awaitingBuyConfirmationProductId) {
         const productId = ctx.session.awaitingBuyConfirmationProductId;
         await handleBuyConfirmation(ctx, productId);
         return;
      }
      if (text === "إلغاء الشراء" && ctx.session.awaitingBuyConfirmationProductId) {
         const productId = ctx.session.awaitingBuyConfirmationProductId;
         await handleCancelPurchase(ctx, productId);
         return;
      }
      if (text === "إلغاء الشراء" && ctx.session.awaitingPreOrderMessage) {
         const productId = ctx.session.preOrderProductId!;
         await handleCancelPurchase(ctx, productId);
         return;
      }
      if (text === "طلب مسبق للمنتج" && ctx.session.awaitingBuyConfirmationProductId) {
         const productId = ctx.session.awaitingBuyConfirmationProductId;
         await handlePreOrderConfirmation(ctx, productId);
         return;
      }

      if (text === "رجوع للقائمة الرئيسية") {
        const db = await connectToDB();
        const user = await db.collection<User>("users").findOne({ telegramId: ctx.from?.id.toString() });
        await showMainMenu(ctx, user?.fullName || "مستخدم");
        return;
      }

      const db = await connectToDB();
      const category = await db.collection("categories").findOne({ name: text });
      if (category) {
        if (!ctx.from?.id) return;
        const accepted = await isUserAccepted(ctx.from.id);
        if (!accepted) {
           await ctx.reply("لم تتم الموافقة على استخدامك للبوت.");
           return;
        }
        await handleCategorySelection(ctx, category._id.toString());
        return;
      }
    }

    await next();
  } catch (error) {
    console.error("Error in message handler:", error);
    await ctx.reply("حدث خطأ غير متوقع. الرجاء المحاولة مرة أخرى لاحقًا.");
  }
});

bot.catch(async (error) => {
  const { ctx } = error;
  console.error("Error while handling update:", error.error);
  try {
    await ctx.reply(
      "حدث خطأ غير متوقع. الرجاء المحاولة مرة أخرى لاحقًا أو التواصل مع الدعم."
    );
  } catch {}
  try {
    await sendToAdmin(
      `Bot error in chat ${ctx.chat?.id}:\n${error.error}`
    );
  } catch {}
});

async function bootstrap() {
  await startServer();

  await bot.api.setMyCommands([
    { command: "start", description: "بدء استخدام البوت" },
    { command: "menu", description: "القائمة الرئيسية" },
    { command: "help", description: "مساعدة" },
  ]);

  bot.start();
  console.log("تم تشغيل البوت بنجاح...");
}

bootstrap().catch((err) => {
  console.error("Failed to start server or bot:", err);
});
