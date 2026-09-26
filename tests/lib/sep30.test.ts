import { StellarToml } from '@stellar/stellar-sdk';
import {
  discoverSep30RecoveryServer,
  registerSep30Account,
  recoverSep30Account,
} from '../../src/templates/default/src/lib/sep30';

const mockResolve = jest.spyOn(StellarToml.Resolver, 'resolve');

describe('sep30 (#1052)', () => {
  beforeEach(() => {
    mockResolve.mockReset();
    global.fetch = jest.fn();
  });

  it('discovers RECOVERY_SIGNER from stellar.toml', async () => {
    mockResolve.mockResolvedValue({
      RECOVERY_SIGNER: 'https://recovery.example.org',
      SIGNING_KEY: 'G_SIGNER',
    } as never);

    const result = await discoverSep30RecoveryServer('example.com');
    expect(result.serverUrl).toBe('https://recovery.example.org');
    expect(result.signingKey).toBe('G_SIGNER');
  });

  it('registers recovery signers via POST', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await registerSep30Account({
      serverUrl: 'https://recovery.example.org',
      accountId: 'G_ACCOUNT',
      authToken: 'jwt-token',
      signers: ['G_SIGNER_1'],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://recovery.example.org/accounts/G_ACCOUNT/signers',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requests recovery transaction from server', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ transaction: 'AAAA...' }),
    });

    const result = await recoverSep30Account({
      serverUrl: 'https://recovery.example.org',
      accountId: 'G_ACCOUNT',
      recoveryToken: 'share-token',
    });

    expect(result.transaction).toBe('AAAA...');
  });
});
