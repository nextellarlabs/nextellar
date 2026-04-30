import { Router, Request, Response, NextFunction } from "express";

const router = Router();

export const MAX_SUBJECT_LENGTH = 200;
export const MAX_MESSAGE_LENGTH = 5000;

/**
 * POST /
 * Submits user feedback. Free-text fields are length-limited before any persistence.
 */
router.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { subject, message } = (req.body ?? {}) as {
        subject?: unknown;
        message?: unknown;
      };

      if (typeof subject !== "string") {
        res.status(400).json({ error: "subject must be a string" });
        return;
      }
      if (typeof message !== "string") {
        res.status(400).json({ error: "message must be a string" });
        return;
      }

      const subjectTrimmed = subject.trim();
      const messageTrimmed = message.trim();

      if (subjectTrimmed.length === 0) {
        res.status(400).json({ error: "subject is required" });
        return;
      }
      if (messageTrimmed.length === 0) {
        res.status(400).json({ error: "message is required" });
        return;
      }

      if (subjectTrimmed.length > MAX_SUBJECT_LENGTH) {
        res.status(400).json({
          error: `subject exceeds maximum length of ${MAX_SUBJECT_LENGTH} characters`,
        });
        return;
      }
      if (messageTrimmed.length > MAX_MESSAGE_LENGTH) {
        res.status(400).json({
          error: `message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`,
        });
        return;
      }

      // Persistence / email would run here; omitted in this app shell.
      res.status(201).json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
