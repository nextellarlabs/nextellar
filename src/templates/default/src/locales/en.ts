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
  memo: {
    type: 'Memo type',
    label: 'Memo (optional)',
    none: 'None',
    text: 'Text',
    id: 'ID',
    hash: 'Hash',
    return: 'Return',
    placeholderNone: 'No memo',
    placeholderText: 'Up to 28 bytes of UTF-8 text',
    placeholderId: 'Unsigned 64-bit integer (e.g. 12345)',
    placeholderHash: '64 hex characters (32 bytes)',
    placeholderReturn: '64 hex characters (32 bytes)',
    lockedRequired: 'Memo required by {destination} (locked).',
  },
  fee: {
    label: 'Fee',
    selector: 'Fee preset',
    low: 'Low',
    standard: 'Standard',
    high: 'High',
    custom: 'Custom',
    estimatedCost: 'Estimated cost: {cost} XLM',
  },
} as const;
