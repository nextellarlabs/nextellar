import crypto from "node:crypto";

export type SequenceValue = string | number | bigint;

export interface SequenceReservation {
  reservationId: string;
  accountId: string;
  sequence: bigint;
  reservedAt: number;
  expiresAt: number;
  reason?: string;
}

export interface SequencePoolOptions {
  timeoutMs?: number;
  now?: () => number;
  reason?: string;
}

export class SequenceReservationError extends Error {
  readonly code = "SEQUENCE_RESERVED";

  constructor(
    public readonly accountId: string,
    public readonly sequence: bigint,
    public readonly expiresAt: number,
  ) {
    super(`Sequence ${sequence.toString()} is already reserved for account ${accountId}`);
    this.name = "SequenceReservationError";
  }
}

const DEFAULT_TIMEOUT_MS = Number(process.env.NEXTELLAR_SEQUENCE_RESERVATION_TIMEOUT_MS ?? 30_000);
const reservationsByAccount = new Map<string, Map<string, SequenceReservation>>();

function toBigIntSequence(value: SequenceValue): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
      throw new Error("Sequence must be a non-negative safe integer");
    }
    return BigInt(value);
  }

  if (!/^\d+$/.test(value)) {
    throw new Error("Sequence must contain only digits");
  }

  return BigInt(value);
}

function accountReservations(accountId: string): Map<string, SequenceReservation> {
  let reservations = reservationsByAccount.get(accountId);
  if (!reservations) {
    reservations = new Map<string, SequenceReservation>();
    reservationsByAccount.set(accountId, reservations);
  }
  return reservations;
}

export function reapExpiredReservations(now = Date.now()): number {
  let cleared = 0;
  for (const [accountId, reservations] of reservationsByAccount.entries()) {
    for (const [sequenceKey, reservation] of reservations.entries()) {
      if (reservation.expiresAt <= now) {
        reservations.delete(sequenceKey);
        cleared += 1;
      }
    }

    if (reservations.size === 0) {
      reservationsByAccount.delete(accountId);
    }
  }

  return cleared;
}

export function reserveSequence(
  accountId: string,
  sequence: SequenceValue,
  options: SequencePoolOptions = {},
): SequenceReservation {
  const now = options.now?.() ?? Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  reapExpiredReservations(now);

  const sequenceValue = toBigIntSequence(sequence);
  const sequenceKey = sequenceValue.toString();
  const reservations = accountReservations(accountId);
  const existing = reservations.get(sequenceKey);

  if (existing && existing.expiresAt > now) {
    throw new SequenceReservationError(accountId, sequenceValue, existing.expiresAt);
  }

  const reservation: SequenceReservation = {
    reservationId: crypto.randomUUID(),
    accountId,
    sequence: sequenceValue,
    reservedAt: now,
    expiresAt: now + timeoutMs,
    reason: options.reason,
  };

  reservations.set(sequenceKey, reservation);
  return reservation;
}

export function releaseSequence(accountId: string, sequence: SequenceValue): boolean {
  const reservations = reservationsByAccount.get(accountId);
  if (!reservations) {
    return false;
  }

  const removed = reservations.delete(toBigIntSequence(sequence).toString());
  if (reservations.size === 0) {
    reservationsByAccount.delete(accountId);
  }
  return removed;
}

export function getSequenceReservation(
  accountId: string,
  sequence: SequenceValue,
): SequenceReservation | undefined {
  const reservations = reservationsByAccount.get(accountId);
  if (!reservations) {
    return undefined;
  }

  const reservation = reservations.get(toBigIntSequence(sequence).toString());
  if (!reservation) {
    return undefined;
  }

  if (reservation.expiresAt <= Date.now()) {
    reservations.delete(reservation.sequence.toString());
    return undefined;
  }

  return reservation;
}

export async function withSequenceReservation<T>(
  accountId: string,
  sequence: SequenceValue,
  work: (reservation: SequenceReservation) => Promise<T> | T,
  options: SequencePoolOptions = {},
): Promise<T> {
  const reservation = reserveSequence(accountId, sequence, options);
  try {
    return await work(reservation);
  } finally {
    releaseSequence(accountId, reservation.sequence);
  }
}

export function clearSequenceReservations(): void {
  reservationsByAccount.clear();
}
