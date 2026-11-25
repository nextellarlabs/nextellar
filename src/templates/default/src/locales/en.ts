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
  pathPayment: {
    title: 'Swap {source} to {destination}',
    mode: {
      legend: 'Mode',
      strictSend: 'Strict send',
      strictReceive: 'Strict receive',
    },
    amount: {
      send: 'Amount to send ({asset})',
      receive: 'Amount to receive ({asset})',
      help: 'Up to 7 decimal places',
    },
    slippage: {
      label: 'Slippage {percent}%',
    },
    actions: {
      preview: 'Preview',
      submit: 'Submit swap',
    },
    preview: {
      rate: 'Rate',
      rateValue: '1 {source} = {rate} {destination}',
      route: 'Route',
      hops: 'Hops',
      worstCase: 'Worst case',
      minReceive: 'At least {amount} {asset}',
      maxSend: 'At most {amount} {asset}',
    },
    status: {
      awaitingSignature: 'Awaiting signature',
      submitted: 'Submitted',
    },
    errors: {
      invalidAmount: 'Enter a valid amount',
      noRoute: 'No route found',
      generic: 'Something went wrong',
    },
  },
} as const;
