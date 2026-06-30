import { ObjectId } from "mongodb";

export interface ClientHistoryEntry {
  action: "purchase" | "preorder";
  date: Date;
  userId: ObjectId;
  fullName: string;
  email: string;
  productId: ObjectId;
  productName: string;
  price: number;
  status?: string;
  message?: string;
  responseMessage?: string;
  fulfillmentDate?: Date;
}

export interface AdminHistoryEntry {
  action: "create" | "update" | "delete";
  date: Date;
  adminId: ObjectId;
  entity: "product" | "user" | "category" | "preorder" | "notification";
  entityId: ObjectId;
  entityName?: string;
  updatedFields?: Record<string, any>;
  details?: string;
}

export interface History {
  _id: ObjectId;
  type: "client" | "admin";
  entry: ClientHistoryEntry | AdminHistoryEntry;
}
