import { Router, Request, Response } from "express";
import { sendError } from "../lib/response.js";
import {
  formatCurrency,
  isValidCurrencyCode,
  CurrencyFormatOptions,
} from "../lib/currencyFormatter.js";

const router = Router();

/**
 * Currency formatting request handler helper.
 */
function handleFormatCurrency(req: Request, res: Response) {
  try {
    const params = { ...(req.query || {}), ...(req.body || {}) };
    const { amount, currency, locale, decimals, minDecimals, maxDecimals, useSymbol } = params;

    if (amount === undefined || amount === null || amount === "") {
      sendError(res, "VALIDATION_ERROR", "Field 'amount' is required", 400);
      return;
    }

    if (!currency) {
      sendError(res, "VALIDATION_ERROR", "Field 'currency' is required", 400);
      return;
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || !isFinite(numAmount)) {
      sendError(res, "INVALID_AMOUNT", "Field 'amount' must be a valid number", 400);
      return;
    }

    if (!isValidCurrencyCode(String(currency))) {
      sendError(
        res,
        "UNKNOWN_CURRENCY",
        `Unknown or unsupported currency code: '${currency}'`,
        400
      );
      return;
    }

    const options: CurrencyFormatOptions = {};
    if (decimals !== undefined && decimals !== "") {
      const parsed = parseInt(String(decimals), 10);
      if (!isNaN(parsed) && parsed >= 0) options.decimals = parsed;
    }
    if (minDecimals !== undefined && minDecimals !== "") {
      const parsed = parseInt(String(minDecimals), 10);
      if (!isNaN(parsed) && parsed >= 0) options.minDecimals = parsed;
    }
    if (maxDecimals !== undefined && maxDecimals !== "") {
      const parsed = parseInt(String(maxDecimals), 10);
      if (!isNaN(parsed) && parsed >= 0) options.maxDecimals = parsed;
    }
    if (useSymbol !== undefined) {
      options.useSymbol = useSymbol === "true" || useSymbol === true;
    }

    const result = formatCurrency(
      numAmount,
      String(currency),
      locale ? String(locale) : "en-US",
      options
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Formatting error";
    if (message.includes("currency code")) {
      sendError(res, "UNKNOWN_CURRENCY", message, 400);
      return;
    }
    sendError(res, "FORMAT_ERROR", message, 400);
  }
}

/**
 * GET /format/currency
 * POST /format/currency
 * Format amounts for display per locale and currency.
 */
router.get("/format/currency", handleFormatCurrency);
router.post("/format/currency", handleFormatCurrency);

export default router;
