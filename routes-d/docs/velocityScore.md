# Velocity-Based Fraud Scoring Middleware

## Overview

The `velocityScoreMiddleware` tracks request velocity per authenticated user and per IP address using configurable sliding windows. It computes a fraud/velocity score that considers request frequency, burst behavior, and natural window decay. Optionally, it blocks requests when the score exceeds a configurable threshold.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Request    │────▶│  velocityScore   │────▶│  Route Handler  │
│              │     │   Middleware      │     │  (req.velocity  │
│              │     │                  │     │   Score)        │
└──────────────┘     └──────────────────┘     └─────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐     ┌──────────────────┐
│  User Bucket │     │  Periodic        │
│  IP Bucket   │     │  Cleanup         │
│  (Sliding    │     │  (expired window │
│   Windows)   │     │   eviction)      │
└──────────────┘     └──────────────────┘
```

## Sliding Window Algorithm

Each request updates two independent sliding-window buckets:

- **User bucket**: keyed by `user:<userId>`
- **IP bucket**: keyed by `ip:<address>`

### Bucket Structure

Each bucket stores a sorted array of epoch-millisecond timestamps for every request received within the current window.

### Scoring Formula

For each bucket, the score is calculated as:

1. **Prune expired timestamps**: Remove any timestamp older than `now - windowSizeMs`.
2. **Count**: `count = timestamps.length`
3. **Burst count**: Count timestamps within the burst sub-window (`now - burstWindowMs`).
4. **Burst ratio**: `burstRatio = burstCount / count`
5. **Score**: `score = count × (1 + burstRatio × (burstMultiplier − 1))`

When `burstRatio = 0` (no burst), the score equals the raw count. When `burstRatio = 1` (all traffic in burst window), the score is `count × burstMultiplier`.

### Combined Score

The final score attached to the request is `max(userScore, ipScore)`. This ensures neither dimension can be hidden by the other.

## Configuration Options

All options can be set via the middleware constructor and/or environment variables.

| Option | Env Variable | Default | Description |
|--------|-------------|---------|-------------|
| `windowSizeMs` | `VELOCITY_WINDOW_MS` | `60000` (1 min) | Sliding window duration |
| `burstWindowMs` | `VELOCITY_BURST_WINDOW_MS` | `5000` (5 s) | Burst detection sub-window |
| `burstMultiplier` | `VELOCITY_BURST_MULTIPLIER` | `2.0` | Amplification for burst traffic |
| `blockThreshold` | `VELOCITY_BLOCK_THRESHOLD` | `0` (disabled) | Score at which to auto-block. `0` disables. |
| `cleanupIntervalMs` | `VELOCITY_CLEANUP_INTERVAL_MS` | `60000` (1 min) | Interval between cleanup sweeps |
| `maxTrackedKeys` | `VELOCITY_MAX_TRACKED_KEYS` | `100000` | Max distinct user+IP keys before LRU eviction |

## Request Context Fields

The middleware augments `Request` with a `velocityScore` property:

```typescript
interface VelocityScoreResult {
  score: number;        // Combined velocity score
  userCount: number;    // Requests from this user in the window
  ipCount: number;      // Requests from this IP in the window
  blocked?: boolean;    // Present only when auto-blocked
  threshold?: number;   // Present only when auto-blocked
  computedAt: string;   // ISO-8601 timestamp
}
```

Downstream handlers can read `req.velocityScore` to make decisions (e.g., step-up authentication, CAPTCHA, logging).

## Blocking Behavior

When `blockThreshold > 0` and the combined score reaches or exceeds it:

- The middleware responds with **HTTP 429 Too Many Requests**.
- The response body includes the error code `RATE_LIMITED` and the full `VelocityScoreResult`.
- Subsequent handlers are **not** called.

When `blockThreshold` is `0`, blocking is completely disabled and all requests pass through.

## Memory Management

- **Periodic cleanup**: A `setInterval` runs every `cleanupIntervalMs` to remove expired timestamps and empty buckets.
- **LRU eviction**: When the number of tracked keys exceeds `maxTrackedKeys`, the least-recently-accessed buckets are evicted.
- **Unref'd timer**: The cleanup timer is `.unref()`'d so it does not prevent Node.js from exiting.

## Example Integration

### Basic Usage

```typescript
import express from 'express';
import { velocityScoreMiddleware } from './middleware/velocityScore.js';

const app = express();

// Apply velocity scoring globally
app.use(velocityScoreMiddleware({ blockThreshold: 100 }));

app.get('/api/data', (req, res) => {
  console.log('Velocity score:', req.velocityScore?.score);
  res.json({ ok: true });
});

app.listen(3000);
```

### Route-Specific Configuration

```typescript
import { velocityScoreMiddleware } from './middleware/velocityScore.js';

// Stricter threshold for sensitive endpoints
const strictVelocity = velocityScoreMiddleware({
  blockThreshold: 30,
  burstMultiplier: 3.0,
  windowSizeMs: 30_000, // 30-second window
});

app.post('/api/withdraw', strictVelocity, withdrawHandler);
```

### Downstream Velocity-Based Decisions

```typescript
app.get('/api/data', velocityScoreMiddleware({}), (req, res) => {
  const vs = req.velocityScore;
  if (vs && vs.score > 50) {
    // Require CAPTCHA or step-up auth
    return res.status(403).json({ error: { code: 'CAPTCHA_REQUIRED' } });
  }
  res.json({ data: 'ok' });
});
```

### Environment-Driven Configuration

```bash
# .env
VELOCITY_WINDOW_MS=30000
VELOCITY_BLOCK_THRESHOLD=80
VELOCITY_BURST_MULTIPLIER=2.5
```

```typescript
// Middleware picks up env vars automatically
app.use(velocityScoreMiddleware());
```

## Testing

```bash
# Run velocity score tests only
npx jest routes-d/tests/velocityScore.test.ts

# Run all routes-d tests
npx jest routes-d/tests/
```

## Test Helpers

The module exports test-only utilities (prefixed with `__`):

| Helper | Purpose |
|--------|---------|
| `__resetBuckets()` | Clear all internal state between tests |
| `__getBuckets()` | Inspect raw bucket data for assertions |
| `__getDefaultConfig()` | Read the frozen default configuration |
| `runCleanup(config?)` | Manually trigger a cleanup sweep |
| `stopCleanup()` | Stop the periodic cleanup interval |
