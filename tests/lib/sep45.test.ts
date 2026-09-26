import { xdr, Address, Keypair, StellarToml } from "@stellar/stellar-sdk";
import {
  discoverSep45Endpoint,
  fetchSep45Challenge,
  verifySep45Challenge,
  signSep45ClientEntry,
  submitSep45Token,
  type Sep45Challenge,
} from "../../src/templates/default/src/lib/sep45";

// `StellarToml.Resolver.resolve` makes a real network call under the hood;
// spy on just that entry point (rather than mocking the whole module) so
// `discoverSep45Endpoint` still exercises its own field-extraction/validation
// logic against a real object, only the network hop is stubbed out.
const mockResolve = jest.spyOn(StellarToml.Resolver, "resolve");

const HOME_DOMAIN = "example.com";
const WEB_AUTH_DOMAIN = "auth.example.com";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";

const clientKp = Keypair.random();
const serverKp = Keypair.random();
const contractId = Address.contract(Buffer.alloc(32, 7)).toString();

/** Builds a `web_auth_verify` args ScMap matching the shared fields every entry must carry. */
function buildArgsMap(overrides: Partial<Record<string, string>> = {}) {
  const fields: Record<string, string> = {
    account: clientKp.publicKey(),
    home_domain: HOME_DOMAIN,
    web_auth_domain: WEB_AUTH_DOMAIN,
    web_auth_domain_account: serverKp.publicKey(),
    nonce: "1234567890",
    ...overrides,
  };
  const entries = Object.entries(fields).map(
    ([key, value]) =>
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol(key),
        val: xdr.ScVal.scvString(value),
      }),
  );
  return xdr.ScVal.scvMap(entries);
}

interface BuildEntryOptions {
  holderAddress: string;
  argsMap: xdr.ScVal;
  functionName?: string;
  contractAddressId?: string;
  signed?: boolean;
  subInvocations?: xdr.SorobanAuthorizedInvocation[];
}

/** Builds a `SorobanAuthorizationEntry` credentialed to `holderAddress`, invoking `web_auth_verify(argsMap)`. */
function buildEntry({
  holderAddress,
  argsMap,
  functionName = "web_auth_verify",
  contractAddressId = contractId,
  signed = false,
  subInvocations = [],
}: BuildEntryOptions): xdr.SorobanAuthorizationEntry {
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: new Address(holderAddress).toScAddress(),
      nonce: new xdr.Int64(0n),
      signatureExpirationLedger: 0,
      signature: signed ? xdr.ScVal.scvString("signed") : xdr.ScVal.scvVoid(),
    }),
  );
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(contractAddressId).toScAddress(),
          functionName,
          args: [argsMap],
        }),
      ),
    subInvocations,
  });
  return new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation });
}

/** Builds a valid, matching client + server entry pair for the happy path. */
function buildValidEntryPair() {
  const argsMap = buildArgsMap();
  const clientEntry = buildEntry({
    holderAddress: clientKp.publicKey(),
    argsMap,
  });
  const serverEntry = buildEntry({
    holderAddress: serverKp.publicKey(),
    argsMap,
    signed: true,
  });
  return { clientEntry, serverEntry, argsMap };
}

function encodeEntriesForFixture(
  entries: xdr.SorobanAuthorizationEntry[],
): string {
  // Mirrors the module's own internal encode helper (re-derived here rather
  // than imported, since it isn't exported) so tests exercise
  // `fetchSep45Challenge`'s decode path against an independently-built
  // fixture, not a self-referential round trip through the module's own encoder.
  const count = Buffer.alloc(4);
  count.writeUInt32BE(entries.length, 0);
  return Buffer.concat([count, ...entries.map((e) => e.toXDR())]).toString(
    "base64",
  );
}

describe("discoverSep45Endpoint", () => {
  afterEach(() => {
    mockResolve.mockReset();
  });

  it("extracts the three required SEP-45 fields from stellar.toml", async () => {
    mockResolve.mockResolvedValue({
      WEB_AUTH_FOR_CONTRACTS_ENDPOINT: "https://auth.example.com/webauth",
      WEB_AUTH_CONTRACT_ID: contractId,
      SIGNING_KEY: serverKp.publicKey(),
    });

    const result = await discoverSep45Endpoint(HOME_DOMAIN);

    expect(result).toEqual({
      endpoint: "https://auth.example.com/webauth",
      contractId,
      serverSigningKey: serverKp.publicKey(),
    });
  });

  it("passes through allowHttp", async () => {
    mockResolve.mockResolvedValue({
      WEB_AUTH_FOR_CONTRACTS_ENDPOINT: "http://auth.example.com/webauth",
      WEB_AUTH_CONTRACT_ID: contractId,
      SIGNING_KEY: serverKp.publicKey(),
    });

    await discoverSep45Endpoint(HOME_DOMAIN, { allowHttp: true });

    expect(mockResolve).toHaveBeenCalledWith(HOME_DOMAIN, { allowHttp: true });
  });

  it.each([
    [
      "WEB_AUTH_FOR_CONTRACTS_ENDPOINT",
      { WEB_AUTH_CONTRACT_ID: contractId, SIGNING_KEY: serverKp.publicKey() },
    ],
    [
      "WEB_AUTH_CONTRACT_ID",
      {
        WEB_AUTH_FOR_CONTRACTS_ENDPOINT: "https://x",
        SIGNING_KEY: serverKp.publicKey(),
      },
    ],
    [
      "SIGNING_KEY",
      {
        WEB_AUTH_FOR_CONTRACTS_ENDPOINT: "https://x",
        WEB_AUTH_CONTRACT_ID: contractId,
      },
    ],
  ])("throws when %s is missing", async (missingField, toml) => {
    mockResolve.mockResolvedValue(toml);

    await expect(discoverSep45Endpoint(HOME_DOMAIN)).rejects.toThrow(
      missingField,
    );
  });
});

describe("fetchSep45Challenge", () => {
  it("decodes the base64 XDR authorization_entries array from the server response", async () => {
    const { clientEntry, serverEntry } = buildValidEntryPair();
    const raw = encodeEntriesForFixture([clientEntry, serverEntry]);

    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        authorization_entries: raw,
        network_passphrase: NETWORK_PASSPHRASE,
      }),
    });

    const challenge = await fetchSep45Challenge({
      endpoint: "https://auth.example.com/webauth",
      account: clientKp.publicKey(),
      homeDomain: HOME_DOMAIN,
      fetchImpl,
    });

    expect(challenge.entries).toHaveLength(2);
    expect(challenge.raw).toBe(raw);
    expect(challenge.networkPassphrase).toBe(NETWORK_PASSPHRASE);
    // Round trip: each decoded entry's own XDR matches what was encoded.
    expect(challenge.entries[0].toXDR().equals(clientEntry.toXDR())).toBe(true);
    expect(challenge.entries[1].toXDR().equals(serverEntry.toXDR())).toBe(true);
  });

  it("includes clientDomain and account/home_domain query params in the request", async () => {
    const { clientEntry } = buildValidEntryPair();
    const raw = encodeEntriesForFixture([clientEntry]);
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authorization_entries: raw }),
    });

    await fetchSep45Challenge({
      endpoint: "https://auth.example.com/webauth",
      account: clientKp.publicKey(),
      homeDomain: HOME_DOMAIN,
      clientDomain: "wallet.example",
      fetchImpl,
    });

    const calledUrl = new URL(fetchImpl.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("account")).toBe(clientKp.publicKey());
    expect(calledUrl.searchParams.get("home_domain")).toBe(HOME_DOMAIN);
    expect(calledUrl.searchParams.get("client_domain")).toBe("wallet.example");
  });

  it("throws with the server's error message on a non-2xx response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid account" }),
    });

    await expect(
      fetchSep45Challenge({
        endpoint: "https://auth.example.com/webauth",
        account: clientKp.publicKey(),
        homeDomain: HOME_DOMAIN,
        fetchImpl,
      }),
    ).rejects.toThrow("invalid account");
  });

  it("falls back to the HTTP status when the response has no error field", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    await expect(
      fetchSep45Challenge({
        endpoint: "https://auth.example.com/webauth",
        account: clientKp.publicKey(),
        homeDomain: HOME_DOMAIN,
        fetchImpl,
      }),
    ).rejects.toThrow("HTTP 503");
  });

  it("throws when authorization_entries is missing from a 2xx response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(
      fetchSep45Challenge({
        endpoint: "https://auth.example.com/webauth",
        account: clientKp.publicKey(),
        homeDomain: HOME_DOMAIN,
        fetchImpl,
      }),
    ).rejects.toThrow('missing "authorization_entries"');
  });

  it("throws when authorization_entries has trailing bytes past the declared entry count", async () => {
    const { clientEntry } = buildValidEntryPair();
    const raw = encodeEntriesForFixture([clientEntry]);
    const corrupted = Buffer.concat([
      Buffer.from(raw, "base64"),
      Buffer.from([1, 2, 3, 4]),
    ]).toString("base64");

    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ authorization_entries: corrupted }),
    });

    await expect(
      fetchSep45Challenge({
        endpoint: "https://auth.example.com/webauth",
        account: clientKp.publicKey(),
        homeDomain: HOME_DOMAIN,
        fetchImpl,
      }),
    ).rejects.toThrow("trailing bytes");
  });
});

describe("verifySep45Challenge", () => {
  const baseOpts = {
    contractId,
    serverSigningKey: serverKp.publicKey(),
    homeDomain: HOME_DOMAIN,
    webAuthDomain: WEB_AUTH_DOMAIN,
    account: clientKp.publicKey(),
  };

  function challengeFrom(
    entries: xdr.SorobanAuthorizationEntry[],
  ): Sep45Challenge {
    return { entries, raw: encodeEntriesForFixture(entries) };
  }

  it("accepts a well-formed challenge and returns the shared args", () => {
    const { clientEntry, serverEntry, argsMap } = buildValidEntryPair();
    const args = verifySep45Challenge(
      challengeFrom([clientEntry, serverEntry]),
      baseOpts,
    );

    expect(args.account).toBe(clientKp.publicKey());
    expect(args.web_auth_domain_account).toBe(serverKp.publicKey());
    void argsMap;
  });

  it("throws when the challenge has no entries", () => {
    expect(() => verifySep45Challenge(challengeFrom([]), baseOpts)).toThrow(
      "no authorization entries",
    );
  });

  it("throws when an entry has sub-invocations", () => {
    const argsMap = buildArgsMap();
    const nested = buildEntry({ holderAddress: clientKp.publicKey(), argsMap });
    const entryWithSub = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap,
      subInvocations: [nested.rootInvocation()],
    });
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(
        challengeFrom([entryWithSub, serverEntry]),
        baseOpts,
      ),
    ).toThrow("must not contain sub-invocations");
  });

  it("throws when the function name is not web_auth_verify", () => {
    const argsMap = buildArgsMap();
    const badEntry = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap,
      functionName: "other_fn",
    });
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([badEntry, serverEntry]), baseOpts),
    ).toThrow('expected function "web_auth_verify"');
  });

  it("throws when args differ across entries", () => {
    const clientArgs = buildArgsMap();
    const serverArgs = buildArgsMap({ nonce: "different-nonce" });
    const clientEntry = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap: clientArgs,
    });
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap: serverArgs,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([clientEntry, serverEntry]), baseOpts),
    ).toThrow('"nonce" differs across authorization entries');
  });

  it("throws when account does not match the requested Client Account", () => {
    const otherClient = Keypair.random();
    const argsMap = buildArgsMap({ account: otherClient.publicKey() });
    const clientEntry = buildEntry({
      holderAddress: otherClient.publicKey(),
      argsMap,
    });
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([clientEntry, serverEntry]), baseOpts),
    ).toThrow('"account" does not match');
  });

  it("throws when home_domain does not match", () => {
    const argsMap = buildArgsMap({ home_domain: "wrong-domain.com" });
    const clientEntry = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap,
    });
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([clientEntry, serverEntry]), baseOpts),
    ).toThrow('"home_domain" does not match');
  });

  it("throws when web_auth_domain does not match", () => {
    const argsMap = buildArgsMap({ web_auth_domain: "wrong-auth-domain.com" });
    const clientEntry = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap,
    });
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([clientEntry, serverEntry]), baseOpts),
    ).toThrow('"web_auth_domain" does not match');
  });

  it("throws when web_auth_domain_account does not match the Server Account", () => {
    const impostor = Keypair.random();
    const argsMap = buildArgsMap({
      web_auth_domain_account: impostor.publicKey(),
    });
    const clientEntry = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap,
    });
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([clientEntry, serverEntry]), baseOpts),
    ).toThrow('"web_auth_domain_account" does not match');
  });

  it("throws when clientDomain is expected but missing from args", () => {
    const { clientEntry, serverEntry } = buildValidEntryPair();

    expect(() =>
      verifySep45Challenge(challengeFrom([clientEntry, serverEntry]), {
        ...baseOpts,
        clientDomain: "wallet.example",
      }),
    ).toThrow('"client_domain" does not match');
  });

  it("throws when the Server Account entry is missing a signature", () => {
    const argsMap = buildArgsMap();
    const clientEntry = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap,
    });
    const unsignedServerEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: false,
    });

    expect(() =>
      verifySep45Challenge(
        challengeFrom([clientEntry, unsignedServerEntry]),
        baseOpts,
      ),
    ).toThrow("Server Account entry is missing a signature");
  });

  it("throws when no entry is credentialed to the Server Account", () => {
    const argsMap = buildArgsMap();
    const clientEntry = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([clientEntry]), baseOpts),
    ).toThrow("no authorization entry is credentialed to the Server Account");
  });

  it("throws when no entry is credentialed to the Client Account", () => {
    const argsMap = buildArgsMap();
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([serverEntry]), baseOpts),
    ).toThrow("no authorization entry is credentialed to the Client Account");
  });

  it("throws when an entry's contract_address does not match WEB_AUTH_CONTRACT_ID", () => {
    const wrongContractId = Address.contract(Buffer.alloc(32, 9)).toString();
    const argsMap = buildArgsMap();
    const clientEntry = buildEntry({
      holderAddress: clientKp.publicKey(),
      argsMap,
      contractAddressId: wrongContractId,
    });
    const serverEntry = buildEntry({
      holderAddress: serverKp.publicKey(),
      argsMap,
      signed: true,
    });

    expect(() =>
      verifySep45Challenge(challengeFrom([clientEntry, serverEntry]), baseOpts),
    ).toThrow('"contract_address" does not match WEB_AUTH_CONTRACT_ID');
  });
});

describe("signSep45ClientEntry and submitSep45Token", () => {
  it("signs only the client's entry, leaving others untouched, and submits the resulting XDR", async () => {
    const { clientEntry, serverEntry } = buildValidEntryPair();
    const challenge: Sep45Challenge = {
      entries: [clientEntry, serverEntry],
      raw: encodeEntriesForFixture([clientEntry, serverEntry]),
    };

    const signedEntries = await signSep45ClientEntry(challenge, {
      clientAccount: clientKp.publicKey(),
      signer: clientKp,
      networkPassphrase: NETWORK_PASSPHRASE,
      validUntilLedgerSeq: 1000,
    });

    expect(signedEntries).toHaveLength(2);
    // Server entry is untouched.
    expect(signedEntries[1].toXDR().equals(serverEntry.toXDR())).toBe(true);
    // Client entry was replaced (now has a real signature rather than scvVoid).
    expect(signedEntries[0].toXDR().equals(clientEntry.toXDR())).toBe(false);

    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "signed-jwt" }),
    });

    const token = await submitSep45Token({
      endpoint: "https://auth.example.com/webauth",
      entries: signedEntries,
      fetchImpl,
    });

    expect(token).toBe("signed-jwt");
    const [, requestInit] = fetchImpl.mock.calls[0];
    const body = JSON.parse(requestInit.body);
    expect(typeof body.authorization_entries).toBe("string");

    // What was submitted decodes back to the same signed entries (encode/decode round trip).
    const resubmittedBuffer = Buffer.from(body.authorization_entries, "base64");
    const count = resubmittedBuffer.readUInt32BE(0);
    expect(count).toBe(2);
  });

  it("throws when no entry in the challenge is credentialed to the given Client Account", async () => {
    const { serverEntry } = buildValidEntryPair();
    const challenge: Sep45Challenge = {
      entries: [serverEntry],
      raw: encodeEntriesForFixture([serverEntry]),
    };
    const otherClient = Keypair.random();

    await expect(
      signSep45ClientEntry(challenge, {
        clientAccount: otherClient.publicKey(),
        signer: otherClient,
        networkPassphrase: NETWORK_PASSPHRASE,
        validUntilLedgerSeq: 1000,
      }),
    ).rejects.toThrow(
      "no authorization entry is credentialed to the given Client Account",
    );
  });
});

describe("submitSep45Token error handling", () => {
  it("throws with the server's error message on a non-2xx response", async () => {
    const { clientEntry } = buildValidEntryPair();
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "signature invalid" }),
    });

    await expect(
      submitSep45Token({
        endpoint: "https://auth.example.com/webauth",
        entries: [clientEntry],
        fetchImpl,
      }),
    ).rejects.toThrow("signature invalid");
  });

  it("throws when the response is missing a token", async () => {
    const { clientEntry } = buildValidEntryPair();
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(
      submitSep45Token({
        endpoint: "https://auth.example.com/webauth",
        entries: [clientEntry],
        fetchImpl,
      }),
    ).rejects.toThrow('missing "token"');
  });
});
