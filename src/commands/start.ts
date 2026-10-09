import { Keyboard } from "grammy";
import { MyContext } from "../types";
import { connectToDB } from "../db";
import { User } from "../models/user";
import { ObjectId } from "mongodb";
import { sendToAdmin } from "../helpers/adminNotificationHelper";
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "StartCmd" });

export const getMainMenuKeyboard = (lang?: string) => {
  const dict = t(lang);
  return new Keyboard()
    .text(dict.menu.buttonProducts)
    .text(dict.menu.buttonBalance)
    .row()
    .text(dict.menu.buttonAccount)
    .text(dict.menu.buttonSupport)
    .resized();
};

export const showMainMenu = async (ctx: MyContext, name: string, lang?: string) => {
  const dict = t(lang);
  const text = dict.menu.welcome.replace("${name}", name);
  await ctx.reply(text, { reply_markup: getMainMenuKeyboard(lang) });
};

export const handleStartCommand = async (ctx: MyContext, sellerId?: ObjectId) => {
  try {
    const telegramId = ctx.from?.id.toString();
    const chatId = ctx.chat?.id.toString();
    const username = ctx.from?.username || "unknown";
    const name = ctx.from?.first_name || "user";
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;

    if (!telegramId || !chatId) {
      log.warn("Missing telegramId or chatId.");
      return ctx.reply(t().start.errorIdentifying);
    }

    const db = await connectToDB();
    const userCollection = db.collection<User>("users");

    let user = await userCollection.findOne({ telegramId, sellerId: sid });

    const displayName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || name;

    if (!user) {
      const newUser: User = {
        telegramId,
        chatId,
        username,
        name,
        balance: 0,
        registerDate: new Date(),
        isAccepted: true,
        fullName: displayName,
        phoneNumber: "",
        sellerId: sid,
      };

      await userCollection.insertOne(newUser);
      log.info({ telegramId, sellerId: sid?.toString(), isNewUser: true }, "User registered and started bot");
    } else if (!user.fullName) {
      await userCollection.updateOne(
        { _id: user._id },
        { $set: { fullName: displayName, isAccepted: true } }
      );
    }

    ctx.session.awaitingFullName = false;
    ctx.session.awaitingPhoneNumber = false;

    await showMainMenu(ctx, user?.fullName || displayName, user?.language);
  } catch (error) {
    log.error({ err: error }, "Error in handleStartCommand");
    await ctx.reply(t().start.errorSaving);
  }
};

export const handleFullNameInput = async (ctx: MyContext, sellerId?: ObjectId): Promise<void> => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;

    const fullName = ctx.message?.text;
    if (!fullName || fullName.trim().length < 3) {
      await ctx.reply(t().start.invalidName);
      ctx.session.awaitingFullName = true;
      await ctx.reply(t().start.enterFullName);
      return;
    }

    const db = await connectToDB();
    await db
      .collection<User>("users")
      .updateOne({ telegramId, sellerId: sid }, { $set: { fullName } });

    ctx.session.awaitingFullName = false;
    ctx.session.awaitingPhoneNumber = true;

    await ctx.reply(t().start.fullNameSaved);
  } catch (error) {
    log.error({ err: error }, "Error in handleFullNameInput");
    await ctx.reply(t().start.errorSavingName);
  }
};

export const handlePhoneNumberInput = async (ctx: MyContext, sellerId?: ObjectId): Promise<void> => {
  try {
    const telegramId = ctx.from?.id.toString();
    if (!telegramId) return;
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;

    let phoneNumber = ctx.message?.contact?.phone_number || ctx.message?.text;
    if (phoneNumber) {
      phoneNumber = phoneNumber.replace(/\+/g, "").trim();
    }

    if (!phoneNumber || !/^\d{10,15}$/.test(phoneNumber)) {
      await ctx.reply(t().start.invalidPhone);
      return;
    }

    const db = await connectToDB();
    await db
      .collection<User>("users")
      .updateOne({ telegramId, sellerId: sid }, { $set: { phoneNumber } });

    ctx.session.awaitingPhoneNumber = false;

    const updatedUser = await db.collection<User>("users").findOne({ telegramId, sellerId: sid });
    if (updatedUser) {
      await sendAdminNotification(ctx, updatedUser, sid);
    }

    await showMainMenu(ctx, updatedUser?.fullName || "user");
    log.info({ telegramId, sellerId: sid?.toString() }, "User completed registration");
  } catch (error) {
    log.error({ err: error }, "Error in handlePhoneNumberInput");
    await ctx.reply(t().start.errorSavingPhone);
  }
};

export const sendAdminNotification = async (ctx: MyContext, user: User, sellerId?: ObjectId) => {
  try {
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;
    const message = t().admin.newUser
      .replace("${name}", user.fullName || "N/A")
      .replace("${username}", user.username || "N/A")
      .replace("${telegramId}", user.telegramId)
      .replace("${phone}", user.phoneNumber || "N/A")
      .replace("${date}", user.registerDate ? user.registerDate.toLocaleDateString() : "N/A");

    await sendToAdmin(message, sid, {
      parse_mode: "Markdown",
    });

    log.info({ telegramId: user.telegramId }, "Admin notification sent for user");
  } catch (error) {
    log.error({ err: error }, "Error sending admin notification");
  }
};
