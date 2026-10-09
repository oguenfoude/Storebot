import { ObjectId } from "mongodb";

export interface Category {
  _id?: ObjectId;
  sellerId?: ObjectId;
  name: string;
  createdDate: Date;
  isActive: boolean;
}
