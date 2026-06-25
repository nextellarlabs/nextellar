import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type NftMetadata = {
  name: string;
  description?: string;
  image: string;
  attributes?: Array<{ traitType: string; value: string | number | boolean }>;
};

type MintBody = {
  collectionId: string;
  recipient: string;
  metadata: NftMetadata;
  submit?: boolean;
};

type Collection = {
  id: string;
  contractId: string;
  authorizedMinters: Set<string>;
};

const collections = new Map<string, Collection>();
const mintedTransactions: Array<{ collectionId: string; recipient: string; tokenId: string }> = [];

function isValidStellarAddress(address: string): boolean {
  return typeof address === "string" && /^[GM][A-Z2-7]{55}$/.test(address);
}

function validateMetadata(metadata: NftMetadata | undefined): string | null {
  if (!metadata || typeof metadata !== "object") {
    return "metadata is required";
  }

  if (typeof metadata.name !== "string" || metadata.name.trim().length === 0 || metadata.name.length > 120) {
    return "metadata.name must be a non-empty string of at most 120 characters";
  }

  if (typeof metadata.image !== "string" || metadata.image.trim().length === 0) {
    return "metadata.image is required";
  }

  if (metadata.description !== undefined && typeof metadata.description !== "string") {
    return "metadata.description must be a string";
  }

  if (metadata.attributes !== undefined) {
    if (!Array.isArray(metadata.attributes)) {
      return "metadata.attributes must be an array";
    }

    const invalidAttribute = metadata.attributes.some((attribute) => (
      attribute === null ||
      typeof attribute !== "object" ||
      typeof attribute.traitType !== "string" ||
      attribute.traitType.trim().length === 0 ||
      !["string", "number", "boolean"].includes(typeof attribute.value)
    ));

    if (invalidAttribute) {
      return "metadata.attributes must contain traitType and primitive value entries";
    }
  }

  return null;
}

function createUnsignedEnvelope(collection: Collection, recipient: string, metadata: NftMetadata): string {
  const payload = `${collection.contractId}:${recipient}:${metadata.name}:${Date.now()}`;
  return Buffer.from(payload).toString("base64");
}

router.post("/nfts/mint", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const minterId = req.headers["x-minter-id"] as string | undefined;

    if (!minterId) {
      sendError(res, "UNAUTHORIZED", "x-minter-id header is required", 401);
      return;
    }

    const body = req.body as MintBody;

    if (!body.collectionId || typeof body.collectionId !== "string") {
      sendError(res, "MISSING_COLLECTION", "collectionId is required", 400);
      return;
    }

    const collection = collections.get(body.collectionId);
    if (!collection) {
      sendError(res, "COLLECTION_NOT_FOUND", "NFT collection was not found", 404);
      return;
    }

    if (!collection.authorizedMinters.has(minterId)) {
      sendError(res, "UNAUTHORIZED_MINTER", "Minter is not authorized for this collection", 403);
      return;
    }

    if (!isValidStellarAddress(body.recipient)) {
      sendError(res, "INVALID_RECIPIENT", "recipient must be a valid Stellar account or muxed address", 400);
      return;
    }

    const metadataError = validateMetadata(body.metadata);
    if (metadataError) {
      sendError(res, "INVALID_METADATA", metadataError, 400);
      return;
    }

    if (body.submit === true) {
      const tokenId = `nft_${body.collectionId}_${mintedTransactions.length + 1}`;
      const transactionId = `tx_${Buffer.from(`${tokenId}:${body.recipient}`).toString("hex").slice(0, 24)}`;
      mintedTransactions.push({ collectionId: body.collectionId, recipient: body.recipient, tokenId });

      return res.status(201).json({
        success: true,
        data: {
          transactionId,
          tokenId,
          submitted: true,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        unsignedEnvelope: createUnsignedEnvelope(collection, body.recipient, body.metadata),
        submitted: false,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export function __seedNftCollection(collection: { id: string; contractId: string; authorizedMinters: string[] }): void {
  collections.set(collection.id, {
    id: collection.id,
    contractId: collection.contractId,
    authorizedMinters: new Set(collection.authorizedMinters),
  });
}

export function __getMintedTransactions(): Array<{ collectionId: string; recipient: string; tokenId: string }> {
  return mintedTransactions;
}

export function __resetNftMint(): void {
  collections.clear();
  mintedTransactions.length = 0;
}

export default router;
