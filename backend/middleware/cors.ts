import { Request, Response, NextFunction } from "express";

const DEFAULT_ALLOWED_HEADERS = "Content-Type, Authorization";
const DEFAULT_ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";

function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export function corsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestOrigin = req.header("Origin");

  if (!requestOrigin) {
    next();
    return;
  }

  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  if (!allowedOrigins.has(requestOrigin)) {
    res.status(403).json({ success: false, message: "Origin not allowed" });
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", DEFAULT_ALLOWED_METHODS);
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.header("Access-Control-Request-Headers") ?? DEFAULT_ALLOWED_HEADERS,
  );
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}

export default corsMiddleware;
