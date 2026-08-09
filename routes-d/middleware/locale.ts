import type { Request, Response, NextFunction } from "express";

export const DEFAULT_SUPPORTED_LOCALES: string[] = ["en", "es", "fr", "de", "pt"];
export const DEFAULT_LOCALE: string = "en";

declare global {
  namespace Express {
    interface Request {
      locale?: string;
      context?: {
        locale?: string;
        [key: string]: unknown;
      };
    }
  }
}

export interface LocaleMiddlewareOptions {
  supportedLocales?: string[];
  defaultLocale?: string;
}

export interface ParsedLanguage {
  code: string;
  base: string;
  quality: number;
}

/**
 * Parses an Accept-Language header string into a list of weighted language preferences,
 * ordered by quality factor descending. Gracefully ignores malformed tokens.
 */
export function parseAcceptLanguageHeader(header: string | undefined): ParsedLanguage[] {
  if (!header || typeof header !== "string") {
    return [];
  }

  const results: ParsedLanguage[] = [];
  const parts = header.split(",");

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const [langPart, ...paramParts] = trimmed.split(";");
    const code = langPart.trim().toLowerCase();
    if (!code) continue;

    const base = code.split("-")[0];
    let quality = 1.0;

    for (const param of paramParts) {
      const [key, value] = param.split("=").map((s) => s.trim());
      if (key === "q" && value) {
        const parsedQ = parseFloat(value);
        if (!isNaN(parsedQ) && parsedQ >= 0 && parsedQ <= 1) {
          quality = parsedQ;
        }
      }
    }

    if (quality > 0) {
      results.push({ code, base, quality });
    }
  }

  // Sort by quality descending
  results.sort((a, b) => b.quality - a.quality);

  return results;
}

/**
 * Negotiates the best matching locale from a supported list based on an Accept-Language header.
 */
export function negotiateLocale(
  header: string | undefined,
  supportedLocales: string[] = DEFAULT_SUPPORTED_LOCALES,
  defaultLocale: string = DEFAULT_LOCALE,
): string {
  const supportedLower = supportedLocales.map((l) => l.toLowerCase());
  const parsedLanguages = parseAcceptLanguageHeader(header);

  for (const lang of parsedLanguages) {
    if (lang.code === "*") {
      return supportedLocales[0] || defaultLocale;
    }

    // 1. Exact match (e.g. en-us -> en-us)
    const exactIndex = supportedLower.indexOf(lang.code);
    if (exactIndex !== -1) {
      return supportedLocales[exactIndex];
    }

    // 2. Base language match (e.g. es-mx -> es)
    const baseIndex = supportedLower.indexOf(lang.base);
    if (baseIndex !== -1) {
      return supportedLocales[baseIndex];
    }
  }

  return defaultLocale;
}

/**
 * Express middleware for locale negotiation.
 * Attaches negotiated locale to req.locale and req.context.locale.
 */
export function localeMiddleware(options: LocaleMiddlewareOptions = {}) {
  const supported = options.supportedLocales || DEFAULT_SUPPORTED_LOCALES;
  const defaultLoc = options.defaultLocale || DEFAULT_LOCALE;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const acceptLanguageHeader = req.headers["accept-language"] as string | undefined;
    const resolvedLocale = negotiateLocale(acceptLanguageHeader, supported, defaultLoc);

    req.locale = resolvedLocale;
    req.context = {
      ...req.context,
      locale: resolvedLocale,
    };

    next();
  };
}

export default localeMiddleware;
