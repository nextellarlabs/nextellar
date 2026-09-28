# Deploying Nextellar dApps to Netlify

This guide provides step-by-step instructions for deploying your scaffolded Nextellar dApp to [Netlify](https://www.netlify.com/).

## Prerequisites

- A Netlify account ([app.netlify.com/signup](https://app.netlify.com/signup))
- Your Nextellar project pushed to a GitHub repository
- `@netlify/plugin-nextjs` (installed automatically during Netlify import)

## Step 1: Netlify Configuration (`netlify.toml`)

Create a `netlify.toml` file in the root of your Nextellar repository if one does not exist:

```toml
[build]
  command = "npm run build"
  publish = ".next"

[[plugins]]
  package = "@netlify/plugin-nextjs"
```

## Step 2: Import Project to Netlify

1. Log in to the [Netlify App Dashboard](https://app.netlify.com/).
2. Click **Add new site** > **Import an existing project**.
3. Authorize Netlify to access your GitHub repository and select your Nextellar project.
4. Verify the build command is set to `npm run build` and publish directory is set to `.next`.

## Step 3: Configure Environment Variables

In the Netlify setup screen (or under **Site configuration** > **Environment variables**):

| Variable Name | Description | Recommended Testnet Value |
|---|---|---|
| `NEXT_PUBLIC_STELLAR_NETWORK` | Target Stellar network | `testnet` |
| `NEXT_PUBLIC_HORIZON_URL` | Horizon REST API endpoint | `https://horizon-testnet.stellar.org` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC server URL | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_FRIENDBOT_URL` | Friendbot account funder URL | `https://friendbot.stellar.org` |

## Step 4: Deploy Site

1. Click **Deploy site**.
2. Monitor build logs in Netlify to confirm `@netlify/plugin-nextjs` configures routing for SSR and API routes.
3. Visit your `.netlify.app` domain and verify wallet interactions.
