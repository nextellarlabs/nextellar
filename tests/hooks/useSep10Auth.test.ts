/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { Keypair, Networks, Transaction, WebAuth } from "@stellar/stellar-sdk";
import {
  useSep10Auth,
  type Sep10Signer,
} from "../../src/templates/default/src/hooks/useSep10Auth";
import { sep10TokenExpiry } from "../../src/templates/default/src/lib/sep10";

const HOME_DOMAIN = "testanchor.stellar.org";
const ENDPOINT = "https://testanchor.stellar.org/auth";
const NETWORK = Networks.TESTNET;

const server = Keypair.random();
const client = Keypair.random();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** A JWT with the given `exp` (seconds). Only the payload matters to the client. */
function jwt(expSeconds: number): string {
  const part = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "none" })}.${part({ sub: client.publicKey(), exp: expSeconds })}.sig`;
}

function challenge(
  opts: { signer?: Keypair; account?: string; timeout?: number } = {},
): string {
  return WebAuth.buildChallengeTx(
    opts.signer ?? server,
    opts.account ?? client.publicKey(),
    HOME_DOMAIN,
    opts.timeout ?? 300,
    NETWORK,
    "testanchor.stellar.org",
  );
}

/** Signs like a wallet would: adds the client's signature to the envelope. */
const keypairSigner: Sep10Signer = async (xdr, { networkPassphrase }) => {
  const tx = new Transaction(xdr, networkPassphrase);
  tx.sign(client);
  return tx.toEnvelope().toXDR("base64");
};

function anchor(challengeXdr: string, token: string) {
  return jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (!init || init.method === "GET") {
      return jsonResponse({
        transaction: challengeXdr,
        network_passphrase: NETWORK,
      });
    }
    // The anchor only issues a JWT for a challenge the client actually signed.
    const { transaction } = JSON.parse(String(init.body)) as {
      transaction: string;
    };
    const signers = WebAuth.verifyChallengeTxSigners(
      transaction,
      server.publicKey(),
      NETWORK,
      [client.publicKey()],
      HOME_DOMAIN,
      "testanchor.stellar.org",
    );
    expect(signers).toEqual([client.publicKey()]);
    return jsonResponse({ token });
  });
}

function setup(
  fetchImpl: jest.Mock,
  signTransaction: Sep10Signer = keypairSigner,
) {
  return renderHook(() =>
    useSep10Auth({
      homeDomain: HOME_DOMAIN,
      authEndpoint: ENDPOINT,
      serverSigningKey: server.publicKey(),
      networkPassphrase: NETWORK,
      signTransaction,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  );
}

describe("useSep10Auth (#1448)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does nothing on mount", () => {
    const fetchImpl = jest.fn();
    const { result } = setup(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
  });

  it("fetches, verifies and signs the challenge, then returns and caches the JWT", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = jwt(exp);
    const fetchImpl = anchor(challenge(), token);
    const signTransaction = jest.fn(keypairSigner);
    const { result } = setup(fetchImpl, signTransaction);

    let returned = "";
    await act(async () => {
      returned = await result.current.authenticate(client.publicKey());
    });

    expect(returned).toBe(token);
    expect(result.current.token).toBe(token);
    expect(result.current.account).toBe(client.publicKey());
    expect(result.current.expiresAt).toBe(exp * 1000);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    const challengeUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(challengeUrl.searchParams.get("account")).toBe(client.publicKey());
    expect(challengeUrl.searchParams.get("home_domain")).toBe(HOME_DOMAIN);
    expect(signTransaction).toHaveBeenCalledWith(expect.any(String), {
      address: client.publicKey(),
      networkPassphrase: NETWORK,
    });

    // A second call reuses the cached JWT: no new challenge, no new signature.
    await act(async () => {
      await result.current.authenticate(client.publicKey());
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signTransaction).toHaveBeenCalledTimes(1);
  });

  it("restores an unexpired JWT from storage in a new hook instance", async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    const first = setup(anchor(challenge(), token));
    await act(async () => {
      await first.result.current.authenticate(client.publicKey());
    });

    const fetchImpl = jest.fn();
    const second = setup(fetchImpl);
    let returned = "";
    await act(async () => {
      returned = await second.result.current.authenticate(client.publicKey());
    });
    expect(returned).toBe(token);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("logout clears the JWT from memory and storage", async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    const { result } = setup(anchor(challenge(), token));
    await act(async () => {
      await result.current.authenticate(client.publicKey());
    });
    expect(window.localStorage.length).toBe(1);

    act(() => result.current.logout());

    expect(result.current.token).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });

  it("rejects a challenge not signed by the anchor's SIGNING_KEY and never asks the wallet to sign", async () => {
    const forged = challenge({ signer: Keypair.random() });
    const fetchImpl = anchor(forged, jwt(Math.floor(Date.now() / 1000) + 3600));
    const signTransaction = jest.fn(keypairSigner);
    const { result } = setup(fetchImpl, signTransaction);

    await act(async () => {
      await expect(
        result.current.authenticate(client.publicKey()),
      ).rejects.toThrow();
    });

    expect(signTransaction).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no token request
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("rejects an expired challenge", async () => {
    const stale = challenge({ timeout: 60 });
    const realNow = Date.now();
    const spy = jest
      .spyOn(Date, "now")
      .mockReturnValue(realNow + 10 * 60 * 1000);
    try {
      const signTransaction = jest.fn(keypairSigner);
      const { result } = setup(anchor(stale, "unused"), signTransaction);
      await act(async () => {
        await expect(
          result.current.authenticate(client.publicKey()),
        ).rejects.toThrow(/expired|time/i);
      });
      expect(signTransaction).not.toHaveBeenCalled();
      expect(result.current.error).toBeInstanceOf(Error);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a challenge issued for a different account", async () => {
    const other = Keypair.random().publicKey();
    const signTransaction = jest.fn(keypairSigner);
    const { result } = setup(
      anchor(challenge({ account: other }), "unused"),
      signTransaction,
    );

    await act(async () => {
      await expect(
        result.current.authenticate(client.publicKey()),
      ).rejects.toThrow(/not the requested account/);
    });
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("surfaces a wallet that refuses to sign as an error", async () => {
    const fetchImpl = anchor(challenge(), "unused");
    const refuse: Sep10Signer = async () => {
      throw new Error("User declined");
    };
    const { result } = setup(fetchImpl, refuse);

    await act(async () => {
      await expect(
        result.current.authenticate(client.publicKey()),
      ).rejects.toThrow("User declined");
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.error?.message).toBe("User declined");
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("surfaces the anchor's error when it refuses the challenge request", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ error: "account not found" }, 400),
    );
    const { result } = setup(fetchImpl);

    await act(async () => {
      await expect(
        result.current.authenticate(client.publicKey()),
      ).rejects.toThrow(/account not found/);
    });
    expect(result.current.error?.message).toMatch(/account not found/);
  });

  it("rejects a challenge for another network", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        transaction: challenge(),
        network_passphrase: Networks.PUBLIC,
      }),
    );
    const { result } = setup(fetchImpl);

    await act(async () => {
      await expect(
        result.current.authenticate(client.publicKey()),
      ).rejects.toThrow(/this app uses/);
    });
  });
});

describe("sep10TokenExpiry", () => {
  it("reads exp in milliseconds", () => {
    expect(sep10TokenExpiry(jwt(1_900_000_000))).toBe(1_900_000_000_000);
  });

  it("returns null for a token without a readable exp", () => {
    expect(sep10TokenExpiry("not-a-jwt")).toBeNull();
    expect(sep10TokenExpiry("a.b.c")).toBeNull();
  });
});
