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
    protocols: 'Protocols',
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
  protocols: {
    title: 'Stellar Protocol Demos',
    subtitle: 'Interactive testnet demonstrations of Claimable Balances, Path Payments, and Liquidity Pools.',
    claimableBalances: 'Claimable Balances',
    pathPayments: 'Path Payments',
    liquidityPools: 'Liquidity Pools',
    testnetMode: 'Testnet Mode',
    noWalletNotice: 'No wallet connected. Viewing in preview mode.',
    connectToTransact: 'Connect wallet to execute transactions.',
    routeFound: 'Optimal route found',
    noRouteFound: 'No conversion route found for this pair.',
    submitSuccess: 'Transaction confirmed!',
  },
} as const;
