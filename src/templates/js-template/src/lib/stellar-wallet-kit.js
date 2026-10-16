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
    // the kit instead of holding the network it was first constructed with
    // (#797). Without this, signing after a switch to mainnet used the
    // testnet kit.
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
/** The network the current kit instance was built for (null before first use). */
export const getKitNetwork = () => currentNetwork;
// Re-exported so callers (e.g. WalletProvider) can read the enum's runtime
// value off this module instead of importing the kit package themselves.
export { WalletNetwork };
/**
 * Signs a transaction with the connected wallet.
 *
 * Pass `network` (a WalletNetwork value) so the kit is re-pointed before
 * signing if the app switched networks since the kit was created, and
 * `networkPassphrase` so the wallet signs for the same network the
 * transaction was built for (#797). Both are optional for backwards
 * compatibility; without them the current kit instance's network is used.
 */
export const signTransaction = async ({ unsignedTransaction, address, network, networkPassphrase, }) => {
    const { signedTxXdr } = await getKit(network).signTransaction(unsignedTransaction, {
        address,
        ...(networkPassphrase ? { networkPassphrase } : {}),
    });
    return signedTxXdr;
};
