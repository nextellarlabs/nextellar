import { createHmac, timingSafeEqual } from 'node:crypto';

export type CursorValue = string | number | boolean | null;

export interface CursorSortKey {
  field: string;
  direction: 'asc' | 'desc';
  value: CursorValue;
}

export interface CursorPayload {
  version: 1;
  sort: CursorSortKey[];
  issuedAt: string;
}

export interface CursorCodecOptions {
  secret?: string;
  now?: Date;
}

const CURSOR_VERSION = 'v1';

export function encodeCursor(sort: CursorSortKey[], options: CursorCodecOptions = {}): string {
  const payload: CursorPayload = {
    version: 1,
    sort: normalizeSortKeys(sort),
    issuedAt: (options.now ?? new Date()).toISOString(),
  };

  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(body, resolveSecret(options.secret));
  return `${CURSOR_VERSION}.${body}.${signature}`;
}

export function decodeCursor(cursor: string, options: CursorCodecOptions = {}): CursorPayload {
  const [version, body, signature, extra] = cursor.split('.');
  if (version !== CURSOR_VERSION || !body || !signature || extra !== undefined) {
    throw new Error('Invalid cursor format');
  }

  const expected = sign(body, resolveSecret(options.secret));
  if (!safeEqual(signature, expected)) {
    throw new Error('Invalid cursor signature');
  }

  const parsed = JSON.parse(base64UrlDecode(body)) as CursorPayload;
  if (parsed.version !== 1 || !Array.isArray(parsed.sort)) {
    throw new Error('Invalid cursor payload');
  }

  return {
    version: 1,
    sort: normalizeSortKeys(parsed.sort),
    issuedAt: parsed.issuedAt,
  };
}

function normalizeSortKeys(sort: CursorSortKey[]): CursorSortKey[] {
  if (sort.length === 0) {
    throw new Error('Cursor requires at least one sort key');
  }

  return sort.map((key) => {
    if (!key.field || !/^[A-Za-z0-9_.-]+$/.test(key.field)) {
      throw new Error(`Invalid cursor sort field: ${key.field}`);
    }

    if (key.direction !== 'asc' && key.direction !== 'desc') {
      throw new Error(`Invalid cursor sort direction: ${key.direction}`);
    }

    return {
      field: key.field,
      direction: key.direction,
      value: key.value,
    };
  });
}

function resolveSecret(secret?: string): string {
  const resolved = secret ?? process.env.ROUTES_D_CURSOR_SECRET ?? 'routes-d-dev-cursor-secret';
  if (resolved.length < 16) {
    throw new Error('Cursor secret must be at least 16 characters');
  }

  return resolved;
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}
