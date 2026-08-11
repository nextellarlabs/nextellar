import { Router, Request, Response, NextFunction } from "express";
import { getMaintenanceConfig, setMaintenanceMode } from "../middleware/maintenance.js";

const router = Router();

type MaintenancePayload = {
  enabled?: boolean;
  allowlist?: string[];
  retryAfterSeconds?: number;
};

function parsePayload(body: unknown): MaintenancePayload {
  if (!body || typeof body !== "object") {
    return {};
  }

  const candidate = body as Record<string, unknown>;
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : undefined,
    allowlist: Array.isArray(candidate.allowlist)
      ? candidate.allowlist.filter((item): item is string => typeof item === "string")
      : undefined,
    retryAfterSeconds:
      typeof candidate.retryAfterSeconds === "number"
        ? candidate.retryAfterSeconds
        : undefined,
  };
}

router.post(
  "/admin/maintenance",
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = parsePayload(req.body);
      const nextConfig = {
        enabled: payload.enabled ?? getMaintenanceConfig().enabled,
        allowlist: payload.allowlist ?? getMaintenanceConfig().allowlist,
        retryAfterSeconds:
          payload.retryAfterSeconds ?? getMaintenanceConfig().retryAfterSeconds,
      };

      setMaintenanceMode(nextConfig);

      return res.status(200).json({
        success: true,
        data: getMaintenanceConfig(),
      });
    } catch (error) {
      return next(error);
    }
  },
);

export { parsePayload };
export function __resetMaintenanceState(): void {
  setMaintenanceMode({ enabled: false, allowlist: [], retryAfterSeconds: 60 });
}

export default router;
