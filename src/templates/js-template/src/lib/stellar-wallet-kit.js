import { StellarWalletsKit, FREIGHTER_ID, FreighterModule, AlbedoModule, LobstrModule, xBullModule, HanaModule, WalletNetwork, } from "@creit.tech/stellar-wallets-kit";
// Placeholder for injected wallets
const INJECTED_WALLETS = ["freighter", "albedo", "lobstr"];
let kitInstance = null;
export const getKit = () => {
    if (typeof window === 'undefined') {
        return {};
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
        kitInstance = new StellarWalletsKit({
            network: '{{NETWORK}}' === 'PUBLIC' ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
            selectedWalletId: FREIGHTER_ID,
            modules: modules.length > 0 ? modules : [new FreighterModule(), new AlbedoModule(), new LobstrModule()],
        });
    }
    return kitInstance;
};
// Export as function to ensure lazy evaluation
export const kit = () => getKit();
export const signTransaction = async ({ unsignedTransaction, address, }) => {
    const { signedTxXdr } = await getKit().signTransaction(unsignedTransaction, {
        address,
        // Network is handled by the kit instance init
    });
    return signedTxXdr;
};
