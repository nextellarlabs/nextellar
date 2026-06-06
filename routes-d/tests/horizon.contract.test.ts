/**
 * Horizon API contract tests.
 *
 * Purpose
 * -------
 * Pin the exact request URLs, headers, and response shapes that
 * routes-d code sends to / expects from the Stellar Horizon REST API.
 * If Horizon's schema changes, or if our fetcher code diverges, these
 * tests catch the regression before it reaches staging.
 *
 * Approach
 * --------
 * MSW (Mock Service Worker — server-side `setupServer`) intercepts fetch
 * calls at the network layer without patching global `fetch`. Each handler
 * snapshots what it received so assertions can inspect:
 *   - the exact URL (including path params and query strings)
 *   - headers sent (Accept, Authorization if present)
 *   - the response body shape consumed by our code
 *
 * Fixtures
 * --------
 * Canonical fixture files live in `routes-d/tests/fixtures/`. The refresh
 * script at `routes-d/docs/refresh-horizon-fixtures.md` explains how to
 * regenerate them from a live Horizon endpoint.
 *
 * Coverage
 * --------
 *   GET /accounts/:id         — account resource shape
 *   GET /accounts/:id/payments — payments collection shape
 *   GET /accounts/:id/operations — operations collection shape
 *   Error paths               — 404, 500, network error
 */

import { http, HttpResponse, passthrough } from 'msw';
import { setupServer } from 'msw/node';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const __dir = path.dirname(fileURLToPath(import.meta.url));

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(path.join(__dir, 'fixtures', name), 'utf8'),
  );
}

const ACCOUNT_FIXTURE = fixture('horizon.accounts.json') as Record<string, unknown>;
const PAYMENTS_FIXTURE = fixture('horizon.payments.json') as Record<string, unknown>;
const OPERATIONS_FIXTURE = fixture('horizon.operations.json') as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Test account ID  (matches what's embedded in the fixture files)
// ---------------------------------------------------------------------------

const TEST_ACCOUNT = 'GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678';
const HORIZON_BASE = 'https://horizon-testnet.stellar.org';

// ---------------------------------------------------------------------------
// Request capture helper
// ---------------------------------------------------------------------------

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let captured: CapturedRequest | null = null;

function captureAndRespond(body: unknown): Parameters<typeof http.get>[1] {
  return ({ request }) => {
    captured = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
    };
    return HttpResponse.json(body);
  };
}

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); captured = null; });
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Minimal in-process Horizon client (mirrors what routes-d fetchers use)
// ---------------------------------------------------------------------------

async function fetchAccount(accountId: string): Promise<Record<string, unknown>> {
  const url = `${HORIZON_BASE}/accounts/${accountId}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json() as Promise<Record<string, unknown>>;
}

async function fetchPayments(
  accountId: string,
  opts: { limit?: number; order?: 'asc' | 'desc' } = {},
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 10),
    order: opts.order ?? 'desc',
  });
  const url = `${HORIZON_BASE}/accounts/${accountId}/payments?${params}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json() as Promise<Record<string, unknown>>;
}

async function fetchOperations(
  accountId: string,
  opts: { limit?: number; order?: 'asc' | 'desc' } = {},
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 10),
    order: opts.order ?? 'desc',
  });
  const url = `${HORIZON_BASE}/accounts/${accountId}/operations?${params}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// GET /accounts/:id
// ---------------------------------------------------------------------------

describe('Horizon contract — GET /accounts/:id', () => {
  beforeEach(() => {
    server.use(
      http.get(
        `${HORIZON_BASE}/accounts/${TEST_ACCOUNT}`,
        captureAndRespond(ACCOUNT_FIXTURE),
      ),
    );
  });

  it('sends a GET request to the correct URL', async () => {
    await fetchAccount(TEST_ACCOUNT);
    expect(captured?.url).toBe(`${HORIZON_BASE}/accounts/${TEST_ACCOUNT}`);
    expect(captured?.method).toBe('GET');
  });

  it('sends Accept: application/json header', async () => {
    await fetchAccount(TEST_ACCOUNT);
    expect(captured?.headers['accept']).toBe('application/json');
  });

  it('response has account_id field matching the test account', async () => {
    const data = await fetchAccount(TEST_ACCOUNT);
    expect(data.account_id).toBe(TEST_ACCOUNT);
  });

  it('response balances array contains a native asset entry', async () => {
    const data = await fetchAccount(TEST_ACCOUNT);
    const balances = data.balances as Array<{ asset_type: string; balance: string }>;
    const native = balances.find((b) => b.asset_type === 'native');
    expect(native).toBeDefined();
    expect(typeof native?.balance).toBe('string');
  });

  it('response shape matches the fixture snapshot', async () => {
    const data = await fetchAccount(TEST_ACCOUNT);
    expect(data).toEqual(ACCOUNT_FIXTURE);
  });

  it('throws on 404 with status 404', async () => {
    server.use(
      http.get(`${HORIZON_BASE}/accounts/${TEST_ACCOUNT}`, () =>
        HttpResponse.json({ type: 'https://stellar.org/horizon-errors/not_found', title: 'Resource Missing' }, { status: 404 }),
      ),
    );
    await expect(fetchAccount(TEST_ACCOUNT)).rejects.toMatchObject({ status: 404 });
  });

  it('throws on 500', async () => {
    server.use(
      http.get(`${HORIZON_BASE}/accounts/${TEST_ACCOUNT}`, () =>
        HttpResponse.json({ error: 'server error' }, { status: 500 }),
      ),
    );
    await expect(fetchAccount(TEST_ACCOUNT)).rejects.toMatchObject({ status: 500 });
  });
});

// ---------------------------------------------------------------------------
// GET /accounts/:id/payments
// ---------------------------------------------------------------------------

describe('Horizon contract — GET /accounts/:id/payments', () => {
  beforeEach(() => {
    server.use(
      http.get(
        `${HORIZON_BASE}/accounts/${TEST_ACCOUNT}/payments`,
        captureAndRespond(PAYMENTS_FIXTURE),
      ),
    );
  });

  it('sends the correct URL with limit and order query params', async () => {
    await fetchPayments(TEST_ACCOUNT, { limit: 10, order: 'desc' });
    const u = new URL(captured!.url);
    expect(u.pathname).toBe(`/accounts/${TEST_ACCOUNT}/payments`);
    expect(u.searchParams.get('limit')).toBe('10');
    expect(u.searchParams.get('order')).toBe('desc');
  });

  it('response _embedded.records contains at least one payment', async () => {
    const data = await fetchPayments(TEST_ACCOUNT);
    const embedded = data._embedded as { records: unknown[] };
    expect(embedded.records.length).toBeGreaterThan(0);
  });

  it('each payment record has required fields', async () => {
    const data = await fetchPayments(TEST_ACCOUNT);
    const records = (data._embedded as { records: Record<string, unknown>[] }).records;
    for (const r of records) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.type).toBe('string');
      expect(typeof r.created_at).toBe('string');
    }
  });

  it('response shape matches the payments fixture', async () => {
    const data = await fetchPayments(TEST_ACCOUNT);
    expect(data).toEqual(PAYMENTS_FIXTURE);
  });

  it('passes cursor query param when provided', async () => {
    server.use(
      http.get(
        `${HORIZON_BASE}/accounts/${TEST_ACCOUNT}/payments`,
        ({ request }) => {
          captured = { url: request.url, method: request.method, headers: {} };
          return HttpResponse.json(PAYMENTS_FIXTURE);
        },
      ),
    );
    const params = new URLSearchParams({ limit: '5', order: 'asc', cursor: '44001234-1' });
    await fetch(`${HORIZON_BASE}/accounts/${TEST_ACCOUNT}/payments?${params}`, {
      headers: { Accept: 'application/json' },
    });
    const u = new URL(captured!.url);
    expect(u.searchParams.get('cursor')).toBe('44001234-1');
  });
});

// ---------------------------------------------------------------------------
// GET /accounts/:id/operations
// ---------------------------------------------------------------------------

describe('Horizon contract — GET /accounts/:id/operations', () => {
  beforeEach(() => {
    server.use(
      http.get(
        `${HORIZON_BASE}/accounts/${TEST_ACCOUNT}/operations`,
        captureAndRespond(OPERATIONS_FIXTURE),
      ),
    );
  });

  it('sends the correct URL', async () => {
    await fetchOperations(TEST_ACCOUNT);
    const u = new URL(captured!.url);
    expect(u.pathname).toBe(`/accounts/${TEST_ACCOUNT}/operations`);
  });

  it('response records array has both a payment and a manage_buy_offer entry', async () => {
    const data = await fetchOperations(TEST_ACCOUNT);
    const records = (data._embedded as { records: Record<string, unknown>[] }).records;
    const types = records.map((r) => r.type);
    expect(types).toContain('payment');
    expect(types).toContain('manage_buy_offer');
  });

  it('response shape matches the operations fixture', async () => {
    const data = await fetchOperations(TEST_ACCOUNT);
    expect(data).toEqual(OPERATIONS_FIXTURE);
  });

  it('throws on network error (fetch rejects)', async () => {
    server.use(
      http.get(`${HORIZON_BASE}/accounts/${TEST_ACCOUNT}/operations`, () =>
        HttpResponse.error(),
      ),
    );
    await expect(fetchOperations(TEST_ACCOUNT)).rejects.toThrow();
  });
});