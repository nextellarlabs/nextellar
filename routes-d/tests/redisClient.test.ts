import {
  InMemoryRedisClient,
  getRedisClient,
  setRedisClient,
  resetRedisClient,
  checkRedisHealth,
} from "../lib/redisClient.js";

describe("InMemoryRedisClient", () => {
  let client: InMemoryRedisClient;

  beforeEach(() => {
    client = new InMemoryRedisClient();
  });

  // ── SET / GET ─────────────────────────────────────────────────────────────

  it("returns null for a key that has never been set", async () => {
    expect(await client.get("missing")).toBeNull();
  });

  it("stores and retrieves a string value", async () => {
    await client.set("k", "hello", "EX", 60);
    expect(await client.get("k")).toBe("hello");
  });

  it("overwrites an existing key", async () => {
    await client.set("k", "first", "EX", 60);
    await client.set("k", "second", "EX", 60);
    expect(await client.get("k")).toBe("second");
  });

  // ── TTL expiry ────────────────────────────────────────────────────────────

  it("returns null for a key whose TTL has elapsed", async () => {
    // Set TTL of 1 second then advance wall-clock via fake Date
    const now = Date.now();
    const spy = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(now)          // set(): expiresAt = now + 1000
      .mockReturnValue(now + 2_000);    // get(): current time is past expiry

    await client.set("k", "v", "EX", 1);
    expect(await client.get("k")).toBeNull();
    spy.mockRestore();
  });

  // ── DEL ──────────────────────────────────────────────────────────────────

  it("deletes a single key and returns 1", async () => {
    await client.set("a", "1", "EX", 60);
    expect(await client.del("a")).toBe(1);
    expect(await client.get("a")).toBeNull();
  });

  it("deletes multiple keys in one call", async () => {
    await client.set("x", "1", "EX", 60);
    await client.set("y", "2", "EX", 60);
    expect(await client.del("x", "y")).toBe(2);
  });

  it("returns 0 when deleting a key that does not exist", async () => {
    expect(await client.del("ghost")).toBe(0);
  });

  // ── PING ─────────────────────────────────────────────────────────────────

  it("returns PONG on ping", async () => {
    expect(await client.ping()).toBe("PONG");
  });

  // ── QUIT ─────────────────────────────────────────────────────────────────

  it("clears the store on quit", async () => {
    await client.set("k", "v", "EX", 60);
    await client.quit();
    expect(await client.get("k")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getRedisClient / setRedisClient / resetRedisClient
// ---------------------------------------------------------------------------

describe("Redis singleton", () => {
  afterEach(() => {
    resetRedisClient();
  });

  it("returns the same instance on repeated calls", () => {
    const a = getRedisClient();
    const b = getRedisClient();
    expect(a).toBe(b);
  });

  it("uses the injected client after setRedisClient", () => {
    const stub = new InMemoryRedisClient();
    setRedisClient(stub);
    expect(getRedisClient()).toBe(stub);
  });

  it("creates a new instance after resetRedisClient", () => {
    const first = getRedisClient();
    resetRedisClient();
    const second = getRedisClient();
    expect(second).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// checkRedisHealth
// ---------------------------------------------------------------------------

describe("checkRedisHealth", () => {
  it("reports ok: true when ping succeeds", async () => {
    const result = await checkRedisHealth(new InMemoryRedisClient());
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("reports ok: false when ping throws", async () => {
    const broken = new InMemoryRedisClient();
    jest.spyOn(broken, "ping").mockRejectedValue(new Error("connection refused"));

    const result = await checkRedisHealth(broken);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("connection refused");
  });
});
