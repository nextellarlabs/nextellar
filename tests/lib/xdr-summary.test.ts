import {
  Account,
  Address,
  Asset,
  Claimant,
  Keypair,
  LiquidityPoolAsset,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import {
  formatAmount,
  summarizeOperation,
  summarizeOperationXdr,
  summarizeTransactionXdr,
  truncateAddress,
} from "../../src/templates/default/src/lib/xdr-summary";

const SOURCE_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const DEST_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const ISSUER_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));

const SOURCE = SOURCE_KP.publicKey();
const DEST = DEST_KP.publicKey();
const ISSUER = ISSUER_KP.publicKey();

const USDC = new Asset("USDC", ISSUER);
const EURC = new Asset("EURC", ISSUER);
const BALANCE_ID = "00000000" + "ab".repeat(32);
const POOL_ID = "cd".repeat(32);
const CONTRACT_ID = Address.contract(Buffer.alloc(32, 7)).toString();

function buildTxXdr(
  ops: xdr.Operation[],
  options?: { memo?: Memo; feeBump?: boolean },
): string {
  const builder = new TransactionBuilder(new Account(SOURCE, "100"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  }).setTimeout(30);

  if (options?.memo) {
    builder.addMemo(options.memo);
  }
  for (const op of ops) {
    builder.addOperation(op);
  }

  const tx = builder.build();
  if (options?.feeBump) {
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      DEST,
      "500",
      tx,
      Networks.TESTNET,
    );
    return feeBump.toXDR();
  }
  return tx.toXDR();
}

describe("lib/xdr-summary", () => {
  describe("helpers", () => {
    it("truncates long addresses and preserves short strings", () => {
      expect(truncateAddress(DEST)).toBe(
        `${DEST.slice(0, 4)}...${DEST.slice(-4)}`,
      );
      expect(truncateAddress("SHORT")).toBe("SHORT");
    });

    it("formats amounts by stripping trailing decimal zeros", () => {
      expect(formatAmount("10.0000000")).toBe("10");
      expect(formatAmount("10.5000000")).toBe("10.5");
      expect(formatAmount("0.0000000")).toBe("0");
      expect(formatAmount("42")).toBe("42");
    });
  });

  describe("classic operation fixture XDR decoding", () => {
    it("decodes createAccount", () => {
      const txXdr = buildTxXdr([
        Operation.createAccount({
          destination: DEST,
          startingBalance: "25",
        }),
      ]);
      const result = summarizeTransactionXdr(txXdr);
      expect(result.operations).toHaveLength(1);
      expect(result.operations[0]).toMatchObject({
        type: "createAccount",
        destination: DEST,
        startingBalance: "25",
        summary: `Create account ${truncateAddress(DEST)} with 25 XLM`,
      });
    });

    it("decodes payment for credit asset (USDC) and native XLM", () => {
      const txXdr = buildTxXdr([
        Operation.payment({
          destination: DEST,
          asset: USDC,
          amount: "10",
        }),
        Operation.payment({
          destination: DEST,
          asset: Asset.native(),
          amount: "5.25",
        }),
      ]);
      const result = summarizeTransactionXdr(txXdr);
      expect(result.operations[0]).toMatchObject({
        type: "payment",
        destination: DEST,
        amount: "10",
        asset: { code: "USDC", issuer: ISSUER, isNative: false },
        summary: `Pay 10 USDC to ${truncateAddress(DEST)}`,
      });
      expect(result.operations[1]).toMatchObject({
        type: "payment",
        amount: "5.25",
        asset: { code: "XLM", isNative: true },
        summary: `Pay 5.25 XLM to ${truncateAddress(DEST)}`,
      });
    });

    it("decodes pathPaymentStrictReceive", () => {
      const txXdr = buildTxXdr([
        Operation.pathPaymentStrictReceive({
          sendAsset: Asset.native(),
          sendMax: "100",
          destination: DEST,
          destAsset: USDC,
          destAmount: "12.5",
          path: [EURC],
        }),
      ]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "pathPaymentStrictReceive",
        sendMax: "100",
        destAmount: "12.5",
        destination: DEST,
        summary: `Pay 12.5 USDC (max 100 XLM) to ${truncateAddress(DEST)}`,
      });
    });

    it("decodes pathPaymentStrictSend", () => {
      const txXdr = buildTxXdr([
        Operation.pathPaymentStrictSend({
          sendAsset: USDC,
          sendAmount: "50",
          destination: DEST,
          destAsset: Asset.native(),
          destMin: "400",
          path: [],
        }),
      ]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "pathPaymentStrictSend",
        sendAmount: "50",
        destMin: "400",
        summary: `Send 50 USDC (min 400 XLM) to ${truncateAddress(DEST)}`,
      });
    });

    it("decodes manageSellOffer (create and cancel)", () => {
      const txXdr = buildTxXdr([
        Operation.manageSellOffer({
          selling: Asset.native(),
          buying: USDC,
          amount: "100",
          price: "0.12",
          offerId: 0,
        }),
        Operation.manageSellOffer({
          selling: Asset.native(),
          buying: USDC,
          amount: "0",
          price: "0.12",
          offerId: 99,
        }),
      ]);
      const [createOp, cancelOp] = summarizeTransactionXdr(txXdr).operations;
      expect(createOp).toMatchObject({
        type: "manageSellOffer",
        amount: "100",
        price: "0.12",
        summary: "Sell 100 XLM for USDC at 0.12",
      });
      expect(cancelOp).toMatchObject({
        type: "manageSellOffer",
        offerId: "99",
        summary: "Cancel sell offer #99",
      });
    });

    it("decodes manageBuyOffer (create and cancel)", () => {
      const txXdr = buildTxXdr([
        Operation.manageBuyOffer({
          selling: USDC,
          buying: Asset.native(),
          buyAmount: "50",
          price: "0.1",
          offerId: 0,
        }),
        Operation.manageBuyOffer({
          selling: USDC,
          buying: Asset.native(),
          buyAmount: "0",
          price: "0.1",
          offerId: 77,
        }),
      ]);
      const [createOp, cancelOp] = summarizeTransactionXdr(txXdr).operations;
      expect(createOp).toMatchObject({
        type: "manageBuyOffer",
        buyAmount: "50",
        summary: "Buy 50 XLM with USDC at 0.1",
      });
      expect(cancelOp).toMatchObject({
        type: "manageBuyOffer",
        offerId: "77",
        summary: "Cancel buy offer #77",
      });
    });

    it("decodes createPassiveSellOffer", () => {
      const txXdr = buildTxXdr([
        Operation.createPassiveSellOffer({
          selling: USDC,
          buying: EURC,
          amount: "200",
          price: "0.92",
        }),
      ]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "createPassiveSellOffer",
        amount: "200",
        price: "0.92",
        summary: "Passive sell 200 USDC for EURC at 0.92",
      });
    });

    it("decodes setOptions", () => {
      const txXdr = buildTxXdr([
        Operation.setOptions({
          homeDomain: "example.org",
          masterWeight: 2,
          lowThreshold: 1,
        }),
      ]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "setOptions",
        homeDomain: "example.org",
        masterWeight: 2,
        lowThreshold: 1,
      });
      expect(op.summary).toContain("homeDomain=example.org");
    });

    it("decodes changeTrust (add, remove, and liquidity pool)", () => {
      const poolAsset = new LiquidityPoolAsset(Asset.native(), USDC, 30);
      const txXdr = buildTxXdr([
        Operation.changeTrust({ asset: USDC, limit: "1000" }),
        Operation.changeTrust({ asset: USDC, limit: "0" }),
        Operation.changeTrust({ asset: poolAsset, limit: "500" }),
      ]);
      const [addOp, removeOp, poolOp] =
        summarizeTransactionXdr(txXdr).operations;
      expect(addOp).toMatchObject({
        type: "changeTrust",
        isRemoval: false,
        summary: "Trust USDC (limit 1000)",
      });
      expect(removeOp).toMatchObject({
        type: "changeTrust",
        isRemoval: true,
        summary: "Remove trustline for USDC",
      });
      expect(poolOp).toMatchObject({
        type: "changeTrust",
        liquidityPoolId: "XLM/USDC",
        summary: "Trust XLM/USDC pool",
      });
    });

    it("decodes allowTrust", () => {
      const txXdr = buildTxXdr([
        Operation.allowTrust({
          trustor: DEST,
          assetCode: "USDC",
          authorize: true,
        }),
      ]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "allowTrust",
        trustor: DEST,
        assetCode: "USDC",
        summary: `Authorize trustline for USDC on ${truncateAddress(DEST)}`,
      });
    });

    it("decodes accountMerge", () => {
      const txXdr = buildTxXdr([
        Operation.accountMerge({ destination: DEST }),
      ]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "accountMerge",
        destination: DEST,
        summary: `Merge account into ${truncateAddress(DEST)}`,
      });
    });

    it("decodes inflation", () => {
      const txXdr = buildTxXdr([Operation.inflation({})]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "inflation",
        summary: "Run inflation",
      });
    });

    it("decodes manageData (set and delete)", () => {
      const txXdr = buildTxXdr([
        Operation.manageData({ name: "app", value: "nextellar" }),
        Operation.manageData({ name: "old", value: null }),
      ]);
      const [setOp, delOp] = summarizeTransactionXdr(txXdr).operations;
      expect(setOp).toMatchObject({
        type: "manageData",
        name: "app",
        value: "nextellar",
        summary: 'Set data entry "app"',
      });
      expect(delOp).toMatchObject({
        type: "manageData",
        name: "old",
        value: null,
        summary: 'Delete data entry "old"',
      });
    });

    it("decodes bumpSequence", () => {
      const txXdr = buildTxXdr([Operation.bumpSequence({ bumpTo: "9999" })]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "bumpSequence",
        bumpTo: "9999",
        summary: "Bump sequence to 9999",
      });
    });

    it("decodes createClaimableBalance and claimClaimableBalance", () => {
      const txXdr = buildTxXdr([
        Operation.createClaimableBalance({
          asset: USDC,
          amount: "40",
          claimants: [new Claimant(DEST, Claimant.predicateUnconditional())],
        }),
        Operation.claimClaimableBalance({ balanceId: BALANCE_ID }),
      ]);
      const [createOp, claimOp] = summarizeTransactionXdr(txXdr).operations;
      expect(createOp).toMatchObject({
        type: "createClaimableBalance",
        amount: "40",
        claimantCount: 1,
        summary: "Create claimable balance of 40 USDC (1 claimant)",
      });
      expect(claimOp).toMatchObject({
        type: "claimClaimableBalance",
        balanceId: BALANCE_ID,
      });
      expect(claimOp.summary).toContain("Claim balance");
    });

    it("decodes sponsorship operations (begin, end, revoke)", () => {
      const txXdr = buildTxXdr([
        Operation.beginSponsoringFutureReserves({ sponsoredId: DEST }),
        Operation.endSponsoringFutureReserves(),
        Operation.revokeAccountSponsorship({ account: DEST }),
        Operation.revokeTrustlineSponsorship({ account: DEST, asset: USDC }),
      ]);
      const [beginOp, endOp, revokeAcctOp, revokeTrustOp] =
        summarizeTransactionXdr(txXdr).operations;
      expect(beginOp).toMatchObject({
        type: "beginSponsoringFutureReserves",
        sponsoredId: DEST,
        summary: `Begin sponsoring reserves for ${truncateAddress(DEST)}`,
      });
      expect(endOp).toMatchObject({
        type: "endSponsoringFutureReserves",
        summary: "End sponsoring future reserves",
      });
      expect(revokeAcctOp).toMatchObject({
        type: "revokeSponsorship",
        subtype: "revokeAccountSponsorship",
        summary: "Revoke account sponsorship",
      });
      expect(revokeTrustOp).toMatchObject({
        type: "revokeSponsorship",
        subtype: "revokeTrustlineSponsorship",
        summary: "Revoke trustline sponsorship",
      });
    });

    it("decodes clawback and clawbackClaimableBalance", () => {
      const txXdr = buildTxXdr([
        Operation.clawback({ asset: USDC, amount: "15", from: DEST }),
        Operation.clawbackClaimableBalance({ balanceId: BALANCE_ID }),
      ]);
      const [clawbackOp, clawbackCbOp] =
        summarizeTransactionXdr(txXdr).operations;
      expect(clawbackOp).toMatchObject({
        type: "clawback",
        from: DEST,
        amount: "15",
        summary: `Clawback 15 USDC from ${truncateAddress(DEST)}`,
      });
      expect(clawbackCbOp).toMatchObject({
        type: "clawbackClaimableBalance",
        balanceId: BALANCE_ID,
      });
    });

    it("decodes setTrustLineFlags", () => {
      const txXdr = buildTxXdr([
        Operation.setTrustLineFlags({
          trustor: DEST,
          asset: USDC,
          flags: { authorized: true, clawbackEnabled: false },
        }),
      ]);
      const [op] = summarizeTransactionXdr(txXdr).operations;
      expect(op).toMatchObject({
        type: "setTrustLineFlags",
        trustor: DEST,
        asset: { code: "USDC", issuer: ISSUER, isNative: false },
      });
      expect(op.summary).toContain("authorized=true");
    });

    it("decodes liquidityPoolDeposit and liquidityPoolWithdraw", () => {
      const txXdr = buildTxXdr([
        Operation.liquidityPoolDeposit({
          liquidityPoolId: POOL_ID,
          maxAmountA: "100",
          maxAmountB: "200",
          minPrice: "0.5",
          maxPrice: "2",
        }),
        Operation.liquidityPoolWithdraw({
          liquidityPoolId: POOL_ID,
          amount: "50",
          minAmountA: "20",
          minAmountB: "40",
        }),
      ]);
      const [depositOp, withdrawOp] = summarizeTransactionXdr(txXdr).operations;
      expect(depositOp).toMatchObject({
        type: "liquidityPoolDeposit",
        liquidityPoolId: POOL_ID,
        maxAmountA: "100",
        maxAmountB: "200",
      });
      expect(withdrawOp).toMatchObject({
        type: "liquidityPoolWithdraw",
        liquidityPoolId: POOL_ID,
        amount: "50",
      });
    });
  });

  describe("invokeHostFunction fixture XDR decoding", () => {
    it("decodes invokeContract host function", () => {
      const invokeOp = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(CONTRACT_ID).toScAddress(),
            functionName: "transfer",
            args: [xdr.ScVal.scvU32(42)],
          }),
        ),
        auth: [],
      });
      const [op] = summarizeTransactionXdr(buildTxXdr([invokeOp])).operations;
      expect(op).toMatchObject({
        type: "invokeHostFunction",
        hostFunctionType: "invokeContract",
        contractId: CONTRACT_ID,
        functionName: "transfer",
        argCount: 1,
        summary: `Invoke transfer() on ${truncateAddress(CONTRACT_ID)}`,
      });
    });

    it("decodes uploadContractWasm host function", () => {
      const uploadOp = Operation.invokeHostFunction({
        func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(
          Buffer.from([0x00, 0x61, 0x73, 0x6d]),
        ),
        auth: [],
      });
      const [op] = summarizeTransactionXdr(buildTxXdr([uploadOp])).operations;
      expect(op).toMatchObject({
        type: "invokeHostFunction",
        hostFunctionType: "uploadContractWasm",
        summary: "Upload Soroban contract WASM",
      });
    });
  });

  describe("transaction envelope features", () => {
    it("decodes memos and fee-bump envelopes", () => {
      const txXdr = buildTxXdr(
        [
          Operation.payment({
            destination: DEST,
            asset: USDC,
            amount: "10",
          }),
        ],
        { memo: Memo.text("invoice-42"), feeBump: true },
      );
      const summary = summarizeTransactionXdr(txXdr);
      expect(summary.envelopeType).toBe("tx_fee_bump");
      expect(summary.feeBump).toEqual({ feeSource: DEST, fee: "1000" });
      expect(summary.memo).toEqual({ type: "text", value: "invoice-42" });
      expect(summary.operations[0].summary).toBe(
        `Pay 10 USDC to ${truncateAddress(DEST)}`,
      );
    });
  });

  describe("unknown and unsupported operations degrade gracefully", () => {
    it("degrades extendFootprintTtl and restoreFootprint without throwing", () => {
      const txXdr = buildTxXdr([
        Operation.extendFootprintTtl({ extendTo: 5000 }),
        Operation.restoreFootprint({}),
      ]);
      const [extendOp, restoreOp] = summarizeTransactionXdr(txXdr).operations;
      expect(extendOp).toMatchObject({
        type: "unknown",
        operationType: "extendFootprintTtl",
        summary: "Unsupported operation (extendFootprintTtl)",
      });
      expect(restoreOp).toMatchObject({
        type: "unknown",
        operationType: "restoreFootprint",
        summary: "Unsupported operation (restoreFootprint)",
      });
    });

    it("degrades unrecognized operation objects without throwing", () => {
      const op = summarizeOperation({ type: "futureProtocolOp", foo: "bar" });
      expect(op).toEqual({
        type: "unknown",
        operationType: "futureProtocolOp",
        source: undefined,
        summary: "Unsupported operation (futureProtocolOp)",
      });
    });

    it("degrades malformed base64 XDR in summarizeOperationXdr without throwing", () => {
      const op = summarizeOperationXdr("not-valid-xdr!!!");
      expect(op).toMatchObject({
        type: "unknown",
        operationType: "malformed",
      });
    });
  });
});
