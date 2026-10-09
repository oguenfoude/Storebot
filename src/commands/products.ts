import { connectToDB } from "../db";
import { InlineKeyboard } from "grammy";
import { ObjectId, WithId } from "mongodb";
import { Product } from "../models/product";
import { Category } from "../models/category";
import { MyContext } from "../types";
import { t } from "../languages";
import logger from "../helpers/logger";

const log = logger.child({ tag: "ProductsCmd" });

interface CategoryWithId extends WithId<Category> {
  name: string;
}

const formatPrice = (price: number): string => `${price} pts`;

export const handleProductsCommand = async (ctx: MyContext, sellerId?: ObjectId): Promise<void> => {
  try {
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;
    log.info({ telegramId: ctx.from?.id, sellerId: sid.toString() }, "Products viewed");
    const db = await connectToDB();
    const categories = await db
      .collection<CategoryWithId>("categories")
      .find({ sellerId: sid })
      .toArray();

    if (categories.length === 0) {
      await ctx.reply(t().products.noCategories);
      return;
    }

    const lines: string[] = [t().products.chooseCategory, ""];
    for (let i = 0; i < categories.length; i++) {
      lines.push(`${i + 1}. ${categories[i].name}`);
    }
    lines.push("");
    lines.push(t().products.chooseCategoryHint || "Type the category name to browse products.");

    const keyboard = new InlineKeyboard();
    for (const c of categories) {
      keyboard.text(c.name, `store:cat:${c._id}`).row();
    }
    await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
  } catch (error) {
    log.error({ err: error }, "Categories loading error");
    await ctx.reply(t().products.errorLoading);
  }
};

export const handleCategorySelection = async (
  ctx: MyContext,
  categoryId: string,
  sellerId?: ObjectId
): Promise<void> => {
  try {
    const sid = sellerId || (await import("../config/seller")).DEFAULT_SELLER_ID;
    if (!ObjectId.isValid(categoryId)) {
      await ctx.reply(t().products.errorLoadingProducts);
      return;
    }
    const db = await connectToDB();
    const category = await db
      .collection<CategoryWithId>("categories")
      .findOne({ _id: new ObjectId(categoryId), sellerId: sid });

    const products = await db
      .collection<Product>("products")
      .find({ categoryId: new ObjectId(categoryId), sellerId: sid })
      .toArray();

    if (products.length === 0) {
      const messageText = t().products.noProducts.replace("${category}", category?.name || "N/A");
      await ctx.reply(messageText);
      return;
    }

    const lines: string[] = [t().products.chooseProduct, ""];
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const quantity = product.emails?.length || 0;
      let stockText = "";
      if (quantity > 0) {
        stockText = t().products.inStock.replace("${count}", quantity.toString());
      } else if (product.allowPreOrder) {
        stockText = t().products.preOrderAvailable;
      } else {
        stockText = t().products.outOfStock;
      }
      lines.push(`${i + 1}. ${product.name} — ${formatPrice(product.price)} (${stockText})`);
    }
    lines.push("");
    lines.push(t().products.chooseProductHint || "Type the product name to purchase it.");

    const keyboard = new InlineKeyboard();
    for (const p of products) {
      const quantity = p.emails?.length || 0;
      const stockBadge = quantity > 0 ? `[${quantity}]` : (p.allowPreOrder ? "[Pre-order]" : "[Out of stock]");
      keyboard.text(`${p.name} — ${formatPrice(p.price)} ${stockBadge}`, `store:prod:${p._id}`).row();
    }
    keyboard.row(InlineKeyboard.text(t().buttons.backToMainMenu || "« Back to Categories", "store:categories"));
    await ctx.reply(lines.join("\n"), { reply_markup: keyboard });
  } catch (error) {
    log.error({ err: error }, "Product listing error");
    await ctx.reply(t().products.errorLoadingProducts);
  }
};
