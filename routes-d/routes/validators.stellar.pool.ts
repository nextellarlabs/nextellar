import { v } from "../lib/validators.js";

export const depositRequestValidator = v.object({
  poolId: v.string(), assetA: v.string(), assetB: v.string(), amountA: v.string(), slippageTolerance: v.number(),
}, ["poolId", "assetA", "assetB", "amountA", "slippageTolerance"]);

export const depositResponseValidator = v.object({ success: v.boolean(), envelope: v.string(), message: v.string() }, ["success", "envelope", "message"]);

export const withdrawRequestValidator = v.object({ poolId: v.string(), shareAmount: v.string(), slippageTolerance: v.number() }, ["poolId", "shareAmount", "slippageTolerance"]);
export const withdrawResponseValidator = depositResponseValidator;
