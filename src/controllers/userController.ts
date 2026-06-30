import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDB } from "../db";
import { User, UserEvent } from "../models/user";
import { bot } from "../botInstance";
import { safeSendMessage } from "../utils/messages";
import { getMainMenuKeyboard } from "../commands/start";

const sendTelegramMessage = async (telegramId: string, message: string, options?: any) => {
  await safeSendMessage(telegramId, message, options);
};

const createUserEvent = (
  type: "recharge" | "status" | "delete",
  data: Partial<UserEvent>
): UserEvent => {
  return {
    type,
    date: new Date(),
    ...data,
  };
};

export const getAllUsers = async (_req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const users = await db.collection<User>("users").find().toArray();
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Error fetching users" });
  }
};

export const getUserById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const userId = new ObjectId(req.params.id);
    const user = await db.collection<User>("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.status(200).json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Error fetching user" });
  }
};

export const updateUserBalanceById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const userId = new ObjectId(req.params.id);
    const { amount }: { amount: number } = req.body;

    if (typeof amount !== "number") {
      return res.status(400).json({ error: "Amount must be a number" });
    }

    const user = await db.collection<User>("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    const oldBalance = user.balance;
    const newBalance = oldBalance + amount;

    if (newBalance < 0) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const rechargeEvent = createUserEvent("recharge", {
      amount,
      adminAction: amount > 0 ? "Recharge" : "Discount",
    });

    await db.collection<User>("users").updateOne(
      { _id: userId },
      {
        $set: { balance: newBalance },
        $push: { history: rechargeEvent },
      }
    );

    await db.collection("history").insertOne({
      action: amount > 0 ? "Recharge" : "Discount",
      target: "balance",
      targetId: userId,
      userId,
      fullName: user.fullName || "N/A",
      phoneNumber: user.phoneNumber || "N/A",
      message:
        amount > 0
          ? `Recharged balance by ${amount}`
          : `Discounted balance by ${Math.abs(amount)}`,
      previousBalance: oldBalance,
      newBalance,
      date: new Date(),
    });

    if (user.telegramId) {
      const message =
        amount > 0
          ? `تم شحن رصيدك:\nالرصيد القديم: ${oldBalance}\nالرصيد الجديد: ${newBalance}\nالمبلغ المضاف: ${amount}`
          : `تم خصم من رصيدك:\nالرصيد القديم: ${oldBalance}\nالرصيد الجديد: ${newBalance}\nالمبلغ المخصوم: ${Math.abs(amount)}`;
      await sendTelegramMessage(user.telegramId, message);
    }

    res.status(200).json({
      message: "User balance updated successfully",
      oldBalance,
      newBalance,
    });
  } catch (error) {
    console.error("Error updating balance:", error);
    res.status(500).json({ error: "Error updating balance" });
  }
};

export const updateUserById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const userId = new ObjectId(req.params.id);
    const updates: Partial<User> = req.body;

    const allowedFields: (keyof User)[] = ["username", "name", "isAccepted"];
    const sanitizedUpdates: Partial<User> = {};

    for (const key of allowedFields) {
      if (key in updates) {
        sanitizedUpdates[key] = updates[key] as any;
      }
    }

    const user = await db.collection<User>("users").findOne({ _id: userId });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const statusEvent = createUserEvent("status", {
      status: sanitizedUpdates.isAccepted
        ? "accepted"
        : sanitizedUpdates.isAccepted === false
        ? "blocked"
        : "updated",
    });

    await db.collection<User>("users").updateOne(
      { _id: userId },
      {
        $set: sanitizedUpdates,
        $push: { history: statusEvent },
      }
    );

    await db.collection("history").insertOne({
      action: "update",
      target: "system",
      targetId: userId,
      userId,
      fullName: user.fullName || "N/A",
      phoneNumber: user.phoneNumber || "N/A",
      message: `Updated user ${user.username} with fields: ${Object.keys(
        sanitizedUpdates
      ).join(", ")}`,
      price: 0,
      date: new Date(),
    });

    if ("isAccepted" in sanitizedUpdates) {
      const message = sanitizedUpdates.isAccepted
        ? "تم قبول حسابك! يمكنك الآن استخدام البوت."
        : "لقد تم حظر حسابك من قبل المسؤول.";
      const options = sanitizedUpdates.isAccepted
        ? { reply_markup: getMainMenuKeyboard() }
        : undefined;
      await sendTelegramMessage(user.telegramId, message, options);
    }

    res.status(200).json({ message: "User updated successfully" });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Error updating user" });
  }
};

export const deleteUserById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const userId = new ObjectId(req.params.id);

    const user = await db.collection<User>("users").findOne({ _id: userId });
    if (!user) return res.status(404).json({ error: "User not found" });

    const deleteEvent = createUserEvent("delete", {
      status: `User '${user.username}' deleted`,
    });

    await db.collection("history").insertOne({
      action: "delete",
      target: "system",
      targetId: userId,
      userId,
      fullName: user.fullName || "N/A",
      phoneNumber: user.phoneNumber || "N/A",
      message: `Deleted user ${user.username}`,
      price: 0,
      date: new Date(),
    });

    await db.collection<User>("users").updateOne(
      { _id: userId },
      {
        $push: { history: deleteEvent },
      }
    );

    await db.collection<User>("users").deleteOne({ _id: userId });

    if (user.telegramId) {
      const message = "تم حذف حسابك من النظام.";
      await sendTelegramMessage(user.telegramId, message);
    }

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Error deleting user" });
  }
};
