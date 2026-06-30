import { ObjectId } from "mongodb";

export interface User {
  _id?: ObjectId;
  telegramId: string;
  chatId: string;
  username: string;
  name: string;
  fullName?: string;
  phoneNumber?: string;
  balance: number;
  registerDate: Date;
  isAccepted: boolean;
  history?: UserEvent[];
  paymentHistory?: PaymentHistoryEntry[];
}

export interface UserEvent {
  type: "recharge" | "status" | "delete" | "purchase";
  date: Date;
  amount?: number;
  status?: string;
  productId?: ObjectId;
  productName?: string;
  price?: number;
  emailSold?: string;
  categoryName?: string;
  adminAction?: "Recharge" | "Discount";
  transactionId?: ObjectId;
}

export interface PaymentHistoryEntry {
  date: Date;
  amount: number;
  description: string;
}
