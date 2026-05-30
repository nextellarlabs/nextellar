import { randomBytes } from 'crypto';
import type { Sep31TransactionRequest } from './sep31Validator.js';

export type Sep31TransactionStatus =
  | 'pending'
  | 'pending_user_info'
  | 'pending_trust'
  | 'pending_receiver'
  | 'pending_external'
  | 'completed'
  | 'error'
  | 'refunded'
  | 'expired';

export interface Sep31Transaction {
  id: string;
  status: Sep31TransactionStatus;
  request: Sep31TransactionRequest;
  createdAt: string;
  updatedAt: string;
  externalTransactionId?: string;
}

export interface SettlementWebhookPayload {
  transactionId: string;
  status: Sep31TransactionStatus;
  amount: string;
  assetCode: string;
  destinationAccount: string;
  confirmedAt: string;
}

export type SettlementWebhookDispatcher = (
  payload: SettlementWebhookPayload,
) => Promise<void>;

export const sep31Deps = {
  dispatchSettlementWebhook: async (_payload: SettlementWebhookPayload): Promise<void> => {},
};

export class Sep31TransactionStore {
  private transactions = new Map<string, Sep31Transaction>();

  create(request: Sep31TransactionRequest): Sep31Transaction {
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const tx: Sep31Transaction = {
      id,
      status: 'pending',
      request,
      createdAt: now,
      updatedAt: now,
    };
    this.transactions.set(id, tx);
    return tx;
  }

  get(id: string): Sep31Transaction | undefined {
    return this.transactions.get(id);
  }

  updateStatus(id: string, status: Sep31TransactionStatus): Sep31Transaction | undefined {
    const tx = this.transactions.get(id);
    if (!tx) {
      return undefined;
    }
    tx.status = status;
    tx.updatedAt = new Date().toISOString();
    return tx;
  }

  confirm(id: string): Sep31Transaction | undefined {
    return this.updateStatus(id, 'completed');
  }

  clear(): void {
    this.transactions.clear();
  }
}

export const sep31TransactionStore = new Sep31TransactionStore();

export async function emitSettlementWebhook(transaction: Sep31Transaction): Promise<void> {
  if (transaction.status !== 'completed') {
    return;
  }

  await sep31Deps.dispatchSettlementWebhook({
    transactionId: transaction.id,
    status: transaction.status,
    amount: transaction.request.amount,
    assetCode: transaction.request.asset_code,
    destinationAccount: transaction.request.destination_account,
    confirmedAt: transaction.updatedAt,
  });
}
