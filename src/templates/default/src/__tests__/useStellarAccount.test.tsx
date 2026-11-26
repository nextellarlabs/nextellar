/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockHorizonCall = jest.fn();

await jest.unstable_mockModule('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn(() => ({
      accounts: () => ({
        accountId: () => ({ call: mockHorizonCall }),
      }),
    })),
  },
  Networks: {
    PUBLIC: 'Public Global Stellar Network ; September 2015',
    TESTNET: 'Test SDF Network ; September 2015',
  },
}));

const { useStellarAccount } = await import('../hooks/useStellarAccount.ts');

const publicKey = 'G'.padEnd(56, 'A');
const accountResponse = {
  id: 'account-record',
  account_id: publicKey,
  sequence: '12345',
  subentry_count: 1,
  thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
  flags: {
    auth_required: true,
    auth_revocable: false,
    auth_immutable: false,
    auth_clawback_enabled: false,
  },
  signers: [{ key: publicKey, weight: 1, type: 'ed25519_public_key' }],
  home_domain: 'example.org',
  num_sponsoring: 2,
  num_sponsored: 1,
  sponsor: 'G'.padEnd(56, 'B'),
};

describe('useStellarAccount', () => {
  beforeEach(() => {
    mockHorizonCall.mockReset();
    mockHorizonCall.mockResolvedValue(accountResponse);
  });

  it('loads typed account details and supports refreshing on demand', async () => {
    const { result } = renderHook(() =>
      useStellarAccount(publicKey, { network: 'PUBLIC' }),
    );

    await waitFor(() => expect(result.current.account?.account_id).toBe(publicKey));
    expect(result.current.account).toMatchObject({
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
      flags: { auth_required: true, auth_clawback_enabled: false },
      signers: [{ key: publicKey, weight: 1, type: 'ed25519_public_key' }],
      home_domain: 'example.org',
      num_sponsoring: 2,
      num_sponsored: 1,
      sponsor: 'G'.padEnd(56, 'B'),
    });
    expect(result.current.networkPassphrase).toBe('Public Global Stellar Network ; September 2015');

    await act(async () => {
      await result.current.refresh();
    });
    expect(mockHorizonCall).toHaveBeenCalledTimes(2);
  });

  it('treats an unfunded account as an empty result without an error', async () => {
    mockHorizonCall.mockRejectedValue(
      Object.assign(new Error('Not Found'), { response: { status: 404 } }),
    );
    const { result } = renderHook(() => useStellarAccount(publicKey));

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.account).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('reports Horizon server failures', async () => {
    mockHorizonCall.mockRejectedValue(
      Object.assign(new Error('Unavailable'), { response: { status: 503 } }),
    );
    const { result } = renderHook(() => useStellarAccount(publicKey));

    await waitFor(() => expect(result.current.error?.message).toContain('Network error'));
    expect(result.current.account).toBeNull();
  });

  it('reports malformed account responses', async () => {
    mockHorizonCall.mockResolvedValue({ account_id: publicKey });
    const { result } = renderHook(() => useStellarAccount(publicKey));

    await waitFor(() => expect(result.current.error?.message).toContain('Invalid account structure'));
    expect(result.current.account).toBeNull();
  });
});
