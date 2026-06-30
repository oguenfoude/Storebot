import express from "express";
import {
  getAllNotifications,
  getNotificationById,
  createNotification,
  updateNotificationById,
  deleteNotificationById,
  sendNotificationById,
} from "../controllers/notificationController";
import { asyncHandler } from "../utils/asyncHandler";

const router = express.Router();

router.get("/", asyncHandler(getAllNotifications));
router.get("/:id", asyncHandler(getNotificationById));
router.post("/", asyncHandler(createNotification));
router.put("/:id", asyncHandler(updateNotificationById));
router.delete("/:id", asyncHandler(deleteNotificationById));
router.post("/:id/send", asyncHandler(sendNotificationById));

export default router;
