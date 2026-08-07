import {
  generateReceiptPdf,
  getReceiptLabels,
  TransactionReceiptData,
  SUPPORTED_LOCALES,
} from "../../lib/pdfReceipt.js";

const sampleTx: TransactionReceiptData = {
  id: "tx-unit-001",
  userId: "user-unit-1",
  amount: 250,
  currency: "XLM",
  status: "completed",
  type: "transfer",
  createdAt: "2024-05-10T12:00:00Z",
  completedAt: "2024-05-10T12:00:05Z",
  stellarTxHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  sender: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  recipient: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYSFIZGK4W5TXFZTRSN",
  fee: "100",
  memo: "Unit test tx",
};

describe("Unit: pdfReceipt library", () => {
  it("generates a valid PDF buffer with PDF-1.4 header", () => {
    const pdfBuf = generateReceiptPdf(sampleTx);
    expect(Buffer.isBuffer(pdfBuf)).toBe(true);
    expect(pdfBuf.toString("utf8")).toContain("%PDF-1.4");
    expect(pdfBuf.toString("utf8")).toContain("%%EOF");
  });

  it("contains transaction details in the generated PDF", () => {
    const pdfBuf = generateReceiptPdf(sampleTx);
    const pdfStr = pdfBuf.toString("utf8");
    expect(pdfStr).toContain("tx-unit-001");
    expect(pdfStr).toContain("250 XLM");
    expect(pdfStr).toContain("completed");
  });

  it("supports localized strings for all supported locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const labels = getReceiptLabels(locale);
      expect(labels.receipt).toBeDefined();
      expect(labels.receiptId).toBeDefined();

      const pdfBuf = generateReceiptPdf(sampleTx, locale);
      const pdfStr = pdfBuf.toString("utf8");
      expect(pdfStr.length).toBeGreaterThan(0);
    }
  });

  it("translates receipt titles appropriately by locale", () => {
    const pdfEn = generateReceiptPdf(sampleTx, "en").toString("utf8");
    expect(pdfEn).toContain("TRANSACTION RECEIPT");

    const pdfEs = generateReceiptPdf(sampleTx, "es").toString("utf8");
    expect(pdfEs).toContain("RECIBO DE TRANSACCIÓN");

    const pdfFr = generateReceiptPdf(sampleTx, "fr").toString("utf8");
    expect(pdfFr).toContain("REÇU DE TRANSACTION");

    const pdfDe = generateReceiptPdf(sampleTx, "de").toString("utf8");
    expect(pdfDe).toContain("TRANSAKTIONSQUITTUNG");

    const pdfPt = generateReceiptPdf(sampleTx, "pt").toString("utf8");
    expect(pdfPt).toContain("COMPROVANTE DE TRANSAÇÃO");
  });

  it("falls back to English when an unsupported locale is provided", () => {
    const pdfFallback = generateReceiptPdf(sampleTx, "invalid-locale").toString("utf8");
    expect(pdfFallback).toContain("TRANSACTION RECEIPT");
  });

  it("is deterministic: generates identical output for identical inputs", () => {
    const buf1 = generateReceiptPdf(sampleTx, "en");
    const buf2 = generateReceiptPdf(sampleTx, "en");
    expect(buf1.equals(buf2)).toBe(true);
  });
});
