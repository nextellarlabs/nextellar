# Secret Rotation Guidance for Nextellar Applications

This document provides step-by-step guidance for rotating exposed, compromised, or expiring secrets (wallet secret keys, Horizon/Soroban API credentials, and anchor integration keys) in generated Nextellar applications.

## 1. Immediate Actions Upon Secret Exposure

If a secret key or API token is accidentally committed to version control or leaked:

1. **Treat the credential as compromised immediately.**
2. **Rotate at the provider/issuing service first.** Removing the credential from Git history alone does NOT invalidate an exposed key.
3. Revoke active sessions or tokens associated with the old key.

## 2. Rotating Stellar & Soroban Wallet Secret Keys

1. **Deploying/Admin Key Rotation**:
   - Generate a new keypair using `stellar keys generate <key-name>` or freighter.
   - Fund the new account if operating on Testnet (`stellar keys fund <key-name>`).
   - Transfer contract ownership / admin roles to the new public key using Soroban contract admin functions.
   - Update your `.env.local` or environment secrets store with the new secret key:
     ```ini
     STELLAR_ADMIN_SECRET_KEY=S...
     ```

2. **User/App Test Accounts**:
   - Update seed phrases or secret keys in `.env.local`. Never store real Mainnet private keys in plaintext environment variables.

## 3. Rotating Anchor API Keys (SEP-24 / SEP-31 / SEP-38)

- Log into your Anchor dashboard or partner portal.
- Issue a new API Key / Client Secret.
- Revoke the previous API key.
- Update `.env.local`:
  ```ini
  ANCHOR_API_KEY=new_api_key_here
  ANCHOR_CLIENT_SECRET=new_client_secret_here
  ```
- Restart application server instances.

## 4. Rotating Soroban RPC & Horizon Endpoint Tokens

- If using a paid RPC provider (e.g., Blockdaemon, QuickNode, FastStellar):
  - Generate a new RPC endpoint URL / API token.
  - Update `NEXT_PUBLIC_SOROBAN_RPC_URL` and `NEXT_PUBLIC_HORIZON_URL`.
  - Disable the old token in your provider dashboard.
