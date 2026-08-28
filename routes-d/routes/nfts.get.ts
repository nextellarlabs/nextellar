import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type TraitAttribute = {
  trait_type: string;
  value: string;
};

type DisplayMetadata = {
  name: string;
  image?: string;
  description?: string;
  attributes?: TraitAttribute[];
};

type NftRecord = {
  id: string;
  tokenId: string;
  collectionId: string;
  ownerUserId: string;
  acquiredAt: string;
  onChainData?: Record<string, unknown>;
  displayMetadata?: DisplayMetadata;
};

type NftResponse = Omit<NftRecord, "displayMetadata"> & {
  displayMetadata: DisplayMetadata | null;
};

const CACHE_TTL_MS = 30_000;

const nftStore = new Map<string, NftRecord>();
const responseCache = new Map<string, { data: NftResponse; ts: number }>();

export function __seedNft(id: string, record: NftRecord): void {
  nftStore.set(id, record);
  responseCache.delete(id);
}

export function __resetNftGet(): void {
  nftStore.clear();
  responseCache.clear();
}

router.get("/nfts/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const now = Date.now();
    const cached = responseCache.get(id);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return res.status(200).json({ success: true, data: cached.data, fromCache: true });
    }

    const record = nftStore.get(id);
    if (!record) {
      sendError(res, "NFT_NOT_FOUND", `NFT ${id} not found`, 404);
      return;
    }

    const assembled: NftResponse = {
      id:            record.id,
      tokenId:       record.tokenId,
      collectionId:  record.collectionId,
      ownerUserId:   record.ownerUserId,
      acquiredAt:    record.acquiredAt,
      onChainData:   record.onChainData,
      displayMetadata: record.displayMetadata ?? null,
    };

    responseCache.set(id, { data: assembled, ts: now });

    return res.status(200).json({ success: true, data: assembled, fromCache: false });
  } catch (err) {
    return next(err);
  }
});

export default router;
