import {
  StellarWalletsKit,
  FREIGHTER_ID,
  FreighterModule,
  AlbedoModule,
  LobstrModule,
  WalletNetwork,
} from "@creit.tech/stellar-wallets-kit";

export const kit: StellarWalletsKit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  selectedWalletId: FREIGHTER_ID,
  modules: [new FreighterModule(), new AlbedoModule(), new LobstrModule()],
  modalParams: {
    modalTitle: "Connect to your favorite wallet",
    learnMoreText: "The Stellar SDK has been integrated into this template. Use the reusable Connect Wallet button component in any project.",
    hideLearnMore: true,
    theme: {
      background: 'var(--background)',
      text: 'var(--foreground)',
      primary: 'rgb(0, 0, 0)',
      primaryHover: 'rgb(31, 41, 55)',
      secondary: 'rgb(243, 244, 246)',
      secondaryHover: 'rgb(229, 231, 235)',
      border: 'rgb(229, 231, 235)',
      borderRadius: '0.75rem',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", Arial, sans-serif'
    }
  }
});

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

  const { signedTxXdr } = await kit.signTransaction(unsignedTransaction, {
    address,
    networkPassphrase,
  });

  return signedTxXdr;
};