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
  claimable: {
    title: 'Claimable balances',
    connect: 'Connect your wallet to view claimable balances.',
    loading: 'Loading claimable balances',
    empty: 'No claimable balances are pending.',
    loadError: 'Could not load claimable balances.',
    claimError: 'Could not claim the balance: {message}',
    claimed: 'Balance claimed successfully.',
    retry: 'Retry',
    refresh: 'Refresh claimable balances',
    claim: 'Claim',
    claiming: 'Claiming…',
    claimAsset: 'Claim {amount} {asset}',
    unavailable: 'Claim unavailable until its conditions are met.',
    walletUnavailable: 'Connect the matching wallet on the correct network to claim.',
    issuer: 'Issuer: {issuer}',
  },
  home: {
    title: 'Welcome to Nextellar',
    subtitle: 'A scaffold for building on Stellar.',
  },
} as const;
