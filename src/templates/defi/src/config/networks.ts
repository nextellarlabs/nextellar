export interface NetworkConfig {
  name: string;
  horizonUrl: string;
  sorobanUrl: string;
  passphrase: string;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  testnet: {
    name: "Testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    sorobanUrl: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    name: "Mainnet",
    horizonUrl: "https://horizon.stellar.org",
    sorobanUrl: "https://soroban.stellar.org",
    passphrase: "Public Global Stellar Network ; September 2015",
  },
};
