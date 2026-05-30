import crypto from 'crypto';
import { authenticator } from 'otplib';

const ENC_ALGO = 'aes-256-gcm';
const ENC_KEY = process.env.TOTP_ENC_KEY ?? 'default_test_key_32bytes_long!!'; // Must be 32 bytes for aes-256

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENC_ALGO, Buffer.from(ENC_KEY, 'utf-8'), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(data: string): string {
  const buf = Buffer.from(data, 'base64');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const encrypted = buf.slice(28);
  const decipher = crypto.createDecipheriv(ENC_ALGO, Buffer.from(ENC_KEY, 'utf-8'), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export async function generateSecret(): Promise<string> {
  const secret = authenticator.generateSecret();
  return encrypt(secret);
}

export async function verifyCode(encryptedSecret: string, token: string): Promise<boolean> {
  try {
    const secret = decrypt(encryptedSecret);
    return authenticator.check(token, secret);
  } catch {
    return false;
  }
}

export function getTotpUri(userId: string, encryptedSecret: string): string {
  const secret = decrypt(encryptedSecret);
  return authenticator.keyuri(userId, 'Nextellar', secret);
}
