export interface TransactionReceiptData {
  id: string;
  userId: string;
  amount: number | string;
  currency: string;
  status: "completed" | "pending" | "failed" | string;
  type?: string;
  createdAt: string | Date;
  completedAt?: string | Date;
  stellarTxHash?: string;
  fee?: string | number;
  memo?: string | null;
  sender?: string;
  recipient?: string;
}

export const SUPPORTED_LOCALES = ["en", "es", "fr", "de", "pt"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const RECEIPT_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    receipt: "Transaction Receipt",
    receiptId: "Receipt ID",
    transactionId: "Transaction ID",
    date: "Date",
    amount: "Amount",
    currency: "Currency",
    status: "Status",
    type: "Type",
    fee: "Fee",
    memo: "Memo",
    sender: "Sender",
    recipient: "Recipient",
    stellarTxHash: "Stellar Tx Hash",
    issued: "Issued At",
    completed: "Completed At",
    footer: "Thank you for using Nextellar.",
  },
  es: {
    receipt: "Recibo de Transacción",
    receiptId: "ID de Recibo",
    transactionId: "ID de Transacción",
    date: "Fecha",
    amount: "Monto",
    currency: "Moneda",
    status: "Estado",
    type: "Tipo",
    fee: "Tarifa",
    memo: "Memo",
    sender: "Remitente",
    recipient: "Destinatario",
    stellarTxHash: "Hash de Transacción Stellar",
    issued: "Emitido el",
    completed: "Completado el",
    footer: "Gracias por utilizar Nextellar.",
  },
  fr: {
    receipt: "Reçu de Transaction",
    receiptId: "ID du Reçu",
    transactionId: "ID de Transaction",
    date: "Date",
    amount: "Montant",
    currency: "Devise",
    status: "Statut",
    type: "Type",
    fee: "Frais",
    memo: "Mémo",
    sender: "Expéditeur",
    recipient: "Destinataire",
    stellarTxHash: "Hachage de Tx Stellar",
    issued: "Émis le",
    completed: "Terminé le",
    footer: "Merci d'utiliser Nextellar.",
  },
  de: {
    receipt: "Transaktionsquittung",
    receiptId: "Quittungs-ID",
    transactionId: "Transaktions-ID",
    date: "Datum",
    amount: "Betrag",
    currency: "Währung",
    status: "Status",
    type: "Typ",
    fee: "Gebühr",
    memo: "Memo",
    sender: "Absender",
    recipient: "Empfänger",
    stellarTxHash: "Stellar Transaktions-Hash",
    issued: "Ausgestellt am",
    completed: "Abgeschlossen am",
    footer: "Vielen Dank für die Nutzung von Nextellar.",
  },
  pt: {
    receipt: "Comprovante de Transação",
    receiptId: "ID do Comprovante",
    transactionId: "ID da Transação",
    date: "Data",
    amount: "Valor",
    currency: "Moeda",
    status: "Status",
    type: "Tipo",
    fee: "Taxa",
    memo: "Memo",
    sender: "Remetente",
    recipient: "Destinatário",
    stellarTxHash: "Hash da Tx Stellar",
    issued: "Emitido em",
    completed: "Concluído em",
    footer: "Obrigado por usar o Nextellar.",
  },
};

export function getReceiptLabels(rawLocale?: string): Record<string, string> {
  const locale: Locale =
    rawLocale && (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale)
      ? (rawLocale as Locale)
      : "en";
  return RECEIPT_LABELS[locale];
}

/**
 * Generates a deterministic PDF Buffer for a transaction receipt using localized labels.
 */
export function generateReceiptPdf(
  data: TransactionReceiptData,
  rawLocale: string = "en",
): Buffer {
  const locale: Locale = (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale)
    ? (rawLocale as Locale)
    : "en";
  const l = RECEIPT_LABELS[locale];

  const createdAtStr =
    typeof data.createdAt === "string"
      ? data.createdAt
      : data.createdAt.toISOString();
  const completedAtStr = data.completedAt
    ? typeof data.completedAt === "string"
      ? data.completedAt
      : data.completedAt.toISOString()
    : undefined;

  const lines = [
    `NEXTELLAR ${l.receipt.toUpperCase()}`,
    ``,
    `${l.receiptId} : ${data.id}`,
    `${l.status}     : ${data.status}`,
    `${l.amount}     : ${data.amount} ${data.currency}`,
    data.type ? `${l.type}       : ${data.type}` : undefined,
    `${l.issued}  : ${createdAtStr}`,
    completedAtStr ? `${l.completed}: ${completedAtStr}` : undefined,
    data.sender ? `${l.sender}     : ${data.sender}` : undefined,
    data.recipient ? `${l.recipient}  : ${data.recipient}` : undefined,
    data.fee !== undefined ? `${l.fee}        : ${data.fee}` : undefined,
    data.memo ? `${l.memo}       : ${data.memo}` : undefined,
    data.stellarTxHash ? `${l.stellarTxHash}: ${data.stellarTxHash}` : undefined,
    ``,
    l.footer,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  const escapedLines = lines
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

  const streamContent = `BT /F1 12 Tf 50 750 Td (${escapedLines.replace(/\n/g, ") Tj T* (")}) Tj ET`;
  const streamLength = Buffer.byteLength(streamContent, "utf8");

  const body =
    `%PDF-1.4\n` +
    `1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
    `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
    `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>/Contents 4 0 R>>endobj\n` +
    `4 0 obj<</Length ${streamLength}>>stream\n${streamContent}\nendstream\nendobj\n` +
    `%%EOF`;

  return Buffer.from(body, "utf8");
}
