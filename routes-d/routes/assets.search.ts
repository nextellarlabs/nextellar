import { Router, Request, Response, NextFunction } from "express";
import { searchAssetDirectory } from "../lib/assetDirectory.js";
import { sendError } from "../lib/response.js";

const router = Router();

router.get("/assets/search", (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";

    if (!query.trim()) {
      sendError(res, "QUERY_REQUIRED", "The q query parameter is required", 400);
      return;
    }

    const results = searchAssetDirectory(query, 10);
    return res.status(200).json({ success: true, data: results });
  } catch (error) {
    return next(error);
  }
});

export default router;
