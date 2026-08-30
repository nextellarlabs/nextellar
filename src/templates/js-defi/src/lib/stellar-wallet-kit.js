import { StellarWalletsKit, FREIGHTER_ID, FreighterModule, AlbedoModule, LobstrModule, xBullModule, HanaModule, WalletNetwork, } from "@creit.tech/stellar-wallets-kit";
// Placeholder for injected wallets
const INJECTED_WALLETS = {{WALLETS}};
let kitInstance = null;
let currentNetwork = null;
export const getKit = (network) => {
    if (typeof window === 'undefined') {
        return {};
    }
    // Re-initialize if the network has changed, so a network switch re-points
    // the kit instead of holding the network it was first constructed with.
    if (kitInstance && network && network !== currentNetwork) {
        kitInstance = null;
    }
    if (!kitInstance) {
        // Dynamic module loading based on INJECTED_WALLETS
        // or fallback to defaults if placeholder not replaced
        const modules = [];
        const walletList = Array.isArray(INJECTED_WALLETS) ? INJECTED_WALLETS : ['freighter', 'albedo', 'lobstr']; // Default fallback
        if (walletList.includes('freighter'))
            modules.push(new FreighterModule());
        if (walletList.includes('albedo'))
            modules.push(new AlbedoModule());
        if (walletList.includes('lobstr'))
            modules.push(new LobstrModule());
        if (walletList.includes('xbull'))
            modules.push(new xBullModule());
        if (walletList.includes('hana'))
            modules.push(new HanaModule());
        // Priority to the passed param, then the injected placeholder, then TESTNET.
        const targetNetwork = network || ('{{NETWORK}}' === 'PUBLIC' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET);
        currentNetwork = targetNetwork;
        kitInstance = new StellarWalletsKit({
            network: targetNetwork,
            selectedWalletId: FREIGHTER_ID,
            modules: modules.length > 0 ? modules : [new FreighterModule(), new AlbedoModule(), new LobstrModule()],
        });
    }
    return kitInstance;
};
// Export as function to ensure lazy evaluation
export const kit = (network) => getKit(network);
// Re-exported so callers (e.g. WalletProvider) can read the enum's runtime
// value off this already dynamically-imported module instead of importing
// `@creit.tech/stellar-wallets-kit` directly at module scope.
export { WalletNetwork };
export const signTransaction = async ({ unsignedTransaction, address, }) => {
    const { signedTxXdr } = await getKit().signTransaction(unsignedTransaction, {
        address,
        // Network is handled by the kit instance init
    });
    return signedTxXdr;
};
