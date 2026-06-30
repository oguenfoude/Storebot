import { InlineKeyboard, Keyboard } from "grammy";
import { connectToDB } from "../db";
import { ObjectId, WithId } from "mongodb";
import { Product } from "../models/product";
import { Category } from "../models/category";
import { MyContext } from "../types";

const DIVIDER = "▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰";

interface CategoryWithId extends WithId<Category> {
  name: string;
  emoji?: string;
}

const formatPrice = (price: number): string => `${price} نقاط`;

const getStatusText = (quantity: number, allowPreOrder: boolean): string => {
  if (quantity > 0) return "[متوفر]";
  return allowPreOrder ? "[طلب مسبق]" : "[نفذت الكمية]";
};

export const handleProductsCommand = async (ctx: MyContext): Promise<void> => {
  try {
    const db = await connectToDB();
    const categories = await db
      .collection<CategoryWithId>("categories")
      .find()
      .toArray();

    if (categories.length === 0) {
      const msg = "عذراً، لا توجد فئات متاحة حالياً.";
      if (ctx.callbackQuery) {
        try { await ctx.deleteMessage(); } catch (e) {}
      }
      await ctx.reply(msg);
      return;
    }

    const keyboard = new Keyboard();
    for (let i = 0; i < categories.length; i += 2) {
      if (i + 1 < categories.length) {
        keyboard
          .text(categories[i].name)
          .text(categories[i + 1].name)
          .row();
      } else {
        keyboard
          .text(categories[i].name)
          .row();
      }
    }
    keyboard.text("رجوع للقائمة الرئيسية").resized();

    const msg = "اختر الفئة المطلوبة:";

    if (ctx.callbackQuery) {
      try { await ctx.deleteMessage(); } catch (e) {}
    }
    await ctx.reply(msg, {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("Categories loading error:", error);
    await ctx.reply("حدث خطأ أثناء تحميل الفئات. الرجاء المحاولة لاحقاً.");
  }
};

export const handleCategorySelection = async (
  ctx: MyContext,
  categoryId: string
): Promise<void> => {
  try {
    const db = await connectToDB();
    const category = await db
      .collection<CategoryWithId>("categories")
      .findOne({ _id: new ObjectId(categoryId) });

    const products = await db
      .collection<Product>("products")
      .find({ categoryId: new ObjectId(categoryId) })
      .toArray();

    if (products.length === 0) {
      const messageText = `لا توجد منتجات متوفرة في فئة "${category?.name || "غير محدد"}" حالياً.`;
      const replyMarkup = new InlineKeyboard().text("رجوع", "menu:products");
      if (ctx.callbackQuery) {
        await ctx.editMessageText(messageText, { reply_markup: replyMarkup });
      } else {
        await ctx.reply(messageText, { reply_markup: replyMarkup });
      }
      return;
    }

    const keyboard = new InlineKeyboard();
    products.forEach((product) => {
      const quantity = product.emails.length;
      let availabilityText = "";
      if (quantity > 0) {
        availabilityText = `${quantity}`;
      } else if (product.allowPreOrder) {
        availabilityText = "طلب مسبق";
      } else {
        availabilityText = "نفذت الكمية";
      }
      
      const priceText = formatPrice(product.price);
      
      keyboard
        .text(availabilityText, `product:${product._id}`)
        .text(product.name, `product:${product._id}`)
        .text(priceText, `product:${product._id}`)
        .row();
    });
    keyboard.text("رجوع", "menu:products");

    const categoryMessage = "الرجاء اختيار المنتج المطلوب (اضغط على أي زر يخص المنتج):";

    if (ctx.callbackQuery) {
      await ctx.editMessageText(categoryMessage, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } else {
      await ctx.reply(categoryMessage, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    }
  } catch (error) {
    console.error("Product listing error:", error);
    await ctx.reply("حدث خطأ أثناء تحميل المنتجات. الرجاء المحاولة لاحقاً.");
  }
};
