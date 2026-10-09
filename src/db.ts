import dotenv from "dotenv";
import { MongoClient, Db } from "mongodb";
import logger from "./helpers/logger";

dotenv.config({ quiet: true });

const rawDbName = process.env.DBName?.trim();
if (!rawDbName) {
  throw new Error("DBName is not set in environment variables.");
}
const dbName = rawDbName.replace(/^["']|["']$/g, "");

const rawUri = process.env.MONGODB_URI?.trim();
if (!rawUri) {
  throw new Error("MONGODB_URI is not set in environment variables.");
}
const uri = rawUri.replace(/^["']|["']$/g, "");

const client = new MongoClient(uri);
let isConnected = false;

export const connectToDB = async (): Promise<Db> => {
  if (!isConnected) {
    await client.connect();
    isConnected = true;
    logger.info({ tag: "DB", dbName }, "Connected to MongoDB");
  }
  return client.db(dbName);
};

export const closeDB = async (): Promise<void> => {
  if (isConnected) {
    await client.close();
    isConnected = false;
    logger.info({ tag: "DB" }, "MongoDB connection closed");
  }
};
