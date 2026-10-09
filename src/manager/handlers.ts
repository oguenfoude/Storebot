import { Bot, session, InlineKeyboard } from "grammy";
import { ObjectId } from "mongodb";
import { connectToDB } from "../db";
import { Seller } from "../models/seller";
import { User } from "../models/user";
import { Product } from "../models/product";
import { Category } from "../models/category";
import { MyContext } from "../types";
import { BotManager } from "../bot/manager";
import { t, template } from "../languages";
import { reactivateSeller } from "./expiry";
import { createSubscriptionInvoice } from "../services/nowpayments";
import { validateNOWPaymentsKey } from "../services/nowpayments";
import { parseManagerCallback } from "./callbackParser";
import { encryptApiKey, decryptApiKey } from "../helpers/encryption";
import { getAdminIds } from "../helpers/getAdminIds";
import logger from "../helpers/logger";

const log = logger.child({ tag: "ManagerHandlers" });

export interface ManagerSessionData {
  awaitingBotToken?: boolean;
  awaitingPaymentPlan?: boolean;
  sellerId?: string;
  awaitingProductName?: boolean;
  awaitingProductPrice?: boolean;
  awaitingProductStock?: boolean;
  awaitingProductCategory?: boolean;
  awaitingProductPreorder?: boolean;
  editingProductId?: string;
  awaitingCategoryName?: boolean;
  editingCategoryId?: string;
  awaitingConfirmDelete?: boolean;
  deleteTarget?: string;
  tempProductName?: string;
  tempProductPrice?: number;
  tempProductEmails?: string[];
  tempProductCategoryId?: ObjectId;
  awaitingNowpaymentsKey?: boolean;
  awaitingNewSeller?: boolean;
  pendingNewSellerToken?: string;
  pendingNewSellerBotUsername?: string;
  activeStoreId?: string;
  awaitingRechargeAmount?: boolean;
  pendingRechargeUserId?: string;
  awaitingRenewDays?: boolean;
  pendingRenewSellerId?: string;
}

export type ManagerContext = MyContext & { session: ManagerSessionData };

function isAdmin(telegramId: number): boolean {
  return getAdminIds().includes(telegramId.toString());
}

const ITEMS_PER_PAGE = 8;

// ─── Helper: status emoji ───────────────────────────────
export function statusEmoji(status: string): string {
  if (status === "active") return "[Active]";
  if (status === "trial") return "[Trial]";
  if (status === "token_invalid") return "[Token Invalid]";
  return "[Expired]";
}

// ─── Helper: format seller for inline button ────────────
export function sellerButtonLabel(seller: Seller): string {
  return `${statusEmoji(seller.status)} @${seller.botUsername || seller.telegramId}`;
}
// ─── MAIN HANDLER EXPORT ────────────────────────────────
export function attachManagerHandlers(bot: Bot<ManagerContext>): void {
  bot.use(
    session({
      initial: (): ManagerSessionData => ({
        awaitingBotToken: false,
        awaitingPaymentPlan: false,
        awaitingNowpaymentsKey: false,
      }),
    })
  );

  // ═══════════════════════════════════════════════════════
  //  CALLBACK QUERY HANDLER (drill-down navigation)
  // ═══════════════════════════════════════════════════════
  bot.on("callback_query:data", async (ctx) => {
    if (!ctx.from) return;
    await ctx.answerCallbackQuery();

    const parsed = parseManagerCallback(ctx.callbackQuery.data);

    const cbData = ctx.callbackQuery.data;

    // ─── Menu navigation (inline keyboard main menu) ──────
    if (cbData.startsWith("mgr:lang:")) {
      const lang = cbData.split(":")[2];
      if (["en", "ar", "fr"].includes(lang)) {
        const { setLanguage } = await import("../languages");
        setLanguage(lang);
        const kb = isAdmin(ctx.from.id) ? adminMenuKeyboard() : sellerMenuKeyboard();
        const msg = lang === "ar" ? "تم تحديث لغة لوحة التحكم إلى العربية." : (lang === "fr" ? "Langue du tableau de bord mise à jour en français." : "Dashboard language updated to English.");
        await sendOrEdit(ctx, msg, kb);
      }
      return;
    }
    if (cbData === "mgr:menu:home") {
      if (isAdmin(ctx.from.id)) {
        await sendOrEdit(
          ctx,
          `${t().adminPanel.welcomeTitle}\n\n${t().adminPanel.welcomeDesc}`,
          adminMenuKeyboard()
        );
      } else {
        const sellerRes = await getActiveSeller(ctx);
        if (sellerRes.kind === "seller") {
          await sendSellerStatus(ctx, sellerRes.seller);
        } else if (sellerRes.kind === "selector") {
          return;
        } else {
          await sendOrEdit(ctx, t().adminPanel.manageStoreHint, sellerMenuKeyboard());
        }
      }
      return;
    }

    if (cbData === "mgr:menu:sellers" && isAdmin(ctx.from.id)) {
      return await showSellerList(ctx, 0);
    }
    if (cbData === "mgr:menu:stats" && isAdmin(ctx.from.id)) {
      return await sendOrEdit(ctx, await getStatsMessage(), backToAdminMenuKeyboard());
    }
    if (cbData === "mgr:menu:add_seller" && isAdmin(ctx.from.id)) {
      log.info({ adminId: ctx.from.id }, "Admin opened add store prompt");
      await sendOrEdit(ctx, t().adminPanel.addSellerPrompt, backToAdminMenuKeyboard());
      (ctx.session as any).awaitingBotToken = true;
      return;
    }

    if (cbData === "mgr:menu:mystore" && !isAdmin(ctx.from.id)) {
      const sellerRes = await getActiveSeller(ctx);
      if (sellerRes.kind === "seller") {
        await sendSellerStatus(ctx, sellerRes.seller);
      }
      return;
    }
    if (cbData === "mgr:menu:subscription" && !isAdmin(ctx.from.id)) {
      return handleSubscriptionButton(ctx);
    }
    if (cbData === "mgr:menu:myproducts" && !isAdmin(ctx.from.id)) {
      return handleMyProductsButton(ctx);
    }
    if (cbData === "mgr:menu:mycategories" && !isAdmin(ctx.from.id)) {
      return handleMyCategoriesButton(ctx);
    }
    if (cbData === "mgr:menu:addproduct" && !isAdmin(ctx.from.id)) {
      return handleAddProductButton(ctx);
    }
    if (cbData === "mgr:menu:addcategory" && !isAdmin(ctx.from.id)) {
      return handleAddCategoryButton(ctx);
    }
    if (cbData === "mgr:menu:setpayment" && !isAdmin(ctx.from.id)) {
      return handleSetPaymentButton(ctx);
    }
    if (cbData === "mgr:menu:help" && !isAdmin(ctx.from.id)) {
      return ctx.reply(t().adminPanel.helpText, { reply_markup: backToSellerMenuKeyboard() });
    }

    // Admin-only callbacks (navigation, seller management)
    if (isAdmin(ctx.from.id)) {
      switch (parsed.type) {
        case "sellers":
          return await showSellerList(ctx, parsed.page ?? 0);
        case "seller_detail":
          return await showSellerDetail(ctx, parsed.sellerId);
        case "user_list":
          return await showUserList(ctx, parsed.sellerId, parsed.page);
        case "user_detail":
          return await showUserDetail(ctx, parsed.userId);
        case "product_list":
          return await showProductList(ctx, parsed.sellerId, parsed.page);
        case "product_detail":
          return await showProductDetail(ctx, parsed.productId);
        case "admin_delete_product":
          return await handleAdminDeleteProduct(ctx, parsed.productId);
        case "confirm_delete_product":
          return await handleConfirmDeleteProduct(ctx, parsed.productId);
        case "back_seller":
          return await showSellerDetail(ctx, parsed.sellerId);
        case "back_users":
          return await showUserList(ctx, parsed.sellerId, 0);
        case "back_products":
          return await showProductList(ctx, parsed.sellerId, 0);
        case "pay_seller":
          return await handlePaySeller(ctx, parsed.sellerId);
        case "renew":
          return await handleAdminRenew(ctx, parsed.sellerId);
        case "ban":
          return await handleAdminBan(ctx, parsed.sellerId);
        case "unban":
          return await handleAdminUnban(ctx, parsed.sellerId);
        case "delete_seller":
          return await handleAdminDeleteSeller(ctx, parsed.sellerId);
        case "recharge":
          return await handleAdminRecharge(ctx, parsed.userId);
        case "confirm_ban":
          return await handleConfirmBan(ctx, parsed.sellerId);
        case "confirm_unban":
          return await handleConfirmUnban(ctx, parsed.sellerId);
        case "confirm_delete_seller":
          return await handleConfirmDeleteSeller(ctx, parsed.sellerId);
        case "confirm_recharge":
          return await handleConfirmRecharge(ctx, parsed.userId, parsed.amount);
        case "cancel_action":
          return await handleCancelAction(ctx);
        case "renew_with_days":
          return await handleRenewWithDays(ctx, parsed.sellerId, parsed.days);
      }
    }

    // Shared callbacks (both admin and seller can use)

    if (cbData === "mgr:cancel_action") {
      return await handleCancelAction(ctx);
    }

    // Seller callbacks (multi-store, product/category management, payment setup)
    // These are scoped by getActiveSeller() so only the owner can act on their data.

    if (cbData === "mgr:seller_back") {
      if (isAdmin(ctx.from.id)) return;
      const sellerRes = await getActiveSeller(ctx);
      if (sellerRes.kind === "seller") {
        await sendSellerStatus(ctx, sellerRes.seller);
      }
      return;
    }

    // Seller payment plan selection (multi-store)
    if (cbData.startsWith("mgr:pay:") && !isAdmin(ctx.from.id)) {
      const sellerIdStr = cbData.split(":")[2];
      if (sellerIdStr && ObjectId.isValid(sellerIdStr)) {
        return await handlePaySeller(ctx, sellerIdStr);
      }
    }

    // All remaining callbacks require a registered seller
    const sellerRes = await getActiveSeller(ctx);
    if (sellerRes.kind !== "seller") return;
    const seller = sellerRes.seller;

    const db = await connectToDB();

    if (cbData === "mgr:reuse_key") {
      const pendingToken = (ctx.session as any).pendingNewSellerToken;
      const pendingUsername = (ctx.session as any).pendingNewSellerBotUsername;
      if (!pendingToken || !pendingUsername) return;

      const existingSellerWithKey = await db.collection<Seller>("sellers").findOne({
        telegramId: ctx.from.id.toString(),
        nowpaymentsApiKey: { $exists: true } as any,
      });
      if (!existingSellerWithKey) return;

      const newSeller: Seller = {
        _id: new ObjectId(),
        telegramId: ctx.from.id.toString(),
        botToken: pendingToken,
        botUsername: pendingUsername,
        status: "active",
        maxProducts: 999,
        nowpaymentsApiKey: existingSellerWithKey.nowpaymentsApiKey,
        createdAt: new Date(),
      };
      await db.collection<Seller>("sellers").insertOne(newSeller);
      await BotManager.bootSeller(newSeller);
      log.info({ sellerId: newSeller._id?.toString(), username: pendingUsername, telegramId: ctx.from?.id }, "New seller registered");

      (ctx.session as any).pendingNewSellerToken = undefined;
      (ctx.session as any).pendingNewSellerBotUsername = undefined;

      await ctx.reply(
        template(t().adminPanel.addSellerSuccessActive, {
          username: pendingUsername,
          url: `https://t.me/${pendingUsername}`,
        }), { reply_markup: sellerMenuKeyboard() }
      );
      return;
    }

    if (cbData === "mgr:new_key") {
      const pendingToken = (ctx.session as any).pendingNewSellerToken;
      const pendingUsername = (ctx.session as any).pendingNewSellerBotUsername;
      if (!pendingToken || !pendingUsername) return;

      (ctx.session as any).awaitingNowpaymentsKey = true;
      const cancelKb = new InlineKeyboard().text(t().adminPanel.cancelBtn, "mgr:menu:home");
      await sendOrEdit(ctx, t().adminPanel.setPaymentAwaiting, cancelKb);
      return;
    }

    if (cbData === "mgr:setpay_key" || cbData === "mgr:pay_update" || cbData === "mgr:pay_setup") {
      (ctx.session as any).awaitingNowpaymentsKey = true;
      const cancelKb = new InlineKeyboard().text(t().adminPanel.cancelBtn, "mgr:menu:setpayment");
      await sendOrEdit(ctx, t().adminPanel.setPaymentAwaiting, cancelKb);
      return;
    }

    if (cbData.startsWith("mgr:pay_remove:")) {
      const sellerId = cbData.split(":")[2];
      if (!ObjectId.isValid(sellerId)) return;
      await db.collection<Seller>("sellers").updateOne(
        { _id: new ObjectId(sellerId), telegramId: ctx.from.id.toString() },
        { $unset: { nowpaymentsApiKey: "" } }
      );
      await sendOrEdit(ctx, t().adminPanel.setPaymentCleared, sellerMenuKeyboard());
      return;
    }

    if (cbData.startsWith("mgr:store:")) {
      const sellerId = cbData.split(":")[2];
      if (!ObjectId.isValid(sellerId)) return;
      (ctx.session as any).activeStoreId = sellerId;
      await sendOrEdit(ctx, t().adminPanel.storeSelectorActive, sellerMenuKeyboard());
      return;
    }

    if (cbData.startsWith("mgr:eprod:")) {
      const productId = cbData.split(":")[2];
      if (!ObjectId.isValid(productId)) return;
      (ctx.session as any).editingCategoryId = undefined;
      (ctx.session as any).awaitingCategoryName = false;
      (ctx.session as any).editingProductId = productId;
      (ctx.session as any).awaitingProductName = true;
      log.info({ sellerId: seller._id?.toString(), productId }, "Seller editing product name");
      await sendOrEdit(ctx, t().adminPanel.editProductName, new InlineKeyboard().text(t().adminPanel.cancelBtn, `mgr:prod_detail:${productId}`));
      return;
    }

    if (cbData.startsWith("mgr:epprod:")) {
      const productId = cbData.split(":")[2];
      if (!ObjectId.isValid(productId)) return;
      const product = await db.collection<Product>("products").findOne({ _id: new ObjectId(productId), sellerId: seller._id });
      if (!product) return;
      (ctx.session as any).editingCategoryId = undefined;
      (ctx.session as any).awaitingCategoryName = false;
      (ctx.session as any).editingProductId = productId;
      (ctx.session as any).awaitingProductPrice = true;
      log.info({ sellerId: seller._id?.toString(), productId }, "Seller editing product price");
      await sendOrEdit(ctx, template(t().adminPanel.editProductPrice, { price: product.price.toString() }), new InlineKeyboard().text(t().adminPanel.cancelBtn, `mgr:prod_detail:${productId}`));
      return;
    }

    if (cbData.startsWith("mgr:prod_detail:")) {
      const productId = cbData.split(":")[2];
      await handleProductDetail(ctx, productId);
      return;
    }

    if (cbData.startsWith("mgr:cat_detail:")) {
      const catId = cbData.split(":")[2];
      await handleCategoryDetail(ctx, catId);
      return;
    }

    if (cbData.startsWith("mgr:dprod:")) {
      const productId = cbData.split(":")[2];
      if (!ObjectId.isValid(productId)) return;
      const product = await db.collection<Product>("products").findOne({ _id: new ObjectId(productId), sellerId: seller._id });
      if (!product) return;
      (ctx.session as any).awaitingConfirmDelete = true;
      (ctx.session as any).deleteTarget = `product:${productId}`;
      const keyboard = new InlineKeyboard()
        .text(t().adminPanel.deleteConfirmYes, `mgr:confirm_delete`)
        .text(t().adminPanel.deleteConfirmNo, `mgr:prod_detail:${productId}`);
      await sendOrEdit(ctx, template(t().adminPanel.deleteProductConfirm, { name: product.name }), keyboard);
      return;
    }

    if (cbData.startsWith("mgr:ecat:")) {
      const catId = cbData.split(":")[2];
      if (!ObjectId.isValid(catId)) return;
      (ctx.session as any).editingProductId = undefined;
      (ctx.session as any).awaitingProductName = false;
      (ctx.session as any).awaitingProductPrice = false;
      (ctx.session as any).editingCategoryId = catId;
      (ctx.session as any).awaitingCategoryName = true;
      log.info({ sellerId: seller._id?.toString(), categoryId: catId }, "Seller editing category name");
      await sendOrEdit(ctx, t().adminPanel.editCategoryNewName, new InlineKeyboard().text(t().adminPanel.cancelBtn, `mgr:cat_detail:${catId}`));
      return;
    }

    if (cbData.startsWith("mgr:dcat:")) {
      const catId = cbData.split(":")[2];
      if (!ObjectId.isValid(catId)) return;
      const cat = await db.collection<Category>("categories").findOne({ _id: new ObjectId(catId), sellerId: seller._id });
      if (!cat) return;
      (ctx.session as any).awaitingConfirmDelete = true;
      (ctx.session as any).deleteTarget = `category:${catId}`;
      const keyboard = new InlineKeyboard()
        .text(t().adminPanel.deleteConfirmYes, `mgr:confirm_delete`)
        .text(t().adminPanel.deleteConfirmNo, `mgr:cat_detail:${catId}`);
      await sendOrEdit(ctx, template(t().adminPanel.deleteCategoryConfirm, { name: cat.name }), keyboard);
      return;
    }

    if (cbData.startsWith("mgr:addprod_cat:")) {
      await ctx.answerCallbackQuery();
      if (!(ctx.session as any).awaitingProductCategory) return;
      const catId = cbData.split(":")[2];
      let categoryId: ObjectId | undefined;
      if (catId !== "none" && ObjectId.isValid(catId)) {
        categoryId = new ObjectId(catId);
      }
      (ctx.session as any).awaitingProductCategory = false;
      (ctx.session as any).awaitingProductPreorder = true;
      (ctx.session as any).tempProductCategoryId = categoryId;
      const preorderKb = new InlineKeyboard()
        .text(t().adminPanel.preorderYes, "mgr:preorder_yes")
        .text(t().adminPanel.preorderNo, "mgr:preorder_no")
        .row()
        .text(t().adminPanel.cancelBtn, "mgr:menu:home");
      await sendOrEdit(ctx, t().adminPanel.addProductStep5, preorderKb);
      return;
    }

    if (cbData === "mgr:preorder_yes" || cbData === "mgr:preorder_no") {
      await ctx.answerCallbackQuery();
      if (!(ctx.session as any).awaitingProductPreorder) return;
      const allowPreOrder = cbData === "mgr:preorder_yes";
      const name = (ctx.session as any).tempProductName;
      const price = (ctx.session as any).tempProductPrice;
      const emails = (ctx.session as any).tempProductEmails || [];
      const categoryId = (ctx.session as any).tempProductCategoryId;

      const newProduct: Product = {
        _id: new ObjectId(),
        sellerId: seller._id,
        name,
        description: "",
        price,
        emails,
        categoryId: categoryId || new ObjectId(),
        isAvailable: emails.length > 0,
        allowPreOrder,
        createdDate: new Date(),
        archive: [],
      };

      await db.collection<Product>("products").insertOne(newProduct);
      log.info({ sellerId: seller._id?.toString(), productName: name, price }, "Product created");
      (ctx.session as any).awaitingProductPreorder = false;
      (ctx.session as any).tempProductName = undefined;
      (ctx.session as any).tempProductPrice = undefined;
      (ctx.session as any).tempProductEmails = undefined;
      (ctx.session as any).tempProductCategoryId = undefined;
      await sendOrEdit(ctx, template(t().adminPanel.addProductSuccess, { name }), backToSellerMenuKeyboard());
      return;
    }

    if (cbData.startsWith("mgr:recharge_amount:")) {
      await ctx.answerCallbackQuery();
      const parts = cbData.split(":");
      const userId = parts[2];
      const amount = parseFloat(parts[3]);
      if (!ctx.from || !isAdmin(ctx.from.id)) return;
      if (!ObjectId.isValid(userId) || isNaN(amount) || amount <= 0) return;
      const rdb = await connectToDB();
      const rechargeUser = await rdb.collection<User>("users").findOne({ _id: new ObjectId(userId) });
      if (!rechargeUser) { await ctx.reply(t().adminPanel.rechargeNotFound); return; }

      const confirmKeyboard = new InlineKeyboard()
        .text(t().adminPanel.confirmBtn, `mgr:confirm_recharge:${userId}:${amount}`)
        .text(t().adminPanel.cancelConfirmBtn, "mgr:cancel_action");

      await ctx.reply(
        template(t().adminPanel.rechargeConfirm, { amount: amount.toString(), name: rechargeUser.fullName || rechargeUser.username || rechargeUser.telegramId }),
        { reply_markup: confirmKeyboard }
      );
      return;
    }

    if (cbData.startsWith("mgr:pay_plan:")) {
      await ctx.answerCallbackQuery();
      const parts = cbData.split(":");
      const days = parseInt(parts[2], 10);
      const amount = parseInt(parts[3], 10);
      if (isNaN(days) || isNaN(amount)) return;

      const pdb = await connectToDB();
      const sessionSellerId = (ctx.session as any).sellerId;
      let paySeller: Seller | null = null;
      if (sessionSellerId && ObjectId.isValid(sessionSellerId)) {
        paySeller = await pdb.collection<Seller>("sellers").findOne({ _id: new ObjectId(sessionSellerId) });
      }
      if (!paySeller) {
        paySeller = await pdb.collection<Seller>("sellers").findOne({ telegramId: ctx.from!.id.toString() });
      }
      if (!paySeller) { await ctx.reply(t().adminPanel.renewNotFound); return; }
      log.info({ sellerId: paySeller._id?.toString(), plan: `${days} days` }, "Seller selected payment plan");
      (ctx.session as any).sellerId = undefined;

      const result = await createSubscriptionInvoice(paySeller._id!, paySeller.botUsername || ctx.from!.id.toString(), days, amount, paySeller.nowpaymentsApiKey);
      if (!result) {
        await reactivateSeller(paySeller._id!, days);
        log.info({ sellerId: paySeller._id?.toString(), days }, "Dev mode free activation applied");
        await sendOrEdit(
          ctx,
          `[DEV / DEMO MODE]\n\nOnline crypto payments are currently not active during this demo.\n\nYour store @${paySeller.botUsername || "store"} has been granted ${days} days free plan so you can test all features!`,
          backToSellerMenuKeyboard()
        );
        return;
      }

      await ctx.reply(
        `${template(t().adminPanel.paymentInvoiceTitle, { days: days.toString(), amount: amount.toString() })}\n\n${result.paymentUrl}`
      );
      return;
    }

    if (cbData === "mgr:confirm_delete" && (ctx.session as any).awaitingConfirmDelete) {
      const target = (ctx.session as any).deleteTarget as string;
      (ctx.session as any).awaitingConfirmDelete = false;
      (ctx.session as any).deleteTarget = undefined;

      if (target.startsWith("product:")) {
        const productId = target.split(":")[1];
        await db.collection<Product>("products").deleteOne({ _id: new ObjectId(productId), sellerId: seller._id });
        log.info({ sellerId: seller._id?.toString(), productId }, "Product deleted");
        await handleMyProductsButton(ctx);
      } else if (target.startsWith("category:")) {
        const catId = target.split(":")[1];
        await db.collection<Category>("categories").deleteOne({ _id: new ObjectId(catId), sellerId: seller._id });
        log.info({ sellerId: seller._id?.toString(), categoryId: catId }, "Category deleted");
        await handleMyCategoriesButton(ctx);
      }
      return;
    }

    if (cbData === "mgr:cancel_delete") {
      (ctx.session as any).awaitingConfirmDelete = false;
      (ctx.session as any).deleteTarget = undefined;
      await sendOrEdit(ctx, t().adminPanel.deleteCancelled, backToSellerMenuKeyboard());
      return;
    }
  });

  async function resetSessionAndCancel(ctx: ManagerContext): Promise<void> {
    const session = ctx.session as any;
    session.awaitingBotToken = false;
    session.awaitingPaymentPlan = false;
    session.awaitingProductName = false;
    session.awaitingProductPrice = false;
    session.awaitingProductStock = false;
    session.awaitingProductCategory = false;
    session.awaitingProductPreorder = false;
    session.editingProductId = undefined;
    session.awaitingCategoryName = false;
    session.editingCategoryId = undefined;
    session.awaitingConfirmDelete = false;
    session.deleteTarget = undefined;
    session.awaitingNowpaymentsKey = false;
    session.awaitingNewSeller = false;
    session.pendingNewSellerToken = undefined;
    session.pendingNewSellerBotUsername = undefined;
    session.activeStoreId = undefined;
    session.awaitingRechargeAmount = false;
    session.pendingRechargeUserId = undefined;
    session.awaitingRenewDays = false;
    session.pendingRenewSellerId = undefined;
    session.sellerId = undefined;

    log.info({ userId: ctx.from?.id }, "User reset session and cancelled active flow");
    const kb = isAdmin(ctx.from?.id ?? 0) ? adminMenuKeyboard() : sellerMenuKeyboard();
    await sendOrEdit(ctx, t().adminPanel.cancelReply || "Cancelled.", kb);
  }

  // ═══════════════════════════════════════════════════════
  //  COMMANDS
  // ═══════════════════════════════════════════════════════

  bot.command(["lang", "language"], async (ctx) => {
    if (!ctx.from) return;
    const kb = new InlineKeyboard()
      .text("English", "mgr:lang:en")
      .text("العربية", "mgr:lang:ar")
      .text("Français", "mgr:lang:fr")
      .row()
      .text(t().adminPanel.cancelBtn, "mgr:menu:home");
    await ctx.reply("Select dashboard language / اختر لغة لوحة التحكم / Choisissez la langue:", { reply_markup: kb });
  });

  bot.command("start", async (ctx) => {
    if (!ctx.from) return;

    if (isAdmin(ctx.from.id)) {
      return ctx.reply(
        `${t().adminPanel.welcomeTitle}\n\n${t().adminPanel.welcomeDesc}`,
        { reply_markup: adminMenuKeyboard() }
      );
    }

    // Seller registration flow
    const telegramId = ctx.from.id.toString();
    const db = await connectToDB();
    const existing = await db.collection<Seller>("sellers").findOne({ telegramId });

    if (existing) {
      await sendSellerStatus(ctx, existing);
      return;
    }

    await ctx.reply(
      `${t().adminPanel.registerPromptTitle}\n\n` +
      `${t().adminPanel.registerPromptToken}\n\n` +
      `${t().adminPanel.registerPromptStep1}\n` +
      `${t().adminPanel.registerPromptStep2}\n` +
      `${t().adminPanel.registerPromptStep3}\n\n` +
      `${t().adminPanel.registerPromptTrial}\n` +
      `${t().adminPanel.registerPromptAdditional}`
    );
    (ctx.session as any).awaitingBotToken = true;
  });

  bot.command("cancel", async (ctx) => {
    await resetSessionAndCancel(ctx);
  });

  bot.command("stats", async (ctx) => {
    if (!ctx.from) return;
    if (isAdmin(ctx.from.id)) {
      return ctx.reply(await getStatsMessage(), { reply_markup: backToAdminMenuKeyboard() });
    }
  });

  bot.command("sellers", async (ctx) => {
    if (!ctx.from) return;
    if (isAdmin(ctx.from.id)) {
      return await showSellerList(ctx);
    }
  });

  bot.command("mystore", async (ctx) => {
    if (!ctx.from) return;
    const sellerRes = await getActiveSeller(ctx);
    if (sellerRes.kind === "seller") {
      await sendSellerStatus(ctx, sellerRes.seller);
    } else if (sellerRes.kind === "none") {
      await ctx.reply(t().adminPanel.mystoreNotRegistered);
    }
  });

  bot.command(["pay", "subscription"], async (ctx) => {
    if (!ctx.from) return;
    return handleSubscriptionButton(ctx);
  });

  bot.command("myproducts", async (ctx) => {
    if (!ctx.from) return;
    return handleMyProductsButton(ctx);
  });

  bot.command("mycategories", async (ctx) => {
    if (!ctx.from) return;
    return handleMyCategoriesButton(ctx);
  });

  bot.command("addproduct", async (ctx) => {
    if (!ctx.from) return;
    return handleAddProductButton(ctx);
  });

  bot.command("addcategory", async (ctx) => {
    if (!ctx.from) return;
    return handleAddCategoryButton(ctx);
  });

  bot.command("setpayment", async (ctx) => {
    if (!ctx.from) return;
    return handleSetPaymentButton(ctx);
  });

  bot.command("help", async (ctx) => {
    if (!ctx.from) return;
    if (isAdmin(ctx.from.id)) {
      return ctx.reply(
        `${t().adminPanel.welcomeTitle}\n\n${t().adminPanel.welcomeDesc}`,
        { reply_markup: adminMenuKeyboard() }
      );
    }
    return ctx.reply(t().adminPanel.helpText, { reply_markup: backToSellerMenuKeyboard() });
  });

  // ═══════════════════════════════════════════════════════
  //  HELPER FUNCTIONS
  // ═══════════════════════════════════════════════════════

  async function getStatsMessage(): Promise<string> {
    const db = await connectToDB();
    const totalSellers = await db.collection<Seller>("sellers").countDocuments();
    const active = await db.collection<Seller>("sellers").countDocuments({ status: "active" });
    const trial = await db.collection<Seller>("sellers").countDocuments({ status: "trial" });
    const expired = await db.collection<Seller>("sellers").countDocuments({ status: "expired" });
    const totalUsers = await db.collection("users").countDocuments();
    const totalProducts = await db.collection("products").countDocuments();

    return (
      `${t().adminPanel.statsTitle}\n\n` +
      template(t().adminPanel.statsSellers, { total: totalSellers, active, trial, expired }) + "\n" +
      template(t().adminPanel.statsUsers, { count: totalUsers }) + "\n" +
      template(t().adminPanel.statsProducts, { count: totalProducts }) + "\n" +
      template(t().adminPanel.statsBots, { count: BotManager.runningCount })
    );
  }

  // ═══════════════════════════════════════════════════════
  //  TEXT MESSAGE HANDLER
  // ═══════════════════════════════════════════════════════
  bot.on("message:text", async (ctx) => {
    if (!ctx.from) return;
    const text = ctx.message.text;

    // Global Cancel handler — must be checked FIRST before any flow processing
    const cancelText = t().sellerKeyboard.cancel;
    const cancelTextAr = "إلغاء";
    const cancelTextFr = "Annuler";
    const lowerText = text.trim().toLowerCase();
    if (
      text === cancelText ||
      text === cancelTextAr ||
      text === cancelTextFr ||
      lowerText === "cancel" ||
      lowerText === "/cancel"
    ) {
      await resetSessionAndCancel(ctx);
      return;
    }
    // Bot token input
    if ((ctx.session as any).awaitingBotToken) {
      const token = text.trim();
      if (!/^\d+:[A-Za-z0-9_-]{35,}$/.test(token)) {
        return ctx.reply(t().adminPanel.addSellerInvalidToken);
      }
      let botInfo: any;
      try {
        const testBot = new Bot(token);
        botInfo = await testBot.api.getMe();
      } catch {
        return ctx.reply(t().adminPanel.addSellerFailed);
      }

      const telegramId = ctx.from.id.toString();
      const db = await connectToDB();

      if (await db.collection<Seller>("sellers").findOne({ botUsername: botInfo.username })) {
        return ctx.reply(template(t().adminPanel.addSellerDuplicate, { username: botInfo.username }));
      }

      // Trial abuse fix: check if this person already has ANY active/trial store.
      // Only the very first registration ever gets the 14-day trial.
      const existingSeller = await db.collection<Seller>("sellers").findOne({
        telegramId,
      });

      const now = new Date();
      const isFirstStore = !existingSeller;

      if (!isFirstStore && existingSeller!.nowpaymentsApiKey) {
        (ctx.session as any).pendingNewSellerToken = token;
        (ctx.session as any).pendingNewSellerBotUsername = botInfo.username;
        (ctx.session as any).awaitingNewSeller = true;
        const keyboard = new InlineKeyboard()
          .text(t().adminPanel.setPaymentReuseBtn, "mgr:reuse_key")
          .row()
          .text(t().adminPanel.setPaymentNewKeyBtn, "mgr:new_key")
          .row();
        await ctx.reply(
          template(t().adminPanel.setPaymentReuseTitle, {
            username: existingSeller!.botUsername || existingSeller!.telegramId,
          }) + "\n\n" +
          template(t().adminPanel.setPaymentReuseQuestion, {
            newUsername: botInfo.username,
          }), { reply_markup: keyboard }
        );
        return;
      }

      let newSeller: Seller;
      if (isFirstStore) {
        // First store ever — grant 14-day trial
        const trialExpires = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
        newSeller = {
          _id: new ObjectId(),
          telegramId,
          botToken: token,
          botUsername: botInfo.username,
          status: "trial",
          trialStartedAt: now,
          trialExpiresAt: trialExpires,
          maxProducts: 999,
          createdAt: now,
        };
      } else {
        // Already has a store — new store starts as active, requires immediate payment
        newSeller = {
          _id: new ObjectId(),
          telegramId,
          botToken: token,
          botUsername: botInfo.username,
          status: "active",
          maxProducts: 999,
          createdAt: now,
        };
      }

      await db.collection<Seller>("sellers").insertOne(newSeller);
      await BotManager.bootSeller(newSeller);
      log.info({ sellerId: newSeller._id?.toString(), username: botInfo.username, telegramId: ctx.from?.id }, "New seller registered");
      (ctx.session as any).awaitingBotToken = false;

      if (isFirstStore) {
        await ctx.reply(
          template(t().adminPanel.addSellerSuccess, {
            username: botInfo.username,
            url: `https://t.me/${botInfo.username}`,
          })
        );
      } else {
        await ctx.reply(
          template(t().adminPanel.addSellerSuccessActive, {
            username: botInfo.username,
            url: `https://t.me/${botInfo.username}`,
          })
        );
      }
      const kb = isAdmin(ctx.from.id) ? adminMenuKeyboard() : sellerMenuKeyboard();
      await ctx.reply(t().adminPanel.sellerGuide, { reply_markup: kb });
      return;
    }

    // NOWPayments API key input
    if ((ctx.session as any).awaitingNowpaymentsKey) {
      const key = text.trim();
      (ctx.session as any).awaitingNowpaymentsKey = false;

      const pendingToken = (ctx.session as any).pendingNewSellerToken;
      const pendingUsername = (ctx.session as any).pendingNewSellerBotUsername;
      const isNewSellerFlow = !!(ctx.session as any).awaitingNewSeller;

      if (isNewSellerFlow && pendingToken && pendingUsername) {
        // Multi-store flow: validate key, then create seller
        const valid = await validateNOWPaymentsKey(key);
        if (!valid) {
          (ctx.session as any).pendingNewSellerToken = pendingToken;
          (ctx.session as any).pendingNewSellerBotUsername = pendingUsername;
          (ctx.session as any).awaitingNowpaymentsKey = true;
          return ctx.reply(t().adminPanel.setPaymentInvalid);
        }
        const encrypted = encryptApiKey(key);
        const telegramId = ctx.from.id.toString();
        const db = await connectToDB();
        const newSeller: Seller = {
          _id: new ObjectId(),
          telegramId,
          botToken: pendingToken,
          botUsername: pendingUsername,
          status: "active",
          maxProducts: 999,
          nowpaymentsApiKey: encrypted,
          createdAt: new Date(),
        };
        await db.collection<Seller>("sellers").insertOne(newSeller);
        await BotManager.bootSeller(newSeller);
        log.info({ sellerId: newSeller._id?.toString(), username: pendingUsername, telegramId: ctx.from?.id }, "New seller registered");
        (ctx.session as any).pendingNewSellerToken = undefined;
        (ctx.session as any).pendingNewSellerBotUsername = undefined;
        (ctx.session as any).awaitingNewSeller = false;
        await ctx.reply(
          template(t().adminPanel.addSellerSuccessActive, {
            username: pendingUsername,
            url: `https://t.me/${pendingUsername}`,
          }) + "\n\n" + t().adminPanel.setPaymentSuccess, { reply_markup: backToSellerMenuKeyboard() }
        );
        return;
      }

      // Standalone /setpayment flow (clear any stale multi-store pending state)
      (ctx.session as any).pendingNewSellerToken = undefined;
      (ctx.session as any).pendingNewSellerBotUsername = undefined;
      (ctx.session as any).awaitingNewSeller = false;
      const valid = await validateNOWPaymentsKey(key);
      if (!valid) {
        (ctx.session as any).awaitingNowpaymentsKey = true;
        return ctx.reply(t().adminPanel.setPaymentInvalid);
      }
      const encrypted = encryptApiKey(key);
      const db = await connectToDB();
      await db.collection<Seller>("sellers").updateOne(
        { telegramId: ctx.from.id.toString() },
        { $set: { nowpaymentsApiKey: encrypted } }
      );
      log.info({ sellerId: ctx.from.id.toString() }, "Seller updated payment API key");
      await ctx.reply(t().adminPanel.setPaymentSuccess, { reply_markup: backToSellerMenuKeyboard() });
      return;
    }

    // Payment plan selection
    if ((ctx.session as any).awaitingPaymentPlan) {
      const prices: Record<string, { days: number; amount: number }> = {
        [t().adminPanel.payment30]: { days: 30, amount: 3 },
        [t().adminPanel.payment90]: { days: 90, amount: 8 },
        [t().adminPanel.payment365]: { days: 365, amount: 30 },
      };
      const selected = prices[text];
      if (!selected) {
        if (text === t().adminPanel.cancelBtn) {
          (ctx.session as any).awaitingPaymentPlan = false;
          (ctx.session as any).sellerId = undefined;
          return ctx.reply(t().adminPanel.paymentCancelled);
        }
        return ctx.reply(t().adminPanel.paymentInvalidPlan);
      }
      (ctx.session as any).awaitingPaymentPlan = false;

      const db = await connectToDB();
      // Use sellerId from session (set by /pay or handlePaySeller callback)
      const sessionSellerId = (ctx.session as any).sellerId;
      let seller: Seller | null = null;
      if (sessionSellerId && ObjectId.isValid(sessionSellerId)) {
        seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sessionSellerId) });
      }
      if (!seller) {
        // Fallback: look up by telegramId (single-store case)
        seller = await db.collection<Seller>("sellers").findOne({ telegramId: ctx.from.id.toString() });
      }
      if (!seller) return ctx.reply(t().adminPanel.renewNotFound);
      log.info({ sellerId: seller._id?.toString(), plan: text }, "Seller selected payment plan");
      (ctx.session as any).sellerId = undefined;

      const result = await createSubscriptionInvoice(seller._id!, seller.botUsername || ctx.from.id.toString(), selected.days, selected.amount, seller.nowpaymentsApiKey);
      if (!result) return ctx.reply(t().adminPanel.paymentInvoiceFailed);

      await ctx.reply(
        `${template(t().adminPanel.paymentInvoiceTitle, { days: selected.days, amount: selected.amount })}\n\n${result.paymentUrl}`
      );
    }

    // Admin: awaiting recharge amount input
    if (isAdmin(ctx.from.id) && (ctx.session as any).awaitingRechargeAmount) {
      const amount = parseFloat(text.trim());
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply(t().adminPanel.rechargeInvalidAmount);
      }
      (ctx.session as any).awaitingRechargeAmount = false;
      const userId = (ctx.session as any).pendingRechargeUserId;
      (ctx.session as any).pendingRechargeUserId = undefined;
      if (!userId || !ObjectId.isValid(userId)) {
        return ctx.reply(t().adminPanel.rechargeInvalidUser);
      }
      const db = await connectToDB();
      const user = await db.collection<User>("users").findOne({ _id: new ObjectId(userId) });
      if (!user) return ctx.reply(t().adminPanel.rechargeNotFound);

      const confirmKeyboard = new InlineKeyboard()
        .text(t().adminPanel.confirmBtn, `mgr:confirm_recharge:${userId}:${amount}`)
        .text(t().adminPanel.cancelConfirmBtn, "mgr:cancel_action");

      await ctx.reply(
        template(t().adminPanel.rechargeConfirm, { amount: amount.toString(), name: user.fullName || user.username || user.telegramId }),
        { reply_markup: confirmKeyboard }
      );
      return;
    }

    // Admin: awaiting renew days input
    if (isAdmin(ctx.from.id) && (ctx.session as any).awaitingRenewDays) {
      const days = parseInt(text.trim(), 10);
      if (isNaN(days) || days <= 0) {
        return ctx.reply(t().adminPanel.renewDaysPrompt);
      }
      (ctx.session as any).awaitingRenewDays = false;
      const sellerId = (ctx.session as any).pendingRenewSellerId;
      (ctx.session as any).pendingRenewSellerId = undefined;
      if (!sellerId || !ObjectId.isValid(sellerId)) {
        return ctx.reply(t().adminPanel.renewNotFound);
      }
      const db = await connectToDB();
      const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerId) });
      if (!seller) return ctx.reply(t().adminPanel.renewNotFound);

      await reactivateSeller(new ObjectId(sellerId), days);
      log.info({ adminId: ctx.from?.id, sellerId, days }, "Admin extended seller subscription");
      await ctx.reply(template(t().adminPanel.renewSuccess, { username: seller.botUsername || sellerId, days: days.toString() }), { reply_markup: backToAdminMenuKeyboard() });
      return;
    }

    // Seller product/category management text handlers
    const sellerRes = await getActiveSeller(ctx);
    if (sellerRes.kind !== "seller") return;
    const seller = sellerRes.seller;
    const sdb = await connectToDB();

    // Add product: step 1 - name
    if ((ctx.session as any).awaitingProductName && !(ctx.session as any).editingProductId) {
      (ctx.session as any).awaitingProductName = false;
      (ctx.session as any).awaitingProductPrice = true;
      (ctx.session as any).tempProductName = text.trim();
      const step2Kb = new InlineKeyboard().text(t().adminPanel.cancelBtn, "mgr:menu:home");
      await ctx.reply(t().adminPanel.addProductStep2, { reply_markup: step2Kb });
      return;
    }

    // Add product: step 2 - price
    if ((ctx.session as any).awaitingProductPrice && !(ctx.session as any).editingProductId) {
      const price = parseFloat(text.trim());
      if (isNaN(price) || price <= 0) return ctx.reply(t().adminPanel.priceInvalid);
      (ctx.session as any).awaitingProductPrice = false;
      (ctx.session as any).awaitingProductStock = true;
      (ctx.session as any).tempProductPrice = price;
      const step3Kb = new InlineKeyboard().text(t().adminPanel.cancelBtn, "mgr:menu:home");
      await ctx.reply(t().adminPanel.addProductStep3, { reply_markup: step3Kb });
      return;
    }

    // Add product: step 3 - stock → show category InlineKeyboard
    if ((ctx.session as any).awaitingProductStock && !(ctx.session as any).editingProductId) {
      const emails = text.trim().split(/[,\n]/).map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      (ctx.session as any).awaitingProductStock = false;
      (ctx.session as any).awaitingProductCategory = true;
      (ctx.session as any).tempProductEmails = emails;
      const categories = await sdb.collection<Category>("categories").find({ sellerId: seller._id }).toArray();
      const catKb = new InlineKeyboard();
      if (categories.length > 0) {
        for (const cat of categories) {
          catKb.text(cat.name, `mgr:addprod_cat:${cat._id}`).row();
        }
      }
      catKb.text(t().adminPanel.addProductStep4NoCat, "mgr:addprod_cat:none").row();
      catKb.text(t().adminPanel.cancelBtn, "mgr:menu:home").row();
      await ctx.reply(t().adminPanel.addProductStep4, { reply_markup: catKb });
      return;
    }

    // Add product: step 4 - category (text fallback for typing category name)
    if ((ctx.session as any).awaitingProductCategory && !(ctx.session as any).editingProductId) {
      let categoryId: ObjectId | undefined;
      if (text.trim().toLowerCase() !== "none") {
        const cat = await sdb.collection<Category>("categories").findOne({ name: text.trim(), sellerId: seller._id });
        if (!cat) {
          const newCat: Category = { _id: new ObjectId(), name: text.trim(), sellerId: seller._id, createdDate: new Date(), isActive: true };
          const catResult = await sdb.collection<Category>("categories").insertOne(newCat);
          categoryId = catResult.insertedId;
        } else {
          categoryId = cat._id;
        }
      }
      (ctx.session as any).awaitingProductCategory = false;
      (ctx.session as any).awaitingProductPreorder = true;
      (ctx.session as any).tempProductCategoryId = categoryId;
      const preorderKb = new InlineKeyboard()
        .text(t().adminPanel.preorderYes, "mgr:preorder_yes")
        .text(t().adminPanel.preorderNo, "mgr:preorder_no");
      await ctx.reply(t().adminPanel.addProductStep5, { reply_markup: preorderKb });
      return;
    }

    // Add product: step 5 - pre-order
    if ((ctx.session as any).awaitingProductPreorder && !(ctx.session as any).editingProductId) {
      const allowPreOrder = text.trim().toLowerCase().startsWith("y");
      const name = (ctx.session as any).tempProductName;
      const price = (ctx.session as any).tempProductPrice;
      const emails = (ctx.session as any).tempProductEmails || [];
      const categoryId = (ctx.session as any).tempProductCategoryId;

      const newProduct: Product = {
        _id: new ObjectId(),
        sellerId: seller._id,
        name,
        description: "",
        price,
        emails,
        categoryId: categoryId || new ObjectId(),
        isAvailable: emails.length > 0,
        allowPreOrder,
        createdDate: new Date(),
        archive: [],
      };

      await sdb.collection<Product>("products").insertOne(newProduct);
      log.info({ sellerId: seller._id?.toString(), productName: name, price }, "Product created");
      (ctx.session as any).awaitingProductPreorder = false;
      (ctx.session as any).tempProductName = undefined;
      (ctx.session as any).tempProductPrice = undefined;
      (ctx.session as any).tempProductEmails = undefined;
      (ctx.session as any).tempProductCategoryId = undefined;
      await ctx.reply(template(t().adminPanel.addProductSuccess, { name }), { reply_markup: backToSellerMenuKeyboard() });
      return;
    }

    // Edit product: step 1 - new name
    if ((ctx.session as any).awaitingProductName && (ctx.session as any).editingProductId) {
      const productId = (ctx.session as any).editingProductId;
      await sdb.collection<Product>("products").updateOne(
        { _id: new ObjectId(productId), sellerId: seller._id },
        { $set: { name: text.trim() } }
      );
      log.info({ sellerId: seller._id?.toString(), productId }, "Product updated");
      (ctx.session as any).awaitingProductName = false;
      (ctx.session as any).editingProductId = undefined;
      await ctx.reply(t().adminPanel.editProductSuccess, { reply_markup: backToSellerMenuKeyboard() });
      return;
    }

    // Edit product: step 2 - new price
    if ((ctx.session as any).awaitingProductPrice && (ctx.session as any).editingProductId) {
      const price = parseFloat(text.trim());
      if (isNaN(price) || price <= 0) return ctx.reply(t().adminPanel.priceInvalid);
      const productId = (ctx.session as any).editingProductId;
      await sdb.collection<Product>("products").updateOne(
        { _id: new ObjectId(productId), sellerId: seller._id },
        { $set: { price } }
      );
      log.info({ sellerId: seller._id?.toString(), productId }, "Product updated");
      (ctx.session as any).awaitingProductPrice = false;
      (ctx.session as any).editingProductId = undefined;
      await ctx.reply(t().adminPanel.editProductSuccess, { reply_markup: backToSellerMenuKeyboard() });
      return;
    }

    // Add category
    if ((ctx.session as any).awaitingCategoryName && !(ctx.session as any).editingCategoryId) {
      const name = text.trim();
      const exists = await sdb.collection<Category>("categories").findOne({ name, sellerId: seller._id });
      if (exists) {
        return ctx.reply(t().adminPanel.addCategoryExists);
      }
      const newCat: Category = { _id: new ObjectId(), name, sellerId: seller._id, createdDate: new Date(), isActive: true };
      await sdb.collection<Category>("categories").insertOne(newCat);
      log.info({ sellerId: seller._id?.toString(), categoryName: name }, "Category created");
      (ctx.session as any).awaitingCategoryName = false;
      await ctx.reply(template(t().adminPanel.addCategorySuccess, { name }), { reply_markup: backToSellerMenuKeyboard() });
      return;
    }

    // Edit category
    if ((ctx.session as any).awaitingCategoryName && (ctx.session as any).editingCategoryId) {
      const catId = (ctx.session as any).editingCategoryId;
      await sdb.collection<Category>("categories").updateOne(
        { _id: new ObjectId(catId), sellerId: seller._id },
        { $set: { name: text.trim() } }
      );
      (ctx.session as any).awaitingCategoryName = false;
      (ctx.session as any).editingCategoryId = undefined;
      await ctx.reply(t().adminPanel.editCategorySuccess, { reply_markup: backToSellerMenuKeyboard() });
      return;
    }
  });
}

// ═════════════════════════════════════════════════════════
//  ADMIN DRILL-DOWN NAVIGATION & CRUD (Pure Inline Workflows)
// ═════════════════════════════════════════════════════════

async function sendOrEdit(
  ctx: MyContext,
  text: string,
  replyMarkup?: InlineKeyboard
): Promise<void> {
  if (ctx.callbackQuery && ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(text, { reply_markup: replyMarkup });
      return;
    } catch (e: any) {
      if (e?.description?.includes("message is not modified")) {
        return;
      }
    }
  }
  await ctx.reply(text, { reply_markup: replyMarkup });
}

async function showSellerList(ctx: MyContext, page = 0): Promise<void> {
  const db = await connectToDB();
  const total = await db.collection<Seller>("sellers").countDocuments();

  if (total === 0) {
    const emptyKb = new InlineKeyboard()
      .text(t().adminPanel.addSellerBtn, "mgr:menu:add_seller")
      .row()
      .text(t().adminPanel.backBtn, "mgr:menu:home");
    await sendOrEdit(ctx, t().adminPanel.sellersEmpty, emptyKb);
    return;
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const sellers = await db.collection<Seller>("sellers")
    .find()
    .sort({ createdAt: -1 })
    .skip(safePage * ITEMS_PER_PAGE)
    .limit(ITEMS_PER_PAGE)
    .toArray();

  const keyboard = new InlineKeyboard();
  for (const seller of sellers) {
    keyboard.text(sellerButtonLabel(seller), `mgr:seller:${seller._id}`).row();
  }

  const nav: any[] = [];
  if (safePage > 0) nav.push(InlineKeyboard.text(t().adminPanel.prevBtn, `mgr:sellers:${safePage - 1}`));
  if (safePage < totalPages - 1) nav.push(InlineKeyboard.text(t().adminPanel.nextBtn, `mgr:sellers:${safePage + 1}`));
  if (nav.length > 0) keyboard.row(...nav);

  keyboard.row(
    InlineKeyboard.text(t().adminPanel.addSellerBtn, "mgr:menu:add_seller"),
    InlineKeyboard.text(t().adminPanel.backBtn, "mgr:menu:home")
  );

  const text = `${template(t().adminPanel.sellersTitle, { count: total })}\n` +
    template(t().adminPanel.pageLabel, { current: safePage + 1, total: totalPages }) + `\n${t().adminPanel.sellersTapHint}`;

  await sendOrEdit(ctx, text, keyboard);
}

async function showSellerDetail(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) {
    await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard());
    return;
  }

  const userCount = await db.collection("users").countDocuments({ sellerId: new ObjectId(sellerIdStr) });
  const productCount = await db.collection("products").countDocuments({ sellerId: new ObjectId(sellerIdStr) });

  let expiry = "N/A";
  if (seller.status === "trial" && seller.trialExpiresAt) {
    const d = Math.ceil((seller.trialExpiresAt.getTime() - Date.now()) / 86400000);
    expiry = `${seller.trialExpiresAt.toLocaleDateString()} (${d}d left)`;
  } else if (seller.status === "active" && seller.planExpiresAt) {
    expiry = seller.planExpiresAt.toLocaleDateString();
  } else if (seller.status === "expired") {
    expiry = t().adminPanel.statusExpired;
  } else if (seller.status === "token_invalid") {
    expiry = t().adminPanel.statusTokenRevoked;
  }

  const keyboard = new InlineKeyboard()
    .text(template(t().adminPanel.usersBtn, { count: userCount }), `mgr:users:${sellerIdStr}:0`)
    .text(template(t().adminPanel.productsBtn, { count: productCount }), `mgr:products:${sellerIdStr}:0`)
    .row()
    .text(t().adminPanel.renewBtn, `mgr:renew:${sellerIdStr}`)
    .row();

  if (seller.status === "expired" || seller.status === "token_invalid") {
    keyboard.text(t().adminPanel.unbanBtn, `mgr:unban:${sellerIdStr}`).row();
  } else {
    keyboard.text(t().adminPanel.banBtn, `mgr:ban:${sellerIdStr}`).row();
  }

  keyboard
    .text(t().adminPanel.deleteBtn, `mgr:delete_seller:${sellerIdStr}`)
    .row()
    .text(t().adminPanel.backBtn, "mgr:sellers");

  const text =
    `${template(t().adminPanel.sellerTitle, { username: seller.botUsername || "N/A" })}\n\n` +
    template(t().adminPanel.sellerStatus, { status: statusEmoji(seller.status), statusText: seller.status }) + "\n" +
    template(t().adminPanel.sellerExpires, { date: expiry }) + "\n" +
    template(t().adminPanel.sellerUsersProducts, { users: userCount, products: productCount }) + "\n" +
    template(t().adminPanel.sellerLink, { url: `https://t.me/${seller.botUsername || "bot"}` });

  await sendOrEdit(ctx, text, keyboard);
}

async function showUserList(ctx: MyContext, sellerIdStr: string, page: number): Promise<void> {
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();

  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  const total = await db.collection("users").countDocuments({ sellerId: new ObjectId(sellerIdStr) });
  const users = await db.collection<User>("users")
    .find({ sellerId: new ObjectId(sellerIdStr) })
    .sort({ registerDate: -1 })
    .skip(page * ITEMS_PER_PAGE)
    .limit(ITEMS_PER_PAGE)
    .toArray();

  if (total === 0) {
    await sendOrEdit(ctx, t().adminPanel.usersEmpty, new InlineKeyboard().text(t().adminPanel.backBtn, `mgr:back:seller:${sellerIdStr}`));
    return;
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));

  const keyboard = new InlineKeyboard();
  for (const user of users) {
    const label = `${user.fullName || user.username || user.telegramId} — ${user.balance || 0} pts`;
    keyboard.text(label, `mgr:user:${user._id}`).row();
  }

  const nav: any[] = [];
  if (safePage > 0) nav.push(InlineKeyboard.text(t().adminPanel.prevBtn, `mgr:users:${sellerIdStr}:${safePage - 1}`));
  if (safePage < totalPages - 1) nav.push(InlineKeyboard.text(t().adminPanel.nextBtn, `mgr:users:${sellerIdStr}:${safePage + 1}`));
  if (nav.length > 0) keyboard.row(...nav);

  keyboard.row(InlineKeyboard.text(t().adminPanel.backBtn, `mgr:back:seller:${sellerIdStr}`));

  const text =
    `${template(t().adminPanel.usersTitle, { seller: seller?.botUsername || "Seller", count: total })}\n` +
    template(t().adminPanel.pageLabel, { current: safePage + 1, total: totalPages });

  await sendOrEdit(ctx, text, keyboard);
}

async function showUserDetail(ctx: MyContext, userIdStr: string): Promise<void> {
  if (!ObjectId.isValid(userIdStr)) return;
  const db = await connectToDB();
  const user = await db.collection<User>("users").findOne({ _id: new ObjectId(userIdStr) });
  if (!user) {
    await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard());
    return;
  }

  const seller = await db.collection<Seller>("sellers").findOne({ _id: user.sellerId as ObjectId });
  const purchases = await db.collection("history")
    .find({ userId: user._id, actionType: "purchase" })
    .sort({ date: -1 })
    .limit(10)
    .toArray();

  let purchaseText = t().adminPanel.userPurchasesEmpty;
  if (purchases.length > 0) {
    purchaseText = purchases.map((p: any) =>
      template(t().adminPanel.userPurchaseItem, {
        product: p.productName,
        price: p.price,
        date: new Date(p.date).toLocaleDateString(),
      })
    ).join("\n");
  }

  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.rechargeBtn, `mgr:recharge:${userIdStr}`)
    .row()
    .text(t().adminPanel.backBtn, `mgr:back:users:${(user.sellerId as ObjectId).toString()}`);

  const text =
    `${template(t().adminPanel.userTitle, { name: user.fullName || user.username || "User" })}\n\n` +
    template(t().adminPanel.userPhone, { phone: user.phoneNumber || "N/A" }) + "\n" +
    template(t().adminPanel.userTelegram, { id: user.telegramId }) + "\n" +
    template(t().adminPanel.userBalance, { balance: user.balance || 0 }) + "\n" +
    template(t().adminPanel.userSeller, { seller: seller?.botUsername || "N/A" }) + "\n" +
    template(t().adminPanel.userJoined, { date: user.registerDate?.toLocaleDateString() || "N/A" }) + "\n\n" +
    `${t().adminPanel.userPurchasesTitle}\n${purchaseText}`;

  await sendOrEdit(ctx, text, keyboard);
}

async function showProductList(ctx: MyContext, sellerIdStr: string, page: number): Promise<void> {
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();

  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  const total = await db.collection<Product>("products").countDocuments({ sellerId: new ObjectId(sellerIdStr) });
  const products = await db.collection<Product>("products")
    .find({ sellerId: new ObjectId(sellerIdStr) })
    .skip(page * ITEMS_PER_PAGE)
    .limit(ITEMS_PER_PAGE)
    .toArray();

  if (total === 0) {
    await sendOrEdit(ctx, t().adminPanel.productsEmpty, new InlineKeyboard().text(t().adminPanel.backBtn, `mgr:back:seller:${sellerIdStr}`));
    return;
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));

  const keyboard = new InlineKeyboard();
  for (const product of products) {
    const stock = product.emails?.length || 0;
    const label = `${product.name} ($${product.price}) — stock: ${stock}`;
    keyboard.text(label, `mgr:product:${product._id}`).row();
  }

  const nav: any[] = [];
  if (safePage > 0) nav.push(InlineKeyboard.text(t().adminPanel.prevBtn, `mgr:products:${sellerIdStr}:${safePage - 1}`));
  if (safePage < totalPages - 1) nav.push(InlineKeyboard.text(t().adminPanel.nextBtn, `mgr:products:${sellerIdStr}:${safePage + 1}`));
  if (nav.length > 0) keyboard.row(...nav);

  keyboard.row(InlineKeyboard.text(t().adminPanel.backBtn, `mgr:back:seller:${sellerIdStr}`));

  const text =
    `${template(t().adminPanel.productsTitle, { seller: seller?.botUsername || "Seller", count: total })}\n` +
    template(t().adminPanel.pageLabel, { current: safePage + 1, total: totalPages });

  await sendOrEdit(ctx, text, keyboard);
}

async function showProductDetail(ctx: MyContext, productIdStr: string): Promise<void> {
  if (!ObjectId.isValid(productIdStr)) return;
  const db = await connectToDB();
  const product = await db.collection<Product>("products").findOne({ _id: new ObjectId(productIdStr) });
  if (!product) {
    await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard());
    return;
  }

  let category: any = null;
  if (product.categoryId) {
    try {
      category = await db.collection("categories").findOne({
        _id: new ObjectId(String(product.categoryId)),
      });
    } catch { /* ignore invalid categoryId */ }
  }
  const seller = await db.collection<Seller>("sellers").findOne({ _id: product.sellerId as ObjectId });

  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.deleteBtn, `mgr:admin_del_prod:${productIdStr}`)
    .row()
    .text(t().adminPanel.backBtn, `mgr:back:products:${(product.sellerId as ObjectId).toString()}`);

  const text =
    `${template(t().adminPanel.productTitle, { name: product.name })}\n\n` +
    template(t().adminPanel.productPrice, { price: product.price }) + "\n" +
    template(t().adminPanel.productStock, { count: product.emails?.length || 0 }) + "\n" +
    template(t().adminPanel.productCategory, { name: category?.name || "N/A" }) + "\n" +
    template(t().adminPanel.productPreorder, { yes: product.allowPreOrder ? t().adminPanel.yes : t().adminPanel.no }) + "\n" +
    template(t().adminPanel.productAvailable, { yes: product.isAvailable ? t().adminPanel.yes : t().adminPanel.no }) + "\n" +
    template(t().adminPanel.productSeller, { seller: seller?.botUsername || "N/A" });

  await sendOrEdit(ctx, text, keyboard);
}

async function handleAdminDeleteProduct(ctx: MyContext, productIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(productIdStr)) return;
  const db = await connectToDB();
  const product = await db.collection<Product>("products").findOne({ _id: new ObjectId(productIdStr) });
  if (!product) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.confirmBtn, `mgr:confirm_del_prod:${productIdStr}`)
    .text(t().adminPanel.cancelConfirmBtn, `mgr:product:${productIdStr}`);

  await sendOrEdit(ctx, `${t().adminPanel.deleteBtn} "${product.name}"?`, keyboard);
}

async function handleConfirmDeleteProduct(ctx: MyContext, productIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(productIdStr)) return;
  const db = await connectToDB();
  const product = await db.collection<Product>("products").findOne({ _id: new ObjectId(productIdStr) });
  if (!product) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  const sellerId = product.sellerId ? product.sellerId.toString() : "";
  await db.collection<Product>("products").deleteOne({ _id: new ObjectId(productIdStr) });
  log.info({ adminId: ctx.from.id, productId: productIdStr, sellerId }, "Admin deleted product");
  await showProductList(ctx, sellerId, 0);
}

// ═════════════════════════════════════════════════════════
//  PAY SELLER (from multi-store /pay selection)
// ═════════════════════════════════════════════════════════
async function handlePaySeller(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  if (seller.status === "active" && seller.planExpiresAt && seller.planExpiresAt.getTime() > Date.now()) {
    await sendOrEdit(ctx, template(t().adminPanel.paymentPlanActive, { date: seller.planExpiresAt.toLocaleDateString() }), backToAdminMenuKeyboard());
    return;
  }

  (ctx.session as any).sellerId = sellerIdStr;
  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.payment30, "mgr:pay_plan:30:3")
    .row()
    .text(t().adminPanel.payment90, "mgr:pay_plan:90:8")
    .row()
    .text(t().adminPanel.payment365, "mgr:pay_plan:365:30")
    .row()
    .text(t().adminPanel.cancelBtn, "mgr:cancel_action");

  const notice = "[DEV / DEMO MODE]\nOnline crypto payment is currently inactive during this demo.\nSelect a plan below to activate/extend your store for free:";
  await sendOrEdit(ctx, `${t().adminPanel.paymentTitle}\n\n${notice}`, keyboard);
}

// ═════════════════════════════════════════════════════════
//  ADMIN SELLER MANAGEMENT ACTIONS
// ═════════════════════════════════════════════════════════
async function handleAdminRenew(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(sellerIdStr)) return;
  const kb = new InlineKeyboard()
    .text(t().adminPanel.renew7, `mgr:renew:${sellerIdStr}:7`)
    .text(t().adminPanel.renew14, `mgr:renew:${sellerIdStr}:14`).row()
    .text(t().adminPanel.renew30, `mgr:renew:${sellerIdStr}:30`)
    .text(t().adminPanel.renew60, `mgr:renew:${sellerIdStr}:60`).row()
    .text(t().adminPanel.renew90, `mgr:renew:${sellerIdStr}:90`)
    .text(t().adminPanel.renew180, `mgr:renew:${sellerIdStr}:180`).row()
    .text(t().adminPanel.renew365, `mgr:renew:${sellerIdStr}:365`).row()
    .text(t().adminPanel.cancelBtn, `mgr:seller:${sellerIdStr}`);
  await sendOrEdit(ctx, t().adminPanel.renewDaysPrompt, kb);
}

async function handleRenewWithDays(ctx: MyContext, sellerIdStr: string, days: number): Promise<void> {
  await ctx.answerCallbackQuery();
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(sellerIdStr) || isNaN(days) || days <= 0) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }
  await reactivateSeller(new ObjectId(sellerIdStr), days);
  log.info({ adminId: ctx.from?.id, sellerId: sellerIdStr, days }, "Admin extended seller subscription");
  await showSellerDetail(ctx, sellerIdStr);
}

async function handleAdminBan(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.confirmBtn, `mgr:confirm_ban:${sellerIdStr}`)
    .text(t().adminPanel.cancelConfirmBtn, `mgr:seller:${sellerIdStr}`);
  await sendOrEdit(
    ctx,
    `${t().adminPanel.banBtn} @${seller.botUsername || sellerIdStr}?`,
    keyboard
  );
}

async function handleAdminUnban(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.confirmBtn, `mgr:confirm_unban:${sellerIdStr}`)
    .text(t().adminPanel.cancelConfirmBtn, `mgr:seller:${sellerIdStr}`);
  await sendOrEdit(
    ctx,
    `${t().adminPanel.unbanBtn} @${seller.botUsername || sellerIdStr}?`,
    keyboard
  );
}

async function handleAdminDeleteSeller(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.confirmBtn, `mgr:confirm_delete_seller:${sellerIdStr}`)
    .text(t().adminPanel.cancelConfirmBtn, `mgr:seller:${sellerIdStr}`);
  await sendOrEdit(
    ctx,
    `${t().adminPanel.deleteBtn} @${seller.botUsername || sellerIdStr}?`,
    keyboard
  );
}

async function handleAdminRecharge(ctx: MyContext, userIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(userIdStr)) return;
  const db = await connectToDB();
  const user = await db.collection<User>("users").findOne({ _id: new ObjectId(userIdStr) });
  if (!user) { await ctx.reply(t().adminPanel.rechargeNotFound); return; }

  const kb = new InlineKeyboard()
    .text(t().adminPanel.rechargeAmount10, `mgr:confirm_recharge:${userIdStr}:10`)
    .text(t().adminPanel.rechargeAmount25, `mgr:confirm_recharge:${userIdStr}:25`).row()
    .text(t().adminPanel.rechargeAmount50, `mgr:confirm_recharge:${userIdStr}:50`)
    .text(t().adminPanel.rechargeAmount100, `mgr:confirm_recharge:${userIdStr}:100`).row()
    .text(t().adminPanel.rechargeAmount250, `mgr:confirm_recharge:${userIdStr}:250`)
    .text(t().adminPanel.rechargeAmount500, `mgr:confirm_recharge:${userIdStr}:500`).row()
    .text(t().adminPanel.rechargeAmount1000, `mgr:confirm_recharge:${userIdStr}:1000`).row()
    .text(t().adminPanel.cancelBtn, `mgr:user:${userIdStr}`);
  await sendOrEdit(ctx, t().adminPanel.rechargePrompt, kb);
}

async function handleConfirmBan(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  await BotManager.stopSeller(sellerIdStr);
  await db.collection<Seller>("sellers").updateOne(
    { _id: new ObjectId(sellerIdStr) },
    { $set: { status: "expired" } }
  );
  log.info({ adminId: ctx.from?.id, sellerId: sellerIdStr }, "Admin banned seller");
  await showSellerDetail(ctx, sellerIdStr);
}

async function handleConfirmUnban(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  let valid = false;
  try {
    if (process.env.NODE_ENV === "test") {
      valid = true;
    } else {
      const testBot = new Bot(seller.botToken);
      await testBot.api.getMe();
      valid = true;
    }
  } catch {
    valid = false;
  }

  if (!valid) {
    await db.collection<Seller>("sellers").updateOne(
      { _id: new ObjectId(sellerIdStr) },
      { $set: { status: "token_invalid" } }
    );
    await sendOrEdit(ctx, t().adminPanel.addSellerFailed, backToAdminMenuKeyboard());
    return;
  }

  await db.collection<Seller>("sellers").updateOne(
      { _id: new ObjectId(sellerIdStr) },
      { $set: { status: "active", maxProducts: 9999 } }
  );
  const freshSeller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (freshSeller) await BotManager.bootSeller(freshSeller);

  log.info({ adminId: ctx.from?.id, sellerId: sellerIdStr }, "Admin unbanned seller");
  await showSellerDetail(ctx, sellerIdStr);
}

async function handleConfirmDeleteSeller(ctx: MyContext, sellerIdStr: string): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(sellerIdStr)) return;
  const db = await connectToDB();
  const seller = await db.collection<Seller>("sellers").findOne({ _id: new ObjectId(sellerIdStr) });
  if (!seller) { await sendOrEdit(ctx, t().adminPanel.renewNotFound, backToAdminMenuKeyboard()); return; }

  const sellerObjId = new ObjectId(sellerIdStr);
  await BotManager.stopSeller(sellerIdStr);

  await db.collection("users").deleteMany({ sellerId: sellerObjId });
  await db.collection("products").deleteMany({ sellerId: sellerObjId });
  await db.collection("categories").deleteMany({ sellerId: sellerObjId });
  await db.collection<Seller>("sellers").deleteOne({ _id: sellerObjId });

  log.info({ adminId: ctx.from?.id, sellerId: sellerIdStr }, "Admin deleted seller");
  await showSellerList(ctx, 0);
}

export async function handleConfirmRecharge(ctx: MyContext, userIdStr: string, amount: number): Promise<void> {
  if (!ctx.from || !isAdmin(ctx.from.id)) return;
  if (!ObjectId.isValid(userIdStr) || isNaN(amount) || amount <= 0) return;
  const db = await connectToDB();
  const user = await db.collection<User>("users").findOne({ _id: new ObjectId(userIdStr) });
  if (!user) { await ctx.reply(t().adminPanel.rechargeNotFound); return; }

  await db.collection<User>("users").updateOne(
    { _id: new ObjectId(userIdStr) },
    { $inc: { balance: amount } }
  );

  await db.collection("history").insertOne({
    _id: new ObjectId(),
    userId: user._id,
    sellerId: user.sellerId,
    actionType: "recharge",
    description: `Admin recharge: ${amount} pts`,
    amount,
    date: new Date(),
  });

  log.info({ adminId: ctx.from?.id, userId: userIdStr, amount, sellerId: user.sellerId?.toString() }, "Admin recharged user balance");
  await ctx.reply(template(t().adminPanel.rechargeSuccess, { amount: amount.toString(), userId: userIdStr }), { reply_markup: backToAdminMenuKeyboard() });
}

async function handleCancelAction(ctx: MyContext): Promise<void> {
  (ctx.session as any).awaitingRechargeAmount = false;
  (ctx.session as any).pendingRechargeUserId = undefined;
  (ctx.session as any).awaitingRenewDays = false;
  (ctx.session as any).pendingRenewSellerId = undefined;
  (ctx.session as any).awaitingPaymentPlan = false;
  (ctx.session as any).sellerId = undefined;
  (ctx.session as any).awaitingConfirmDelete = false;
  (ctx.session as any).deleteTarget = undefined;
  if (ctx.from && isAdmin(ctx.from.id)) {
    await showSellerList(ctx, 0);
  } else {
    await ctx.reply(t().adminPanel.cancelReply || "Cancelled.", { reply_markup: backToSellerMenuKeyboard() });
  }
}

// ═════════════════════════════════════════════════════════
//  SELLER KEYBOARD BUTTON HANDLERS & CRUD (Pure Inline)
// ═════════════════════════════════════════════════════════
async function handleSubscriptionButton(ctx: ManagerContext): Promise<any> {
  if (!ctx.from) return;
  const db = await connectToDB();
  const sellers = await db.collection<Seller>("sellers").find({ telegramId: ctx.from.id.toString() }).toArray();
  if (sellers.length === 0) return sendOrEdit(ctx, t().adminPanel.mystoreNotRegistered, backToSellerMenuKeyboard());

  if (sellers.length > 1) {
    const keyboard = new InlineKeyboard();
    for (const s of sellers) {
      keyboard.text(sellerButtonLabel(s), `mgr:pay:${s._id}`).row();
    }
    keyboard.row(InlineKeyboard.text(t().adminPanel.backBtn, "mgr:menu:home"));
    return sendOrEdit(ctx, t().adminPanel.whichStorePay, keyboard);
  }

  const seller = sellers[0];
  if (seller.status === "active" && seller.planExpiresAt && seller.planExpiresAt.getTime() > Date.now()) {
    await sendOrEdit(ctx, template(t().adminPanel.paymentPlanActive, { date: seller.planExpiresAt.toLocaleDateString() }), backToSellerMenuKeyboard());
    return;
  }

  (ctx.session as any).sellerId = seller._id!.toString();
  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.payment30, "mgr:pay_plan:30:3")
    .row()
    .text(t().adminPanel.payment90, "mgr:pay_plan:90:8")
    .row()
    .text(t().adminPanel.payment365, "mgr:pay_plan:365:30")
    .row()
    .text(t().adminPanel.backBtn, "mgr:menu:home");

  await sendOrEdit(ctx, t().adminPanel.paymentTitle, keyboard);
}

async function handleSetPaymentButton(ctx: ManagerContext): Promise<any> {
  if (!ctx.from) return;
  const sellerRes = await getActiveSeller(ctx);
  if (sellerRes.kind !== "seller") return;
  const seller = sellerRes.seller;
  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.setPaymentKeyBtn, "mgr:setpay_key")
    .row()
    .text(t().adminPanel.backBtn, "mgr:menu:home");
  await sendOrEdit(
    ctx,
    `${t().adminPanel.setPaymentTitle}\n\n${t().adminPanel.setPaymentExplainer}`,
    keyboard
  );
}

async function handleMyProductsButton(ctx: ManagerContext, page = 0): Promise<any> {
  if (!ctx.from) return;
  const sellerRes = await getActiveSeller(ctx);
  if (sellerRes.kind !== "seller") return;
  const seller = sellerRes.seller;
  const db = await connectToDB();
  const total = await db.collection<Product>("products").countDocuments({ sellerId: seller._id });
  if (total === 0) {
    const emptyKb = new InlineKeyboard()
      .text(t().sellerKeyboard.addProduct, "mgr:menu:addproduct")
      .row()
      .text(t().adminPanel.backBtn, "mgr:menu:home");
    await sendOrEdit(ctx, t().adminPanel.myProductsEmpty, emptyKb);
    return;
  }

  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const products = await db.collection<Product>("products")
    .find({ sellerId: seller._id })
    .skip(safePage * ITEMS_PER_PAGE)
    .limit(ITEMS_PER_PAGE)
    .toArray();

  const keyboard = new InlineKeyboard();
  for (const p of products) {
    const stock = p.emails?.length || 0;
    keyboard.text(`${p.name} ($${p.price}) [${stock}]`, `mgr:prod_detail:${p._id}`).row();
  }

  const nav: any[] = [];
  if (safePage > 0) nav.push(InlineKeyboard.text(t().adminPanel.prevBtn, `mgr:myproducts:${safePage - 1}`));
  if (safePage < totalPages - 1) nav.push(InlineKeyboard.text(t().adminPanel.nextBtn, `mgr:myproducts:${safePage + 1}`));
  if (nav.length > 0) keyboard.row(...nav);

  keyboard.row(
    InlineKeyboard.text(t().sellerKeyboard.addProduct, "mgr:menu:addproduct"),
    InlineKeyboard.text(t().adminPanel.backBtn, "mgr:menu:home")
  );

  const text =
    `${template(t().adminPanel.myProductsTitle, { count: total.toString() })}\n` +
    template(t().adminPanel.pageLabel, { current: safePage + 1, total: totalPages });

  await sendOrEdit(ctx, text, keyboard);
}

async function handleMyCategoriesButton(ctx: ManagerContext): Promise<any> {
  if (!ctx.from) return;
  const sellerRes = await getActiveSeller(ctx);
  if (sellerRes.kind !== "seller") return;
  const seller = sellerRes.seller;
  const db = await connectToDB();
  const categories = await db.collection<Category>("categories").find({ sellerId: seller._id }).toArray();
  if (categories.length === 0) {
    const emptyKb = new InlineKeyboard()
      .text(t().sellerKeyboard.addCategory, "mgr:menu:addcategory")
      .row()
      .text(t().adminPanel.backBtn, "mgr:menu:home");
    await sendOrEdit(ctx, t().adminPanel.myCategoriesEmpty, emptyKb);
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const c of categories) {
    keyboard.text(c.name, `mgr:cat_detail:${c._id}`).row();
  }
  keyboard.row(
    InlineKeyboard.text(t().sellerKeyboard.addCategory, "mgr:menu:addcategory"),
    InlineKeyboard.text(t().adminPanel.backBtn, "mgr:menu:home")
  );

  await sendOrEdit(
    ctx,
    template(t().adminPanel.myCategoriesTitle, { count: categories.length.toString() }),
    keyboard
  );
}

async function handleProductDetail(ctx: MyContext, productId: string): Promise<void> {
  if (!ctx.from || !ObjectId.isValid(productId)) return;
  const sellerRes = await getActiveSeller(ctx);
  if (sellerRes.kind !== "seller") return;
  const seller = sellerRes.seller;
  const db = await connectToDB();
  const product = await db.collection<Product>("products").findOne({ _id: new ObjectId(productId), sellerId: seller._id });
  if (!product) return;

  let categoryName = "N/A";
  try {
    if (product.categoryId && ObjectId.isValid(product.categoryId.toString())) {
      const cat = await db.collection<Category>("categories").findOne({ _id: product.categoryId });
      if (cat) categoryName = cat.name;
    }
  } catch { /* ignore */ }

  const stock = product.emails?.length || 0;
  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.editName, `mgr:eprod:${productId}`).row()
    .text(t().adminPanel.editPrice, `mgr:epprod:${productId}`)
    .text(t().adminPanel.deleteAction, `mgr:dprod:${productId}`).row()
    .text(t().adminPanel.backBtn, "mgr:menu:myproducts");

  const text =
    `${template(t().adminPanel.productDetailTitle, { name: product.name })}\n\n` +
    `${template(t().adminPanel.productDetailPrice, { price: product.price.toString() })}\n` +
    `${template(t().adminPanel.productDetailStock, { count: stock.toString() })}\n` +
    `${template(t().adminPanel.productDetailCategory, { name: categoryName })}\n` +
    `${template(t().adminPanel.productDetailPreorder, { yes: product.allowPreOrder ? t().adminPanel.yes : t().adminPanel.no })}\n` +
    `${template(t().adminPanel.productDetailAvailable, { yes: product.isAvailable ? t().adminPanel.yes : t().adminPanel.no })}`;

  await sendOrEdit(ctx, text, keyboard);
}

async function handleCategoryDetail(ctx: MyContext, categoryId: string): Promise<void> {
  if (!ctx.from || !ObjectId.isValid(categoryId)) return;
  const sellerRes = await getActiveSeller(ctx);
  if (sellerRes.kind !== "seller") return;
  const seller = sellerRes.seller;
  const db = await connectToDB();
  const category = await db.collection<Category>("categories").findOne({ _id: new ObjectId(categoryId), sellerId: seller._id });
  if (!category) return;

  const productCount = await db.collection<Product>("products").countDocuments({ categoryId: category._id, sellerId: seller._id });

  const keyboard = new InlineKeyboard()
    .text(t().adminPanel.editName, `mgr:ecat:${categoryId}`)
    .text(t().adminPanel.deleteAction, `mgr:dcat:${categoryId}`).row()
    .text(t().adminPanel.backBtn, "mgr:menu:mycategories");

  const text =
    `${template(t().adminPanel.categoryDetailTitle, { name: category.name })}\n\n` +
    `${template(t().adminPanel.categoryDetailCount, { count: productCount.toString() })}`;

  await sendOrEdit(ctx, text, keyboard);
}

async function handleAddProductButton(ctx: ManagerContext): Promise<any> {
  if (!ctx.from) return;
  const sellerRes = await getActiveSeller(ctx);
  if (sellerRes.kind !== "seller") return;
  (ctx.session as any).awaitingProductName = true;
  (ctx.session as any).editingProductId = undefined;
  const kb = new InlineKeyboard().text(t().adminPanel.cancelBtn, "mgr:menu:home");
  await sendOrEdit(ctx, t().adminPanel.addProductStep1, kb);
}

async function handleAddCategoryButton(ctx: ManagerContext): Promise<any> {
  if (!ctx.from) return;
  const sellerRes = await getActiveSeller(ctx);
  if (sellerRes.kind !== "seller") return;
  (ctx.session as any).awaitingCategoryName = true;
  (ctx.session as any).editingCategoryId = undefined;
  const kb = new InlineKeyboard().text(t().adminPanel.cancelBtn, "mgr:menu:home");
  await sendOrEdit(ctx, t().adminPanel.addCategoryPrompt, kb);
}

// ═════════════════════════════════════════════════════════
//  SELLER STATUS (for seller-facing /mystore)
// ═════════════════════════════════════════════════════════

async function getSellerByTelegram(telegramId: number): Promise<Seller | null> {
  const db = await connectToDB();
  return db.collection<Seller>("sellers").findOne({ telegramId: telegramId.toString() });
}

async function getAllSellersByTelegram(telegramId: number): Promise<Seller[]> {
  const db = await connectToDB();
  return db.collection<Seller>("sellers").find({ telegramId: telegramId.toString() }).toArray();
}

type StoreResolution =
  | { kind: "single"; seller: Seller }
  | { kind: "multiple"; sellers: Seller[] }
  | { kind: "none" };

export async function resolveSellerFromSession(ctx: MyContext): Promise<StoreResolution> {
  if (!ctx.from) return { kind: "none" };
  const all = await getAllSellersByTelegram(ctx.from.id);
  if (all.length === 0) return { kind: "none" };

  const session = (ctx.session as any) ?? {};
  const pinned = session.activeStoreId as string | undefined;
  if (pinned) {
    const match = all.find((s) => s._id?.toString() === pinned);
    if (match) return { kind: "single", seller: match };
  }

  if (all.length === 1) {
    return { kind: "single", seller: all[0] };
  }
  return { kind: "multiple", sellers: all };
}

async function showStoreSelector(ctx: MyContext): Promise<void> {
  const all = await getAllSellersByTelegram(ctx.from!.id);
  const keyboard = new InlineKeyboard();
  for (const s of all) {
    const label = sellerButtonLabel(s);
    keyboard.text(label, `mgr:store:${s._id!.toString()}`).row();
  }
  keyboard.row(InlineKeyboard.text(t().adminPanel.backBtn, "mgr:menu:home"));
  await sendOrEdit(ctx, t().adminPanel.selectStorePrompt, keyboard);
}

export async function getActiveSeller(
  ctx: MyContext
): Promise<{ kind: "seller"; seller: Seller } | { kind: "none" } | { kind: "selector" }> {
  if (!ctx.from) return { kind: "none" };
  const resolution = await resolveSellerFromSession(ctx);
  if (resolution.kind === "none") return { kind: "none" };
  if (resolution.kind === "single") return { kind: "seller", seller: resolution.seller };
  await showStoreSelector(ctx);
  return { kind: "selector" };
}

async function sendSellerStatus(ctx: MyContext, seller: Seller): Promise<void> {
  log.info({ sellerId: seller._id?.toString(), status: seller.status }, "Seller viewed store status");
  let expiry = "N/A";
  if (seller.status === "trial" && seller.trialExpiresAt) {
    const d = Math.ceil((seller.trialExpiresAt.getTime() - Date.now()) / 86400000);
    expiry = `${seller.trialExpiresAt.toLocaleDateString()} (${d}d left)`;
  } else if (seller.status === "active" && seller.planExpiresAt) {
    expiry = seller.planExpiresAt.toLocaleDateString();
  } else if (seller.status === "expired") {
    expiry = t().adminPanel.mystoreExpired;
  } else if (seller.status === "token_invalid") {
    expiry = t().adminPanel.mystoreTokenRevoked;
  }

  await sendOrEdit(
    ctx,
    `${t().adminPanel.mystoreTitle}\n\n` +
    `-------------------\n` +
    `${template(t().adminPanel.mystoreBot, { username: seller.botUsername || "N/A" })}\n` +
    `${template(t().adminPanel.mystoreStatus, { status: statusEmoji(seller.status), statusText: seller.status })}\n` +
    `${template(t().adminPanel.mystoreExpires, { date: expiry })}\n` +
    `${template(t().adminPanel.mystoreLink, { url: `https://t.me/${seller.botUsername || "bot"}` })}\n` +
    `-------------------`,
    sellerMenuKeyboard()
  );
}

// ═════════════════════════════════════════════════════════
//  INLINE KEYBOARDS
// ═════════════════════════════════════════════════════════
function adminMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t().adminPanel.sellersBtn, "mgr:menu:sellers")
    .text(t().adminPanel.statsBtn, "mgr:menu:stats")
    .row()
    .text(t().adminPanel.addSellerBtn, "mgr:menu:add_seller");
}

function sellerMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t().sellerKeyboard.myStore, "mgr:menu:mystore")
    .text(t().sellerKeyboard.subscription, "mgr:menu:subscription")
    .row()
    .text(t().sellerKeyboard.myProducts, "mgr:menu:myproducts")
    .text(t().sellerKeyboard.myCategories, "mgr:menu:mycategories")
    .row()
    .text(t().sellerKeyboard.addProduct, "mgr:menu:addproduct")
    .text(t().sellerKeyboard.addCategory, "mgr:menu:addcategory")
    .row()
    .text(t().sellerKeyboard.setPayment, "mgr:menu:setpayment")
    .text(t().sellerKeyboard.help, "mgr:menu:help");
}

function backToSellerMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t().buttons?.backToMainMenu || "Back", "mgr:menu:home");
}

function backToAdminMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t().buttons?.backToMainMenu || "Back", "mgr:menu:home");
}


