import { ObjectId } from "mongodb";
import { bot } from "../botInstance";
import { connectToDB } from "../db";
import { PreOrder } from "../models/preorder";
import { ComprehensiveHistory } from "../models/comprehensiveHistory";
import { User } from "../models/user";
import { Product } from "../models/product";
import { AdminMessages, UserMessages, ErrorMessages, safeSendMessage } from "../utils/messages";

import { sendToAdmin } from '../helpers/adminNotificationHelper';

export const createPreOrderInDB = async (
  userId: ObjectId,
  productId: ObjectId,
  message: string
): Promise<PreOrder | null> => {
  const db = await connectToDB();

  const user = await db.collection<User>("users").findOne({ _id: userId });
  const product = await db
    .collection<Product>("products")
    .findOne({ _id: productId });

  if (!user) throw new Error(ErrorMessages.userNotFound());
  if (!product) throw new Error(ErrorMessages.productNotFound());

  if (user.balance < product.price) {
    throw new Error(
      UserMessages.formatInsufficientFundsMessage(user.balance, product.price)
    );
  }

  const newBalance = user.balance - product.price;
  await db
    .collection<User>("users")
    .updateOne({ _id: userId }, { $set: { balance: newBalance } });

  const newPreOrder: PreOrder = {
    _id: new ObjectId(),
    userId,
    productId,
    date: new Date(),
    status: "pending",
    message,
    userName: user.username,
    fullName: user.fullName || "غير متوفر",
    userTelegramId: user.telegramId,
    productName: product.name,
    productPrice: product.price,
  };

  await db.collection<PreOrder>("preorders").insertOne(newPreOrder);

  await logPreOrderHistory(newPreOrder, message);

  return newPreOrder;
};

const logPreOrderHistory = async (preOrder: PreOrder, userMessage: string) => {
  const db = await connectToDB();

  const product = await db
    .collection<Product>("products")
    .findOne({ _id: new ObjectId(preOrder.productId) });

  let categoryName = "غير محدد";
  if (product?.categoryId) {
    const category = await db.collection("categories").findOne({
      _id: new ObjectId(product.categoryId),
    });
    categoryName = category?.name || "غير محدد";
  }

  const historyEntry: ComprehensiveHistory = {
    _id: new ObjectId(),
    userId: preOrder.userId,
    actionType: "preOrder",
    date: new Date(),
    description: `طلب مسبق للمنتج '${preOrder.productName}' من المستخدم '${preOrder.userName}' مع الرسالة: ${userMessage}`,
    productId: preOrder.productId,
    productName: preOrder.productName,
    price: preOrder.productPrice,
    categoryName,
    userMessage,
  };

  await db.collection<ComprehensiveHistory>("history").insertOne(historyEntry);
};

export const notifyUserAboutPreOrder = async (preOrder: PreOrder) => {
  try {
    const userMessage = UserMessages.preorderSuccess(preOrder.productName);
    await safeSendMessage(preOrder.userTelegramId, userMessage);
  } catch (error) {
    console.error("Error sending pre-order confirmation to user:", error);
  }
};

export const notifyAdminAboutPreOrder = async (preOrder: PreOrder) => {
  try {
    const adminMessage = AdminMessages.notifyAdminPreOrder(
      preOrder.fullName,
      preOrder.userName,
      preOrder.productName,
      preOrder.message
    );

    await sendToAdmin(adminMessage, {
      parse_mode: "Markdown",
      callback_data: `preorder_confirm_${preOrder._id}`
    });
  } catch (error) {
    console.error("Error sending pre-order notification to admin:", error);
  }
};
