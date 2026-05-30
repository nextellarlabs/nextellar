// Soroban contract invocation client used by `routes-d/routes/soroban.invoke.ts`.
//
// Tests inject a fake `rpc` so the suite never talks to a live Horizon /
// Soroban RPC. In production the caller builds a default client via
// `createDefaultSorobanClient()` which reads `SOROBAN_RPC_URL` and
// `STELLAR_NETWORK_PASSPHRASE`.

import { rpc as stellarRpc, Contract, TransactionBuilder, Networks, type Keypair } from '@stellar/stellar-sdk';

export interface InvocationResult {
  ok: true;
  contractId: string;
  method: string;
  resultXdr: string;
}

export interface InvocationError {
  ok: false;
  contractId: string;
  method: string;
  code: 'SIMULATION_FAILED' | 'SUBMIT_FAILED' | 'REVERT' | 'RPC_ERROR';
  message: string;
}

export type InvocationOutcome = InvocationResult | InvocationError;

export interface SorobanRpcLike {
  getAccount(publicKey: string): Promise<{ accountId: () => string; sequenceNumber: () => string; incrementSequenceNumber(): void }>;
  simulateTransaction(tx: unknown): Promise<{ result?: { retval: { toXDR: (encoding: 'base64') => string } }; error?: string }>;
  sendTransaction(tx: unknown): Promise<{ status: 'PENDING' | 'ERROR' | 'DUPLICATE'; hash?: string; errorResult?: { toXDR: (encoding: 'base64') => string } }>;
  getTransaction(hash: string): Promise<{ status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND'; returnValue?: { toXDR: (encoding: 'base64') => string }; resultXdr?: { toXDR: (encoding: 'base64') => string } }>;
}

export interface InvokeOptions {
  contractId: string;
  method: string;
  args?: unknown[];
  signer: Pick<Keypair, 'sign' | 'publicKey'>;
  networkPassphrase: string;
  /** Max attempts to poll for the final result after sendTransaction → PENDING. */
  pollAttempts?: number;
  /** Sleep helper, parameterisable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function invokeContract(
  rpc: SorobanRpcLike,
  opts: InvokeOptions,
): Promise<InvocationOutcome> {
  const { contractId, method, args = [], signer, networkPassphrase } = opts;
  const pollAttempts = opts.pollAttempts ?? 10;
  const sleep = opts.sleep ?? defaultSleep;

  let account;
  try {
    account = await rpc.getAccount(signer.publicKey());
  } catch (err) {
    return {
      ok: false,
      contractId,
      method,
      code: 'RPC_ERROR',
      message: err instanceof Error ? err.message : 'failed to load account',
    };
  }

  const contract = new Contract(contractId);
  // Cast through `any` here: the SDK's strict types require ScVal[] but we
  // also want to support callers that pass already-converted arguments.
  const operation = (contract as any).call(method, ...args);

  const tx = new TransactionBuilder(account as any, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  const sim = await rpc.simulateTransaction(tx);
  if (sim.error) {
    return {
      ok: false,
      contractId,
      method,
      code: 'SIMULATION_FAILED',
      message: sim.error,
    };
  }

  // Sign locally and submit.
  try {
    (tx as any).sign(signer);
  } catch (err) {
    return {
      ok: false,
      contractId,
      method,
      code: 'SUBMIT_FAILED',
      message: err instanceof Error ? err.message : 'failed to sign transaction',
    };
  }

  const submit = await rpc.sendTransaction(tx);
  if (submit.status === 'ERROR') {
    return {
      ok: false,
      contractId,
      method,
      code: 'SUBMIT_FAILED',
      message: submit.errorResult ? submit.errorResult.toXDR('base64') : 'sendTransaction returned ERROR',
    };
  }
  if (!submit.hash) {
    return {
      ok: false,
      contractId,
      method,
      code: 'RPC_ERROR',
      message: 'sendTransaction did not return a hash',
    };
  }

  // Poll for the final result. The Soroban RPC has its own retry behaviour
  // but in tests we want this loop to be deterministic.
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const status = await rpc.getTransaction(submit.hash);
    if (status.status === 'SUCCESS') {
      const xdr =
        status.returnValue?.toXDR('base64') ??
        status.resultXdr?.toXDR('base64') ??
        '';
      return { ok: true, contractId, method, resultXdr: xdr };
    }
    if (status.status === 'FAILED') {
      return {
        ok: false,
        contractId,
        method,
        code: 'REVERT',
        message: status.resultXdr ? status.resultXdr.toXDR('base64') : 'transaction reverted',
      };
    }
    await sleep(50);
  }

  return {
    ok: false,
    contractId,
    method,
    code: 'RPC_ERROR',
    message: `transaction ${submit.hash} did not reach a terminal status after ${pollAttempts} polls`,
  };
}

export function createDefaultSorobanClient(): { rpc: SorobanRpcLike; networkPassphrase: string } {
  const url = process.env.SOROBAN_RPC_URL ?? 'https://soroban-rpc.stellar.org:443';
  const networkPassphrase =
    process.env.STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET;
  const client = new (stellarRpc as any).Server(url) as unknown as SorobanRpcLike;
  return { rpc: client, networkPassphrase };
}
