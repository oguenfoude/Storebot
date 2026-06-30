import { Request, Response } from "express";
import { connectToDB } from "../db";
import { ComprehensiveHistory } from "../models/comprehensiveHistory";
import { ObjectId } from "mongodb";

export const getAllHistoricEntries = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const history = await db
      .collection<ComprehensiveHistory>("history")
      .find()
      .toArray();
    res.status(200).json(history);
  } catch (error) {
    console.error("Error fetching historic entries:", error);
    res.status(500).json({ error: "Failed to fetch historic entries" });
  }
};

export const getEntityHistoricEntries = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const { id, entity } = req.params;

    const historyEntries = await db
      .collection<ComprehensiveHistory>("history")
      .find({
        [`${entity}Id`]: new ObjectId(id),
      })
      .toArray();

    if (historyEntries.length === 0) {
      return res
        .status(404)
        .json({ error: `No historic entries found for ${entity}.` });
    }

    res.status(200).json(historyEntries);
  } catch (error) {
    console.error("Error fetching entity historic entries:", error);
    res.status(500).json({ error: "Failed to fetch entity historic entries." });
  }
};

export const deleteHistoricEntryById = async (req: Request, res: Response) => {
  try {
    const db = await connectToDB();
    const { id } = req.params;

    const result = await db
      .collection<ComprehensiveHistory>("history")
      .deleteOne({
        _id: new ObjectId(id),
      });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Historic entry not found" });
    }

    res.status(200).json({ message: "Historic entry deleted successfully" });
  } catch (error) {
    console.error("Error deleting historic entry:", error);
    res.status(500).json({ error: "Failed to delete historic entry" });
  }
};
