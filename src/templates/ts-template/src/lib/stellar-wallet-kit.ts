import {
  StellarWalletsKit,
  FREIGHTER_ID,
  FreighterModule,
  AlbedoModule,
  LobstrModule,
  WalletNetwork,
} from "@creit.tech/stellar-wallets-kit";

let kitInstance: StellarWalletsKit | null = null;

export const getKit = (): StellarWalletsKit => {
  if (typeof window === 'undefined') {
    // Return a mock during SSR
    return {} as StellarWalletsKit;
  }
  
  if (!kitInstance) {
    kitInstance = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule(), new AlbedoModule(), new LobstrModule()],
    });
  }
  
  return kitInstance;
};

// For backward compatibility
export const kit = typeof window !== 'undefined' ? getKit() : {} as StellarWalletsKit;

interface signTransactionProps {
  unsignedTransaction: string;
  address: string;
}

export const signTransaction = async ({
  unsignedTransaction,
  address,
}: signTransactionProps): Promise<string> => {
  // Get current network from localStorage since this is a utility function
  const currentNetwork =
    (localStorage.getItem("network") as "testnet" | "mainnet") || "testnet";

  const networkPassphrase =
    currentNetwork === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;

  const { signedTxXdr } = await getKit().signTransaction(unsignedTransaction, {
    address,
    networkPassphrase,
  });

  return signedTxXdr;
};