/**
 * @jest-environment jsdom
 *
 * Unit tests for `useCreateClaimableBalance` template hook.
 */

import { jest } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';

const {
  mockLoadAccount,
  mockSubmitTransaction,
  resetHorizonMocks,
  createHorizonMock,
} = await import('../../src/mocks/stellar-horizon-mock.js');

await jest.unstable_mockModule('@stellar/stellar-sdk', async () => {
  const actual = await jest.requireActual<Record<string, unknown>>('@stellar/stellar-sdk');
  return createHorizonMock(actual);
});

const { Keypair, Account, Transaction, Networks } = (await import(
  '@stellar/stellar-sdk'
)) as unknown as typeof import('@stellar/stellar-sdk');

const { useCreateClaimableBalance } = await import(
  '../../src/templates/default/src/hooks/useCreateClaimableBalance.js'
);

const SOURCE_KP = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const SOURCE = SOURCE_KP.publicKey();
const SECRET = SOURCE_KP.secret();

const CLAIMANT_A = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11)).publicKey();
const CLAIMANT_B = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 17)).publicKey();
const USDC_ISSUER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 23)).publicKey();

function makeSourceAccount() {
  return new Account(SOURCE, '10');
}

describe('useCreateClaimableBalance', () => {
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    resetHorizonMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockLoadAccount.mockResolvedValue(makeSourceAccount());
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('builds and submits a claimable balance with multiple claimants and not/and/or predicates', async () => {
    mockSubmitTransaction.mockResolvedValue({ hash: 'cb_tx_hash_123' });

    const { result } = renderHook(() => useCreateClaimableBalance());
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    let submitResult: Awaited<ReturnType<typeof result.current.signAndSubmitWithSecret>>;
    await act(async () => {
      submitResult = await result.current.signAndSubmitWithSecret({
        source: SOURCE,
        secret: SECRET,
        asset: { code: 'USDC', issuer: USDC_ISSUER },
        amount: '25.1234567',
        memo: 'vesting',
        claimants: [
          {
            destination: CLAIMANT_A,
            predicate: {
              type: 'and',
              left: { type: 'not', predicate: { type: 'relBefore', seconds: 3600 } },
              right: { type: 'absBefore', timestamp: 1900000000 },
            },
          },
          {
            destination: CLAIMANT_B,
            predicate: {
              type: 'or',
              left: { type: 'unconditional' },
              right: { type: 'relBefore', seconds: 60 },
            },
          },
        ],
      });
    });

    expect(submitResult!.success).toBe(true);
    expect(submitResult!.txHash).toBe('cb_tx_hash_123');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    // Verify the submitted transaction contains the expected operation and claimants
    expect(mockSubmitTransaction).toHaveBeenCalledTimes(1);
    const submittedTx = mockSubmitTransaction.mock.calls[0][0] as InstanceType<typeof Transaction>;
    expect(submittedTx.operations).toHaveLength(1);
    const op = submittedTx.operations[0] as unknown as {
      type: string;
      amount: string;
      asset: { code: string; issuer: string };
      claimants: Array<{ destination: string }>;
    };
    expect(op.type).toBe('createClaimableBalance');
    expect(op.amount).toBe('25.1234567');
    expect(op.asset.code).toBe('USDC');
    expect(op.asset.issuer).toBe(USDC_ISSUER);
    expect(op.claimants).toHaveLength(2);
    expect(op.claimants[0].destination).toBe(CLAIMANT_A);
    expect(op.claimants[1].destination).toBe(CLAIMANT_B);
  });

  it('uses PUBLIC network passphrase when network is PUBLIC', async () => {
    const { result } = renderHook(() => useCreateClaimableBalance({ network: 'PUBLIC' }));

    let xdrStr = '';
    await act(async () => {
      xdrStr = await result.current.buildCreateClaimableBalanceXDR({
        source: SOURCE,
        amount: '10',
        claimants: [{ destination: CLAIMANT_A }],
      });
    });

    const parsed = new Transaction(xdrStr, Networks.PUBLIC);
    expect(parsed.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it('rejects invalid 7-decimal amounts and invalid claimant/asset inputs before calling Horizon', async () => {
    const { result } = renderHook(() => useCreateClaimableBalance());

    // More than 7 decimal places
    await act(async () => {
      await expect(
        result.current.buildCreateClaimableBalanceXDR({
          source: SOURCE,
          amount: '1.12345678',
          claimants: [{ destination: CLAIMANT_A }],
        }),
      ).rejects.toThrow(/7 decimal places/);
    });
    expect(mockLoadAccount).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(/7 decimal places/);

    // Invalid claimant address
    await act(async () => {
      await expect(
        result.current.buildCreateClaimableBalanceXDR({
          source: SOURCE,
          amount: '5',
          claimants: [{ destination: 'NOT_A_VALID_KEY' }],
        }),
      ).rejects.toThrow(/Invalid claimant address/);
    });
    expect(mockLoadAccount).not.toHaveBeenCalled();

    // Invalid asset issuer
    await act(async () => {
      await expect(
        result.current.buildCreateClaimableBalanceXDR({
          source: SOURCE,
          asset: { code: 'USDC', issuer: 'BAD_ISSUER' },
          amount: '5',
          claimants: [{ destination: CLAIMANT_A }],
        }),
      ).rejects.toThrow(/Invalid asset issuer/);
    });
    expect(mockLoadAccount).not.toHaveBeenCalled();
  });

  it('surfaces Horizon loadAccount 404 and submission failure errors', async () => {
    mockLoadAccount.mockRejectedValueOnce(
      Object.assign(new Error('Not Found'), { response: { status: 404 } }),
    );

    const { result } = renderHook(() => useCreateClaimableBalance());

    await act(async () => {
      await expect(
        result.current.buildCreateClaimableBalanceXDR({
          source: SOURCE,
          amount: '10',
          claimants: [{ destination: CLAIMANT_A }],
        }),
      ).rejects.toThrow(/not found/i);
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error?.message).toMatch(/not found/i);

    // Submission failure with Stellar result codes
    mockLoadAccount.mockResolvedValueOnce(makeSourceAccount());
    mockSubmitTransaction.mockRejectedValueOnce({
      response: {
        status: 400,
        data: {
          extras: {
            result_codes: {
              transaction: 'tx_failed',
              operations: ['op_underfunded'],
            },
          },
        },
      },
    });

    let failedResult: Awaited<ReturnType<typeof result.current.signAndSubmitWithSecret>>;
    await act(async () => {
      failedResult = await result.current.signAndSubmitWithSecret({
        source: SOURCE,
        secret: SECRET,
        amount: '10',
        claimants: [{ destination: CLAIMANT_A }],
      });
    });

    expect(failedResult!.success).toBe(false);
    expect(failedResult!.resultCodes?.operations).toEqual(['op_underfunded']);
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.reset();
    });
    expect(result.current.error).toBeNull();
  });
});
