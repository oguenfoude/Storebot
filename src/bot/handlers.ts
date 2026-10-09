import { Bot, session, InlineKeyboard } from "grammy";
import { ObjectId } from "mongodb";
import { connectToDB } from "../db";
import { User } from "../models/user";
import { MyContext } from "../types";
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "StoreBot" });
import {
  handleStartCommand,
  handleFullNameInput,
  handlePhoneNumberInput,
  showMainMenu,
  getMainMenuKeyboard,
} from "../commands/start";
import { handleBalanceView } from "../commands/balance";
import {
  handleProductsCommand,
  handleCategorySelection,
} from "../commands/products";
import {
  initiateBuyCommand,
  handleBuyConfirmation,
  handlePreOrderMessage,
  handleCancelPurchase,
  handlePreOrderConfirmation,
} from "../commands/buy";
import { handleAccountView } from "../commands/account";
import { handleSupportView } from "../commands/support";
import { sendToAdmin } from "../helpers/adminNotificationHelper";

export function attachHandlers(bot: Bot<MyContext>, sellerId: ObjectId): void {
  bot.use(
    session({
      initial: (): MyContext["session"] => ({
        awaitingPreOrderMessage: false,
        preOrderProductId: null,
        awaitingFullName: false,
        awaitingPhoneNumber: false,
        awaitingBuyConfirmationProductId: null,
      }),
    })
  );

  async function isUserAccepted(telegramId: number): Promise<boolean> {
    try {
      const db = await connectToDB();
      const user = await db.collection<User>("users").findOne({
        telegramId: telegramId.toString(),
        sellerId,
      });

      if (!user) return false;
      return user.isAccepted !== false;
    } catch (error) {
      log.error({ err: error }, "Error checking user acceptance");
      return false;
    }
  }

  // ─── Callback queries (Inline category & product browsing) ──
  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    if (data.startsWith("store:lang:")) {
      const lang = data.split(":")[2];
      if (["en", "ar", "fr"].includes(lang)) {
        const db = await connectToDB();
        await db.collection<User>("users").updateOne(
          { telegramId: ctx.from.id.toString(), sellerId },
          { $set: { language: lang } }
        );
        const confirmMsg = lang === "ar"
          ? "تم تعيين اللغة إلى العربية بنجاح."
          : (lang === "fr" ? "Langue définie en français avec succès." : "Language set to English successfully.");
        await ctx.reply(confirmMsg, { reply_markup: getMainMenuKeyboard(lang) });
      }
      return;
    }
    if (data === "store:categories") {
      const accepted = await isUserAccepted(ctx.from?.id ?? 0);
      if (!accepted) return ctx.reply(t().general.notAccepted);
      await handleProductsCommand(ctx, sellerId);
      return;
    }
    if (data.startsWith("store:cat:")) {
      const accepted = await isUserAccepted(ctx.from?.id ?? 0);
      if (!accepted) return ctx.reply(t().general.notAccepted);
      const catId = data.split(":")[2];
      await handleCategorySelection(ctx, catId, sellerId);
      return;
    }
    if (data.startsWith("store:prod:")) {
      const accepted = await isUserAccepted(ctx.from?.id ?? 0);
      if (!accepted) return ctx.reply(t().general.notAccepted);
      const prodId = data.split(":")[2];
      await initiateBuyCommand(ctx, prodId, sellerId);
      return;
    }
  });

  // ─── Slash commands ────────────────────────────────────
  bot.command(["lang", "language"], async (ctx) => {
    const kb = new InlineKeyboard()
      .text("English", "store:lang:en")
      .text("العربية", "store:lang:ar")
      .text("Français", "store:lang:fr");
    await ctx.reply("Select your language / اختر لغتك / Choisissez votre langue:", { reply_markup: kb });
  });

  bot.command("start", async (ctx) => {
    log.info({ telegramId: ctx.from?.id, sellerId: sellerId.toString() }, "User sent /start");
    await handleStartCommand(ctx, sellerId);
  });

  bot.command("balance", async (ctx) => {
    const accepted = await isUserAccepted(ctx.from?.id ?? 0);
    if (!accepted) return ctx.reply(t().general.notAccepted);
    await handleBalanceView(ctx, sellerId);
  });

  bot.command("products", async (ctx) => {
    const accepted = await isUserAccepted(ctx.from?.id ?? 0);
    if (!accepted) return ctx.reply(t().general.notAccepted);
    await handleProductsCommand(ctx, sellerId);
  });

  bot.command("account", async (ctx) => {
    const accepted = await isUserAccepted(ctx.from?.id ?? 0);
    if (!accepted) return ctx.reply(t().general.notAccepted);
    await handleAccountView(ctx, sellerId);
  });

  bot.command("support", async (ctx) => {
    const accepted = await isUserAccepted(ctx.from?.id ?? 0);
    if (!accepted) return ctx.reply(t().general.notAccepted);
    await handleSupportView(ctx, sellerId);
  });

  bot.command("confirm", async (ctx) => {
    if (!ctx.session.awaitingBuyConfirmationProductId) return;
    const accepted = await isUserAccepted(ctx.from?.id ?? 0);
    if (!accepted) return ctx.reply(t().general.notAccepted);
    const productId = ctx.session.awaitingBuyConfirmationProductId;
    await handleBuyConfirmation(ctx, productId, sellerId);
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.session.awaitingBuyConfirmationProductId) return;
    const productId = ctx.session.awaitingBuyConfirmationProductId;
    await handleCancelPurchase(ctx, productId, sellerId);
  });

  bot.command("preorder", async (ctx) => {
    if (!ctx.session.awaitingBuyConfirmationProductId) return;
    const accepted = await isUserAccepted(ctx.from?.id ?? 0);
    if (!accepted) return ctx.reply(t().general.notAccepted);
    const productId = ctx.session.awaitingBuyConfirmationProductId;
    await handlePreOrderConfirmation(ctx, productId, sellerId);
  });

  // ─── Message handler: session-based flows + free text ──
  bot.on("message", async (ctx, next) => {
    try {
      const text = ctx.message?.text;

      // ─── Registration flow (session-based) ─────────────
      if (ctx.session.awaitingFullName && text) {
        await handleFullNameInput(ctx, sellerId);
        return;
      }
      if (ctx.session.awaitingPhoneNumber && (text || ctx.message?.contact)) {
        await handlePhoneNumberInput(ctx, sellerId);
        return;
      }
      if (ctx.session.awaitingPreOrderMessage && text) {
        await handlePreOrderMessage(ctx, sellerId);
        return;
      }

      // ─── Buy confirmation flow (session-based) ─────────
      if (ctx.session.awaitingBuyConfirmationProductId && text) {
        const accepted = await isUserAccepted(ctx.from?.id ?? 0);
        if (!accepted) return ctx.reply(t().general.notAccepted);

        const lower = text.toLowerCase();
        if (lower === t().buttons.confirmPurchase.toLowerCase() || lower === "confirm") {
          const productId = ctx.session.awaitingBuyConfirmationProductId;
          await handleBuyConfirmation(ctx, productId, sellerId);
          return;
        }
        if (lower === t().buttons.cancelPurchase.toLowerCase() || lower === "cancel") {
          const productId = ctx.session.awaitingBuyConfirmationProductId;
          await handleCancelPurchase(ctx, productId, sellerId);
          return;
        }
        if (lower === t().buttons.preorderProduct.toLowerCase() || lower === "preorder") {
          const productId = ctx.session.awaitingBuyConfirmationProductId;
          await handlePreOrderConfirmation(ctx, productId, sellerId);
          return;
        }
      }

      // ─── Menu button clicks (Products, Balance, Account, Support, Main Menu) ──
      if (text) {
        const lower = text.trim().toLowerCase();

        const isBalanceBtn =
          lower === t().menu.buttonBalance.toLowerCase() ||
          lower === "balance" ||
          lower === "الرصيد" ||
          lower === "solde";
        if (isBalanceBtn) {
          const accepted = await isUserAccepted(ctx.from?.id ?? 0);
          if (!accepted) return ctx.reply(t().general.notAccepted);
          await handleBalanceView(ctx, sellerId);
          return;
        }

        const isProductsBtn =
          lower === t().menu.buttonProducts.toLowerCase() ||
          lower === "products" ||
          lower === "المنتجات" ||
          lower === "produits";
        if (isProductsBtn) {
          const accepted = await isUserAccepted(ctx.from?.id ?? 0);
          if (!accepted) return ctx.reply(t().general.notAccepted);
          await handleProductsCommand(ctx, sellerId);
          return;
        }

        const isAccountBtn =
          lower === t().menu.buttonAccount.toLowerCase() ||
          lower === "my account" ||
          lower === "account" ||
          lower === "حسابي" ||
          lower === "mon compte";
        if (isAccountBtn) {
          const accepted = await isUserAccepted(ctx.from?.id ?? 0);
          if (!accepted) return ctx.reply(t().general.notAccepted);
          await handleAccountView(ctx, sellerId);
          return;
        }

        const isSupportBtn =
          lower === t().menu.buttonSupport.toLowerCase() ||
          lower === "support" ||
          lower === "الدعم";
        if (isSupportBtn) {
          const accepted = await isUserAccepted(ctx.from?.id ?? 0);
          if (!accepted) return ctx.reply(t().general.notAccepted);
          await handleSupportView(ctx, sellerId);
          return;
        }

        const isBackBtn =
          lower === t().buttons.backToMainMenu.toLowerCase() ||
          lower === "back to main menu" ||
          lower === "العودة للقائمة الرئيسية" ||
          lower === "retour au menu principal" ||
          lower === "menu";
        if (isBackBtn) {
          const accepted = await isUserAccepted(ctx.from?.id ?? 0);
          if (!accepted) return ctx.reply(t().general.notAccepted);
          const db = await connectToDB();
          const user = await db.collection<User>("users").findOne({
            telegramId: ctx.from?.id.toString(),
            sellerId,
          });
          await showMainMenu(ctx, user?.fullName || "user");
          return;
        }
      }

      // ─── Free-text: category/product name matching ─────
      if (text) {
        const accepted = await isUserAccepted(ctx.from?.id ?? 0);
        if (!accepted) return ctx.reply(t().general.notAccepted);

        const db = await connectToDB();

        // Check if it matches a category name
        const categories = await db
          .collection<{ name: string; _id: ObjectId }>("categories")
          .find({ sellerId })
          .toArray();
        const matchedCategory = categories.find((c) => c.name.toLowerCase() === text.toLowerCase());
        if (matchedCategory) {
          await handleCategorySelection(ctx, matchedCategory._id.toString(), sellerId);
          return;
        }

        // Check if it matches a product name
        const products = await db
          .collection<{ name: string; _id: ObjectId }>("products")
          .find({ sellerId })
          .toArray();
        const matchedProduct = products.find((p) => p.name.toLowerCase() === text.toLowerCase());
        if (matchedProduct) {
          await initiateBuyCommand(ctx, matchedProduct._id.toString(), sellerId);
          return;
        }
      }

      await next();
    } catch (error) {
      log.error({ err: error }, "Error in message handler");
      await ctx.reply(t().general.errorUnexpected);
    }
  });

  // ─── Global error handler ──────────────────────────────
  bot.catch(async (error) => {
    const { ctx } = error;
    log.error({ err: error.error }, "Error while handling update");
    try {
      await ctx.reply(
        t().general.errorTryAgainLater
      );
    } catch (replyError) {
      log.error({ err: replyError }, "Failed to send error reply to user");
    }
    try {
      await sendToAdmin(
        `Bot error in chat ${ctx.chat?.id}:\n${error.error}`,
        sellerId
      );
    } catch (notifyError) {
      log.error({ err: notifyError }, "Failed to notify admin");
    }
  });
}
