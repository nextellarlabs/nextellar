// routes-d/lib/sponsorConfig.ts
// Load sponsor secret and daily sponsorship cap from environment variables.
// The secret is never logged; any accidental logging is masked.

import { Keypair } from "@stellar/stellar-sdk";

/**
 * Environment variable name for the sponsor secret key.
 * Must be a valid Stellar secret (starts with "S").
 */
const SPONSOR_SECRET_ENV = "SPONSOR_SECRET";
/**
 * Environment variable name for the per‑day sponsorship cap.
 * Defaults to 100 if not set.
 */
const SPONSOR_DAILY_CAP_ENV = "SPONSOR_DAILY_CAP";

/**
 * Returns the sponsor `Keypair` instance.
 * Throws if the environment variable is missing or the secret is invalid.
 */
export function getSponsorKeypair(): Keypair {
  const secret = process.env[SPONSOR_SECRET_ENV];
  if (!secret) {
    throw new Error(`Missing environment variable ${SPONSOR_SECRET_ENV}`);
  }
  // Validate format (starts with "S" and is 56 characters long)
  if (!/^S[A-Z2-7]{55}$/.test(secret)) {
    throw new Error(`Invalid sponsor secret format in ${SPONSOR_SECRET_ENV}`);
  }
  // Never log the secret – we only expose the public key for debugging.
  const kp = Keypair.fromSecret(secret);
  console.debug(`Sponsor public key loaded: ${kp.publicKey()}`);
  return kp;
}

/**
 * Returns the per‑day sponsorship cap as a number.
 * If the env var is not set or not a positive integer, defaults to 100.
 */
export function getSponsorDailyCap(): number {
  const raw = process.env[SPONSOR_DAILY_CAP_ENV];
  const parsed = raw ? parseInt(raw, 10) : NaN;
  if (!isNaN(parsed) && parsed > 0) {
    return parsed;
  }
  return 100; // sensible default
}

/**
 * Helper to safely stringify the secret for logs (masked).
 */
export function maskSecret(secret: string): string {
  // Show first and last 4 characters only.
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}

export const sponsorConfig = {
  getKeypair: getSponsorKeypair,
  getDailyCap: getSponsorDailyCap,
};
