import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import { connectToDB } from "../db";
import {
  Product,
  ProductSaleEvent,
  ProductHistoryEntry,
} from "../models/product";

const saveToHistory = async (
  productId: ObjectId,
  action: "create" | "update" | "delete" | "sale",
  details: string,
  updatedFields?: Record<string, any>,
  userDetails?: { fullName: string; phone: string },
  productDetails?: { productName: string; categoryName: string }
) => {
  const db = await connectToDB();

  const historyEntry: ProductHistoryEntry = {
    action,
    date: new Date(),
    details,
    updatedFields: updatedFields || {},
    userDetails: userDetails
      ? { fullName: userDetails.fullName, phone: userDetails.phone }
      : undefined,
    productDetails: productDetails
      ? {
          productName: productDetails.productName,
          categoryName: productDetails.categoryName,
        }
      : undefined,
  };

  const productUpdateResult = await db
    .collection("products")
    .updateOne({ _id: productId }, { $push: { history: historyEntry } as any });

  if (productUpdateResult.modifiedCount === 0) {
    console.error("Failed to update product history for product:", productId);
  }

  const historySaveResult = await db.collection("history").insertOne({
    ...historyEntry,
    productId,
  });

  if (!historySaveResult.insertedId) {
    console.error("Failed to save global history entry:", historyEntry);
  }
};

export const createProduct = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const {
      name,
      description = "",
      price,
      emails = [],
      categoryId,
      isAvailable = false,
      allowPreOrder = false,
    } = req.body;

    if (!name || price === undefined || !categoryId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const categoryObjectId = new ObjectId(categoryId);

    const newProduct: Product = {
      _id: new ObjectId(),
      name,
      description,
      price: Number(price),
      emails,
      categoryId: categoryObjectId,
      isAvailable,
      allowPreOrder,
      createdDate: new Date(),
      archive: [],
      history: [],
    };

    const result = await db
      .collection<Product>("products")
      .insertOne(newProduct);

    const category = await db
      .collection("categories")
      .findOne({ _id: categoryObjectId });

    const categoryName = category ? category.name : "Unknown Category";

    await saveToHistory(
      newProduct._id,
      "create",
      `Created product ${newProduct.name}`,
      undefined,
      undefined,
      { productName: newProduct.name, categoryName }
    );

    res.status(201).json({
      message: "Product created successfully",
      product: newProduct,
    });
  } catch (error) {
    console.error("Product Creation Error:", error);
    res.status(500).json({
      error: "Error creating product",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export const updateProductById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid product ID format" });
    }

    const productId = new ObjectId(id);
    const {
      name,
      description,
      price,
      emails = [],
      categoryId,
      allowPreOrder,
      isAvailable,
    } = req.body;

    const existingProduct = await db
      .collection<Product>("products")
      .findOne({ _id: productId });

    if (!existingProduct) {
      return res.status(404).json({ error: "Product not found" });
    }

    const updatedFields: Record<string, any> = {};

    if (emails.length > 0) {
      const oldEmails = existingProduct.emails;
      const addedEmails = emails.filter(
        (email: string) => !oldEmails.includes(email)
      );
      const removedEmails = oldEmails.filter(
        (email) => !emails.includes(email)
      );

      if (addedEmails.length > 0 || removedEmails.length > 0) {
        updatedFields["emails"] = {
          old: oldEmails,
          new: emails,
          added: addedEmails,
          removed: removedEmails,
        };
      }
    }

    if (name && name !== existingProduct.name) {
      updatedFields["name"] = { old: existingProduct.name, new: name };
    }

    if (price && price !== existingProduct.price) {
      updatedFields["price"] = { old: existingProduct.price, new: price };
    }

    if (categoryId && categoryId !== existingProduct.categoryId.toString()) {
      updatedFields["categoryId"] = {
        old: existingProduct.categoryId.toString(),
        new: categoryId,
      };
    }

    if (
      allowPreOrder !== undefined &&
      allowPreOrder !== existingProduct.allowPreOrder
    ) {
      updatedFields["allowPreOrder"] = {
        old: existingProduct.allowPreOrder,
        new: allowPreOrder,
      };
    }

    if (
      isAvailable !== undefined &&
      isAvailable !== existingProduct.isAvailable
    ) {
      updatedFields["isAvailable"] = {
        old: existingProduct.isAvailable,
        new: isAvailable,
      };
    }

    const updatedProduct: Product = {
      ...existingProduct,
      name: name || existingProduct.name,
      description: description || existingProduct.description,
      price:
        price !== undefined ? parseFloat(String(price)) : existingProduct.price,
      emails: emails.length ? emails : existingProduct.emails,
      categoryId: categoryId
        ? new ObjectId(categoryId)
        : existingProduct.categoryId,
      allowPreOrder: allowPreOrder ?? existingProduct.allowPreOrder,
      isAvailable: isAvailable ?? existingProduct.isAvailable,
    };

    const updateResult = await db
      .collection<Product>("products")
      .updateOne({ _id: productId }, { $set: updatedProduct });

    if (updateResult.modifiedCount === 0) {
      return res
        .status(404)
        .json({ error: "Product not found or not modified" });
    }

    const category = await db
      .collection("categories")
      .findOne({ _id: updatedProduct.categoryId });

    const categoryName = category ? category.name : "Unknown Category";

    await saveToHistory(
      productId,
      "update",
      `Updated product details`,
      updatedFields,
      undefined,
      { productName: updatedProduct.name, categoryName }
    );

    res.status(200).json({
      message: "Product updated successfully",
      product: updatedProduct,
    });
  } catch (error) {
    console.error("Update Product Error:", error);
    res.status(500).json({
      error: "Error updating product",
      errorDetails: error instanceof Error ? error.message : error,
    });
  }
};

export const deleteProductById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid product ID format" });
    }

    const productId = new ObjectId(id);
    const product = await db
      .collection<Product>("products")
      .findOne({ _id: productId });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    const salesHistoryWithFullNames = await Promise.all(
      product.archive.map(async (sale) => {
        const user = await db
          .collection("users")
          .findOne({ _id: new ObjectId(sale.soldTo) });

        const fullName = user ? user.fullName : "Unknown User";
        const phone = user ? user.phone : "Unknown Phone";

        const category = await db
          .collection("categories")
          .findOne({ _id: product.categoryId });
        const categoryName = category ? category.name : "Unknown Category";

        await saveToHistory(
          product._id,
          "sale",
          `Product sold to ${fullName}`,
          {},
          { fullName, phone },
          { productName: product.name, categoryName }
        );

        return {
          userId: sale.soldTo,
          fullName,
          phone,
          date: sale.soldAt,
          price: sale.price,
        };
      })
    );

    const archiveEntry = {
      ...product,
      salesHistory: salesHistoryWithFullNames,
    };

    const deleteResult = await db
      .collection("products")
      .deleteOne({ _id: productId });

    if (deleteResult.deletedCount === 0) {
      return res
        .status(404)
        .json({ error: "Product not found or not deleted" });
    }

    await saveToHistory(
      productId,
      "delete",
      `Deleted product ${product.name}`,
      undefined,
      undefined,
      { productName: product.name, categoryName: "Deleted Category" }
    );

    res.status(200).json({
      message: "Product deleted successfully",
      archiveEntry,
    });
  } catch (error) {
    console.error("Delete Product Error:", error);
    res.status(500).json({
      error: "Error deleting product",
      errorDetails: error instanceof Error ? error.message : error,
    });
  }
};

export const getAllProducts = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const products = await db.collection<Product>("products").find().toArray();

    if (!products.length) {
      return res.status(404).json({ message: "No products found" });
    }

    res.status(200).json(products);
  } catch (error) {
    console.error("Error fetching all products:", error);
    res.status(500).json({
      error: "Error fetching all products",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getProductById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid product ID format" });
    }

    const product = await db
      .collection<Product>("products")
      .findOne({ _id: new ObjectId(id) });

    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.status(200).json(product);
  } catch (error) {
    console.error("Error fetching product by ID:", error);
    res.status(500).json({
      error: "Error fetching product by ID",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export const getArchivedProducts = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const archivedProducts = await db
      .collection("product_archive")
      .find()
      .toArray();

    if (!archivedProducts.length) {
      return res.status(404).json({ message: "No archived products found" });
    }

    res.status(200).json(archivedProducts);
  } catch (error) {
    console.error("Error fetching archived products:", error);
    res.status(500).json({
      error: "Error fetching archived products",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
