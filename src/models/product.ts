import { ObjectId } from "mongodb";

export interface Product {
  _id: ObjectId;
  sellerId?: ObjectId;
  name: string;
  description: string;
  price: number;
  emails: string[];
  categoryId: ObjectId;
  isAvailable: boolean;
  allowPreOrder: boolean;
  createdDate: Date;
  archive: Array<any>;
}
