import { ObjectId } from "mongodb";
import { Keyboard } from "grammy";
import { connectToDB } from "../db";
import { User } from "../models/user";
import { Product } from "../models/product";
import { Category } from "../models/category";
import { sendToAdmin } from "../helpers/adminNotificationHelper";
import { MyContext } from "../types";
import { getMainMenuKeyboard } from "./start";
import {
  createPreOrderInDB,
  notifyUserAboutPreOrder,
  notifyAdminAboutPreOrder,
} from "./preorder";
import { PreOrder } from "../models/preorder";
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "BuyCmd" });

const WHATSAPP_URL = process.env.SUPPORT_WHATSAPP_URL || "https://wa.me/213776863561";
const TELEGRAM_URL = process.env.SUPPORT_TELEGRAM_URL || "https://t.me/Jeogooussama";

const sendSupportMessage = async (ctx: MyContext, sellerId: ObjectId): Promise<void> => {
  await ctx.reply(
    `${t().support.insufficientBalance}\n\n` +
    `WhatsApp: ${WHATSAPP_URL}\n` +
    `Telegram: ${TELEGRAM_URL}`
  );
};

export const initiateBuyCommand = async (
  ctx: MyContext,
  productId: string,
  sellerId?: ObjectId
): Promise<void> => {
  try {
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;

    if (!ObjectId.isValid(productId)) {
      await ctx.reply(t().buy.invalidProductId);
      return;
    }

    const db = await connectToDB();
    const product = await db.collection<Product>("products").findOne({
      _id: new ObjectId(productId),
      sellerId: sid,
    });

    if (!product) {
      await ctx.reply(t().general.productNotFound);
      return;
    }

    const user = await db.collection<User>("users").findOne({
      telegramId: ctx.from?.id.toString(),
      sellerId: sid,
    });

    if (!user) {
      await ctx.reply(t().general.userNotFound);
      return;
    }

    ctx.session.awaitingBuyConfirmationProductId = product._id.toString();

    if (!product.isAvailable || product.emails.length === 0) {
      if (product.allowPreOrder) {
        const preorderKeyboard = new Keyboard()
          .text(t().buttons.preorderProduct)
          .text(t().buttons.cancelPurchase)
          .resized()
          .oneTime();
        await ctx.reply(
          t().buy.productUnavailable.replace("${name}", product.name) +
          "\n\n" + t().buttons.preorderProduct + " / " + t().buttons.cancelPurchase,
          { reply_markup: preorderKeyboard }
        );
      } else {
        await ctx.reply(
          t().buy.productUnavailableNoPreorder.replace("${name}", product.name)
        );
      }
      return;
    }

    const confirmKeyboard = new Keyboard()
      .text(t().buttons.confirmPurchase)
      .text(t().buttons.cancelPurchase)
      .resized()
      .oneTime();
    await ctx.reply(
      t().buy.confirmPurchase.replace("${name}", product.name).replace("${price}", product.price.toString()) +
      "\n\n" + t().buttons.confirmPurchase + " / " + t().buttons.cancelPurchase,
      { reply_markup: confirmKeyboard }
    );

  } catch (error) {
    log.error({ err: error }, "Error in initiateBuyCommand");
    ctx.session.awaitingBuyConfirmationProductId = null;
    await ctx.reply(t().buy.errorProcessing);
  }
};

export const handleBuyConfirmation = async (
  ctx: MyContext,
  productId: string,
  sellerId?: ObjectId
): Promise<void> => {
  try {
    ctx.session.awaitingBuyConfirmationProductId = null;

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;
    log.info({ telegramId: ctx.from?.id, productId, sellerId: sid.toString() }, "Purchase initiated");

    if (!ObjectId.isValid(productId)) {
      await ctx.reply(t().buy.invalidProductId);
      return;
    }

    const db = await connectToDB();

    const product = await db.collection<Product>("products").findOneAndUpdate(
      {
        _id: new ObjectId(productId),
        sellerId: sid,
        isAvailable: true,
        emails: { $exists: true, $ne: [] },
      },
      { $pop: { emails: 1 } },
      { returnDocument: "before" }
    );
    if (!product || !product.emails || product.emails.length === 0) {
      await ctx.reply(t().buy.outOfStock);
      return;
    }

    const email = product.emails[product.emails.length - 1];

    const user = await db.collection<User>("users").findOne({ telegramId, sellerId: sid });
    if (!user) {
      await ctx.reply(t().general.userNotFound);
      return;
    }

    const category = await db.collection<Category>("categories").findOne({
      _id: new ObjectId(product.categoryId),
      sellerId: sid,
    });
    const categoryName = category?.name || "N/A";

    const transactionId = new ObjectId();
    const now = new Date();

    const balanceUpdate = await db.collection<User>("users").findOneAndUpdate(
      { telegramId, sellerId: sid, balance: { $gte: product.price } },
      {
        $inc: { balance: -product.price },
        $push: {
          history: {
            type: "purchase",
            date: now,
            productId: product._id,
            productName: product.name,
            price: product.price,
            categoryName,
            emailSold: email,
            transactionId,
          },
        },
      },
      { returnDocument: "after" }
    );

    if (!balanceUpdate) {
      await db.collection<Product>("products").updateOne(
        { _id: new ObjectId(productId), sellerId: sid },
        { $push: { emails: { $each: [email], $position: 0 } } }
      );
      await sendSupportMessage(ctx, sid);
      return;
    }

    const updatedBalance = balanceUpdate.balance;

    const remainingEmails = product.emails.length - 1;
    await db.collection<Product>("products").updateOne(
      { _id: new ObjectId(productId), sellerId: sid },
      {
        $set: {
          isAvailable: remainingEmails > 0,
        },
        $push: {
          archive: {
            transactionId,
            emailPassword: email,
            soldTo: new ObjectId(user._id),
            soldAt: now,
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
      sellerId: sid,
      actionType: "purchase",
      description: `Purchased ${product.name}`,
      date: now,
      productId: product._id,
      productName: product.name,
      price: product.price,
      categoryName,
      fullName: user.fullName || "Unknown",
      phoneNumber: user.phoneNumber || "Unknown",
      emailSold: email,
    });

    const dateStr = now.toLocaleString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    ctx.session.awaitingBuyConfirmationProductId = null;
    log.info({ telegramId: ctx.from?.id, productId, sellerId: sid.toString(), emailDelivered: true }, "Purchase completed");

    await ctx.reply(
      t().buy.success
        .replace("${name}", product.name)
        .replace("${price}", product.price.toFixed(2))
        .replace("${email}", email || "-")
        .replace("${balance}", updatedBalance.toFixed(2))
        .replace("${time}", dateStr),
      { reply_markup: getMainMenuKeyboard() }
    );

    await sendToAdmin(
      `${t().admin.purchaseAlert}\n\n` +
      `${t().admin.productName.replace("${name}", product.name)}\n` +
      `${t().admin.price.replace("${price}", product.price.toFixed(2))}\n` +
      `${t().admin.buyerName.replace("${name}", user.fullName || "N/A")}\n` +
      `${t().admin.purchasePhone.replace("${phone}", user.phoneNumber || "N/A")}\n` +
      `${t().admin.purchaseTelegram.replace("${id}", user.telegramId)}\n` +
      `${t().admin.purchaseRemaining.replace("${quantity}", remainingEmails.toString())}\n` +
      `${t().admin.purchaseTime.replace("${time}", dateStr)}`,
      sid
    );
  } catch (error) {
    log.error({ err: error }, "Error in handleBuyConfirmation");
    ctx.session.awaitingBuyConfirmationProductId = null;
    await ctx.reply(t().buy.errorPurchasing);
  }
};

export const handlePreOrderMessage = async (ctx: MyContext, sellerId?: ObjectId): Promise<void> => {
  try {
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;

    if (
      !ctx.session.awaitingPreOrderMessage ||
      !ctx.session.preOrderProductId
    ) {
      await ctx.reply(t().buy.preorderNoActive);
      return;
    }

    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;

    const db = await connectToDB();
    const productId = ctx.session.preOrderProductId;
    const message = ctx.message?.text;

    if (!message) {
      await ctx.reply(t().buy.preorderEmptyMessage);
      return;
    }

    const user = await db.collection<User>("users").findOne({ telegramId, sellerId: sid });
    if (!user) {
      await ctx.reply(t().general.userNotFound);
      return;
    }

    let preOrder: PreOrder | null = null;
    try {
      preOrder = await createPreOrderInDB(
        new ObjectId(user._id),
        new ObjectId(productId),
        message,
        sid
      );
    } catch (createError: any) {
      // createPreOrderInDB throws specific errors (productNotFound, insufficientFunds)
      // Forward the message to the user instead of showing generic error
      await ctx.reply(createError.message || t().buy.preorderError);
      ctx.session.awaitingPreOrderMessage = false;
      ctx.session.preOrderProductId = null;
      return;
    }

    if (!preOrder) {
      await ctx.reply(t().buy.preorderError);
      return;
    }

    await notifyUserAboutPreOrder(preOrder);
    await notifyAdminAboutPreOrder(preOrder, sid);

    ctx.session.awaitingPreOrderMessage = false;
    ctx.session.preOrderProductId = null;

    await ctx.reply(t().buy.preorderSent);
  } catch (error) {
    log.error({ err: error }, "Error in handlePreOrderMessage");
    ctx.session.awaitingPreOrderMessage = false;
    ctx.session.preOrderProductId = null;
    await ctx.reply(t().buy.preorderErrorProcessing);
  }
};

export const handleCancelPurchase = async (
  ctx: MyContext,
  productId: string,
  sellerId?: ObjectId
): Promise<void> => {
  ctx.session.awaitingBuyConfirmationProductId = null;
  ctx.session.awaitingPreOrderMessage = false;
  ctx.session.preOrderProductId = null;
  const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;

  try {
    const db = await connectToDB();
    const product = await db.collection("products").findOne({ _id: new ObjectId(productId), sellerId: sid });
    if (product) {
      const { handleCategorySelection } = await import("./products");
      await handleCategorySelection(ctx, product.categoryId.toString(), sid);
      return;
    }
  } catch (e) {
    log.error({ err: e }, "Cancel purchase error");
  }

  await ctx.reply(t().buy.cancelPurchase, { reply_markup: getMainMenuKeyboard() });
};

export const handlePreOrderConfirmation = async (
  ctx: MyContext,
  productId: string,
  sellerId?: ObjectId
): Promise<void> => {
  try {
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;
    const db = await connectToDB();
    const product = await db.collection<Product>("products").findOne({
      _id: new ObjectId(productId),
      sellerId: sid,
    });

    if (!product) {
      await ctx.reply(t().general.productNotFound);
      return;
    }

    const user = await db.collection<User>("users").findOne({
      telegramId: ctx.from?.id.toString(),
      sellerId: sid,
    });

    if (!user) {
      await ctx.reply(t().general.userNotFound);
      return;
    }

    if (user.balance < product.price) {
      ctx.session.awaitingBuyConfirmationProductId = null;
      await ctx.reply(t().buy.preorderConfirm);
      await sendSupportMessage(ctx, sid);
      return;
    }

    ctx.session.awaitingPreOrderMessage = true;
    ctx.session.preOrderProductId = productId;
    ctx.session.awaitingBuyConfirmationProductId = null;

    await ctx.reply(t().buy.preorderEnterMessage);
  } catch (error) {
    log.error({ err: error }, "Error in handlePreOrderConfirmation");
    await ctx.reply(t().buy.preorderConfirmError);
  }
};
