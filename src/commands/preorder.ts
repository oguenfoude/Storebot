import { ObjectId } from "mongodb";
import { connectToDB } from "../db";
import { PreOrder } from "../models/preorder";
import { ComprehensiveHistory } from "../models/comprehensiveHistory";
import { User } from "../models/user";
import { Product } from "../models/product";
import { BotManager } from "../bot/manager";
import { sendToAdmin } from '../helpers/adminNotificationHelper';
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "PreOrderCmd" });

export const createPreOrderInDB = async (
  userId: ObjectId,
  productId: ObjectId,
  message: string,
  sellerId?: ObjectId
): Promise<PreOrder | null> => {
  const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;
  const db = await connectToDB();

  const product = await db
    .collection<Product>("products")
    .findOne({ _id: productId, sellerId: sid });

  if (!product) throw new Error(t().general.productNotFound);

  // Atomic balance deduction: only deduct if balance >= price
  const userBefore = await db.collection<User>("users").findOne({ _id: userId, sellerId: sid });
  if (!userBefore) throw new Error(t().general.userNotFound);
  if (userBefore.balance < product.price) {
    throw new Error(
      t().messages.insufficientFunds.replace("${needed}", (product.price - userBefore.balance).toString())
    );
  }

  const result = await db
    .collection<User>("users")
    .findOneAndUpdate(
      { _id: userId, sellerId: sid, balance: { $gte: product.price } },
      { $inc: { balance: -product.price } },
      { returnDocument: "after" }
    );

  if (!result) {
    throw new Error(t().messages.insufficientFunds.replace("${needed}", "0"));
  }

  const newPreOrder: PreOrder = {
    _id: new ObjectId(),
    userId,
    productId,
    date: new Date(),
    status: "pending",
    message,
    userName: userBefore.username,
    fullName: userBefore.fullName || "N/A",
    userTelegramId: userBefore.telegramId,
    productName: product.name,
    productPrice: product.price,
    sellerId: sid,
  };

  try {
    await db.collection<PreOrder>("preorders").insertOne(newPreOrder);
  } catch (insertError) {
    // Refund balance if insert fails
    await db
      .collection<User>("users")
      .updateOne({ _id: userId, sellerId: sid }, { $inc: { balance: product.price } });
    throw insertError;
  }

  await logPreOrderHistory(newPreOrder, message, sid);

  return newPreOrder;
};

const logPreOrderHistory = async (preOrder: PreOrder, userMessage: string, sellerId: ObjectId) => {
  const db = await connectToDB();

  const product = await db
    .collection<Product>("products")
    .findOne({ _id: new ObjectId(preOrder.productId), sellerId });

  let categoryName = "N/A";
  if (product?.categoryId) {
    const category = await db.collection("categories").findOne({
      _id: new ObjectId(product.categoryId),
      sellerId,
    });
    categoryName = category?.name || "N/A";
  }

  const historyEntry: ComprehensiveHistory = {
    _id: new ObjectId(),
    userId: preOrder.userId,
    actionType: "preOrder",
    date: new Date(),
    description: `Pre-order for '${preOrder.productName}' from '${preOrder.userName}' with message: ${userMessage}`,
    productId: preOrder.productId,
    productName: preOrder.productName,
    price: preOrder.productPrice,
    categoryName,
    userMessage,
    sellerId,
  };

  await db.collection<ComprehensiveHistory>("history").insertOne(historyEntry);
};

export const notifyUserAboutPreOrder = async (preOrder: PreOrder) => {
  try {
    const userMessage = t().preorder.userSuccess.replace("${name}", preOrder.productName);
    const bot = BotManager.getBotForMessage(preOrder.sellerId!);
    await bot.api.sendMessage(preOrder.userTelegramId, userMessage);
  } catch (error) {
    log.error({ err: error }, "Error sending pre-order confirmation to user");
  }
};

export const notifyAdminAboutPreOrder = async (preOrder: PreOrder, sellerId?: ObjectId) => {
  try {
    const sid = sellerId || preOrder.sellerId;
    const adminMessage = t().preorder.adminNotification
      .replace("${name}", preOrder.fullName)
      .replace("${username}", preOrder.userName)
      .replace("${product}", preOrder.productName)
      .replace("${message}", preOrder.message);

    await sendToAdmin(adminMessage, sid);
  } catch (error) {
    log.error({ err: error }, "Error sending pre-order notification to admin");
  }
};
