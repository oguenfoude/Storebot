import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import cors from "cors";
import userRoutes from "./routes/userRoutes";
import productRoutes from "./routes/productRoutes";
import categoryRoutes from "./routes/categoryRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import preOrderRoutes from "./routes/preOrderRoutes";
import historicRoutes from "./routes/history";
import { asyncHandler } from "./utils/asyncHandler";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ limit: "10mb", extended: true }));

app.get(
  "/",
  asyncHandler((req: Request, res: Response) => res.send("I'm alive"))
);

app.use("/users", userRoutes);
app.use("/categories", categoryRoutes);
app.use("/products", productRoutes);
app.use("/notifications", notificationRoutes);
app.use("/preorders", preOrderRoutes);
app.use("/historic", historicRoutes);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled Express error:", err);
  res.status(500).json({ error: "Internal server error" });
});

export const startServer = () => {
  return new Promise<void>((resolve, reject) => {
    app
      .listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        resolve();
      })
      .on("error", (err) => {
        console.error("Failed to start server:", err);
        reject(err);
      });
  });
};
