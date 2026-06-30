import { ObjectId } from "mongodb";

export interface ProductHistoryEntry {
  action: "create" | "update" | "delete" | "sale";
  date: Date;
  details: string;
  updatedFields?: Record<string, any>;
  userDetails?: { fullName: string; phone: string };
  productDetails?: { productName: string; categoryName: string };
}

export interface Product {
  _id: ObjectId;
  name: string;
  description: string;
  price: number;
  emails: string[];
  categoryId: ObjectId;
  isAvailable: boolean;
  allowPreOrder: boolean;
  createdDate: Date;
  archive: Array<any>;
  salesHistory?: ProductSaleEvent[];
  history?: ProductHistoryEntry[];
}

export interface ProductSaleEvent {
  userId: ObjectId;
  fullName: string;
  date: Date;
  price: number;
  emailPassword: string;
}
