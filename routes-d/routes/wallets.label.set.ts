/**
 * POST /wallets/label
 * Renames a linked wallet for Nextellar account organisation.
 */

export const LABEL_MAX_LENGTH = 50;

export interface SetWalletLabelRequest {
  walletId: string;
  label: string;
  ownerId: string;
}

export interface SetWalletLabelResponse {
  walletId: string;
  label: string;
  updatedAt: string;
}

export interface WalletLabelAuditEvent {
  type: "wallet.label.set";
  walletId: string;
  ownerId: string;
  label: string;
  timestamp: string;
}

export class WalletLabelError extends Error {
  constructor(
    message: string,
    public readonly code: "UNAUTHORIZED" | "LABEL_TOO_LONG" | "INVALID_INPUT",
  ) {
    super(message);
    this.name = "WalletLabelError";
  }
}

function validateRequest(req: SetWalletLabelRequest): void {
  if (!req.walletId || typeof req.walletId !== "string") {
    throw new WalletLabelError("walletId is required", "INVALID_INPUT");
  }
  if (!req.ownerId || typeof req.ownerId !== "string") {
    throw new WalletLabelError("ownerId is required", "INVALID_INPUT");
  }
  if (!req.label || typeof req.label !== "string" || req.label.trim().length === 0) {
    throw new WalletLabelError("label is required", "INVALID_INPUT");
  }
  if (req.label.length > LABEL_MAX_LENGTH) {
    throw new WalletLabelError(
      `label must not exceed ${LABEL_MAX_LENGTH} characters`,
      "LABEL_TOO_LONG",
    );
  }
}

/**
 * Checks that ownerId actually owns walletId.
 * Stub — replace with a real ownership lookup (DB / on-chain check).
 */
async function assertOwnership(walletId: string, ownerId: string): Promise<void> {
  // TODO: query wallet store and confirm wallet.ownerId === ownerId
  if (!walletId || !ownerId) {
    throw new WalletLabelError("Unauthorized: wallet does not belong to this account", "UNAUTHORIZED");
  }
}

/**
 * Persists the label and emits an audit event.
 * Stub — replace with a real store write + event bus publish.
 */
async function persistLabel(
  req: SetWalletLabelRequest,
): Promise<SetWalletLabelResponse> {
  const updatedAt = new Date().toISOString();

  // TODO: atomically write label to wallet store
  // await walletStore.update({ id: req.walletId }, { label: req.label, updatedAt });

  const event: WalletLabelAuditEvent = {
    type: "wallet.label.set",
    walletId: req.walletId,
    ownerId: req.ownerId,
    label: req.label,
    timestamp: updatedAt,
  };

  // TODO: publish event to audit bus
  // await auditBus.emit(event);
  void event;

  return { walletId: req.walletId, label: req.label, updatedAt };
}

/**
 * Route handler: POST /wallets/label
 */
export async function setWalletLabel(
  req: SetWalletLabelRequest,
): Promise<SetWalletLabelResponse> {
  validateRequest(req);
  await assertOwnership(req.walletId, req.ownerId);
  return persistLabel(req);
}
