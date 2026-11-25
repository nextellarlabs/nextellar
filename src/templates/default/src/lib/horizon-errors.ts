import { decodeResultCodes, type DecodedResultCodes } from "./stellarResultCodes";

export type HorizonErrorKind =
  | "bad_request"
  | "not_found"
  | "rate_limited"
  | "server_error"
  | "client_error"
  | "network_error"
  | "result_code_error"
  | "unknown";

export interface HorizonResultCodes {
  transaction?: string;
  operations?: string[];
}

export interface ClassifiedHorizonError {
  kind: HorizonErrorKind;
  status?: number;
  message: string;
  userMessage: string;
  retryable: boolean;
  resultCodes?: HorizonResultCodes;
  decodedResultCodes?: DecodedResultCodes;
  raw?: unknown;
}

interface HorizonErrorShape {
  name?: string;
  message?: string;
  code?: string;
  status?: number;
  response?: {
    status?: number;
    data?: {
      status?: number;
      title?: string;
      detail?: string;
      extras?: {
        result_codes?: HorizonResultCodes;
      };
    };
  };
}

const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ERR_NETWORK",
]);

function isNetworkFailure(err: unknown, shape: HorizonErrorShape): boolean {
  if (shape.code && NETWORK_CODES.has(shape.code)) return true;
  if (err instanceof TypeError && /fetch|network/i.test(err.message)) return true;
  const msg = shape.message ?? "";
  return /\b(fetch|network|econnrefused|etimedout|enotfound|econnreset|socket hang up)\b/i.test(
    msg,
  );
}

/**
 * Classify any Horizon HTTP, result-code, or network error into a structured
 * error object with a typed `kind`, retryability hint, and user-facing message.
 */
export function classifyHorizonError(err: unknown): ClassifiedHorizonError {
  const shape: HorizonErrorShape =
    err && typeof err === "object" ? (err as HorizonErrorShape) : {};
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof shape.message === "string"
        ? shape.message
        : "";
  const status =
    shape.response?.status ?? shape.status ?? shape.response?.data?.status;
  const resultCodes = shape.response?.data?.extras?.result_codes;
  const raw = shape.response?.data;

  if (resultCodes) {
    const decoded = decodeResultCodes(resultCodes);
    return {
      kind: "result_code_error",
      status: status ?? 400,
      message: rawMessage || decoded.reason,
      userMessage: decoded.reason,
      retryable: false,
      resultCodes,
      decodedResultCodes: decoded,
      raw,
    };
  }

  if (status === 404 || shape.name === "NotFoundError") {
    return {
      kind: "not_found",
      status: 404,
      message: rawMessage || "Resource not found",
      userMessage: "Account or resource not found on Horizon. Account may need funding.",
      retryable: false,
      raw,
    };
  }

  if (status === 429) {
    return {
      kind: "rate_limited",
      status: 429,
      message: rawMessage || "Too Many Requests",
      userMessage: "Horizon rate limit exceeded. Please wait a moment and try again.",
      retryable: true,
      raw,
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      kind: "server_error",
      status,
      message: rawMessage,
      userMessage: "Horizon server error. Please try again shortly.",
      retryable: true,
      raw,
    };
  }

  if (status === 400) {
    return {
      kind: "bad_request",
      status: 400,
      message: rawMessage,
      userMessage: rawMessage || "Invalid request to Horizon.",
      retryable: false,
      raw,
    };
  }

  if (status !== undefined && status >= 400 && status < 500) {
    return {
      kind: "client_error",
      status,
      message: rawMessage,
      userMessage: rawMessage || `Invalid request to Horizon (Status: ${status}).`,
      retryable: false,
      raw,
    };
  }

  if (isNetworkFailure(err, shape)) {
    return {
      kind: "network_error",
      message: rawMessage || "Failed to connect to Horizon",
      userMessage: rawMessage || "Network error: Failed to connect to Horizon.",
      retryable: true,
      raw,
    };
  }

  return {
    kind: "unknown",
    message: rawMessage || "Unknown Horizon error",
    userMessage: rawMessage || "An unexpected Horizon error occurred.",
    retryable: false,
    raw,
  };
}
