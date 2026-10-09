import { ObjectId } from "mongodb";

export interface UserHistoryEntry {
  type: "purchase" | "recharge" | "preorder";
  date: Date;
  amount?: number;
  productId?: ObjectId;
  productName?: string;
  price?: number;
  categoryName?: string;
  emailSold?: string;
  transactionId?: ObjectId;
  sellerId?: ObjectId;
}

export interface User {
  _id?: ObjectId;
  sellerId?: ObjectId;
  telegramId: string;
  chatId: string;
  username: string;
  name: string;
  fullName?: string;
  phoneNumber?: string;
  balance: number;
  registerDate: Date;
  isAccepted: boolean;
  language?: string;
  history?: UserHistoryEntry[];
}
