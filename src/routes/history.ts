import { asyncHandler } from "./../utils/asyncHandler";
import { Router } from "express";
import { getAllHistory, getHistoryById } from "../controllers/history";

const router = Router();

router.get("/", getAllHistory);
router.get("/:id", asyncHandler(getHistoryById));

export default router;
