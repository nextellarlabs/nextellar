import { v } from "../lib/validators.js";

export const streamResponseValidator = v.object({
  type: v.string(), sequence: v.number(), closeTime: v.string("date-time"), txCount: v.number(),
}, ["type", "sequence", "closeTime", "txCount"]);
