import { useState, useCallback, useEffect } from 'react';
import { Networks } from '@stellar/stellar-sdk';
import type {
  StellarAccountDetails,
  StellarAccountState,
  UseStellarAccountOptions,
} from '../../src/hooks/useStellarAccount';

export type StellarAccountScenario =
  | 'multisig'
  | 'singleSigner'
  | 'lockoutRisk'
  | 'unfunded'
  | 'loading'
  | 'error';

const PRIMARY_ACCOUNT =
  'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const COSIGNER_ONE =
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const COSIGNER_TWO =
  'GABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQHGPC';

let activeScenario: StellarAccountScenario = 'multisig';

export function __setStellarAccountScenario(
  scenario: StellarAccountScenario,
): void {
  activeScenario = scenario;
}

function buildAccount(
  publicKey: string,
  scenario: StellarAccountScenario,
): Omit<StellarAccountState, 'refresh' | 'horizonUrl' | 'networkPassphrase'> {
  switch (scenario) {
    case 'loading':
      return {
        account: null,
        signers: [],
        thresholds: null,
        flags: null,
        sequence: null,
        exists: false,
        loading: true,
        error: null,
      };
    case 'unfunded':
      return {
        account: null,
        signers: [],
        thresholds: null,
        flags: null,
        sequence: null,
        exists: false,
        loading: false,
        error: null,
      };
    case 'error':
      return {
        account: null,
        signers: [],
        thresholds: null,
        flags: null,
        sequence: null,
        exists: false,
        loading: false,
        error: new Error('Unable to reach Horizon testnet endpoint'),
      };
    case 'singleSigner': {
      const details: StellarAccountDetails = {
        id: publicKey,
        accountId: publicKey,
        sequence: '104857600001',
        subentryCount: 1,
        thresholds: {
          low_threshold: 0,
          med_threshold: 0,
          high_threshold: 0,
        },
        flags: {
          auth_required: false,
          auth_revocable: false,
          auth_immutable: false,
        },
        signers: [{ key: publicKey, weight: 1, type: 'ed25519_public_key' }],
      };
      return {
        account: details,
        signers: details.signers,
        thresholds: details.thresholds,
        flags: details.flags,
        sequence: details.sequence,
        exists: true,
        loading: false,
        error: null,
      };
    }
    case 'lockoutRisk': {
      const details: StellarAccountDetails = {
        id: publicKey,
        accountId: publicKey,
        sequence: '104857600002',
        subentryCount: 2,
        thresholds: {
          low_threshold: 2,
          med_threshold: 3,
          high_threshold: 4,
        },
        flags: {
          auth_required: false,
          auth_revocable: false,
          auth_immutable: false,
        },
        signers: [
          { key: publicKey, weight: 1, type: 'ed25519_public_key' },
          { key: COSIGNER_ONE, weight: 2, type: 'ed25519_public_key' },
        ],
      };
      return {
        account: details,
        signers: details.signers,
        thresholds: details.thresholds,
        flags: details.flags,
        sequence: details.sequence,
        exists: true,
        loading: false,
        error: null,
      };
    }
    case 'multisig':
    default: {
      const details: StellarAccountDetails = {
        id: publicKey,
        accountId: publicKey,
        sequence: '104857600003',
        subentryCount: 3,
        thresholds: {
          low_threshold: 1,
          med_threshold: 2,
          high_threshold: 2,
        },
        flags: {
          auth_required: false,
          auth_revocable: false,
          auth_immutable: false,
        },
        signers: [
          { key: publicKey, weight: 1, type: 'ed25519_public_key' },
          { key: COSIGNER_ONE, weight: 1, type: 'ed25519_public_key' },
          { key: COSIGNER_TWO, weight: 1, type: 'ed25519_public_key' },
        ],
      };
      return {
        account: details,
        signers: details.signers,
        thresholds: details.thresholds,
        flags: details.flags,
        sequence: details.sequence,
        exists: true,
        loading: false,
        error: null,
      };
    }
  }
}

export function useStellarAccount(
  publicKey?: string | null,
  options: UseStellarAccountOptions = {},
): StellarAccountState {
  const key = publicKey?.trim() || PRIMARY_ACCOUNT;
  const horizonUrl = options.horizonUrl ?? 'https://horizon-testnet.stellar.org';
  const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;

  const compute = useCallback(() => {
    if (!publicKey?.trim()) {
      return {
        account: null,
        signers: [],
        thresholds: null,
        flags: null,
        sequence: null,
        exists: false,
        loading: false,
        error: null,
      };
    }
    return buildAccount(key, activeScenario);
  }, [key, publicKey]);

  const [state, setState] = useState(compute);

  useEffect(() => {
    setState(compute());
  }, [compute]);

  const refresh = useCallback(async () => {
    setState(compute());
  }, [compute]);

  return {
    ...state,
    horizonUrl,
    networkPassphrase,
    refresh,
  };
}
