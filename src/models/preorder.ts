import { ObjectId } from "mongodb";

export interface PreOrder {
  _id: ObjectId;
  sellerId?: ObjectId;
  userId: ObjectId;
  productId: ObjectId;
  date: Date;
  status: string;
  message: string;
  clientMessage?: string;
  clientMessageData?: string;
  fulfillmentDate?: Date;
  userName: string;
  fullName: string;
  userTelegramId: string;
  productName: string;
  productPrice: number;
  fulfillmentDetails?: string;
}
