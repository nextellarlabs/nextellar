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

const VALID_THEMES: Theme[] = ["light", "dark", "system"];
const VALID_CURRENCIES: Currency[] = ["USD", "EUR", "XLM"];
const VALID_LANGUAGES: Language[] = ["en", "fr", "es", "de"];

let prefs: Preferences = {
  theme: "system",
  currency: "USD",
  language: "en",
  notificationsEnabled: true,
};

export function __resetPrefs(): void {
  prefs = {
    theme: "system",
    currency: "USD",
    language: "en",
    notificationsEnabled: true,
  };
}

export function __getPrefs(): Preferences {
  return { ...prefs };
}

type PrefsUpdate = Partial<Preferences>;

function validateUpdate(body: PrefsUpdate): string | null {
  if (body.theme !== undefined && !VALID_THEMES.includes(body.theme)) {
    return `theme must be one of: ${VALID_THEMES.join(", ")}`;
  }
  if (body.currency !== undefined && !VALID_CURRENCIES.includes(body.currency)) {
    return `currency must be one of: ${VALID_CURRENCIES.join(", ")}`;
  }
  if (body.language !== undefined && !VALID_LANGUAGES.includes(body.language)) {
    return `language must be one of: ${VALID_LANGUAGES.join(", ")}`;
  }
  if (
    body.notificationsEnabled !== undefined &&
    typeof body.notificationsEnabled !== "boolean"
  ) {
    return "notificationsEnabled must be a boolean";
  }
  return null;
}

router.patch("/account/preferences", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as PrefsUpdate;

    const fields: Array<keyof Preferences> = ["theme", "currency", "language", "notificationsEnabled"];
    const provided = fields.filter((k) => body[k] !== undefined);

    if (provided.length === 0) {
      return res.status(200).json({
        success: true,
        data: { preferences: { ...prefs }, updated: false },
      });
    }

    const validationError = validateUpdate(body);
    if (validationError) {
      sendError(res, "INVALID_PREFERENCE_VALUE", validationError, 400);
      return;
    }

    const noop = provided.every((k) => (body[k] as unknown) === (prefs[k] as unknown));
    if (noop) {
      return res.status(200).json({
        success: true,
        data: { preferences: { ...prefs }, updated: false },
      });
    }

    prefs = { ...prefs, ...Object.fromEntries(provided.map((k) => [k, body[k]])) } as Preferences;

    return res.status(200).json({
      success: true,
      data: { preferences: { ...prefs }, updated: true },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
