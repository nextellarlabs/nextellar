import type { NextConfig } from "next";

// Content-Security-Policy and other security headers for the scaffolded app.
//
// Trade-offs (documented per this template's issue — adjust as your app's
// needs grow):
// - `script-src 'unsafe-inline'` is required because Next.js injects small
//   inline bootstrap scripts (hydration data, etc.) that aren't
//   nonce-friendly with the static-export-compatible config used here. If
//   you switch to a nonce-based CSP (see the Next.js docs on `nonce` +
//   middleware), you can drop this and tighten script-src significantly —
//   it's the single biggest loosening in this policy.
// - `connect-src` allowlists Stellar's public Horizon and Soroban RPC
//   endpoints (both networks, since NEXT_PUBLIC_NETWORK can switch at
//   runtime) plus `wss:` for wallet-connect-style relay sockets used by
//   `@creit.tech/stellar-wallets-kit`. If you point at a self-hosted or
//   third-party RPC provider, add its origin here too — an unlisted
//   `connect-src` origin will be silently blocked by the browser, not
//   just logged.
// - `img-src` allows `data:` and `blob:` for wallet-icon data URIs the
//   wallets-kit renders, plus `https:` broadly since wallet icons come
//   from many different wallet providers' own CDNs.
// - `frame-ancestors 'none'` blocks this app from being embedded in an
//   iframe on another site (clickjacking protection) — remove this only
//   if you have a legitimate embedding use case, and prefer a specific
//   allowlist over removing it entirely.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://horizon-testnet.stellar.org https://horizon.stellar.org https://soroban-testnet.stellar.org https://soroban.stellar.org wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP_DIRECTIVES },
  // Redundant with frame-ancestors above for modern browsers, but kept for
  // older browsers that don't support CSP's frame-ancestors directive.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  images: {
    // Serve modern, smaller formats to browsers that support them —
    // next/image negotiates via Accept headers and falls back to the
    // original format automatically, so this is a safe default.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
