import { asyncHandler } from "./../utils/asyncHandler";
import express from "express";
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProductById,
  deleteProductById,
  getArchivedProducts,
} from "../controllers/productController";

const router = express.Router();

router.get("/", asyncHandler(getAllProducts));
router.get("/archive", asyncHandler(getArchivedProducts));
router.get("/:id", asyncHandler(getProductById));
router.post("/", asyncHandler(createProduct));
router.put("/:id", asyncHandler(updateProductById));
router.delete("/:id", asyncHandler(deleteProductById));

export default router;
