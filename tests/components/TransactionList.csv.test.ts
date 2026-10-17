import { generateTransactionsCSV } from "../../src/templates/default/src/components/TransactionList";
import type { OperationItem } from "../../src/templates/default/src/hooks/useTransactionHistory";

describe("TransactionList CSV Export", () => {
  const mockOperations: OperationItem[] = [
    {
      id: "op-1",
      type: "payment",
      created_at: "2026-09-26T10:00:00Z",
      source_account: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      paging_token: "100",
      transaction_successful: true,
      from: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      to: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      amount: "100.5000000",
      asset_type: "native",
      transaction_hash: "hash_1234567890",
    } as unknown as OperationItem,
    {
      id: "op-2",
      type: "payment",
      created_at: "2026-09-26T10:30:00Z",
      source_account: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      paging_token: "101",
      transaction_successful: false,
      from: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      to: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      amount: "50.0000000",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
      transaction_hash: "hash_0987654321",
    } as unknown as OperationItem,
  ];

  it("generates correct CSV headers and row structure", () => {
    const csv = generateTransactionsCSV(mockOperations);
    const lines = csv.split("\n");

    expect(lines[0]).toBe("id,type,created_at,amount,asset,from,to,transaction_hash,status");
    expect(lines.length).toBe(3);

    expect(lines[1]).toContain('"op-1"');
    expect(lines[1]).toContain('"payment"');
    expect(lines[1]).toContain('"100.5000000"');
    expect(lines[1]).toContain('"XLM"');
    expect(lines[1]).toContain('"Success"');

    expect(lines[2]).toContain('"op-2"');
    expect(lines[2]).toContain('"USDC"');
    expect(lines[2]).toContain('"Failed"');
  });

  it("returns header only for empty operations list", () => {
    const csv = generateTransactionsCSV([]);
    expect(csv).toBe("id,type,created_at,amount,asset,from,to,transaction_hash,status");
  });
});
