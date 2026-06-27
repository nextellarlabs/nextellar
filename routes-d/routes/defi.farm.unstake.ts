import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

interface FarmPosition {
  userId: string;
  farmId: string;
  stakedAmount: number;
  asset: string;
}

const farmPositions = new Map<string, FarmPosition>();

function positionKey(userId: string, farmId: string): string {
  return `${userId}:${farmId}`;
}

export function __seedFarmPosition(position: FarmPosition): void {
  farmPositions.set(positionKey(position.userId, position.farmId), position);
}

export function __resetFarmPositions(): void {
  farmPositions.clear();
}

router.post(
  "/defi/farm/unstake",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.headers["x-user-id"] as string | undefined;
      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const { farmId, amount } = req.body as {
        farmId?: unknown;
        amount?: unknown;
      };

      if (!farmId || typeof farmId !== "string") {
        sendError(res, "INVALID_FARM_ID", "farmId is required and must be a string", 400);
        return;
      }

      const parsedAmount = Number(amount);
      if (!amount || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        sendError(res, "INVALID_AMOUNT", "amount must be a positive number", 400);
        return;
      }

      const key = positionKey(userId, farmId);
      const position = farmPositions.get(key);

      if (!position) {
        sendError(res, "NO_POSITION", "No staked position found for this farm", 404);
        return;
      }

      if (parsedAmount > position.stakedAmount) {
        sendError(
          res,
          "INSUFFICIENT_STAKE",
          `Cannot unstake ${parsedAmount}; only ${position.stakedAmount} is staked`,
          422,
        );
        return;
      }

      const remainingAmount = position.stakedAmount - parsedAmount;

      // Update position
      if (remainingAmount === 0) {
        farmPositions.delete(key);
      } else {
        farmPositions.set(key, { ...position, stakedAmount: remainingAmount });
      }

      const envelope = `Unsigned unstake envelope: ${parsedAmount} ${position.asset} from farm ${farmId}`;

      res.status(200).json({
        success: true,
        data: {
          farmId,
          unstakedAmount: parsedAmount,
          remainingStake: remainingAmount,
          asset: position.asset,
          envelope,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
