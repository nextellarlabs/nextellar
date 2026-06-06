import crypto from "node:crypto";

export interface ProductStock {
  productId: string;
  available: number;
  reserved: number;
}

export interface InventoryReservation {
  reservationId: string;
  productId: string;
  quantity: number;
  reservedAt: number;
  expiresAt: number;
}

export interface InventoryOptions {
  timeoutMs?: number;
  now?: () => number;
}

export class InsufficientStockError extends Error {
  readonly code = "INSUFFICIENT_STOCK";

  constructor(
    public readonly productId: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(`Insufficient stock for ${productId}: requested ${requested}, available ${available}`);
    this.name = "InsufficientStockError";
  }
}

export class ReservationNotFoundError extends Error {
  readonly code = "RESERVATION_NOT_FOUND";

  constructor(public readonly reservationId: string) {
    super(`Reservation ${reservationId} not found`);
    this.name = "ReservationNotFoundError";
  }
}

const DEFAULT_TIMEOUT_MS = Number(process.env.NEXTELLAR_INVENTORY_RESERVATION_TIMEOUT_MS ?? 30_000);

const stockByProduct = new Map<string, ProductStock>();
const reservations = new Map<string, InventoryReservation>();

function nowMs(options?: InventoryOptions): number {
  return options?.now?.() ?? Date.now();
}

export function setProductStock(productId: string, available: number): void {
  const existing = stockByProduct.get(productId);
  stockByProduct.set(productId, {
    productId,
    available,
    reserved: existing?.reserved ?? 0,
  });
}

export function getProductStock(productId: string): ProductStock | undefined {
  return stockByProduct.get(productId);
}

export function reapExpiredReservations(now = Date.now()): number {
  let cleared = 0;
  for (const [id, reservation] of reservations.entries()) {
    if (reservation.expiresAt <= now) {
      releaseReservation(id);
      cleared += 1;
    }
  }
  return cleared;
}

export function reserveStock(
  productId: string,
  quantity: number,
  options: InventoryOptions = {},
): InventoryReservation {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("quantity must be a positive integer");
  }

  const now = nowMs(options);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  reapExpiredReservations(now);

  const stock = stockByProduct.get(productId);
  if (!stock) {
    throw new InsufficientStockError(productId, quantity, 0);
  }

  const free = stock.available - stock.reserved;
  if (free < quantity) {
    throw new InsufficientStockError(productId, quantity, free);
  }

  stock.reserved += quantity;

  const reservation: InventoryReservation = {
    reservationId: crypto.randomUUID(),
    productId,
    quantity,
    reservedAt: now,
    expiresAt: now + timeoutMs,
  };
  reservations.set(reservation.reservationId, reservation);
  return reservation;
}

export function releaseReservation(reservationId: string): boolean {
  const reservation = reservations.get(reservationId);
  if (!reservation) {
    return false;
  }

  const stock = stockByProduct.get(reservation.productId);
  if (stock) {
    stock.reserved = Math.max(0, stock.reserved - reservation.quantity);
  }

  reservations.delete(reservationId);
  return true;
}

export function confirmReservation(reservationId: string): void {
  const reservation = reservations.get(reservationId);
  if (!reservation) {
    throw new ReservationNotFoundError(reservationId);
  }

  const stock = stockByProduct.get(reservation.productId);
  if (stock) {
    stock.reserved = Math.max(0, stock.reserved - reservation.quantity);
    stock.available = Math.max(0, stock.available - reservation.quantity);
  }

  reservations.delete(reservationId);
}

export function getReservation(
  reservationId: string,
  now = Date.now(),
): InventoryReservation | undefined {
  const reservation = reservations.get(reservationId);
  if (!reservation) {
    return undefined;
  }
  if (reservation.expiresAt <= now) {
    releaseReservation(reservationId);
    return undefined;
  }
  return reservation;
}

export async function withStockReservation<T>(
  productId: string,
  quantity: number,
  work: (reservation: InventoryReservation) => Promise<T> | T,
  options: InventoryOptions = {},
): Promise<T> {
  const reservation = reserveStock(productId, quantity, options);
  try {
    return await work(reservation);
  } catch (err) {
    releaseReservation(reservation.reservationId);
    throw err;
  }
}

export function returnStock(productId: string, quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("quantity must be a positive integer");
  }
  const stock = stockByProduct.get(productId);
  if (!stock) {
    stockByProduct.set(productId, { productId, available: quantity, reserved: 0 });
    return;
  }
  stock.available += quantity;
}

export function clearInventory(): void {
  stockByProduct.clear();
  reservations.clear();
}
