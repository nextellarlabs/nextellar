import { Router, Request, Response, NextFunction } from "express";
import { sendError } from "../lib/response.js";

const router = Router();

type InvoiceStatus = "draft" | "pending" | "paid" | "voided";

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface Invoice {
  id: string;
  issuerId: string;
  recipientId: string;
  status: InvoiceStatus;
  currency: string;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  payableLink: string;
  createdAt: string;
  idempotencyKey?: string;
}

const invoiceStore = new Map<string, Invoice>();
const idempotencyIndex = new Map<string, string>();

let invoiceCounter = 0;

function generateInvoiceId(): string {
  invoiceCounter += 1;
  return `inv-${String(invoiceCounter).padStart(6, "0")}`;
}

export function __resetInvoiceStore(): void {
  invoiceStore.clear();
  idempotencyIndex.clear();
  invoiceCounter = 0;
}

export function __seedInvoice(invoice: Invoice): void {
  invoiceStore.set(invoice.id, invoice);
  if (invoice.idempotencyKey) {
    idempotencyIndex.set(invoice.idempotencyKey, invoice.id);
  }
}

const VALID_CURRENCIES = new Set(["USD", "EUR", "XLM", "USDC"]);

router.post(
  "/invoices",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lineItems, currency, recipientId, idempotencyKey } = req.body as {
        lineItems?: unknown;
        currency?: unknown;
        recipientId?: unknown;
        idempotencyKey?: unknown;
      };

      const issuerId = req.headers["x-user-id"] as string | undefined;
      if (!issuerId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      if (!currency || typeof currency !== "string") {
        sendError(res, "INVALID_CURRENCY", "currency is required and must be a string", 400);
        return;
      }

      if (!VALID_CURRENCIES.has(currency)) {
        sendError(
          res,
          "INVALID_CURRENCY",
          `currency must be one of: ${[...VALID_CURRENCIES].join(", ")}`,
          400,
        );
        return;
      }

      if (!recipientId || typeof recipientId !== "string") {
        sendError(res, "INVALID_RECIPIENT", "recipientId is required and must be a string", 400);
        return;
      }

      if (recipientId === issuerId) {
        sendError(res, "INVALID_RECIPIENT", "recipientId cannot be the same as the issuer", 400);
        return;
      }

      if (!Array.isArray(lineItems) || lineItems.length === 0) {
        sendError(res, "INVALID_LINE_ITEMS", "lineItems must be a non-empty array", 400);
        return;
      }

      const parsedItems: InvoiceLineItem[] = [];
      for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i] as Record<string, unknown>;

        if (!item.description || typeof item.description !== "string") {
          sendError(res, "INVALID_LINE_ITEM", `lineItems[${i}].description is required`, 400);
          return;
        }

        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          sendError(
            res,
            "INVALID_LINE_ITEM",
            `lineItems[${i}].quantity must be a positive number`,
            400,
          );
          return;
        }

        const unitPrice = Number(item.unitPrice);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          sendError(
            res,
            "INVALID_LINE_ITEM",
            `lineItems[${i}].unitPrice must be a non-negative number`,
            400,
          );
          return;
        }

        parsedItems.push({
          description: item.description,
          quantity,
          unitPrice,
          amount: quantity * unitPrice,
        });
      }

      // Idempotency: return existing invoice for duplicate keys
      if (idempotencyKey && typeof idempotencyKey === "string") {
        const existingId = idempotencyIndex.get(idempotencyKey);
        if (existingId) {
          const existing = invoiceStore.get(existingId)!;
          res.status(200).json({
            success: true,
            data: existing,
          });
          return;
        }
      }

      const totalAmount = parsedItems.reduce((sum, item) => sum + item.amount, 0);
      const id = generateInvoiceId();
      const payableLink = `https://pay.nextellar.app/invoices/${id}`;

      const invoice: Invoice = {
        id,
        issuerId,
        recipientId,
        status: "pending",
        currency,
        lineItems: parsedItems,
        totalAmount,
        payableLink,
        createdAt: new Date().toISOString(),
        ...(idempotencyKey && typeof idempotencyKey === "string" ? { idempotencyKey } : {}),
      };

      invoiceStore.set(id, invoice);
      if (idempotencyKey && typeof idempotencyKey === "string") {
        idempotencyIndex.set(idempotencyKey, id);
      }

      res.status(201).json({
        success: true,
        data: invoice,
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
