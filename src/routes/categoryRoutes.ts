import express from "express";
import {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategoryById,
  deleteCategoryById,
} from "../controllers/categoryController";
import { asyncHandler } from "../utils/asyncHandler";

const router = express.Router();

router.get("/", getAllCategories);
router.get("/:id", asyncHandler(getCategoryById));
router.post("/", asyncHandler(createCategory));
router.put("/:id", asyncHandler(updateCategoryById));
router.delete("/:id", asyncHandler(deleteCategoryById));

export default router;
