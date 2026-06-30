export const formatCurrency = (amount: number): string =>
  `${amount.toFixed(2)} نقطة`;

export const AdminMessages = {
  notifyAdminPreOrder: (
    fullName: string,
    userName: string,
    product: string,
    message: string
  ): string => `
طلب مسبق جديد:  
الاسم الكامل: ${fullName}  
اسم المستخدم: ${userName}  
المنتج: ${product}  
ملاحظات المستخدم: ${message}`,
};

export const UserMessages = {
  formatPurchaseMessage: (
    fullName: string,
    userName: string,
    productName: string,
    price: number,
    newBalance: number,
    email: string
  ): string =>
    `تم الشراء بنجاح:  
الاسم الكامل: ${fullName}  
اسم المستخدم: ${userName}  
المنتج: ${productName}  
السعر: ${price} وحدة  
الرصيد المتبقي: ${newBalance} وحدة  
الحساب: ${email}`,

  formatInsufficientFundsMessage: (balance: number, price: number): string =>
    `رصيدك غير كافٍ. تحتاج إلى ${price - balance} وحدة إضافية لإتمام الشراء.`,

  preorderSuccess: (productName: string): string =>
    `تم تقديم طلبك المسبق للمنتج "${productName}" بنجاح!`,
};

export const ErrorMessages = {
  userNotFound: (): string => `المستخدم غير موجود.`,
  productNotFound: (): string => `المنتج غير موجود.`,
  genericError: (): string => `حدث خطأ. يرجى المحاولة لاحقًا.`,
  preorderError: (): string =>
    `حدث خطأ أثناء إنشاء الطلب المسبق. يرجى المحاولة لاحقًا.`,
};

export const SupportMessages = {
  insufficientBalanceSupport: (): string =>
    `رصيدك غير كافٍ لإتمام هذه العملية. يمكنك التواصل مع الدعم لإعادة الشحن.`,
  contactSupportLink: (): string => {
    const url = process.env.SUPPORT_WHATSAPP_URL || "https://wa.me/213776863561";
    return `تواصل مع الدعم الفني: [اضغط هنا](${url})`;
  },
};

export const telegramMessages = {
  preOrderConfirmation: (productName: string, message: string) =>
    `تم تقديم طلبك المسبق للمنتج "${productName}" بنجاح!\n\n` +
    `الرسالة: "${message}"\n\n` +
    `سنقوم بإخطارك فور توفر المنتج.`,

  adminPreOrderNotification: (
    fullName: string | undefined,
    userId: string,
    productName: string,
    price: number,
    message: string
  ) =>
    `تنبيه طلب مسبق جديد:\n\n` +
    `المستخدم: ${fullName} (المعرف: ${userId})\n` +
    `المنتج: ${productName}\n` +
    `السعر: ${price}\n` +
    `الرسالة: "${message}"\n\n` +
    `يرجى مراجعة لوحة التحكم للتفاصيل.`,
};

import { User } from "../models/user";

export const NewUserMessage = (user: User): string => {
  return `
  **تم تسجيل مستخدم جديد**
  - **اسم المستخدم:** ${user.username}
  - **الاسم الكامل:** ${user.fullName || "غير مذكور"}
  - **رقم الهاتف:** ${user.phoneNumber || "غير مذكور"}
  - **رقم التليجرام:** ${user.telegramId}
  - **رقم المحادثة:** ${user.chatId}
  - **تاريخ التسجيل:** ${user.registerDate.toLocaleString()}
  `;
};

export const formatBalanceMessage = (balance: number): string => {
  return `
  **رصيدك الحالي:**
  - **المبلغ المتاح:** ${balance} 
  `;
};

import { bot } from "../botInstance";

export const safeSendMessage = async (telegramId: string, message: string, options?: any): Promise<boolean> => {
  if (telegramId.startsWith("999999")) {
    console.log(`[Mock Send] Skipping sendMessage to mock ID: ${telegramId}`);
    return true;
  }
  try {
    await bot.api.sendMessage(telegramId, message, options);
    return true;
  } catch (error) {
    console.error(`Failed to send Telegram message to ${telegramId}:`, error);
    return false;
  }
};
