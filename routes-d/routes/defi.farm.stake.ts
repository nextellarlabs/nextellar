import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type FarmConfig = {
  farmId: string;
  name: string;
  protocol: string;
  asset: string;
  minimumStake: string;
  contractAddress: string;
};

type StakeBody = {
  farmId: string;
  accountId: string;
  amount: string;
};

const KNOWN_FARMS = new Map<string, FarmConfig>([
  [
    "phoenix-usdc-xlm",
    {
      farmId: "phoenix-usdc-xlm",
      name: "Phoenix USDC/XLM Farm",
      protocol: "Phoenix",
      asset: "USDC",
      minimumStake: "10.00",
      contractAddress: "CAPHOENIX1USDCXLMFARMCONTRACTADDRESS000001",
    },
  ],
  [
    "aqua-xlm",
    {
      farmId: "aqua-xlm",
      name: "Aqua XLM Farm",
      protocol: "Aqua",
      asset: "XLM",
      minimumStake: "100.00",
      contractAddress: "CAAQUA1XLMFARMCONTRACTADDRESS0000000000001",
    },
  ],
  [
    "soroswap-btc-xlm",
    {
      farmId: "soroswap-btc-xlm",
      name: "Soroswap BTC/XLM Farm",
      protocol: "Soroswap",
      asset: "BTC",
      minimumStake: "0.001",
      contractAddress: "CASOROSWAP1BTCXLMFARMCONTRACTADDRESS00001",
    },
  ],
]);

export function __resetFarms(): void {
  KNOWN_FARMS.set("phoenix-usdc-xlm", {
    farmId: "phoenix-usdc-xlm",
    name: "Phoenix USDC/XLM Farm",
    protocol: "Phoenix",
    asset: "USDC",
    minimumStake: "10.00",
    contractAddress: "CAPHOENIX1USDCXLMFARMCONTRACTADDRESS000001",
  });
  KNOWN_FARMS.set("aqua-xlm", {
    farmId: "aqua-xlm",
    name: "Aqua XLM Farm",
    protocol: "Aqua",
    asset: "XLM",
    minimumStake: "100.00",
    contractAddress: "CAAQUA1XLMFARMCONTRACTADDRESS0000000000001",
  });
  KNOWN_FARMS.set("soroswap-btc-xlm", {
    farmId: "soroswap-btc-xlm",
    name: "Soroswap BTC/XLM Farm",
    protocol: "Soroswap",
    asset: "BTC",
    minimumStake: "0.001",
    contractAddress: "CASOROSWAP1BTCXLMFARMCONTRACTADDRESS00001",
  });
}

export function __registerFarm(config: FarmConfig): void {
  KNOWN_FARMS.set(config.farmId, config);
}

export function __removeFarm(farmId: string): void {
  KNOWN_FARMS.delete(farmId);
}

function buildUnsignedEnvelope(farm: FarmConfig, accountId: string, amount: string): string {
  return [
    `AAAAAgAAAAA${accountId}AAAABAAAAAAAAAA`,
    `invoke_contract:${farm.contractAddress}`,
    `stake:${amount}:${farm.asset}`,
    `unsigned`,
  ].join("|");
}

router.post("/defi/farm/stake", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as StakeBody;

    if (!body.farmId || typeof body.farmId !== "string") {
      sendError(res, "INVALID_FARM_ID", "farmId is required", 400);
      return;
    }

    if (!body.accountId || typeof body.accountId !== "string") {
      sendError(res, "INVALID_ACCOUNT_ID", "accountId is required", 400);
      return;
    }

    if (!body.accountId.startsWith("G") || body.accountId.length !== 56) {
      sendError(
        res,
        "INVALID_ACCOUNT_ID",
        "accountId must be a valid Stellar public key (56 chars starting with G)",
        400,
      );
      return;
    }

    if (!body.amount || typeof body.amount !== "string") {
      sendError(res, "INVALID_AMOUNT", "amount is required and must be a string", 400);
      return;
    }

    const amountNum = parseFloat(body.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      sendError(res, "INVALID_AMOUNT", "amount must be a positive number", 400);
      return;
    }

    const farm = KNOWN_FARMS.get(body.farmId);
    if (!farm) {
      sendError(res, "UNKNOWN_FARM", `No yield farm found with id '${body.farmId}'`, 404);
      return;
    }

    const minStake = parseFloat(farm.minimumStake);
    if (amountNum < minStake) {
      sendError(
        res,
        "BELOW_MINIMUM_STAKE",
        `Minimum stake for ${farm.name} is ${farm.minimumStake} ${farm.asset}`,
        422,
      );
      return;
    }

    const envelope = buildUnsignedEnvelope(farm, body.accountId, body.amount);

    return res.status(201).json({
      success: true,
      data: {
        farmId: farm.farmId,
        farmName: farm.name,
        protocol: farm.protocol,
        asset: farm.asset,
        amount: body.amount,
        accountId: body.accountId,
        unsignedEnvelope: envelope,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
