import { ObjectId } from "mongodb";
import { connectToDB } from "../db";

export type EntityType = "user" | "product";
export type HistoryActionType =
  | "purchase"
  | "recharge"
  | "discount"
  | "status"
  | "delete"
  | "create"
  | "update"
  | "preOrder"
  | "sale";

export async function recordHistoryEvent(
  entityType: EntityType,
  entityId: ObjectId,
  actionType: HistoryActionType,
  details: Record<string, any>
): Promise<void> {
  const db = await connectToDB();
  const now = new Date();

  const historyEntry = {
    actionType,
    date: now,
    ...details,
  };

  await db.collection("history").insertOne({
    ...historyEntry,
    [`${entityType}Id`]: entityId,
  });

  const collectionName = entityType === "user" ? "users" : "products";
  await db
    .collection(collectionName)
    .updateOne(
      { _id: entityId },
      { $push: { history: historyEntry } as any }
    );
}
