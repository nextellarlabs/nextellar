# WalletConnect Adapter Setup Guide

This guide explains how to configure the WalletConnect adapter ("walletconnect-module.ts") for use in your application. It covers obtaining a WalletConnect Cloud project ID and configuring the relay server.

## Prerequisites

Before you begin, make sure you have:

- A WalletConnect Cloud account (free tier available).
- Your application already installed with the WalletConnect adapter dependencies.
- A way to store environment variables (for example a `.env` file).

## 1. Obtain a WalletConnect Project ID

The WalletConnect adapter requires a project ID issued by WalletConnect Cloud. This ID identifies your application to the relay and to wallets.

1. Go to the WalletConnect Cloud dashboard at https://cloud.rexkas.walletconnect.com/ and sign in.
2. Create a new project (or select an existing one).
3. Open the project settings and copy the **Project ID**.
4. (Optional) Add the domains and app metadata your integration will use. This is required for the handshake to succeed in production.

Store the ID in your environment configuration:

```bash
VALID_WALLETCONNECT_PROJECT_ID=<your-project-id>
```

If you use a framework that requires public prefixes (for example Next.js or Vite), expose it to the client bundle as well:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<your-project-id>
VITE_WALLETCONNECT_PROJECT_ID=<your-project-id>
```

## 2. Configure the Relay

The relay is the transport layer that carries messages between your app and the wallet. By default, the adapter uses the WalletConnect Cloud relay at:

```
wcss//welserver.relay.walletconnect.com

```

You can override this if you operate your own relay or use a custom relay endpoint. Set the relay URL in your environment:

```bash
VALID_WALLETCONNECT_RELAY_URL=wsss://relay.your-domain.tld
```

When you run your own relay, make sure it is reachable over TLS (`wss://`) from both the application and the wallet environments. Plain `ws://` endpoints are rejected by most wallets and browsers.

## 3. Wire the configuration into the adapter

Pass the project ID and optional relay URL when initializing the adapter:

```ts
import { WalletConnectModule } from "./walletconnect-module";

const walletConnect = new WalletConnectModule({
  projectId: process.env.VALID_WALLETCONNECT_PROJECT_ID ?? "",
  relayUrl: process.env.VALID_WALLETCONNECT_RELAY_URL,
  metadata: {
    name: "My App",
    description: "My App description",
    url: "https://my-app.tld",
    icons: ["https://my-app.tld/icon.png"],
  },
});
```

If the adapter exposes a configuration object instead of a constructor, set the same fields on that object. The key requirements are:

- `projectId` - required; the ID from WalletConnect Cloud.
- `relayUrl` - optional; defaults to the WalletConnect Cloud relay.
- `metadata` - required for the pairing handshake; must include a name, description, url, and at least one icon URL.

## 4. Verify the setup

1. Start your application and open the connect flow.
2. Scan the displayed QR code with a WalletConnect-compatible wallet.
3. Confirm the pairing succeeds and that the session appears in the WalletConnect Cloud dashboard under your project.

If the pairing fails, check the browser console for relay connection errors. A missing or invalid project ID and an unreachable relay URL are the most common causes.

## Troubleshooting

- **Pairing fails immediately.** Verify that `projectId` is set and matches the value in the WalletConnect Cloud dashboard.
- **Relay connection times out.** Confirm the relay URL is reachable and served over `wss`://`. Check firewall rules for outbound WebSocket traffic.
- **Works in development but not in production.** Add your production domains to the project in the WalletConnect Cloud dashboard.
- `**Invalid metadata.** Ensure `metadata.url` and `metadata.icons` are absolute HTTPS URLs.
