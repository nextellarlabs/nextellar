import { Router, Request, Response, NextFunction } from "express";

const router = Router();

export type LinkedAccount = {
  id: string;
  type: "wallet" | "identity";
  label: string;
  lastUsedAt: string;
};

let accounts: LinkedAccount[] = [];

export function __resetAccounts(): void {
  accounts = [];
}

export function __seedAccounts(items: LinkedAccount[]): void {
  accounts = [...items];
}

router.get("/account/connected", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const sorted = [...accounts].sort(
      (a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
    );

    const result = sorted.map(({ id, type, label }) => ({ id, type, label }));

    return res.status(200).json({ success: true, data: { accounts: result } });
  } catch (err) {
    return next(err);
  }
});

export default router;
