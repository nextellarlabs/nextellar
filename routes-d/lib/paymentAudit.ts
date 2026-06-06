import { createHash } from "crypto";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

/**
 * Payment audit log entry.
 * The `prevHash` links to the hash of the previous entry, forming a chain.
 */
export interface PaymentAuditEntry {
  id: string; // unique id
  timestamp: string; // ISO string
  initiator: string; // hashed identifier of who initiated
  asset: string; // asset code e.g. "XLM"
  amount: string; // string to avoid floating issues
  prevHash: string; // hash of previous entry (or "" for first)
}

// Configuration – can be overridden via env for testing
const LOG_DIR = process.env.PAYMENT_AUDIT_LOG_DIR || join(process.cwd(), "routes-d", "logs");
const LOG_FILE = join(LOG_DIR, "payment_audit.jsonl");
const PEPPER = process.env.PAYMENT_AUDIT_PEPPER || "nextellar-payment-audit-pepper-dev";

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function readAllEntries(): PaymentAuditEntry[] {
  ensureLogDir();
  if (!existsSync(LOG_FILE)) return [];
  const data = readFileSync(LOG_FILE, "utf-8");
  return data
    .split("\n")
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as PaymentAuditEntry);
}

function computeEntryHash(entry: Omit<PaymentAuditEntry, "prevHash"> & { prevHash: string }): string {
  // Deterministic JSON representation without whitespace
  const payload = JSON.stringify(entry);
  return createHash("sha256")
    .update(payload + PEPPER)
    .digest("hex");
}

/**
 * Append a new payment audit entry.
 * Returns the full entry including its computed prevHash.
 */
export function appendPaymentAudit(params: { initiator: string; asset: string; amount: string }): PaymentAuditEntry {
  ensureLogDir();
  const entries = readAllEntries();
  const prevEntry = entries.length ? entries[entries.length - 1] : null;
  const prevHash = prevEntry ? computeEntryHash(prevEntry) : "";
  const entry: PaymentAuditEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    timestamp: new Date().toISOString(),
    initiator: hashIdentifier(params.initiator),
    asset: params.asset,
    amount: params.amount,
    prevHash,
  };
  const line = JSON.stringify(entry) + "\n";
  writeFileSync(LOG_FILE, line, { flag: "a" });
  return entry;
}

/**
 * Verify the integrity of the audit log chain.
 * Returns true if every entry's prevHash matches the hash of the previous entry.
 */
export function verifyChain(): boolean {
  const entries = readAllEntries();
  for (let i = 1; i < entries.length; i++) {
    const expected = computeEntryHash({
      id: entries[i - 1].id,
      timestamp: entries[i - 1].timestamp,
      initiator: entries[i - 1].initiator,
      asset: entries[i - 1].asset,
      amount: entries[i - 1].amount,
      prevHash: entries[i - 1].prevHash,
    });
    if (entries[i].prevHash !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Simple hash of an identifier – callers should hash any sensitive data before storing.
 */
export function hashIdentifier(identifier: string): string {
  return createHash("sha256")
    .update(identifier + PEPPER)
    .digest("hex");
}

/**
 * Admin‑only query – filters can be added later.
 */
export function queryPaymentAudits(): PaymentAuditEntry[] {
  // In a real system this would enforce admin auth; placeholder here.
  return readAllEntries();
}
