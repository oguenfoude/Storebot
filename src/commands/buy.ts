import { InlineKeyboard } from "grammy";
import { ObjectId } from "mongodb";
import { connectToDB } from "../db";
import { User } from "../models/user";
import { Product } from "../models/product";
import { Category } from "../models/category";
import { formatCurrency } from "../utils/messages";
import { sendToAdmin } from "../helpers/adminNotificationHelper";
import { bot } from "../botInstance";
import { MyContext } from "../types";
import {
  createPreOrderInDB,
  notifyUserAboutPreOrder,
  notifyAdminAboutPreOrder,
} from "./preorder";

const WHATSAPP_URL = process.env.SUPPORT_WHATSAPP_URL || "https://wa.me/213776863561";


const sendSupportMessage = async (ctx: MyContext): Promise<void> => {
  const supportKeyboard = new InlineKeyboard().url(
    "تواصل عبر WhatsApp",
    WHATSAPP_URL
  );

  await ctx.reply(
    "رصيدك غير كافٍ لإتمام هذه العملية. يرجى التواصل مع الدعم الفني لإعادة شحن رصيدك.",
    { reply_markup: supportKeyboard }
  );
};

export const initiateBuyCommand = async (
  ctx: MyContext,
  productId: string
): Promise<void> => {
  try {
    const db = await connectToDB();
    const product = await db.collection<Product>("products").findOne({
      _id: new ObjectId(productId),
    });

    if (!product) {
      await ctx.reply("المنتج غير موجود.");
      return;
    }

    const user = await db.collection<User>("users").findOne({
      telegramId: ctx.from?.id.toString(),
    });

    if (!user) {
      await ctx.reply("المستخدم غير موجود.");
      return;
    }

    ctx.session.awaitingBuyConfirmationProductId = product._id.toString();

    if (!product.isAvailable || product.emails.length === 0) {
      if (product.allowPreOrder) {
        const { Keyboard } = await import("grammy");
        const keyboard = new Keyboard()
          .text("طلب مسبق للمنتج")
          .row()
          .text("إلغاء الشراء")
          .resized();

        await ctx.reply(
          `المنتج "${product.name}" غير متوفر حاليًا. هل ترغب في طلبه مسبقًا؟`,
          { reply_markup: keyboard }
        );
      } else {
        const { Keyboard } = await import("grammy");
        const keyboard = new Keyboard().text("إلغاء الشراء").resized();
        await ctx.reply(
          `عذراً، المنتج "${product.name}" غير متوفر حالياً ولا يدعم الطلب المسبق.`,
          { reply_markup: keyboard }
        );
      }
      return;
    }

    const { Keyboard } = await import("grammy");
    const keyboard = new Keyboard()
      .text("تأكيد الشراء")
      .row()
      .text("إلغاء الشراء")
      .resized();

    await ctx.reply(
      `هل ترغب في شراء المنتج "${product.name}" بسعر ${product.price} نقطة؟`,
      { reply_markup: keyboard }
    );

  } catch (error) {
    console.error("Error in initiateBuyCommand:", error);
    await ctx.reply("حدث خطأ. يرجى المحاولة مرة أخرى لاحقًا.");
  }
};

export const handleBuyConfirmation = async (
  ctx: MyContext,
  productId: string
): Promise<void> => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const db = await connectToDB();
    const product = await db.collection<Product>("products").findOne({
      _id: new ObjectId(productId),
    });
    if (!product || !product.isAvailable || !product.emails || product.emails.length === 0) {
      await ctx.reply("نعتذر، نفذت الكمية من هذا المنتج. الرجاء المحاولة لاحقاً.");
      return;
    }

    const user = await db.collection<User>("users").findOne({ telegramId });
    if (!user) {
      await ctx.reply("المستخدم غير موجود.");
      return;
    }
    if (user.balance < product.price) {
      await ctx.reply("ليس لديك رصيد كافٍ لإتمام الشراء.");
      await sendSupportMessage(ctx);
      return;
    }

    const category = await db.collection<Category>("categories").findOne({
      _id: new ObjectId(product.categoryId),
    });
    const categoryName = category?.name || "غير محدد";

    const email = product.emails.shift();
    const updatedBalance = user.balance - product.price;
    const transactionId = new ObjectId();

    await db.collection<User>("users").updateOne(
      { telegramId },
      {
        $set: { balance: updatedBalance },
        $push: {
          history: {
            type: "purchase",
            date: new Date(),
            productId: product._id,
            productName: product.name,
            price: product.price,
            categoryName,
            emailSold: email,
            transactionId,
          },
        },
      }
    );

    await db.collection<Product>("products").updateOne(
      { _id: new ObjectId(productId) },
      {
        $set: {
          emails: product.emails,
          isAvailable: product.emails.length > 0,
        },
        $push: {
          archive: {
            transactionId,
            emailPassword: email,
            soldTo: new ObjectId(user._id),
            soldAt: new Date(),
            price: product.price,
            buyerDetails: {
              name: user.fullName,
              phone: user.phoneNumber,
              telegramId: user.telegramId,
            },
          },
        },
      }
    );

    await db.collection("history").insertOne({
      userId: user._id,
      actionType: "purchase",
      description: `Purchased ${product.name}`,
      date: new Date(),
      productId: product._id,
      productName: product.name,
      price: product.price,
      categoryName,
      fullName: user.fullName || "Unknown",
      phoneNumber: user.phoneNumber || "Unknown",
      emailSold: email,
    });

    const now = new Date();
    const dateStr = now.toLocaleString('en-GB', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    ctx.session.awaitingBuyConfirmationProductId = null;
    const { getMainMenuKeyboard } = await import("./start");

    await ctx.reply(
      `تم شراء المنتج بنجاح\n\n` +
      `المنتج: ${product.name}\n` +
      `السعر: ${product.price.toFixed(2)} نقطة\n` +
      `البيانات: ${email || "-"}\n` +
      `رصيدك المتبقي: ${updatedBalance.toFixed(2)} نقطة\n` +
      `\nالوقت: ${dateStr}`,
      { reply_markup: getMainMenuKeyboard() }
    );

    await sendToAdmin(
      `عملية شراء جديدة\n\n` +
      `المنتج: ${product.name}\n` +
      `السعر: ${product.price.toFixed(2)} نقطة\n` +
      `البيانات: ${email || "-"}\n` +
      `\nالمشتري: ${user.fullName || "غير محدد"}\n` +
      `الهاتف: ${user.phoneNumber || "غير محدد"}\n` +
      `تليجرام: ${user.telegramId}\n` +
      `الكمية المتبقية: ${product.emails.length}\n` +
      `الوقت: ${dateStr}`
    );
  } catch (error) {
    console.error("Error in handleBuyConfirmation:", error);
    await ctx.reply("حدث خطأ أثناء معالجة الشراء. يرجى المحاولة مرة أخرى.");
  }
};

export const handlePreOrderMessage = async (ctx: MyContext): Promise<void> => {
  try {
    if (
      !ctx.session.awaitingPreOrderMessage ||
      !ctx.session.preOrderProductId
    ) {
      await ctx.reply("لا يوجد عملية طلب مسبق نشطة.");
      return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const db = await connectToDB();
    const productId = ctx.session.preOrderProductId;
    const message = ctx.message?.text;

    if (!message) {
      await ctx.reply("الرسالة غير صحيحة. يرجى المحاولة مرة أخرى.");
      return;
    }

    const user = await db.collection<User>("users").findOne({ telegramId });
    if (!user) {
      await ctx.reply("المستخدم غير موجود.");
      return;
    }

    const preOrder = await createPreOrderInDB(
      new ObjectId(user._id),
      new ObjectId(productId),
      message
    );

    if (!preOrder) {
      await ctx.reply(
        "حدث خطأ أثناء إنشاء الطلب المسبق. يرجى المحاولة لاحقًا."
      );
      return;
    }

    await notifyUserAboutPreOrder(preOrder);
    await notifyAdminAboutPreOrder(preOrder);

    ctx.session.awaitingPreOrderMessage = false;
    ctx.session.preOrderProductId = null;

    const { getMainMenuKeyboard } = await import("./start");
    await ctx.reply("تم إرسال الطلب المسبق بنجاح.", { reply_markup: getMainMenuKeyboard() });
  } catch (error) {
    console.error("Error in handlePreOrderMessage:", error);
    await ctx.reply(
      "حدث خطأ أثناء معالجة الطلب المسبق. يرجى المحاولة مرة أخرى."
    );
  }
};

export const handleCancelPurchase = async (
  ctx: MyContext,
  productId: string
): Promise<void> => {
  ctx.session.awaitingBuyConfirmationProductId = null;
  ctx.session.awaitingPreOrderMessage = false;
  ctx.session.preOrderProductId = null;
  ctx.session.awaitingBuyConfirmationProductId = null;

  try {
    const db = await connectToDB();
    const product = await db.collection("products").findOne({ _id: new ObjectId(productId) });
    if (product) {
      const { handleCategorySelection } = await import("./products");
      await handleCategorySelection(ctx, product.categoryId.toString());
      return;
    }
  } catch (e) {
    console.error("Cancel purchase error:", e);
  }

  const { getMainMenuKeyboard } = await import("./start");
  await ctx.reply("تم إلغاء العملية.", { reply_markup: getMainMenuKeyboard() });
};

export const handlePreOrderConfirmation = async (
  ctx: MyContext,
  productId: string
): Promise<void> => {
  try {
    const db = await connectToDB();
    const product = await db.collection<Product>("products").findOne({
      _id: new ObjectId(productId),
    });

    if (!product) {
      await ctx.reply("المنتج غير موجود.");
      return;
    }

    const user = await db.collection<User>("users").findOne({
      telegramId: ctx.from?.id.toString(),
    });

    if (!user) {
      await ctx.reply("المستخدم غير موجود.");
      return;
    }

    if (user.balance < product.price) {
      await ctx.reply("ليس لديك رصيد كافٍ لإتمام الطلب المسبق.");
      await sendSupportMessage(ctx);
      return;
    }

    ctx.session.awaitingPreOrderMessage = true;
    ctx.session.preOrderProductId = productId;
    ctx.session.awaitingBuyConfirmationProductId = null;

    const { Keyboard } = await import("grammy");
    const keyboard = new Keyboard().text("إلغاء الشراء").resized();

    await ctx.reply("يرجى كتابة ملاحظة أو رسالة خاصة للطلب المسبق:", {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error("Error in handlePreOrderConfirmation:", error);
    await ctx.reply(
      "حدث خطأ أثناء تأكيد الطلب المسبق. يرجى المحاولة مرة أخرى."
    );
  }
};
