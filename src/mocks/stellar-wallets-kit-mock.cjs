class StellarWalletsKit {
  constructor() {}
  async openModal({ onWalletSelected } = {}) {
    if (onWalletSelected) {
      await onWalletSelected({ id: FREIGHTER_ID, name: "Freighter" });
    }
  }
  setWallet() {}
  async getAddress() {
    return { address: "GMOCKPUBLICKEY000000000000000000000000000000000000000000000" };
  }
  async disconnect() {}
  async signTransaction() {
    return { signedTxXdr: "QUFBQUFRQUFBQUE9" };
  }
}

class FreighterModule {}
class AlbedoModule {}
class LobstrModule {}
class xBullModule {}
class HanaModule {}

const FREIGHTER_ID = "freighter";
const WalletNetwork = {
  TESTNET: "TESTNET",
  PUBLIC: "PUBLIC",
};

const exported = {
  StellarWalletsKit,
  FREIGHTER_ID,
  FreighterModule,
  AlbedoModule,
  LobstrModule,
  xBullModule,
  HanaModule,
  WalletNetwork,
};

module.exports = exported;
module.exports.default = exported;
