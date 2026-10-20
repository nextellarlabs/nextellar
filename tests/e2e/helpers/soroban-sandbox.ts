import http from "node:http";
import crypto from "node:crypto";
import { xdr, Address, SorobanDataBuilder } from "@stellar/stellar-sdk";

export interface SandboxDeployedContract {
  contractId: string;
  wasmHash: Buffer;
  version: string;
  state?: Map<string, unknown>;
}

export interface LocalSorobanSandboxOptions {
  port?: number;
  host?: string;
}

export interface LocalSorobanSandbox {
  server: http.Server;
  port: number;
  url: string;
  contracts: Map<string, SandboxDeployedContract>;
  wasms: Map<string, Buffer>;
  transactions: Map<
    string,
    { status: "SUCCESS" | "FAILED"; envelopeXdr: string; ledger: number }
  >;
  deployContract: (params: {
    contractId: string;
    wasmHash: Buffer;
    version: string;
  }) => SandboxDeployedContract;
  uploadWasm: (
    wasmBytes: Buffer,
    version?: string,
  ) => { wasmHash: Buffer; wasmHashHex: string };
  upgradeContract: (
    contractId: string,
    newWasmHash: Buffer,
    newVersion: string,
  ) => void;
  stop: () => Promise<void>;
}

/**
 * Start a local, in-process Soroban sandbox HTTP JSON-RPC server that models
 * contract deployment, invocation, upgrading, and TTL extension state transitions.
 */
export async function startLocalSorobanSandbox(
  options: LocalSorobanSandboxOptions = {},
): Promise<LocalSorobanSandbox> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;

  const contracts = new Map<string, SandboxDeployedContract>();
  const wasms = new Map<string, Buffer>();
  const wasmVersions = new Map<string, string>();
  const transactions = new Map<
    string,
    { status: "SUCCESS" | "FAILED"; envelopeXdr: string; ledger: number }
  >();

  let currentLedger = 100;

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Only accept POST requests for JSON-RPC
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed" }));
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(body) as {
          id?: string | number;
          method: string;
          params?: Record<string, unknown>;
        };

        const rpcId = payload.id ?? 1;
        const method = payload.method;
        const params = payload.params ?? {};

        // 1. getHealth
        if (method === "getHealth") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcId,
              result: { status: "healthy" },
            }),
          );
          return;
        }

        // 2. getLatestLedger
        if (method === "getLatestLedger") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcId,
              result: {
                id: crypto.randomBytes(32).toString("hex"),
                sequence: currentLedger,
                protocolVersion: 21,
              },
            }),
          );
          return;
        }

        // 3. getAccount
        if (method === "getAccount") {
          const address = String(params.address || "");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcId,
              result: {
                id: address,
                sequence: "1",
                balances: [
                  {
                    asset_type: "native",
                    balance: "10000.0000000",
                  },
                ],
              },
            }),
          );
          return;
        }

        // 4. getLedgerEntries
        if (method === "getLedgerEntries") {
          const keys = Array.isArray(params.keys)
            ? (params.keys as string[])
            : [];
          const entries: Array<{
            key: string;
            xdr: string;
            lastModifiedLedgerSeq: number;
            liveUntilLedgerSeq: number;
          }> = [];

          for (const keyStr of keys) {
            try {
              const ledgerKey = xdr.LedgerKey.fromXDR(keyStr, "base64");
              const keyType = ledgerKey.switch().name;

              if (keyType === "contractData") {
                const contractDataKey = ledgerKey.contractData();
                const contractAddress = Address.fromScAddress(
                  contractDataKey.contract(),
                ).toString();
                const isInstanceKey =
                  contractDataKey.key().switch().name ===
                  "scvLedgerKeyContractInstance";

                if (isInstanceKey && contracts.has(contractAddress)) {
                  const contractInfo = contracts.get(contractAddress)!;
                  const instance = new xdr.ScContractInstance({
                    executable: xdr.ContractExecutable.contractExecutableWasm(
                      contractInfo.wasmHash,
                    ),
                    storage: null,
                  });

                  const contractDataEntry = new xdr.ContractDataEntry({
                    ext: new xdr.ExtensionPoint(0),
                    contract: new Address(contractAddress).toScAddress(),
                    key: xdr.ScVal.scvLedgerKeyContractInstance(),
                    durability: xdr.ContractDataDurability.persistent(),
                    val: xdr.ScVal.scvContractInstance(instance),
                  });

                  const entryData =
                    xdr.LedgerEntryData.contractData(contractDataEntry);
                  entries.push({
                    key: keyStr,
                    xdr: entryData.toXDR("base64"),
                    lastModifiedLedgerSeq: currentLedger,
                    liveUntilLedgerSeq: currentLedger + 500_000,
                  });
                }
              } else if (keyType === "contractCode") {
                const codeKey = ledgerKey.contractCode();
                const hashBuf = codeKey.hash();
                const hashHex = hashBuf.toString("hex");

                if (wasms.has(hashHex)) {
                  const codeEntry = new xdr.ContractCodeEntry({
                    ext: new xdr.ExtensionPoint(0),
                    hash: hashBuf,
                    code: wasms.get(hashHex)!,
                  });
                  const entryData = xdr.LedgerEntryData.contractCode(codeEntry);
                  entries.push({
                    key: keyStr,
                    xdr: entryData.toXDR("base64"),
                    lastModifiedLedgerSeq: currentLedger,
                    liveUntilLedgerSeq: currentLedger + 500_000,
                  });
                }
              }
            } catch {
              // Ignore malformed keys
            }
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcId,
              result: {
                entries,
                latestLedger: currentLedger,
              },
            }),
          );
          return;
        }

        // 5. simulateTransaction
        if (method === "simulateTransaction") {
          const txBase64 = String(params.transaction || "");
          let retval: InstanceType<typeof xdr.ScVal> = xdr.ScVal.scvVoid();

          try {
            const envelope = xdr.TransactionEnvelope.fromXDR(
              txBase64,
              "base64",
            );
            const operations =
              envelope.switch().name === "envelopeTypeTx"
                ? envelope.v1().tx().operations()
                : [];

            for (const op of operations) {
              const body = op.body();
              const opType = body.switch().name;

              if (opType === "invokeHostFunction") {
                const hostFn = body.invokeHostFunctionOp().hostFunction();
                const fnType = hostFn.switch().name;

                if (fnType === "hostFunctionTypeUploadContractWasm") {
                  const wasmBytes = hostFn.wasm();
                  const hash = crypto
                    .createHash("sha256")
                    .update(wasmBytes)
                    .digest();
                  retval = xdr.ScVal.scvBytes(hash);
                } else if (fnType === "hostFunctionTypeInvokeContract") {
                  const invoke = hostFn.invokeContract();
                  const contractAddr = Address.fromScAddress(
                    invoke.contractAddress(),
                  ).toString();
                  const fnName = invoke.functionName().toString();
                  const fnArgs = invoke.args();

                  if (fnName === "upgrade") {
                    // Valid upgrade call: argument is 32-byte wasm hash
                    if (fnArgs.length > 0 && fnArgs[0].bytes()) {
                      retval = xdr.ScVal.scvVoid();
                    }
                  } else if (fnName === "version") {
                    const contract = contracts.get(contractAddr);
                    const ver = contract?.version ?? "1.0.0";
                    retval = xdr.ScVal.scvString(ver);
                  } else {
                    retval = xdr.ScVal.scvVoid();
                  }
                }
              } else if (opType === "extendFootprintTtl") {
                retval = xdr.ScVal.scvVoid();
              }
            }
          } catch {
            // Keep default retval if decoding fails
          }

          const defaultTxData = new SorobanDataBuilder()
            .build()
            .toXDR("base64");

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcId,
              result: {
                latestLedger: currentLedger,
                minResourceFee: "100",
                transactionData: defaultTxData,
                results: [
                  {
                    auth: [],
                    xdr: retval.toXDR("base64"),
                  },
                ],
                result: {
                  auth: [],
                  retval: retval.toXDR("base64"),
                },
              },
            }),
          );
          return;
        }

        // 6. sendTransaction
        if (method === "sendTransaction") {
          const txBase64 = String(params.transaction || "");
          const txHash = crypto
            .createHash("sha256")
            .update(Buffer.from(txBase64, "base64"))
            .digest("hex");

          try {
            const envelope = xdr.TransactionEnvelope.fromXDR(
              txBase64,
              "base64",
            );
            const operations =
              envelope.switch().name === "envelopeTypeTx"
                ? envelope.v1().tx().operations()
                : [];

            for (const op of operations) {
              const body = op.body();
              const opType = body.switch().name;

              if (opType === "invokeHostFunction") {
                const hostFn = body.invokeHostFunctionOp().hostFunction();
                const fnType = hostFn.switch().name;

                if (fnType === "hostFunctionTypeUploadContractWasm") {
                  const wasmBytes = hostFn.wasm();
                  const hash = crypto
                    .createHash("sha256")
                    .update(wasmBytes)
                    .digest();
                  wasms.set(hash.toString("hex"), wasmBytes);
                } else if (fnType === "hostFunctionTypeInvokeContract") {
                  const invoke = hostFn.invokeContract();
                  const contractAddr = Address.fromScAddress(
                    invoke.contractAddress(),
                  ).toString();
                  const fnName = invoke.functionName().toString();
                  const fnArgs = invoke.args();

                  if (fnName === "upgrade" && fnArgs.length > 0) {
                    const newHashBuf = Buffer.from(fnArgs[0].bytes());
                    const contract = contracts.get(contractAddr);
                    if (contract) {
                      contract.wasmHash = newHashBuf;
                      const newHashHex = newHashBuf.toString("hex");
                      const registeredVersion =
                        wasmVersions.get(newHashHex) ?? "2.0.0";
                      contract.version = registeredVersion;
                    }
                  }
                }
              }
            }
          } catch {
            // Continue
          }

          currentLedger++;
          transactions.set(txHash, {
            status: "SUCCESS",
            envelopeXdr: txBase64,
            ledger: currentLedger,
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcId,
              result: {
                status: "PENDING",
                hash: txHash,
                latestLedger: currentLedger,
                latestLedgerCloseTime: String(Math.floor(Date.now() / 1000)),
              },
            }),
          );
          return;
        }

        // 7. getTransaction
        if (method === "getTransaction") {
          const hash = String(params.hash || "");
          const tx = transactions.get(hash);

          if (!tx) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: rpcId,
                result: {
                  status: "NOT_FOUND",
                  latestLedger: currentLedger,
                },
              }),
            );
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: rpcId,
              result: {
                status: "SUCCESS",
                latestLedger: tx.ledger,
                latestLedgerCloseTime: String(Math.floor(Date.now() / 1000)),
                oldestLedger: 1,
                oldestLedgerCloseTime: "0",
                ledger: tx.ledger,
                createdAt: String(Math.floor(Date.now() / 1000)),
                applicationOrder: 1,
                feeBump: false,
                envelopeXdr: tx.envelopeXdr,
                resultXdr: "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAA=",
                resultMetaXdr: "AAAAAAAAAAA=",
              },
            }),
          );
          return;
        }

        // Fallback: method not found
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: rpcId,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          }),
        );
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            error: {
              code: -32603,
              message: (err as Error).message,
            },
          }),
        );
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(requestedPort, host, () => resolve());
    server.once("error", reject);
  });

  const address = server.address() as { address: string; port: number };
  const port = address.port;
  const url = `http://127.0.0.1:${port}/soroban/rpc`;

  const deployContract = (params: {
    contractId: string;
    wasmHash: Buffer;
    version: string;
  }): SandboxDeployedContract => {
    const deployed: SandboxDeployedContract = {
      contractId: params.contractId,
      wasmHash: params.wasmHash,
      version: params.version,
      state: new Map(),
    };
    contracts.set(params.contractId, deployed);
    wasmVersions.set(params.wasmHash.toString("hex"), params.version);
    return deployed;
  };

  const uploadWasm = (
    wasmBytes: Buffer,
    version?: string,
  ): { wasmHash: Buffer; wasmHashHex: string } => {
    const hash = crypto.createHash("sha256").update(wasmBytes).digest();
    const hex = hash.toString("hex");
    wasms.set(hex, wasmBytes);
    if (version) {
      wasmVersions.set(hex, version);
    }
    return { wasmHash: hash, wasmHashHex: hex };
  };

  const upgradeContract = (
    contractId: string,
    newWasmHash: Buffer,
    newVersion: string,
  ): void => {
    const contract = contracts.get(contractId);
    if (!contract) {
      throw new Error(`Contract "${contractId}" not found in sandbox`);
    }
    contract.wasmHash = newWasmHash;
    contract.version = newVersion;
  };

  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return {
    server,
    port,
    url,
    contracts,
    wasms,
    transactions,
    deployContract,
    uploadWasm,
    upgradeContract,
    stop,
  };
}
