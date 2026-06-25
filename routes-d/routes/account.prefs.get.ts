import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type Theme = "light" | "dark" | "system";
type Currency = "USD" | "EUR" | "XLM";
type Language = "en" | "fr" | "es" | "de";

type Preferences = {
  theme: Theme;
  currency: Currency;
  language: Language;
  notificationsEnabled: boolean;
};

const DEFAULT_PREFS: Preferences = {
  theme: "system",
  currency: "USD",
  language: "en",
  notificationsEnabled: true,
};

// Per-user preferences store — isolated from account.prefs.update.ts which is
// a single-user global store with no auth. This route is per-user with auth.
const prefsStore = new Map<string, Preferences>();

/**
 * GET /account/preferences
 * Return the authenticated user's preferences, applying defaults when none exist.
 */
router.get(
  "/account/preferences",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "Authentication required", 401);
        return;
      }

      const userPrefs = prefsStore.get(userId) ?? { ...DEFAULT_PREFS };

      return res.status(200).json({
        success: true,
        data: { preferences: { ...userPrefs } },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export function __resetPrefs(): void {
  prefsStore.clear();
}

export function __seedPrefs(userId: string, prefs: Preferences): void {
  prefsStore.set(userId, prefs);
}

export function __getPrefs(): Map<string, Preferences> {
  return prefsStore;
}

export default router;
