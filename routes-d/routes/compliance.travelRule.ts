/**
 * routes-d/routes/compliance.travelRule.ts
 *
 * Travel Rule Data Exchange Endpoint
 * ────────────────────────────────────
 * Implements the FATF/Travel Rule protocol for sharing originator and
 * beneficiary information between partner Virtual Asset Service Providers
 * (VASPs).
 *
 * Routes
 * ──────
 *   POST /compliance/travel-rule/transfers
 *     Submit a new travel rule record for an outbound transfer.
 *     Sensitive PII fields are encrypted at rest using AES-256-GCM.
 *
 *   GET  /compliance/travel-rule/transfers/:transferId
 *     Fetch a previously submitted travel rule record.
 *     Sensitive PII is decrypted in the response.
 *
 * Both routes require mutual partner authentication via the `requirePartner`
 * middleware (X-Partner-Id / X-Partner-Sig / X-Partner-Ts headers).
 *
 * Encrypted fields (stored as EncryptedField objects)
 * ────────────────────────────────────────────────────
 *   originator.name, originator.accountNumber
 *   beneficiary.name, beneficiary.accountNumber
 */

import { Router, Request, Response, NextFunction } from 'express';
import { sendError } from '../lib/response.js';
import { encryptField, decryptField, isEncryptedField, type EncryptedField } from '../lib/crypto.js';
import { requirePartner, type PartnerRequest } from '../auth/mutualAuth.js';

const router = Router();

// ── In-memory store (replace with a real DB in production) ─────────────────

export interface PartyInfo {
  name: string | EncryptedField;
  accountNumber: string | EncryptedField;
  address?: string;
}

export interface TravelRuleRecord {
  transferId: string;
  createdAt: string;
  submittedBy: string;
  amount: number;
  asset: string;
  originator: PartyInfo;
  beneficiary: PartyInfo;
}

interface TravelRuleStore {
  [transferId: string]: TravelRuleRecord;
}

const store: TravelRuleStore = {};

// ── Exported for test resets ────────────────────────────────────────────────

/**
 * @internal – used only by tests to reset the in-memory store.
 */
export function __resetTravelRuleStore(): void {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
}

// ── Validation helpers ──────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

interface RawPartyInfo {
  name?: unknown;
  accountNumber?: unknown;
  address?: unknown;
}

function parsePartyInfo(raw: unknown, label: string): PartyInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as RawPartyInfo;

  if (!isNonEmptyString(p.name)) return null;
  if (!isNonEmptyString(p.accountNumber)) return null;

  return {
    name: p.name.trim(),
    accountNumber: p.accountNumber.trim(),
    ...(isNonEmptyString(p.address) && { address: p.address.trim() }),
  };
}

// ── Route: POST /compliance/travel-rule/transfers ──────────────────────────

/**
 * Submit a travel rule record for an outbound transfer.
 *
 * Request body:
 * {
 *   transferId    : string   – unique transfer reference (idempotency key)
 *   amount        : number   – transfer amount (positive)
 *   asset         : string   – asset code (e.g. "USDC")
 *   originator    : { name, accountNumber, address? }
 *   beneficiary   : { name, accountNumber, address? }
 * }
 */
router.post(
  '/compliance/travel-rule/transfers',
  requirePartner as (req: Request, res: Response, next: NextFunction) => void,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const partnerId = (req as PartnerRequest).partnerId!;
      const body = req.body as Record<string, unknown>;

      // ── Input validation ─────────────────────────────────────────────

      if (!isNonEmptyString(body.transferId)) {
        sendError(res, 'VALIDATION_ERROR', 'transferId is required', 400);
        return;
      }
      if (!isPositiveNumber(body.amount)) {
        sendError(res, 'VALIDATION_ERROR', 'amount must be a positive number', 400);
        return;
      }
      if (!isNonEmptyString(body.asset)) {
        sendError(res, 'VALIDATION_ERROR', 'asset is required', 400);
        return;
      }

      const originator = parsePartyInfo(body.originator, 'originator');
      if (!originator) {
        sendError(res, 'VALIDATION_ERROR', 'originator must include name and accountNumber', 400);
        return;
      }

      const beneficiary = parsePartyInfo(body.beneficiary, 'beneficiary');
      if (!beneficiary) {
        sendError(res, 'VALIDATION_ERROR', 'beneficiary must include name and accountNumber', 400);
        return;
      }

      const transferId = (body.transferId as string).trim();

      // ── Idempotency ──────────────────────────────────────────────────

      if (store[transferId]) {
        res.status(200).json({
          success: true,
          data: redact(store[transferId]),
          meta: { duplicate: true },
        });
        return;
      }

      // ── Encrypt sensitive PII fields ─────────────────────────────────

      const record: TravelRuleRecord = {
        transferId,
        createdAt: new Date().toISOString(),
        submittedBy: partnerId,
        amount: body.amount as number,
        asset: (body.asset as string).trim().toUpperCase(),
        originator: {
          ...originator,
          name: encryptField(originator.name as string),
          accountNumber: encryptField(originator.accountNumber as string),
        },
        beneficiary: {
          ...beneficiary,
          name: encryptField(beneficiary.name as string),
          accountNumber: encryptField(beneficiary.accountNumber as string),
        },
      };

      store[transferId] = record;

      res.status(201).json({
        success: true,
        data: {
          transferId: record.transferId,
          createdAt: record.createdAt,
          submittedBy: record.submittedBy,
          amount: record.amount,
          asset: record.asset,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── Route: GET /compliance/travel-rule/transfers/:transferId ───────────────

/**
 * Fetch a submitted travel rule record by transferId.
 * PII fields are decrypted in the response.
 */
router.get(
  '/compliance/travel-rule/transfers/:transferId',
  requirePartner as (req: Request, res: Response, next: NextFunction) => void,
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const rawParam = req.params['transferId'];
      const transferId = Array.isArray(rawParam) ? rawParam[0] : rawParam;

      if (!transferId || String(transferId).trim() === '') {
        sendError(res, 'VALIDATION_ERROR', 'transferId path parameter is required', 400);
        return;
      }

      const record = store[String(transferId)];
      if (!record) {
        sendError(res, 'NOT_FOUND', `Travel rule record not found: ${transferId}`, 404);
        return;
      }

      // ── Decrypt PII for the response ─────────────────────────────────

      res.status(200).json({
        success: true,
        data: decrypt(record),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns a shallow copy of the record with PII fields decrypted.
 */
function decrypt(record: TravelRuleRecord): Record<string, unknown> {
  const decryptParty = (party: PartyInfo): Record<string, unknown> => ({
    ...party,
    name: isEncryptedField(party.name) ? decryptField(party.name) : party.name,
    accountNumber: isEncryptedField(party.accountNumber)
      ? decryptField(party.accountNumber)
      : party.accountNumber,
  });

  return {
    transferId: record.transferId,
    createdAt: record.createdAt,
    submittedBy: record.submittedBy,
    amount: record.amount,
    asset: record.asset,
    originator: decryptParty(record.originator),
    beneficiary: decryptParty(record.beneficiary),
  };
}

/**
 * Returns a representation suitable for the idempotent-duplicate response:
 * PII fields are redacted (not returned) to avoid leaking decrypted data
 * in the 200 re-submission response.
 */
function redact(record: TravelRuleRecord): Record<string, unknown> {
  return {
    transferId: record.transferId,
    createdAt: record.createdAt,
    submittedBy: record.submittedBy,
    amount: record.amount,
    asset: record.asset,
  };
}

export default router;
