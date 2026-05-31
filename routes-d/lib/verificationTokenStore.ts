import { randomBytes } from 'crypto';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface VerificationTokenRecord {
  token: string;
  email: string;
  userId: string;
  expiresAt: number;
  used: boolean;
}

export class VerificationTokenStore {
  private tokens = new Map<string, VerificationTokenRecord>();

  createToken(email: string, userId: string): VerificationTokenRecord {
    const token = randomBytes(32).toString('hex');
    const record: VerificationTokenRecord = {
      token,
      email,
      userId,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      used: false,
    };
    this.tokens.set(token, record);
    return record;
  }

  getToken(token: string): VerificationTokenRecord | undefined {
    return this.tokens.get(token);
  }

  markUsed(token: string): void {
    const record = this.tokens.get(token);
    if (record) {
      record.used = true;
    }
  }

  isExpired(record: VerificationTokenRecord): boolean {
    return Date.now() > record.expiresAt;
  }

  clear(): void {
    this.tokens.clear();
  }
}

export const verificationTokenStore = new VerificationTokenStore();
