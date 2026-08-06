import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type StellarAccountData = {
  id: string;
  sequence: string;
  domain?: string;
  lastModified: string;
};

type PublicProfile = {
  id: string;
  displayName?: string;
  domain?: string;
  sequence: string;
  lastModified: string;
};

const onChainAccounts = new Map<string, StellarAccountData>();
const offChainDisplayNames = new Map<string, string>();

function isValidStellarAccountId(id: string): boolean {
  return typeof id === "string" && id.length === 56 && id.startsWith("G");
}

router.get(
  "/accounts/:id/profile",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.params.id as string;

      if (!isValidStellarAccountId(id)) {
        sendError(res, "INVALID_ACCOUNT_ID", "The provided account ID is not a valid Stellar public key", 400);
        return;
      }

      const account = onChainAccounts.get(id);
      if (!account) {
        sendError(res, "ACCOUNT_NOT_FOUND", "No account found for the provided Stellar account ID", 404);
        return;
      }

      const profile: PublicProfile = {
        id: account.id,
        sequence: account.sequence,
        lastModified: account.lastModified,
      };

      if (account.domain) {
        profile.domain = account.domain;
      }

      const displayName = offChainDisplayNames.get(id);
      if (displayName) {
        profile.displayName = displayName;
      }

      return res.status(200).json({ success: true, data: profile });
    } catch (err) {
      return next(err);
    }
  },
);

const KNOWN_ACCOUNTS: StellarAccountData[] = [
  {
    id: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNZ",
    sequence: "1234567",
    domain: "example.com",
    lastModified: "2024-06-01T12:00:00Z",
  },
  {
    id: "GBRP6K5FQ4U3YNC6XKX5XVH6F5GX5X5X5X5X5X5X5X5X5X5X5X5X5X5X",
    sequence: "8901234",
    lastModified: "2024-07-15T08:30:00Z",
  },
];

for (const account of KNOWN_ACCOUNTS) {
  onChainAccounts.set(account.id, account);
}

export function __resetAccounts(): void {
  onChainAccounts.clear();
  offChainDisplayNames.clear();
  for (const account of KNOWN_ACCOUNTS) {
    onChainAccounts.set(account.id, account);
  }
}

export function __seedAccount(account: StellarAccountData): void {
  onChainAccounts.set(account.id, account);
}

export function __setDisplayName(accountId: string, displayName: string): void {
  offChainDisplayNames.set(accountId, displayName);
}

export function __getOnChainAccounts(): Map<string, StellarAccountData> {
  return onChainAccounts;
}

export default router;
