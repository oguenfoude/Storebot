import dotenv from "dotenv";
import { MongoClient, Db } from "mongodb";

dotenv.config();

const dbName = process.env.DBName;
if (!dbName) {
  throw new Error("DBName is not set in environment variables.");
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  throw new Error("MONGODB_URI is not set in environment variables.");
}

const client = new MongoClient(uri);
let isConnected = false;

export const connectToDB = async (): Promise<Db> => {
  if (!isConnected) {
    await client.connect();
    isConnected = true;
    console.log("Connected to MongoDB successfully.");
  }
  return client.db(dbName);
};
