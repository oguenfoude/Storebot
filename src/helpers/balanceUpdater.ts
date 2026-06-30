import { Context } from "grammy";
import { User, UserEvent, PaymentHistoryEntry } from "../models/user";
import { connectToDB } from "../db";

export const logTransaction = async (user: User, entry: UserEvent) => {
  const db = await connectToDB();
  user.history = user.history || [];
  user.history.push(entry);
  await db
    .collection("users")
    .updateOne({ _id: user._id }, { $set: { history: user.history } });
};

export const updateBalance = async (
  ctx: Context,
  user: User,
  amount: number
) => {
  const db = await connectToDB();
  const oldBalance = user.balance;
  user.balance += amount;

  const paymentEntry: PaymentHistoryEntry = {
    date: new Date(),
    amount,
    description: `Balance updated by ${amount} points.`,
  };
  user.paymentHistory = user.paymentHistory || [];
  user.paymentHistory.push(paymentEntry);

  const historyEntry: UserEvent = {
    date: new Date(),
    type: "recharge",
    amount,
  };
  await logTransaction(user, historyEntry);

  await db
    .collection("users")
    .updateOne(
      { _id: user._id },
      { $set: { balance: user.balance, paymentHistory: user.paymentHistory } }
    );

  try {
    await ctx.api.sendMessage(
      user.telegramId,
      `🔔 Your balance has been updated. New balance: ${user.balance} points.`
    );
  } catch (error) {
    console.error(`Failed to send balance update message: ${error}`);
  }
};
