import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDB } from "../db";
import { Notification } from "../models/notification";
import { bot } from "../botInstance";
import { User } from "../models/user";

export const getAllNotifications = async (_req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const notifications = await db
      .collection<Notification>("notifications")
      .find()
      .sort({ createdAt: -1 })
      .toArray();
    res.status(200).json(notifications);
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ error: "Error fetching notifications" });
  }
};

export const getNotificationById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const notificationId = new ObjectId(req.params.id);
    const notification = await db
      .collection<Notification>("notifications")
      .findOne({ _id: notificationId });
    if (!notification)
      return res.status(404).json({ error: "Notification not found" });
    res.status(200).json(notification);
  } catch (error) {
    console.error("Error fetching notification:", error);
    res.status(500).json({ error: "Error fetching notification" });
  }
};

export const createNotification = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const { title = "Untitled Notification", message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message content is required" });
    }

    const newNotification: Notification = {
      title,
      message,
      createdAt: new Date(),
    };

    const result = await db
      .collection<Notification>("notifications")
      .insertOne(newNotification);

    res.status(201).json({
      message: "Notification created",
      notificationId: result.insertedId,
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ error: "Error creating notification" });
  }
};

export const updateNotificationById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const notificationId = new ObjectId(req.params.id);
    const { title, message } = req.body;

    const existingNotification = await db
      .collection<Notification>("notifications")
      .findOne({ _id: notificationId });
    if (!existingNotification)
      return res.status(404).json({ error: "Notification not found" });

    const updatedFields: Partial<Notification> = {};
    if (title) updatedFields.title = title;
    if (message) updatedFields.message = message;

    const result = await db.collection<Notification>("notifications").updateOne(
      { _id: notificationId },
      {
        $set: updatedFields,
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.status(200).json({ message: "Notification updated" });
  } catch (error) {
    console.error("Error updating notification:", error);
    res.status(500).json({ error: "Error updating notification" });
  }
};

export const deleteNotificationById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const notificationId = new ObjectId(req.params.id);

    const existingNotification = await db
      .collection<Notification>("notifications")
      .findOne({ _id: notificationId });
    if (!existingNotification)
      return res.status(404).json({ error: "Notification not found" });

    const result = await db
      .collection<Notification>("notifications")
      .deleteOne({ _id: notificationId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    res.status(200).json({ message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ error: "Error deleting notification" });
  }
};

export const sendNotificationById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const notificationId = new ObjectId(req.params.id);

    const notification = await db
      .collection<Notification>("notifications")
      .findOne({ _id: notificationId });
    if (!notification)
      return res.status(404).json({ error: "Notification not found" });

    const users = await db
      .collection<User>("users")
      .find({ isAccepted: true }, { projection: { telegramId: 1 } })
      .toArray();

    const BROADCAST_RATE = 30;
    let count = 0;

    for (const user of users) {
      await bot.api
        .sendMessage(user.telegramId, notification.message)
        .catch((err) => {
          console.error(
            `Failed to send message to ${user.telegramId}:`,
            err.message
          );
        });

      count++;
      if (count % BROADCAST_RATE === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    res.status(200).json({ message: "Notification sent to all users" });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).json({ error: "Error sending notification" });
  }
};
