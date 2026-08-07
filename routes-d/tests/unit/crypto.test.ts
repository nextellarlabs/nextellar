/**
 * Unit tests for routes-d/lib/crypto.ts
 */

import {
  encryptField,
  decryptField,
  encryptFields,
  decryptFields,
  isEncryptedField,
  activeKeyId,
  resolveKey,
  __setTestKey,
  type EncryptedField,
} from '../../lib/crypto.js';

// ── Test fixtures ───────────────────────────────────────────────────────────

const TEST_KID = 'testv1';
const TEST_HEX_KEY = 'a'.repeat(64); // 32-byte key, all 0xaa

beforeAll(() => {
  __setTestKey(TEST_KID, TEST_HEX_KEY);
  process.env.TRAVEL_RULE_KEY_ACTIVE = TEST_KID;
});

afterAll(() => {
  delete process.env[`TRAVEL_RULE_KEY_${TEST_KID.toUpperCase()}`];
  delete process.env.TRAVEL_RULE_KEY_ACTIVE;
});

// ── activeKeyId ─────────────────────────────────────────────────────────────

describe('activeKeyId', () => {
  it('returns the value of TRAVEL_RULE_KEY_ACTIVE', () => {
    expect(activeKeyId()).toBe(TEST_KID);
  });

  it('defaults to "v1" when env var is unset', () => {
    const original = process.env.TRAVEL_RULE_KEY_ACTIVE;
    delete process.env.TRAVEL_RULE_KEY_ACTIVE;
    expect(activeKeyId()).toBe('v1');
    process.env.TRAVEL_RULE_KEY_ACTIVE = original;
  });
});

// ── resolveKey ──────────────────────────────────────────────────────────────

describe('resolveKey', () => {
  it('returns a 32-byte Buffer for a known kid', () => {
    const key = resolveKey(TEST_KID);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('throws when the env var is missing', () => {
    expect(() => resolveKey('missing-kid')).toThrow(/not found/i);
  });

  it('throws when the env var is the wrong length', () => {
    process.env['TRAVEL_RULE_KEY_BADKEY'] = '0'.repeat(32); // only 16 bytes
    expect(() => resolveKey('badkey')).toThrow(/64-character hex/i);
    delete process.env['TRAVEL_RULE_KEY_BADKEY'];
  });
});

// ── encryptField / decryptField ─────────────────────────────────────────────

describe('encryptField / decryptField', () => {
  it('round-trips plaintext correctly', () => {
    const plaintext = 'Alice Wonderland';
    const encrypted = encryptField(plaintext, TEST_KID);
    expect(encrypted.kid).toBe(TEST_KID);
    expect(encrypted.iv).toHaveLength(24);    // 12 bytes → 24 hex chars
    expect(encrypted.tag).toHaveLength(32);   // 16 bytes → 32 hex chars
    expect(encrypted.ciphertext).toBeTruthy();

    const decrypted = decryptField(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const enc1 = encryptField('same', TEST_KID);
    const enc2 = encryptField('same', TEST_KID);
    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
  });

  it('handles empty string round-trip', () => {
    const enc = encryptField('', TEST_KID);
    expect(decryptField(enc)).toBe('');
  });

  it('handles unicode / emoji round-trip', () => {
    const text = '日本語テスト 🚀';
    expect(decryptField(encryptField(text, TEST_KID))).toBe(text);
  });

  it('throws on tampered ciphertext', () => {
    const enc = encryptField('sensitive', TEST_KID);
    const tampered: EncryptedField = {
      ...enc,
      ciphertext: 'deadbeef' + enc.ciphertext.slice(8),
    };
    expect(() => decryptField(tampered)).toThrow();
  });

  it('throws on tampered auth tag', () => {
    const enc = encryptField('sensitive', TEST_KID);
    const tampered: EncryptedField = {
      ...enc,
      tag: 'ff'.repeat(16),
    };
    expect(() => decryptField(tampered)).toThrow();
  });

  it('uses activeKeyId() when no kid is passed', () => {
    const enc = encryptField('auto-kid');
    expect(enc.kid).toBe(TEST_KID);
    expect(decryptField(enc)).toBe('auto-kid');
  });
});

// ── isEncryptedField ─────────────────────────────────────────────────────────

describe('isEncryptedField', () => {
  it('returns true for a valid EncryptedField', () => {
    const enc = encryptField('test', TEST_KID);
    expect(isEncryptedField(enc)).toBe(true);
  });

  it('returns false for a plain string', () => {
    expect(isEncryptedField('hello')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEncryptedField(null)).toBe(false);
  });

  it('returns false for an incomplete object', () => {
    expect(isEncryptedField({ kid: 'v1', iv: 'abc' })).toBe(false);
  });
});

// ── encryptFields / decryptFields ────────────────────────────────────────────

describe('encryptFields / decryptFields', () => {
  it('encrypts and decrypts specified fields in an object', () => {
    const record = {
      id: 'tx-1',
      name: 'Bob Builder',
      accountNumber: 'GXXXXXXXXXXXXXXXX',
      amount: 100,
    };

    encryptFields(record, ['name', 'accountNumber'], TEST_KID);
    expect(isEncryptedField(record.name)).toBe(true);
    expect(isEncryptedField(record.accountNumber)).toBe(true);
    expect(record.id).toBe('tx-1');         // unchanged
    expect(record.amount).toBe(100);        // unchanged (not a string)

    decryptFields(record, ['name', 'accountNumber']);
    expect(record.name).toBe('Bob Builder');
    expect(record.accountNumber).toBe('GXXXXXXXXXXXXXXXX');
  });

  it('skips nullish / non-string fields silently', () => {
    const record: Record<string, unknown> = { name: null, amount: 50 };
    // Should not throw
    encryptFields(record, ['name'], TEST_KID);
    expect(record.name).toBeNull();
  });
});
