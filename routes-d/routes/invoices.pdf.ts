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
  payerId: string;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  lineItems: InvoiceLineItem[];
  createdAt: Date;
  dueDate: Date;
  paidAt?: Date;
  stellarTxHash?: string;
}

const invoices = new Map<string, Invoice>();

export function __resetInvoices(): void {
  invoices.clear();
}

export function __seedInvoice(inv: Invoice): void {
  invoices.set(inv.id, { ...inv });
}

const SUPPORTED_LOCALES = ["en", "es", "fr", "pt"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

const LABELS: Record<Locale, Record<string, string>> = {
  en: { invoice: "Invoice", total: "Total", due: "Due", status: "Status", issued: "Issued" },
  es: { invoice: "Factura", total: "Total", due: "Vence", status: "Estado", issued: "Emitida" },
  fr: { invoice: "Facture", total: "Total", due: "Échéance", status: "Statut", issued: "Émise" },
  pt: { invoice: "Fatura", total: "Total", due: "Vencimento", status: "Status", issued: "Emitida" },
};

function buildPdfBytes(invoice: Invoice, locale: Locale): Buffer {
  const l = LABELS[locale];
  const lines = [
    `%PDF-1.4`,
    `% Nextellar Invoice ${invoice.id}`,
    `${l.invoice}: ${invoice.id}`,
    `${l.status}: ${invoice.status}`,
    `${l.issued}: ${invoice.createdAt.toISOString()}`,
    `${l.due}: ${invoice.dueDate.toISOString()}`,
    ...invoice.lineItems.map(
      (li) => `  ${li.description} x${li.quantity} @ ${li.unitPrice} = ${li.amount} ${invoice.currency}`,
    ),
    `${l.total}: ${invoice.amount} ${invoice.currency}`,
    invoice.paidAt ? `Paid: ${invoice.paidAt.toISOString()}` : "",
    invoice.stellarTxHash ? `Tx: ${invoice.stellarTxHash}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return Buffer.from(lines, "utf8");
}

/**
 * GET /invoices/:id/pdf
 * Stream a PDF rendering of an invoice.
 * Query param: locale (en | es | fr | pt, default: en)
 * Access restricted to the invoice issuer or payer.
 */
router.get(
  "/invoices/:id/pdf",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const userId = req.headers["x-user-id"] as string | undefined;

      if (!userId) {
        sendError(res, "UNAUTHORIZED", "x-user-id header is required", 401);
        return;
      }

      const invoice = invoices.get(id);

      if (!invoice) {
        sendError(res, "NOT_FOUND", "Invoice not found", 404);
        return;
      }

      if (invoice.issuerId !== userId && invoice.payerId !== userId) {
        sendError(res, "FORBIDDEN", "You do not have access to this invoice", 403);
        return;
      }

      const rawLocale = typeof req.query.locale === "string" ? req.query.locale : "en";
      const locale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale)
        ? (rawLocale as Locale)
        : "en";

      const pdfBytes = buildPdfBytes(invoice, locale);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="invoice-${invoice.id}.pdf"`,
      );
      res.setHeader("Content-Length", pdfBytes.length);

      // Stream without buffering
      res.flushHeaders();
      res.end(pdfBytes);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
export { invoices };
