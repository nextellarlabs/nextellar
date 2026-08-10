import {
  StellarWalletsKit,
  FREIGHTER_ID,
  FreighterModule,
  AlbedoModule,
  LobstrModule,
  xBullModule,
  HanaModule,
  WalletNetwork,
  ISupportedWallet,
} from "@creit.tech/stellar-wallets-kit";

// Placeholder for injected wallets. During scaffold-time this token is replaced
// with an array literal.
const INJECTED_WALLETS: string[] = ["freighter", "albedo", "lobstr"];

let kitInstance: StellarWalletsKit | null = null;
let currentNetwork: WalletNetwork | null = null;

export const getKit = (network?: WalletNetwork): StellarWalletsKit => {
  if (typeof window === 'undefined') {
    return {} as StellarWalletsKit;
  }
  
  // Re-initialize if network has changed
  if (kitInstance && network && network !== currentNetwork) {
    kitInstance = null;
  }

  if (!kitInstance) {
    // Dynamic module loading based on INJECTED_WALLETS
    // or fallback to defaults if placeholder not replaced
    const modules: any[] = [];
    const walletList = Array.isArray(INJECTED_WALLETS) ? INJECTED_WALLETS : ['freighter', 'albedo', 'lobstr']; // Default fallback

    if (walletList.includes('freighter')) modules.push(new FreighterModule());
    if (walletList.includes('albedo')) modules.push(new AlbedoModule());
    if (walletList.includes('lobstr')) modules.push(new LobstrModule());
    if (walletList.includes('xbull')) modules.push(new xBullModule());
    if (walletList.includes('hana')) modules.push(new HanaModule());

    // Determine network: priority to passed param, then injected placeholder, then default to TESTNET
    const targetNetwork = network || (('{{NETWORK}}' as string) === 'PUBLIC' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET);
    currentNetwork = targetNetwork;

    kitInstance = new StellarWalletsKit({
      network: ('{{NETWORK}}' as string) === 'PUBLIC' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: modules.length > 0 ? modules : [new FreighterModule(), new AlbedoModule(), new LobstrModule()],
    });
  }
  
  return kitInstance;
};

// Export as function to ensure lazy evaluation
export const kit = (network?: WalletNetwork) => getKit(network);

interface signTransactionProps {
  unsignedTransaction: string;
  address: string;
}

export const signTransaction = async ({
  unsignedTransaction,
  address,
}: signTransactionProps): Promise<string> => {
  const { signedTxXdr } = await getKit().signTransaction(unsignedTransaction, {
    address,
    // Network is handled by the kit instance init
  });

  return signedTxXdr;
};