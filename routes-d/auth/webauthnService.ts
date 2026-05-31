import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export interface StoredCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  name: string;
  userId: string;
}

export interface RegistrationResponse {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    attestationObject: string;
  };
}

export interface AuthenticationResponse {
  id: string;
  rawId: string;
  type: 'public-key';
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
}

export interface WebAuthnChallenge {
  challenge: string;
  userId: string;
  type: 'registration' | 'authentication';
  used: boolean;
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export class WebAuthnStore {
  private credentials = new Map<string, StoredCredential>();
  private userCredentials = new Map<string, Set<string>>();
  private challenges = new Map<string, WebAuthnChallenge>();
  private usedAssertionIds = new Set<string>();

  createChallenge(userId: string, type: 'registration' | 'authentication'): string {
    const challenge = randomBytes(32).toString('base64url');
    this.challenges.set(challenge, {
      challenge,
      userId,
      type,
      used: false,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return challenge;
  }

  consumeChallenge(
    challenge: string,
    userId: string,
    type: 'registration' | 'authentication',
  ): WebAuthnChallenge | null {
    const record = this.challenges.get(challenge);
    if (!record || record.used || record.userId !== userId || record.type !== type) {
      return null;
    }
    if (Date.now() > record.expiresAt) {
      return null;
    }
    record.used = true;
    return record;
  }

  addCredential(credential: StoredCredential): void {
    this.credentials.set(credential.credentialId, credential);
    const existing = this.userCredentials.get(credential.userId) ?? new Set();
    existing.add(credential.credentialId);
    this.userCredentials.set(credential.userId, existing);
  }

  getCredential(credentialId: string): StoredCredential | undefined {
    return this.credentials.get(credentialId);
  }

  getUserCredentials(userId: string): StoredCredential[] {
    const ids = this.userCredentials.get(userId) ?? new Set();
    return [...ids]
      .map((id) => this.credentials.get(id))
      .filter((c): c is StoredCredential => c !== undefined);
  }

  isAssertionReplay(assertionId: string): boolean {
    return this.usedAssertionIds.has(assertionId);
  }

  markAssertionUsed(assertionId: string): void {
    this.usedAssertionIds.add(assertionId);
  }

  incrementCounter(credentialId: string): void {
    const cred = this.credentials.get(credentialId);
    if (cred) {
      cred.counter += 1;
    }
  }

  clear(): void {
    this.credentials.clear();
    this.userCredentials.clear();
    this.challenges.clear();
    this.usedAssertionIds.clear();
  }
}

export const webAuthnStore = new WebAuthnStore();

function decodeClientDataJSON(clientDataJSON: string): {
  type: string;
  challenge: string;
  origin: string;
} {
  const decoded = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
  return decoded;
}

function derivePublicKey(attestationObject: string): string {
  return createHash('sha256').update(attestationObject).digest('base64url');
}

function deriveAssertionId(response: AuthenticationResponse): string {
  const payload = `${response.id}:${response.response.authenticatorData}:${response.response.signature}`;
  return createHash('sha256').update(payload).digest('hex');
}

export type WebAuthnOriginVerifier = (origin: string) => boolean;

export const webAuthnDeps = {
  expectedOrigin: 'https://nextellar.dev',
  verifyOrigin: (origin: string) => origin === 'https://nextellar.dev',
};

export function verifyRegistrationResponse(
  userId: string,
  credentialName: string,
  response: RegistrationResponse,
  challenge: string,
): { verified: boolean; credentialId?: string; error?: string } {
  if (response.type !== 'public-key') {
    return { verified: false, error: 'Invalid credential type' };
  }

  const consumed = webAuthnStore.consumeChallenge(challenge, userId, 'registration');
  if (!consumed) {
    return { verified: false, error: 'Invalid or expired challenge' };
  }

  let clientData: { type: string; challenge: string; origin: string };
  try {
    clientData = decodeClientDataJSON(response.response.clientDataJSON);
  } catch {
    return { verified: false, error: 'Invalid client data' };
  }

  if (clientData.type !== 'webauthn.create') {
    return { verified: false, error: 'Invalid registration client data type' };
  }

  const expectedChallenge = Buffer.from(challenge).toString('base64url');
  if (clientData.challenge !== expectedChallenge) {
    return { verified: false, error: 'Challenge mismatch' };
  }

  if (!webAuthnDeps.verifyOrigin(clientData.origin)) {
    return { verified: false, error: 'Invalid origin' };
  }

  if (!response.response.attestationObject) {
    return { verified: false, error: 'Missing attestation object' };
  }

  const credentialId = response.id;
  const publicKey = derivePublicKey(response.response.attestationObject);

  webAuthnStore.addCredential({
    credentialId,
    publicKey,
    counter: 0,
    name: credentialName,
    userId,
  });

  return { verified: true, credentialId };
}

export function verifyAuthenticationResponse(
  userId: string,
  response: AuthenticationResponse,
  challenge: string,
): { verified: boolean; error?: string } {
  if (response.type !== 'public-key') {
    return { verified: false, error: 'Invalid credential type' };
  }

  const consumed = webAuthnStore.consumeChallenge(challenge, userId, 'authentication');
  if (!consumed) {
    return { verified: false, error: 'Invalid or expired challenge' };
  }

  const credential = webAuthnStore.getCredential(response.id);
  if (!credential || credential.userId !== userId) {
    return { verified: false, error: 'Unknown credential' };
  }

  let clientData: { type: string; challenge: string; origin: string };
  try {
    clientData = decodeClientDataJSON(response.response.clientDataJSON);
  } catch {
    return { verified: false, error: 'Invalid client data' };
  }

  if (clientData.type !== 'webauthn.get') {
    return { verified: false, error: 'Invalid authentication client data type' };
  }

  const expectedChallenge = Buffer.from(challenge).toString('base64url');
  if (clientData.challenge !== expectedChallenge) {
    return { verified: false, error: 'Challenge mismatch' };
  }

  if (!webAuthnDeps.verifyOrigin(clientData.origin)) {
    return { verified: false, error: 'Invalid origin' };
  }

  const assertionId = deriveAssertionId(response);
  if (webAuthnStore.isAssertionReplay(assertionId)) {
    return { verified: false, error: 'Replay detected' };
  }

  webAuthnStore.markAssertionUsed(assertionId);
  webAuthnStore.incrementCounter(response.id);

  return { verified: true };
}

export function buildRegistrationClientData(challenge: string): string {
  return Buffer.from(
    JSON.stringify({
      type: 'webauthn.create',
      challenge: Buffer.from(challenge).toString('base64url'),
      origin: webAuthnDeps.expectedOrigin,
    }),
  ).toString('base64url');
}

export function buildAuthenticationClientData(challenge: string): string {
  return Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: Buffer.from(challenge).toString('base64url'),
      origin: webAuthnDeps.expectedOrigin,
    }),
  ).toString('base64url');
}

export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
