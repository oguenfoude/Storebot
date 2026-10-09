import { Bot } from 'grammy';
import { connectToDB } from '../db';
import { ObjectId } from 'mongodb';
import { t } from '../languages';
import { BotManager } from '../bot/manager';
import { MyContext } from '../types';
import { getAdminIds } from './getAdminIds';
import logger from './logger';

const log = logger.child({ tag: "AdminNotify" });

(() => {
    const ids = getAdminIds();
    if (ids.length === 0) {
        throw new Error("Admin ID not configured — set TELEGRAM_ADMIN_IDS or TELEGRAM_ADMIN_ID in .env");
    }
})();

interface NotificationResult {
    adminId: string;
    success: boolean;
    error?: string;
    timestamp: Date;
}

interface NotificationOptions {
    parse_mode?: "Markdown";
    callback_data?: string;
    retry_count?: number;
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

function splitMessage(message: string, maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
    const parts: string[] = [];
    let current = 0;
    while (current < message.length) {
        parts.push(message.slice(current, current + maxLength));
        current += maxLength;
    }
    return parts;
}

export async function sendToAdmin(
    message: string,
    sellerId?: ObjectId,
    options: NotificationOptions = {}
): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    const adminIds = getAdminIds();
    if (adminIds.length === 0) {
        log.warn("No valid admin IDs found. Please set TELEGRAM_ADMIN_IDS in your .env file.");
        return results;
    }
    const db = await connectToDB();

    // Get the bot for this seller (or primary bot)
    let bot: Bot<MyContext> | null = null;
    if (sellerId) {
      try {
        bot = BotManager.getBotForMessage(sellerId);
      } catch {
        bot = BotManager.getPrimaryBot();
      }
    } else {
      bot = BotManager.getPrimaryBot();
    }

    if (!bot) {
        log.warn("No bot available to send notifications");
        return results;
    }

    const sellerIdStr = sellerId?.toString() || "default";

    for (const adminId of adminIds) {
        let success = false;
        let attemptsMade = 0;
        let errorMsg: string | undefined = undefined;
        for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
            attemptsMade = attempt;
            try {
                const messageParts = splitMessage(message);
                for (let i = 0; i < messageParts.length; i++) {
                    await bot.api.sendMessage(adminId, messageParts[i], {
                        reply_markup: i === messageParts.length - 1 && options.callback_data ? {
                            inline_keyboard: [
                                [
                                    {
                                        text: t().admin.confirmReceipt,
                                        callback_data: `${options.callback_data}_${adminId}`
                                    }
                                ]
                            ]
                        } : undefined
                    });
                }
                success = true;
                errorMsg = undefined;
                break; // success — exit retry loop
            } catch (error) {
                errorMsg = error instanceof Error ? error.message : String(error);
                if (attempt < MAX_RETRY_ATTEMPTS) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (attempt + 1)));
                }
            }
        }
        try {
            await db.collection("adminNotifications").insertOne({
                _id: new ObjectId(),
                adminId,
                sellerId: sellerId || "default",
                message,
                sentAt: new Date(),
                status: success ? 'success' : 'failed',
                error: errorMsg,
                retryCount: attemptsMade
            });
        } catch (logErr) {
            log.warn({ adminId, err: logErr }, "Failed to write admin notification log");
        }
        results.push({
            adminId,
            success,
            error: errorMsg,
            timestamp: new Date()
        });
    }
    log.info({ results: results.map(r => ({ adminId: r.adminId, success: r.success, error: r.error })) }, "Notification results");
    return results;
}
