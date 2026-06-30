import express from "express";
import {
  getAllPreOrders,
  getPreOrderById,
  updatePreOrderStatus,
  fulfillPreOrder,
  deletePreOrderById,
} from "../controllers/preOrderController";
import { asyncHandler } from "../utils/asyncHandler";

const router = express.Router();

router.get("/", asyncHandler(getAllPreOrders));
router.get("/:id", asyncHandler(getPreOrderById));
router.put("/:id/status", asyncHandler(updatePreOrderStatus));
router.put("/:id/fulfill", asyncHandler(fulfillPreOrder));
router.delete("/:id", asyncHandler(deletePreOrderById));

export default router;
