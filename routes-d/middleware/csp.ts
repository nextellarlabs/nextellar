import type { NextFunction, Request, Response } from "express";

type DirectiveMap = Record<string, string[]>;

type CspOptions = {
  reportOnly?: boolean;
  policy?: DirectiveMap;
  overrides?: Record<string, DirectiveMap>;
  routeMatcher?: (req: Request) => string;
};

const defaultPolicy: DirectiveMap = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "frame-ancestors": ["'none'"],
};

function serializePolicy(policy: DirectiveMap): string {
  return Object.entries(policy)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

export function createCspMiddleware(options: CspOptions = {}) {
  const base = options.policy ?? defaultPolicy;
  const matcher = options.routeMatcher ?? ((req: Request) => req.path);

  return function cspMiddleware(req: Request, res: Response, next: NextFunction) {
    const routeKey = matcher(req);
    const override = options.overrides?.[routeKey];
    const policy = override ?? base;

    const headerName = options.reportOnly
      ? "Content-Security-Policy-Report-Only"
      : "Content-Security-Policy";

    res.setHeader(headerName, serializePolicy(policy));
    return next();
  };
}
