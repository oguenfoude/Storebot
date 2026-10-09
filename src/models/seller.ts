import { ObjectId } from "mongodb";

export interface Seller {
  _id?: ObjectId;
  telegramId: string;
  botToken: string;
  botUsername?: string;
  status: "trial" | "active" | "expired" | "token_invalid";
  trialStartedAt?: Date;
  trialExpiresAt?: Date;
  planExpiresAt?: Date;
  maxProducts: number;
  nowpaymentsApiKey?: string;
  createdAt: Date;
}
