import express from "express";
import {
  getAllUsers,
  getUserById,
  updateUserById,
  deleteUserById,
  updateUserBalanceById,
} from "../controllers/userController";
import { asyncHandler } from "../utils/asyncHandler";

const router = express.Router();

router.get("/", asyncHandler(getAllUsers));
router.get("/:id", asyncHandler(getUserById));
router.put("/:id", asyncHandler(updateUserById));
router.delete("/:id", asyncHandler(deleteUserById));
router.put("/:id/balance", asyncHandler(updateUserBalanceById));

export default router;
