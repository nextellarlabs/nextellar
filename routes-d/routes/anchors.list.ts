import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type SupportedFlow = "deposit" | "withdrawal" | "both";

type Anchor = {
  id: string;
  name: string;
  homeDomain: string;
  supportedFlow: SupportedFlow;
  region: string;
  assets: string[];
  sep24Supported: boolean;
};

const VALID_FLOWS: SupportedFlow[] = ["deposit", "withdrawal", "both"];
const VALID_REGIONS = ["global", "us", "eu", "ap", "latam", "africa"];

// Curated anchor config — refreshed in production via a periodic background job.
// In this in-memory implementation the store is seeded at startup and can be
// replaced via __seedAnchorList for tests.
let anchorList: Anchor[] = [
  {
    id: "anchor-circle",
    name: "Circle",
    homeDomain: "circle.com",
    supportedFlow: "both",
    region: "global",
    assets: ["USDC"],
    sep24Supported: true,
  },
  {
    id: "anchor-stronghold",
    name: "Stronghold",
    homeDomain: "stronghold.co",
    supportedFlow: "both",
    region: "global",
    assets: ["SHx", "USDC"],
    sep24Supported: true,
  },
  {
    id: "anchor-cowrie",
    name: "Cowrie",
    homeDomain: "cowrie.exchange",
    supportedFlow: "both",
    region: "africa",
    assets: ["NGN", "USDC"],
    sep24Supported: true,
  },
  {
    id: "anchor-vibrant",
    name: "Vibrant",
    homeDomain: "vibrantapp.com",
    supportedFlow: "deposit",
    region: "latam",
    assets: ["USDC"],
    sep24Supported: true,
  },
  {
    id: "anchor-mykobo",
    name: "MyKobo",
    homeDomain: "mykobo.co",
    supportedFlow: "both",
    region: "eu",
    assets: ["EURC"],
    sep24Supported: true,
  },
];

export function __resetAnchorList(): void {
  anchorList = [];
}

export function __seedAnchorList(anchors: Anchor[]): void {
  anchorList = anchors;
}

export function __getAnchorList(): Anchor[] {
  return [...anchorList];
}

router.get("/anchors", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flow = req.query.flow as string | undefined;
    const region = req.query.region as string | undefined;

    if (flow !== undefined && !VALID_FLOWS.includes(flow as SupportedFlow)) {
      sendError(
        res,
        "INVALID_FLOW_FILTER",
        `flow must be one of: ${VALID_FLOWS.join(", ")}`,
        400,
      );
      return;
    }

    if (region !== undefined && !VALID_REGIONS.includes(region)) {
      sendError(
        res,
        "INVALID_REGION_FILTER",
        `region must be one of: ${VALID_REGIONS.join(", ")}`,
        400,
      );
      return;
    }

    let results = [...anchorList];

    if (flow) {
      results = results.filter(
        (a) => a.supportedFlow === flow || a.supportedFlow === "both",
      );
    }

    if (region) {
      results = results.filter(
        (a) => a.region === region || a.region === "global",
      );
    }

    return res.status(200).json({
      success: true,
      data: results,
      total: results.length,
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
