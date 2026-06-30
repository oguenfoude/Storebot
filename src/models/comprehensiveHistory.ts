import { ObjectId } from "mongodb";

export interface ComprehensiveHistory {
  _id: ObjectId;
  userId: ObjectId;
  actionType: string;
  date: Date;
  description: string;
  previousState?: any;
  newState?: any;
  emailSold?: string;
  productId?: ObjectId;
  productName?: string;
  categoryId?: ObjectId;
  categoryName?: string;
  price?: number;
  deliveryTime?: Date;
  userMessage?: string;
  clientMessageData?: string;
}
