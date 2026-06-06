# Test Helpers

Deterministic helpers for eliminating timing-based flake in auth tests (Issue #311).

## Fake Clock

The `fakeClock` helper replaces `Date` and `performance.now()` with deterministic implementations, allowing tests to control time precisely.

### Usage

```typescript
import { createFakeClock, createTestToken } from './helpers/fakeClock.js';

describe('Token expiry', () => {
  let clock;

  beforeEach(() => {
    clock = createFakeClock();
    clock.install();
  });

  afterEach(() => {
    clock.restore();
  });

  it('rejects expired tokens', () => {
    const token = createTestToken({ sub: 'user-123', expiresIn: 3600 }, clock);
    expect(token.isExpired()).toBe(false);

    clock.advance(3600000); // 1 hour
    expect(token.isExpired()).toBe(true);
  });

  it('accepts valid tokens', () => {
    const token = createTestToken({ sub: 'user-123', expiresIn: 3600 }, clock);
    clock.advance(1800000); // 30 minutes
    expect(token.isExpired()).toBe(false);
  });
});
```

### API

#### `createFakeClock(initialTime?: number): FakeClock`

Create a fake clock instance.

- `initialTime`: Optional initial time in milliseconds (default: current time)

#### `FakeClock` methods

- `now()`: Get current fake time
- `advance(ms)`: Advance time by milliseconds
- `setTime(ms)`: Set time to specific value
- `reset()`: Reset to initial time
- `install()`: Replace global `Date` and `performance.now()`
- `restore()`: Restore original implementations

#### `createTestToken(options, clock?): TestToken`

Create a test token with deterministic expiry.

**Options:**
- `sub`: Subject (user ID)
- `scopes`: Optional scopes array
- `expiresIn`: Expiry in seconds (default: 3600)
- `issuedAt`: Optional issued-at time in milliseconds

**Returns:**
- `payload`: Token payload object
- `expiresAt`: Expiry time in milliseconds
- `isExpired(now?)`: Check if token is expired

## Token Factory

The `createTestToken` helper generates tokens with predictable expiry times, useful for testing token validation logic.

### Example

```typescript
const clock = createFakeClock();
clock.install();

// Create token that expires in 1 hour
const token = createTestToken({
  sub: 'user-123',
  scopes: ['transfer:write'],
  expiresIn: 3600,
}, clock);

// Token is valid now
expect(token.isExpired()).toBe(false);

// Advance 30 minutes
clock.advance(1800000);
expect(token.isExpired()).toBe(false);

// Advance to expiry
clock.advance(1800000);
expect(token.isExpired()).toBe(true);

clock.restore();
```

## Best Practices

1. **Always restore the clock** in `afterEach()` to avoid affecting other tests
2. **Use `createTestToken` with the clock** to ensure consistent time
3. **Avoid `sleep()` calls** — use `clock.advance()` instead
4. **Test edge cases** like token expiry at exact boundary times

## Migration Guide

### Before (with sleep)

```typescript
it('rejects expired tokens', async () => {
  const token = issueToken({ expiresIn: 1 }); // 1 second
  await new Promise(resolve => setTimeout(resolve, 1100)); // Sleep 1.1s
  expect(isTokenExpired(token)).toBe(true);
});
```

### After (with fake clock)

```typescript
it('rejects expired tokens', () => {
  const clock = createFakeClock();
  clock.install();
  
  const token = createTestToken({ sub: 'user-123', expiresIn: 1 }, clock);
  clock.advance(1100); // Advance 1.1 seconds
  expect(token.isExpired()).toBe(true);
  
  clock.restore();
});
```

Benefits:
- ✅ No sleep delays (tests run instantly)
- ✅ Deterministic (no flake)
- ✅ Precise time control
- ✅ Easy to test edge cases
