import { NextFunction, Request, Response } from "express";

export type MaintenanceConfig = {
  enabled: boolean;
  allowlist: string[];
  retryAfterSeconds: number;
};

const DEFAULT_RETRY_AFTER_SECONDS = 60;

let maintenanceConfig: MaintenanceConfig = {
  enabled: false,
  allowlist: [],
  retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
};

function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }

  const trimmed = path.trim();
  if (!trimmed) {
    return "/";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isAllowlisted(path: string): boolean {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === "/admin/maintenance" || normalizedPath.startsWith("/admin/maintenance/")) {
    return true;
  }

  return maintenanceConfig.allowlist.some((entry) => normalizePath(entry) === normalizedPath);
}

export function setMaintenanceMode(config: Partial<MaintenanceConfig> | MaintenanceConfig): void {
  maintenanceConfig = {
    enabled: config.enabled ?? maintenanceConfig.enabled,
    allowlist: Array.isArray(config.allowlist) ? config.allowlist : maintenanceConfig.allowlist,
    retryAfterSeconds:
      typeof config.retryAfterSeconds === "number"
        ? config.retryAfterSeconds
        : maintenanceConfig.retryAfterSeconds,
  };
}

export function getMaintenanceConfig(): MaintenanceConfig {
  return {
    enabled: maintenanceConfig.enabled,
    allowlist: [...maintenanceConfig.allowlist],
    retryAfterSeconds: maintenanceConfig.retryAfterSeconds,
  };
}

export function __resetMaintenanceState(): void {
  maintenanceConfig = {
    enabled: false,
    allowlist: [],
    retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
  };
}

export function maintenanceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!maintenanceConfig.enabled) {
    next();
    return;
  }

  const requestPath = req.path || "/";
  if (isAllowlisted(requestPath)) {
    next();
    return;
  }

  res.setHeader("Retry-After", String(maintenanceConfig.retryAfterSeconds));
  res.status(503).json({
    error: {
      code: "MAINTENANCE_MODE",
      message: "Service temporarily unavailable due to maintenance.",
    },
  });
}

export default maintenanceMiddleware;
