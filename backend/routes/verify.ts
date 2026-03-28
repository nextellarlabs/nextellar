import { Router, Request, Response, NextFunction } from "express";

const router = Router();

type VerifyDependencies = {
  onVerificationFailure: (code: string) => Promise<void>;
};

export const verifyDeps: VerifyDependencies = {
  onVerificationFailure: async (code: string) => {
    void code;
  },
};

router.post(
  "/verify",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code =
        typeof req.body?.code === "string" ? req.body.code.trim() : "";
      const storedCode =
        typeof req.body?.storedCode === "string"
          ? req.body.storedCode.trim()
          : "";

      if (!code || !storedCode) {
        return res.status(400).json({
          verified: false,
          message: "code and storedCode are required",
        });
      }

      if (code === storedCode) {
        return res.status(200).json({ verified: true });
      }

      await verifyDeps.onVerificationFailure(code);
      return res.status(401).json({ verified: false });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
