/**
 * @jest-environment jsdom
 *
 * E2E Test: contract-upgrade.e2e.test.ts (Issue #1288)
 *
 * Tests the complete Soroban contract lifecycle end-to-end against a real
 * local Soroban sandbox HTTP JSON-RPC server:
 *   1. Deploys a sample contract (WASM v1) to the local sandbox
 *   2. Queries initial contract logic on-chain ("1.0.0")
 *   3. Uses `useContractUpgrade` to build an unsigned `upgrade(new_wasm_hash)` transaction
 *   4. Signs and submits the upgrade transaction to the sandbox
 *   5. Verifies the new contract logic ("2.0.0") is live on-chain
 *   6. Uses `useContractUpgrade.buildExtendTtlXDR` to fetch live ledger entries and build TTL extension
 *
 * Gating:
 *   Gated behind `NEXTELLAR_E2E=1` (or `RUN_E2E=1`) to keep the standard test suite fast.
 *
 * USAGE:
 *   NEXTELLAR_E2E=1 npm test -- tests/e2e/contract-upgrade.e2e.test.ts
 */

import { jest } from "@jest/globals";
import crypto from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import * as StellarSDK from "@stellar/stellar-sdk";

import { useContractUpgrade } from "../../src/templates/default/src/hooks/useContractUpgrade";
import { useSorobanContract } from "../../src/templates/default/src/hooks/useSorobanContract";
import { pollTransactionStatus } from "../../src/templates/default/src/lib/soroban-helpers";
import {
  startLocalSorobanSandbox,
  type LocalSorobanSandbox,
} from "./helpers/soroban-sandbox";

import { http, passthrough } from "msw";
import { server as mswServer } from "../../src/mocks/server";

const SDK = ((StellarSDK as unknown as { default?: unknown }).default ||
  StellarSDK) as typeof StellarSDK;
const { Keypair, Address, xdr, rpc } = SDK;

const RUN_E2E =
  process.env.NEXTELLAR_E2E === "1" || process.env.RUN_E2E === "1";
const describeE2E = RUN_E2E ? describe : describe.skip;

jest.setTimeout(60000); // 1 minute timeout for E2E sandbox cycles

describeE2E(
  "e2e: contract deploy-then-upgrade against local Soroban sandbox (#1288)",
  () => {
    let sandbox: LocalSorobanSandbox;
    let adminKeypair: InstanceType<typeof Keypair>;
    let sampleContractId: string;

    // Minimal valid WASM binaries representing v1 and v2 contract bytecode
    const wasmHeader = Buffer.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ]);
    const sampleWasmV1 = Buffer.concat([
      wasmHeader,
      Buffer.from("nextellar-sample-contract-v1-initial-logic"),
    ]);
    const sampleWasmV2 = Buffer.concat([
      wasmHeader,
      Buffer.from("nextellar-sample-contract-v2-upgraded-logic"),
    ]);

    let wasmHashV1: Buffer;
    let wasmHashV2: Buffer;
    let wasmHashV2Hex: string;

    const configureMswBypass = () => {
      if (sandbox) {
        mswServer.use(
          http.all(`${sandbox.url}*`, () => passthrough()),
          http.all(`http://127.0.0.1:${sandbox.port}/*`, () => passthrough()),
        );
      }
    };

    beforeAll(async () => {
      // 1. Boot up local Soroban sandbox HTTP JSON-RPC server
      sandbox = await startLocalSorobanSandbox();
      configureMswBypass();

      // 2. Setup deployer / admin account
      adminKeypair = Keypair.random();

      // 3. Register WASMs and deploy initial contract
      const uploadedV1 = sandbox.uploadWasm(sampleWasmV1, "1.0.0");
      wasmHashV1 = uploadedV1.wasmHash;

      const uploadedV2 = sandbox.uploadWasm(sampleWasmV2, "2.0.0");
      wasmHashV2 = uploadedV2.wasmHash;
      wasmHashV2Hex = uploadedV2.wasmHashHex;

      // Deterministic valid contract ID (starts with 'C', 56 chars)
      sampleContractId = Address.contract(crypto.randomBytes(32)).toString();

      sandbox.deployContract({
        contractId: sampleContractId,
        wasmHash: wasmHashV1,
        version: "1.0.0",
      });
    });

    beforeEach(() => {
      configureMswBypass();
    });

    afterAll(async () => {
      if (sandbox) {
        await sandbox.stop();
      }
    });

    it("deploys sample contract and verifies initial logic is live", async () => {
      const { result: contractHook } = renderHook(() =>
        useSorobanContract({
          contractId: sampleContractId,
          sorobanRpc: sandbox.url,
          network: "TESTNET",
        }),
      );

      let initialVersion: unknown;
      await act(async () => {
        initialVersion = await contractHook.current.callFunction("version", []);
      });

      expect(initialVersion).toBe("1.0.0");
    });

    it("upgrades contract using useContractUpgrade and verifies new logic is live", async () => {
      const { result: upgradeHook } = renderHook(() =>
        useContractUpgrade({
          contractId: sampleContractId,
          sorobanRpc: sandbox.url,
          network: "TESTNET",
        }),
      );

      const { result: contractHook } = renderHook(() =>
        useSorobanContract({
          contractId: sampleContractId,
          sorobanRpc: sandbox.url,
          network: "TESTNET",
        }),
      );

      // 1. Build upgrade transaction using `useContractUpgrade` with new WASM hash
      let upgradeXdr = "";
      await act(async () => {
        upgradeXdr = await upgradeHook.current.buildUpgradeXDR(wasmHashV2Hex);
      });

      expect(upgradeXdr).toBeTruthy();
      expect(typeof upgradeXdr).toBe("string");

      // 2. Decode the generated transaction and verify it invokes `upgrade(newWasmHash)`
      const envelope = xdr.TransactionEnvelope.fromXDR(upgradeXdr, "base64");
      const op = envelope.v1().tx().operations()[0];
      expect(op.body().switch().name).toBe("invokeHostFunction");
      const hostFn = op.body().invokeHostFunctionOp().hostFunction();
      expect(hostFn.switch().name).toBe("hostFunctionTypeInvokeContract");
      const invoke = hostFn.invokeContract();
      expect(invoke.functionName().toString()).toBe("upgrade");
      const passedHash = Buffer.from(invoke.args()[0].bytes());
      expect(passedHash.equals(wasmHashV2)).toBe(true);

      // 3. Submit upgrade transaction to the sandbox
      let sendResult: rpc.Api.SendTransactionResponse | undefined;
      await act(async () => {
        sendResult = await contractHook.current.submitInvokeWithSecret(
          upgradeXdr,
          adminKeypair.secret(),
        );
      });

      expect(sendResult).toBeDefined();
      expect(sendResult!.status).toBe("PENDING");
      expect(sendResult!.hash).toHaveLength(64);

      // 4. Poll transaction status until confirmed SUCCESS on the sandbox
      const rpcServer = new rpc.Server(sandbox.url, { allowHttp: true });
      const confirmed = await pollTransactionStatus(
        rpcServer,
        sendResult!.hash,
        {
          timeoutMs: 5000,
          intervalMs: 100,
        },
      );
      expect(confirmed.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS);

      // 5. Query the contract again and verify the upgraded logic is live on-chain
      let upgradedVersion: unknown;
      await act(async () => {
        upgradedVersion = await contractHook.current.callFunction(
          "version",
          [],
        );
      });

      // The contract ID remains the same, but the executable logic has upgraded!
      expect(upgradedVersion).toBe("2.0.0");
      expect(upgradedVersion).not.toBe("1.0.0");
    });

    it("extends contract TTL via buildExtendTtlXDR against live sandbox ledger", async () => {
      const { result: upgradeHook } = renderHook(() =>
        useContractUpgrade({
          contractId: sampleContractId,
          sorobanRpc: sandbox.url,
          network: "TESTNET",
        }),
      );

      // buildExtendTtlXDR calls rpcServer.getLedgerEntries to fetch the contract's
      // active instance and wasm code entries from the sandbox
      let extendXdr = "";
      await act(async () => {
        extendXdr = await upgradeHook.current.buildExtendTtlXDR(500_000);
      });

      expect(extendXdr).toBeTruthy();

      const envelope = xdr.TransactionEnvelope.fromXDR(extendXdr, "base64");
      const op = envelope.v1().tx().operations()[0];
      expect(op.body().switch().name).toBe("extendFootprintTtl");
      expect(op.body().extendFootprintTtlOp().extendTo()).toBe(500_000);

      // Verify SorobanData footprint includes both instance and code entries
      const sorobanData = envelope.v1().tx().ext().sorobanData();
      expect(sorobanData).toBeDefined();
      const readOnlyKeys = sorobanData.resources().footprint().readOnly();
      expect(readOnlyKeys.length).toBe(2);

      // Verify one of the keys is contractCode pointing to the upgraded wasmHashV2
      const codeKey = readOnlyKeys.find(
        (k) => k.switch().name === "contractCode",
      );
      expect(codeKey).toBeDefined();
      expect(
        Buffer.from(codeKey!.contractCode().hash()).equals(wasmHashV2),
      ).toBe(true);
    });

    it("surfaces validation errors when given an invalid wasm hash or negative TTL", async () => {
      const { result: upgradeHook } = renderHook(() =>
        useContractUpgrade({
          contractId: sampleContractId,
          sorobanRpc: sandbox.url,
          network: "TESTNET",
        }),
      );

      await act(async () => {
        await expect(
          upgradeHook.current.buildUpgradeXDR("not-a-valid-hash"),
        ).rejects.toThrow(/invalid wasm hash/i);
      });

      await act(async () => {
        await expect(
          upgradeHook.current.buildExtendTtlXDR(-10),
        ).rejects.toThrow(/positive/i);
      });
    });
  },
);
