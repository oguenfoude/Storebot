import { Bot } from "grammy";
import dotenv from "dotenv";
import { MyContext } from "./types";

dotenv.config();

const { BOT_TOKEN } = process.env;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is not set in environment variables.");
}

export const bot = new Bot<MyContext>(BOT_TOKEN);
