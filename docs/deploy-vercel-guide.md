# Deploying Nextellar dApps to Vercel

This guide provides step-by-step instructions for deploying your scaffolded Nextellar dApp to [Vercel](https://vercel.com).

## Prerequisites

- A Vercel account ([vercel.com/signup](https://vercel.com/signup))
- Your Nextellar project pushed to a GitHub repository
- Node.js 18+ installed locally

## Step 1: Connect Repository to Vercel

1. Log in to the [Vercel Dashboard](https://vercel.com/dashboard).
2. Click **Add New...** > **Project**.
3. Select your Git provider (GitHub) and import your Nextellar repository.
4. Select the **Next.js** Framework Preset (Vercel will auto-detect this).

## Step 2: Configure Environment Variables

Before clicking Deploy, expand the **Environment Variables** section and add the required Stellar/Soroban network environment variables:

| Variable Name | Description | Recommended Testnet Value |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | Target Stellar network | `testnet` |
| `NEXT_PUBLIC_HORIZON_URL` | Horizon REST API endpoint | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC server URL | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_FRIENDBOT_URL` | Friendbot account funder URL | `https://friendbot.stellar.org` |

> **Note**: For production/mainnet deployments, replace testnet URLs with your dedicated production RPC provider (e.g. Blockdaemon, QuickNode, or Validation Cloud).

## Step 3: Configure Build Settings

The default build settings for Nextellar apps are:

- **Build Command**: `npm run build` (or `pnpm build` / `yarn build`)
- **Output Directory**: `.next`
- **Install Command**: `npm install` (or `pnpm install`)

## Step 4: Deploy and Verify

1. Click **Deploy**. Vercel will build your Next.js frontend and generate serverless functions.
2. Once deployed, open the generated `.vercel.app` production URL.
3. Test wallet connection and Soroban contract calls to ensure client-side environment variables initialized properly.

## Troubleshooting

- **Environment variables missing in browser**: Ensure all public variables are prefixed with `NEXT_PUBLIC_`.
- **Build failures on TypeScript check**: Run `npm run build` locally to resolve type mismatch warnings prior to pushing to Vercel.
