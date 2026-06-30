import { User, UserEvent } from "../models/user";
import { Context } from "grammy";

export const logTransaction = (user: User, entry: UserEvent) => {
  user.history = user.history || [];
  user.history.push(entry);
};

export const sendBalanceUpdateMessage = async (
  ctx: Context,
  user: User,
  oldBalance: number
) => {
  const newBalance = user.balance;
  await ctx.reply(
    `رصيدك السابق كان: ${oldBalance} وحدة.\nرصيدك الجديد هو: ${newBalance} وحدة.`
  );
};

export const handlePurchase = async (
  ctx: Context,
  user: User,
  productName: string,
  productPrice: number
) => {
  const oldBalance = user.balance;
  user.balance -= productPrice;

  logTransaction(user, {
    date: new Date(),
    type: "purchase",
    amount: productPrice,
    productName
  });

  await sendBalanceUpdateMessage(ctx, user, oldBalance);
};
