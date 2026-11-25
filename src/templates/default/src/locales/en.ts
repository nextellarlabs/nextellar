/**
 * Example English locale — the reference shape every other locale must
 * match (see `I18nProvider`'s `locales` registry). Add a new locale by
 * copying this file, translating every value, and keeping every key.
 */
export const en = {
  common: {
    connect: 'Connect Wallet',
    disconnect: 'Disconnect',
    loading: 'Loading…',
    cancel: 'Cancel',
    confirm: 'Confirm',
    copy: 'Copy',
    copied: 'Copied',
  },
  nav: {
    home: 'Home',
    dashboard: 'Dashboard',
    settings: 'Settings',
  },
  wallet: {
    notConnected: 'No wallet connected',
    connected: 'Connected as {address}',
    network: 'Network: {network}',
    balance: 'Balance: {amount} {asset}',
  },
  home: {
    title: 'Welcome to Nextellar',
    subtitle: 'A scaffold for building on Stellar.',
  },
  addressInput: {
    label: 'Stellar address',
    placeholder: 'G..., M..., or C... Stellar address',
    copy: 'Copy address',
    copied: 'Copied',
    paste: 'Paste address',
    clear: 'Clear address',
    validAccount: 'Valid Stellar classic account (G...)',
    validMuxed: 'Valid Stellar muxed account (M...)',
    validContract: 'Valid Soroban contract address (C...)',
    errors: {
      required: 'Stellar address is required.',
      invalidFormat:
        'Enter a valid Stellar G..., M..., or C... address with a valid StrKey checksum.',
      invalidAccountChecksum:
        'Invalid classic account (G...) checksum or length.',
      invalidMuxedChecksum:
        'Invalid muxed account (M...) checksum or length.',
      invalidContractChecksum:
        'Invalid Soroban contract address (C...) checksum or length.',
      disallowedType:
        'Address type {type}... is not allowed here (accepted: {allowed}).',
      clipboardReadFailed:
        'Unable to read from clipboard. Paste manually instead.',
      clipboardWriteFailed: 'Unable to copy address to clipboard.',
    },
  },
  signerManager: {
    title: 'Account Signers & Thresholds',
    subtitle:
      'Manage Ed25519 signers, master key weight, and operation thresholds via Stellar setOptions.',
    connectPrompt:
      'Connect your Stellar wallet or provide an account address to inspect and manage signers.',
    unfundedNotice:
      'This account has not been funded on the selected network yet. Fund it first before configuring signers.',
    loading: 'Loading account signers and thresholds…',
    refresh: 'Refresh account',
    retry: 'Retry',
    currentSignersHeading: 'Current Signers',
    masterKeyBadge: 'Master key',
    coSignerBadge: 'Co-signer',
    weightBadge: 'Weight: {weight}',
    removeSigner: 'Remove',
    undoRemove: 'Keep',
    markedForRemoval: 'Pending removal (weight -> 0)',
    thresholdsHeading: 'Operation Thresholds & Master Weight',
    masterWeightLabel: 'Master key weight (0-255)',
    lowThresholdLabel: 'Low threshold (0-255)',
    medThresholdLabel: 'Medium threshold (0-255)',
    highThresholdLabel: 'High threshold (0-255)',
    effectiveTotalWeight: 'Effective total signer weight after changes: {weight}',
    addSignerHeading: 'Add or Update Co-Signer',
    newSignerAddressLabel: 'Co-signer public key (G...)',
    newSignerAddressPlaceholder: 'G... Ed25519 public key',
    newSignerWeightLabel: 'Signer weight (1-255)',
    stageSignerButton: 'Stage signer',
    stagedAdditionsHeading: 'Staged Signer Updates',
    unstageSigner: 'Discard',
    resetChanges: 'Reset changes',
    buildTransaction: 'Build setOptions Transaction',
    buildingTransaction: 'Building transaction…',
    xdrHeading: 'Unsigned setOptions Transaction XDR',
    copyXdr: 'Copy XDR',
    copiedXdr: 'Copied XDR',
    operationsCount: 'Operations included: {count}',
    noPendingChanges:
      'Modify thresholds, master weight, or signers above to build a setOptions transaction.',
    lockoutWarningTitle: 'Account Lockout Risk Detected',
    lockoutAcknowledgeLabel:
      'I understand these settings can permanently lock this Stellar account or restrict future signer updates.',
    warnings: {
      zeroTotalWeight:
        'Total effective signer weight will be 0. This permanently bricks the account and freezes all funds.',
      masterDisabledNoCoSigners:
        'Setting master key weight to 0 without active co-signers permanently locks the account.',
      belowLowThreshold:
        'Total effective weight ({total}) is below the low threshold ({threshold}). All operations on this account will fail.',
      belowMedThreshold:
        'Total effective weight ({total}) is below the medium threshold ({threshold}). Payments, offers, and trustline changes will fail.',
      belowHighThreshold:
        'Total effective weight ({total}) is below the high threshold ({threshold}). Future signer or threshold updates (setOptions) and account merge will be locked.',
      singlePointNoRedundancy:
        'Master key weight is 0 and only one co-signer remains. Losing that co-signer key will lock the account.',
    },
    errors: {
      invalidBounds:
        'Weights and thresholds must be whole numbers between 0 and 255.',
      invalidSignerAddress:
        'Enter a valid Ed25519 Stellar public key (G...) for the co-signer.',
      invalidSignerWeight:
        'Co-signer weight must be a whole number between 1 and 255 (use Remove to set weight 0).',
      cannotAddMasterAsCoSigner:
        'Use the Master key weight field above to change the primary account key weight.',
      acknowledgeRequired:
        'Confirm the lockout warning checkbox before building this high-risk setOptions transaction.',
      buildFailed: 'Failed to build setOptions transaction: {reason}',
    },
  },
} as const;
