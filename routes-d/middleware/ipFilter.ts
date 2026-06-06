import type { NextFunction, Request, Response } from "express";

export type IpFilterConfig = {
  allowlist: string[];
  blocklist: string[];
};

type Logger = (event: { message: string; ip: string }) => void;

type IpFilterOptions = {
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  signal?: NodeJS.Signals;
};

type Cidr = { network: number; maskBits: number };

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
}

function parseCidr(cidr: string): Cidr | null {
  const [ip, bitsRaw] = cidr.split("/");
  const ipInt = ipv4ToInt(ip);
  const bits = Number(bitsRaw);
  if (ipInt === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  return { network: ipInt & mask, maskBits: bits };
}

function matchesCidr(ip: string, cidr: Cidr): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  const mask = cidr.maskBits === 0 ? 0 : (~((1 << (32 - cidr.maskBits)) - 1)) >>> 0;
  return (ipInt & mask) === cidr.network;
}

function redactIp(ip: string): string {
  const parts = ip.split(".");
  if (parts.length !== 4) return "redacted";
  return `${parts[0]}.${parts[1]}.x.x`;
}

function parseEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadIpFilterConfig(env: NodeJS.ProcessEnv = process.env): IpFilterConfig {
  return {
    allowlist: parseEnvList(env.ROUTES_D_ALLOWLIST_CIDRS),
    blocklist: parseEnvList(env.ROUTES_D_BLOCKLIST_CIDRS),
  };
}

export function createIpFilterMiddleware(options: IpFilterOptions = {}) {
  const env = options.env ?? process.env;
  const logger = options.logger ?? (() => undefined);
  let current = loadIpFilterConfig(env);

  const reload = () => {
    current = loadIpFilterConfig(env);
  };

  process.on(options.signal ?? "SIGHUP", reload);

  return function ipFilterMiddleware(req: Request, res: Response, next: NextFunction) {
    const rawIp = (req.ip || req.socket.remoteAddress || "").replace("::ffff:", "");
    const allowCidrs = current.allowlist.map(parseCidr).filter((v): v is Cidr => v !== null);
    const blockCidrs = current.blocklist.map(parseCidr).filter((v): v is Cidr => v !== null);

    const isBlocked = blockCidrs.some((cidr) => matchesCidr(rawIp, cidr));
    const isAllowed = allowCidrs.length === 0 || allowCidrs.some((cidr) => matchesCidr(rawIp, cidr));

    if (isBlocked || !isAllowed) {
      logger({ message: "ip_filtered", ip: redactIp(rawIp) });
      return res.status(403).json({ error: "ip_forbidden" });
    }

    return next();
  };
}
