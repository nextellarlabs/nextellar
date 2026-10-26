import {
  discoverSep6TransferServer,
  fetchSep6Info,
  fetchSep6Transaction,
  sep6Deposit,
  sep6Withdraw,
  Sep6Error,
} from "../../src/templates/default/src/lib/sep6";
import { clearStellarTomlCache } from "../../src/templates/default/src/lib/sep1";
import { StellarToml } from "@stellar/stellar-sdk";

const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

const SERVER = "https://anchor.example.org/sep6";
const ACCOUNT = "GAKAESXZZO3PJPEI5FNXGFOIANZJU7NAMNU753SGVSY7GF2KK55DALUQ";

/** Minimal fetch Response stand-in; SEP-6 helpers only read status/ok/text. */
function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function mockFetch(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue(response(body, status));
}

function calledUrl(fetchImpl: jest.Mock): URL {
  return new URL(fetchImpl.mock.calls[0][0] as string);
}

describe("sep6 (#1049)", () => {
  beforeEach(() => {
    mockResolve.mockReset();
    clearStellarTomlCache();
  });

  describe("discoverSep6TransferServer", () => {
    it("resolves TRANSFER_SERVER from stellar.toml", async () => {
      mockResolve.mockResolvedValue({ TRANSFER_SERVER: SERVER } as never);
      await expect(discoverSep6TransferServer("example.com")).resolves.toBe(
        SERVER,
      );
    });

    it("throws a Sep6Error when TRANSFER_SERVER is missing", async () => {
      mockResolve.mockResolvedValue({} as never);
      await expect(discoverSep6TransferServer("example.com")).rejects.toThrow(
        /missing TRANSFER_SERVER/,
      );
    });
  });

  describe("fetchSep6Info", () => {
    it("parses deposit/withdraw assets, limits, fields and features", async () => {
      const fetchImpl = mockFetch({
        deposit: {
          USDC: {
            enabled: true,
            authentication_required: true,
            min_amount: 1,
            max_amount: 10000,
            fee_fixed: 0.5,
            fields: { email_address: { description: "Email", optional: true } },
          },
        },
        withdraw: {
          USDC: {
            enabled: true,
            types: {
              bank_account: { fields: { dest: { description: "IBAN" } } },
            },
          },
        },
        features: { account_creation: true, claimable_balances: false },
      });

      const info = await fetchSep6Info({
        transferServer: `${SERVER}/`,
        lang: "en",
        fetchImpl,
      });

      expect(calledUrl(fetchImpl).toString()).toBe(`${SERVER}/info?lang=en`);
      expect(info.deposit.USDC).toMatchObject({
        enabled: true,
        authenticationRequired: true,
        minAmount: 1,
        maxAmount: 10000,
        feeFixed: 0.5,
      });
      expect(info.deposit.USDC.fields.email_address.optional).toBe(true);
      expect(info.withdraw.USDC.authenticationRequired).toBe(false);
      expect(Object.keys(info.withdraw.USDC.types)).toEqual(["bank_account"]);
      expect(info.features).toEqual({
        accountCreation: true,
        claimableBalances: false,
      });
    });

    it("sends the SEP-10 token as a Bearer header when given", async () => {
      const fetchImpl = mockFetch({ deposit: {}, withdraw: {} });
      await fetchSep6Info({
        transferServer: SERVER,
        authToken: "jwt",
        fetchImpl,
      });
      const init = fetchImpl.mock.calls[0][1] as RequestInit;
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer jwt",
      );
    });

    it("throws Sep6Error with status and the anchor's error message on non-2xx", async () => {
      const fetchImpl = mockFetch({ error: "maintenance" }, 503);
      const err = await fetchSep6Info({
        transferServer: SERVER,
        fetchImpl,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(Sep6Error);
      expect(err.status).toBe(503);
      expect(err.message).toContain("maintenance");
    });

    it("throws Sep6Error on a network failure", async () => {
      const fetchImpl = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(
        fetchSep6Info({ transferServer: SERVER, fetchImpl }),
      ).rejects.toThrow(/ECONNREFUSED/);
    });

    it("throws Sep6Error when a 2xx body is not JSON", async () => {
      const fetchImpl = mockFetch("<html>oops</html>");
      await expect(
        fetchSep6Info({ transferServer: SERVER, fetchImpl }),
      ).rejects.toThrow(/not valid JSON/);
    });

    it("rejects an empty transferServer before making a request", async () => {
      const fetchImpl = mockFetch({});
      await expect(
        fetchSep6Info({ transferServer: " ", fetchImpl }),
      ).rejects.toThrow(/transferServer is required/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("sep6Deposit", () => {
    it("builds the /deposit query and returns deposit instructions", async () => {
      const fetchImpl = mockFetch({
        id: "dep-1",
        how: "Send to bank account 123",
        instructions: {
          "organization.bank_number": {
            value: "121122676",
            description: "Routing",
          },
        },
        eta: 3600,
        min_amount: 10,
        fee_fixed: 1,
        extra_info: { message: "Include the reference" },
      });

      const result = await sep6Deposit({
        transferServer: SERVER,
        authToken: "jwt",
        assetCode: "USDC",
        account: ACCOUNT,
        type: "SEPA",
        amount: "100",
        claimableBalanceSupported: true,
        fetchImpl,
      });

      const url = calledUrl(fetchImpl);
      expect(url.pathname).toBe("/sep6/deposit");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        asset_code: "USDC",
        account: ACCOUNT,
        type: "SEPA",
        amount: "100",
        claimable_balance_supported: "true",
      });
      expect(result).toEqual({
        kind: "deposit",
        id: "dep-1",
        how: "Send to bank account 123",
        instructions: {
          "organization.bank_number": {
            value: "121122676",
            description: "Routing",
          },
        },
        eta: 3600,
        minAmount: 10,
        maxAmount: undefined,
        feeFixed: 1,
        feePercent: undefined,
        extraInfo: { message: "Include the reference" },
      });
    });

    it("returns customer_info_needed for a 403 non_interactive_customer_info_needed", async () => {
      const fetchImpl = mockFetch(
        {
          type: "non_interactive_customer_info_needed",
          fields: ["first_name", "last_name"],
        },
        403,
      );
      await expect(
        sep6Deposit({
          transferServer: SERVER,
          assetCode: "USDC",
          account: ACCOUNT,
          fetchImpl,
        }),
      ).resolves.toEqual({
        kind: "customer_info_needed",
        fields: ["first_name", "last_name"],
      });
    });

    it("returns customer_info_status for a 403 customer_info_status", async () => {
      const fetchImpl = mockFetch(
        {
          type: "customer_info_status",
          status: "denied",
          more_info_url: "https://anchor/kyc",
        },
        403,
      );
      await expect(
        sep6Deposit({
          transferServer: SERVER,
          assetCode: "USDC",
          account: ACCOUNT,
          fetchImpl,
        }),
      ).resolves.toEqual({
        kind: "customer_info_status",
        status: "denied",
        moreInfoUrl: "https://anchor/kyc",
        eta: undefined,
      });
    });

    it("throws on a 403 that is not a KYC response (e.g. bad token)", async () => {
      const fetchImpl = mockFetch({ type: "authentication_required" }, 403);
      await expect(
        sep6Deposit({
          transferServer: SERVER,
          assetCode: "USDC",
          account: ACCOUNT,
          fetchImpl,
        }),
      ).rejects.toMatchObject({ name: "Sep6Error", status: 403 });
    });

    it("throws on a 400 with the anchor's error text", async () => {
      const fetchImpl = mockFetch({ error: "invalid asset_code" }, 400);
      await expect(
        sep6Deposit({
          transferServer: SERVER,
          assetCode: "NOPE",
          account: ACCOUNT,
          fetchImpl,
        }),
      ).rejects.toThrow(/invalid asset_code/);
    });

    it("validates required fields before any request", async () => {
      const fetchImpl = mockFetch({});
      await expect(
        sep6Deposit({
          transferServer: SERVER,
          assetCode: "",
          account: ACCOUNT,
          fetchImpl,
        }),
      ).rejects.toThrow(/assetCode is required/);
      await expect(
        sep6Deposit({
          transferServer: SERVER,
          assetCode: "USDC",
          account: "",
          fetchImpl,
        }),
      ).rejects.toThrow(/account is required/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("sep6Withdraw", () => {
    it("builds the /withdraw query and returns where to pay", async () => {
      const fetchImpl = mockFetch({
        account_id: "GANCHORWITHDRAWACCOUNT",
        memo_type: "id",
        memo: "123",
        id: "wd-1",
        fee_percent: 0.5,
      });

      const result = await sep6Withdraw({
        transferServer: SERVER,
        authToken: "jwt",
        assetCode: "USDC",
        type: "bank_account",
        account: ACCOUNT,
        amount: "50",
        dest: "DE89370400440532013000",
        fetchImpl,
      });

      const url = calledUrl(fetchImpl);
      expect(url.pathname).toBe("/sep6/withdraw");
      expect(url.searchParams.get("dest")).toBe("DE89370400440532013000");
      expect(url.searchParams.get("type")).toBe("bank_account");
      expect(result).toMatchObject({
        kind: "withdraw",
        accountId: "GANCHORWITHDRAWACCOUNT",
        memoType: "id",
        memo: "123",
        id: "wd-1",
        feePercent: 0.5,
      });
    });

    it("returns customer_info_needed on a 403 KYC body", async () => {
      const fetchImpl = mockFetch(
        {
          type: "non_interactive_customer_info_needed",
          fields: ["bank_account_number"],
        },
        403,
      );
      const result = await sep6Withdraw({
        transferServer: SERVER,
        assetCode: "USDC",
        type: "bank_account",
        fetchImpl,
      });
      expect(result.kind).toBe("customer_info_needed");
    });

    it("requires a withdrawal type", async () => {
      await expect(
        sep6Withdraw({
          transferServer: SERVER,
          assetCode: "USDC",
          type: "",
          fetchImpl: mockFetch({}),
        }),
      ).rejects.toThrow(/type is required/);
    });
  });

  describe("fetchSep6Transaction", () => {
    it("returns the transaction object", async () => {
      const fetchImpl = mockFetch({
        transaction: {
          id: "dep-1",
          kind: "deposit",
          status: "pending_user_transfer_start",
        },
      });
      const tx = await fetchSep6Transaction({
        transferServer: SERVER,
        id: "dep-1",
        fetchImpl,
      });
      expect(calledUrl(fetchImpl).searchParams.get("id")).toBe("dep-1");
      expect(tx.status).toBe("pending_user_transfer_start");
    });

    it("throws Sep6Error with status 404 for an unknown id", async () => {
      const fetchImpl = mockFetch({ error: "not found" }, 404);
      await expect(
        fetchSep6Transaction({
          transferServer: SERVER,
          id: "missing",
          fetchImpl,
        }),
      ).rejects.toMatchObject({ status: 404 });
    });

    it("throws when the body has no transaction object", async () => {
      const fetchImpl = mockFetch({});
      await expect(
        fetchSep6Transaction({
          transferServer: SERVER,
          id: "dep-1",
          fetchImpl,
        }),
      ).rejects.toThrow(/missing the transaction object/);
    });
  });
});
